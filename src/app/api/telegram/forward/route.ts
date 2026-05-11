import { createClient } from "@/lib/telegram";
import { buildMediaInfo } from "@/lib/telegram-media";
import { Api } from "telegram";
import bigInt from "big-integer";
import { createWriteStream, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_SIZE = 512 * 1024; // 512 KB per chunk

/** Error message patterns that indicate forwarding is restricted by the source chat. */
const RESTRICTED_PATTERNS = [
  /CHAT_FORWARDS_RESTRICTED/i,
  /FORWARD_RESTRICTED/i,
  /noforwards/i,
];

function isRestrictedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return RESTRICTED_PATTERNS.some((re) => re.test(error.message));
}

/**
 * Stream a single message's media to a temporary file on disk.
 *
 * Writing to disk (rather than accumulating a Buffer) avoids the
 * GramJS `CustomBuffer` bug where an empty `filePath` string causes
 * "Either one of `buffer` or `filePath` should be specified" for large
 * files — because GramJS natively reads a file-path string via `fs`.
 */
async function downloadToTempFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  groupId: string,
  messageId: number
): Promise<{ filePath: string; fileName: string; mimeType: string } | null> {
  const messages = await client.getMessages(groupId, { ids: [messageId] });
  const msg = messages[0];
  if (!msg || !msg.media) return null;

  const info = buildMediaInfo(msg.media as Api.TypeMessageMedia, messageId);
  if (!info) return null;

  const totalSize = info.fileSize.toJSNumber();
  const limitChunks = Math.ceil(totalSize / REQUEST_SIZE) + 1;

  // Create a uniquely-named temp file — keep the original extension so
  // Telegram can infer the media type correctly on upload.
  const ext = info.fileName.includes(".") ? info.fileName.slice(info.fileName.lastIndexOf(".")) : "";
  const tmpPath = join(tmpdir(), `tg_fwd_${randomBytes(8).toString("hex")}${ext}`);

  const writeStream = createWriteStream(tmpPath);

  try {
    const iter = client.iterDownload({
      file: info.location,
      offset: bigInt(0),
      requestSize: REQUEST_SIZE,
      chunkSize: REQUEST_SIZE,
      limit: limitChunks,
      dcId: info.dcId,
      fileSize: info.fileSize,
    });

    // Write chunks to disk as they arrive — only 512 KB in memory at a time
    for await (const chunk of iter) {
      const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buf, (err) => (err ? reject(err) : resolve()));
      });
    }

    // Flush and close the write stream
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    // Make sure the stream is closed and temp file cleaned up on error
    writeStream.destroy();
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }

  return { filePath: tmpPath, fileName: info.fileName, mimeType: info.mimeType };
}

/**
 * Re-send a list of messages to the destination by downloading each one's
 * media to a temp file, then uploading it fresh via `sendFile`.
 *
 * Passing a file-path *string* to GramJS is the only approach that works
 * reliably for both small and large files:
 *  - Buffer approach: GramJS creates CustomFile("", buffer) internally;
 *    for files > 20 MB it takes the `filePath` branch, reads `file.path`
 *    which is "" (falsy), and CustomBuffer throws.
 *  - CustomFile via require(): different module instance → instanceof fails.
 *  - File path string: GramJS calls fs.lstat → reads it natively, works
 *    for any size.
 */
async function resendAsNewMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  fromGroupId: string,
  toGroupId: string,
  messageIds: number[]
): Promise<void> {
  for (const messageId of messageIds) {
    // Re-fetch to get the caption (message text) alongside media info
    const [msgResult, fileResult] = await Promise.all([
      client.getMessages(fromGroupId, { ids: [messageId] }),
      downloadToTempFile(client, fromGroupId, messageId),
    ]);

    if (!fileResult) {
      console.warn(`[forward] message ${messageId} has no downloadable media — skipping`);
      continue;
    }

    const caption: string = msgResult[0]?.message ?? "";

    try {
      // Pass the file path as a plain string — GramJS handles it natively
      // via fs.lstat + fs.stat, correctly for any file size.
      await client.sendFile(toGroupId, {
        file: fileResult.filePath,
        caption,
        forceDocument: false,
        supportsStreaming: true,
      });
    } finally {
      // Always clean up the temp file
      await fsp.unlink(fileResult.filePath).catch((e) => {
        console.warn(`[forward] failed to delete temp file ${fileResult.filePath}:`, e);
      });
    }
  }
}

export async function POST(request: Request) {
  let client;

  try {
    const { sessionString, fromGroupId, toGroupId, messageIds } = await request.json();

    if (
      !sessionString ||
      !fromGroupId ||
      !toGroupId ||
      !Array.isArray(messageIds) ||
      messageIds.length === 0
    ) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const parsedMessageIds = (messageIds as unknown[])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));

    if (parsedMessageIds.length === 0) {
      return Response.json({ error: "Invalid message IDs" }, { status: 400 });
    }

    client = createClient(sessionString);
    await client.connect();

    // ── Step 1: Try the fast native forward ──────────────────────────────
    try {
      await client.forwardMessages(toGroupId, {
        messages: parsedMessageIds,
        fromPeer: fromGroupId,
      });
      return Response.json({ success: true, method: "forward" });
    } catch (forwardError: unknown) {
      if (!isRestrictedError(forwardError)) {
        // Not a restriction error — propagate to the outer catch → 500
        throw forwardError;
      }

      // ── Step 2: Restricted — download to temp file → re-upload ──────────
      console.info(
        `[forward] native forward blocked (${(forwardError as Error).message}), ` +
          `falling back to download→resend for ${parsedMessageIds.length} message(s)`
      );

      await resendAsNewMessages(client, fromGroupId, toGroupId, parsedMessageIds);
      return Response.json({ success: true, method: "resend" });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to forward messages";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore disconnect failures
      }
    }
  }
}
