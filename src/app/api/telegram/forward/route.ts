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

/** Pick the largest downloadable thumb size from a document's thumbs array. */
function pickBestThumb(
  thumbs: readonly Api.TypePhotoSize[] | undefined
): { type: string; size: number } | null {
  if (!thumbs || thumbs.length === 0) return null;
  let best: { type: string; size: number } | null = null;
  for (const t of thumbs) {
    if (t instanceof Api.PhotoSize) {
      if (!best || t.size > best.size) best = { type: t.type, size: t.size };
    } else if (t instanceof Api.PhotoSizeProgressive) {
      const max = t.sizes[t.sizes.length - 1] ?? 0;
      if (!best || max > best.size) best = { type: t.type, size: max };
    }
    // PhotoStrippedSize / PhotoCachedSize / PhotoPathSize are inline and
    // can't be fetched via InputDocumentFileLocation — skip them.
  }
  return best;
}

/** Download a document's thumbnail to a temp file. Returns null on any failure. */
async function downloadThumbToTempFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  doc: Api.Document,
  thumb: { type: string; size: number }
): Promise<string | null> {
  const tmpPath = join(tmpdir(), `tg_fwd_thumb_${randomBytes(8).toString("hex")}.jpg`);
  const writeStream = createWriteStream(tmpPath);
  try {
    const iter = client.iterDownload({
      file: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: thumb.type,
      }),
      offset: bigInt(0),
      requestSize: REQUEST_SIZE,
      chunkSize: REQUEST_SIZE,
      limit: Math.ceil(thumb.size / REQUEST_SIZE) + 1,
      dcId: doc.dcId,
      fileSize: bigInt(thumb.size),
    });
    for await (const chunk of iter) {
      const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buf, (err) => (err ? reject(err) : resolve()));
      });
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    return tmpPath;
  } catch (err) {
    writeStream.destroy();
    await fsp.unlink(tmpPath).catch(() => {});
    console.warn(`[forward] thumb download failed, continuing without thumb:`, err);
    return null;
  }
}

/**
 * Stream a single message's media to a temporary file on disk.
 *
 * Writing to disk (rather than accumulating a Buffer) avoids the
 * GramJS `CustomBuffer` bug where an empty `filePath` string causes
 * "Either one of `buffer` or `filePath` should be specified" for large
 * files — because GramJS natively reads a file-path string via `fs`.
 */
type ProgressEmitter = (event: ProgressEvent) => void;

/** Sentinel thrown when the client disconnects mid-operation. */
class ClientDisconnected extends Error {
  constructor() {
    super("client disconnected");
    this.name = "ClientDisconnected";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ClientDisconnected();
}

type ProgressEvent =
  | { type: "start"; total: number }
  | { type: "forwarding" }
  | { type: "message_start"; messageId: number; index: number; size: number | null }
  | { type: "download_progress"; messageId: number; index: number; loaded: number; total: number }
  | { type: "download_done"; messageId: number; index: number }
  | { type: "upload_progress"; messageId: number; index: number; progress: number }
  | { type: "upload_done"; messageId: number; index: number }
  | { type: "message_skipped"; messageId: number; index: number; reason: string }
  | { type: "done"; method: "forward" | "resend" }
  | { type: "error"; message: string };

async function downloadToTempFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  groupId: string,
  messageId: number,
  index: number,
  emit: ProgressEmitter,
  signal: AbortSignal
): Promise<{
  filePath: string;
  fileName: string;
  mimeType: string;
  // Original document attributes (e.g. DocumentAttributeVideo with w/h/duration).
  // Preserved so the re-uploaded media keeps its aspect ratio — without these,
  // GramJS defaults video dimensions to 1×1 because Node has no ffprobe.
  attributes: Api.TypeDocumentAttribute[];
  // Path to a downloaded thumbnail (JPEG) for the document, if available.
  // Without this, resent videos show as a black square until played.
  thumbPath: string | null;
} | null> {
  const messages = await client.getMessages(groupId, { ids: [messageId] });
  const msg = messages[0];
  if (!msg || !msg.media) return null;

  const info = buildMediaInfo(msg.media as Api.TypeMessageMedia, messageId);
  if (!info) return null;

  let attributes: Api.TypeDocumentAttribute[] = [];
  let thumbPath: string | null = null;
  if (msg.media instanceof Api.MessageMediaDocument) {
    const doc = msg.media.document;
    if (doc instanceof Api.Document) {
      attributes = doc.attributes;
      const bestThumb = pickBestThumb(doc.thumbs);
      if (bestThumb) {
        thumbPath = await downloadThumbToTempFile(client, doc, bestThumb);
      }
    }
  }

  const totalSize = info.fileSize.toJSNumber();
  const limitChunks = Math.ceil(totalSize / REQUEST_SIZE) + 1;

  emit({ type: "message_start", messageId, index, size: totalSize });

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
    let loaded = 0;
    for await (const chunk of iter) {
      // Abort if the client disconnected — bail out before writing more bytes.
      throwIfAborted(signal);
      const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buf, (err) => (err ? reject(err) : resolve()));
      });
      loaded += buf.byteLength;
      emit({ type: "download_progress", messageId, index, loaded, total: totalSize });
    }

    // Flush and close the write stream
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    emit({ type: "download_done", messageId, index });
  } catch (err) {
    // Make sure the stream is closed and temp file cleaned up on error
    writeStream.destroy();
    await fsp.unlink(tmpPath).catch(() => {});
    if (thumbPath) await fsp.unlink(thumbPath).catch(() => {});
    throw err;
  }

  return { filePath: tmpPath, fileName: info.fileName, mimeType: info.mimeType, attributes, thumbPath };
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
  messageIds: number[],
  emit: ProgressEmitter,
  signal: AbortSignal
): Promise<void> {
  for (let index = 0; index < messageIds.length; index++) {
    // Stop early if the client (e.g., user closed the tab / reloaded). Each
    // message is an independent server-side commit, so aborting between
    // messages prevents the rest of the batch from being sent.
    throwIfAborted(signal);

    const messageId = messageIds[index];
    // Re-fetch to get the caption (message text) alongside media info
    const [msgResult, fileResult] = await Promise.all([
      client.getMessages(fromGroupId, { ids: [messageId] }),
      downloadToTempFile(client, fromGroupId, messageId, index, emit, signal),
    ]);

    if (!fileResult) {
      console.warn(`[forward] message ${messageId} has no downloadable media — skipping`);
      emit({ type: "message_skipped", messageId, index, reason: "no downloadable media" });
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
        // Preserve original document attributes (width/height/duration for videos,
        // duration/title for audio, animated/sticker flags, etc.) so the resent
        // media renders with the correct aspect ratio and metadata. Without this,
        // GramJS would default video dimensions to 1×1 (no ffprobe in Node).
        attributes: fileResult.attributes.length > 0 ? fileResult.attributes : undefined,
        // Preserve the original thumbnail so previews render before playback.
        thumb: fileResult.thumbPath ?? undefined,
        progressCallback: (progress: number) => {
          emit({ type: "upload_progress", messageId, index, progress });
        },
      });
      emit({ type: "upload_done", messageId, index });
    } finally {
      // Always clean up the temp files
      await fsp.unlink(fileResult.filePath).catch((e) => {
        console.warn(`[forward] failed to delete temp file ${fileResult.filePath}:`, e);
      });
      if (fileResult.thumbPath) {
        await fsp.unlink(fileResult.thumbPath).catch((e) => {
          console.warn(`[forward] failed to delete temp thumb ${fileResult.thumbPath}:`, e);
        });
      }
    }
  }
}

export async function POST(request: Request) {
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

  // One AbortController, fired by either:
  //  - request.signal (Next.js aborts this when the underlying TCP connection
  //    drops — e.g. tab closed, page reloaded, navigation away)
  //  - ReadableStream.cancel() (consumer-side cancellation)
  // Once aborted, the resend loop bails between messages instead of running
  // the rest of the batch as a "ghost" job on the server.
  const ac = new AbortController();
  const onClientAbort = () => ac.abort();
  request.signal.addEventListener("abort", onClientAbort);

  // Stream NDJSON progress events so the client can render a live progress bar
  // for the download→resend fallback. One JSON object per line.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit: ProgressEmitter = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let client: any;
      try {
        client = createClient(sessionString);
        await client.connect();

        emit({ type: "start", total: parsedMessageIds.length });

        // ── Step 1: Try the fast native forward ──────────────────────────
        try {
          emit({ type: "forwarding" });
          await client.forwardMessages(toGroupId, {
            messages: parsedMessageIds,
            fromPeer: fromGroupId,
          });
          emit({ type: "done", method: "forward" });
        } catch (forwardError: unknown) {
          if (!isRestrictedError(forwardError)) throw forwardError;

          // ── Step 2: Restricted — download to temp file → re-upload ─────
          console.info(
            `[forward] native forward blocked (${(forwardError as Error).message}), ` +
              `falling back to download→resend for ${parsedMessageIds.length} message(s)`
          );

          await resendAsNewMessages(
            client,
            fromGroupId,
            toGroupId,
            parsedMessageIds,
            emit,
            ac.signal
          );
          emit({ type: "done", method: "resend" });
        }
      } catch (error: unknown) {
        if (error instanceof ClientDisconnected) {
          // Client is already gone — no point emitting; just log and exit.
          console.info(
            `[forward] client disconnected mid-operation; aborted remaining messages`
          );
        } else {
          const message = error instanceof Error ? error.message : "Failed to forward messages";
          emit({ type: "error", message });
        }
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
        if (client) {
          try {
            await client.disconnect();
          } catch {
            // ignore disconnect failures
          }
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // Consumer cancelled the stream (e.g., reader.cancel()). Treat the same
      // as a client disconnect so the in-flight resend loop stops.
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Disable buffering on reverse proxies so events flush immediately
      "X-Accel-Buffering": "no",
    },
  });
}
