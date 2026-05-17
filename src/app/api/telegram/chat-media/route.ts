import { createClient } from "@/lib/telegram";
import { buildMediaInfo } from "@/lib/telegram-media";
import { resolveUserPeer } from "@/lib/telegram-peer";
import { Api } from "telegram";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_SIZE = 512 * 1024;

/**
 * Streams media from a 1-to-1 chat message. This is the peer-aware twin of
 * /api/telegram/download (which only addresses group/channel ids) — it
 * resolves a user peer first, so it works for direct-message attachments.
 */
function parseRange(
  header: string | null,
  fileSize: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  let start: number;
  let end: number;
  if (startStr === "" && endStr !== "") {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (startStr !== "") {
    start = Number(startStr);
    end = endStr === "" ? fileSize - 1 : Number(endStr);
  } else {
    return null;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= fileSize || start > end) return null;
  return { start, end };
}

/** Pick the largest real (non-stripped) thumbnail size from a message. */
function pickThumbSize(
  media: Api.TypeMessageMedia,
): Api.TypePhotoSize | undefined {
  let sizes: readonly Api.TypePhotoSize[] = [];
  if (
    media instanceof Api.MessageMediaDocument &&
    media.document instanceof Api.Document
  ) {
    sizes = media.document.thumbs ?? [];
  } else if (
    media instanceof Api.MessageMediaPhoto &&
    media.photo instanceof Api.Photo
  ) {
    sizes = media.photo.sizes;
  }
  let best: Api.TypePhotoSize | undefined;
  let bestArea = 0;
  for (const s of sizes) {
    let area = 0;
    if (s instanceof Api.PhotoSize) area = s.w * s.h;
    else if (s instanceof Api.PhotoSizeProgressive) area = s.w * s.h;
    else continue; // skip stripped / cached / path — those are the blurry ones
    if (area >= bestArea) {
      bestArea = area;
      best = s;
    }
  }
  return best;
}

/**
 * Serve a sharp, real thumbnail (the JPEG preview Telegram generates) rather
 * than the tiny stripped blur. Used for video posters in the chat.
 */
async function streamThumbnail(
  sessionString: string,
  userId: string | null,
  accessHash: string | null,
  chatId: string | null,
  messageId: number,
): Promise<Response> {
  const client = createClient(sessionString);
  await client.connect();
  try {
    const peer = chatId
      ? String(chatId)
      : await resolveUserPeer(client, userId ?? "", accessHash);
    const messages = await client.getMessages(peer, { ids: [messageId] });
    const msg = messages[0];
    if (!msg || !msg.media) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const size = pickThumbSize(msg.media);
    if (!size) {
      return Response.json({ error: "No thumbnail" }, { status: 404 });
    }
    const buf = await client.downloadMedia(msg.media, { thumb: size });
    if (!buf) {
      return Response.json({ error: "No thumbnail" }, { status: 404 });
    }
    const data = buf instanceof Buffer ? buf : Buffer.from(buf as Uint8Array);
    return new Response(data as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}

async function streamChatMedia(
  sessionString: string,
  userId: string | null,
  accessHash: string | null,
  chatId: string | null,
  messageId: number,
  mode: "inline" | "attachment",
  rangeHeader: string | null,
): Promise<Response> {
  const client = createClient(sessionString);
  await client.connect();

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  };

  try {
    // A group/channel marked id resolves directly; a user needs an explicit
    // InputPeerUser built from its accessHash.
    const peer = chatId
      ? String(chatId)
      : await resolveUserPeer(client, userId ?? "", accessHash);
    const messages = await client.getMessages(peer, { ids: [messageId] });
    const msg = messages[0];
    if (!msg || !msg.media) {
      await cleanup();
      return Response.json({ error: "Media not found" }, { status: 404 });
    }

    const info = buildMediaInfo(msg.media, messageId);
    if (!info) {
      await cleanup();
      return Response.json({ error: "Unsupported media" }, { status: 415 });
    }

    const totalSize = info.fileSize.toJSNumber();
    const range = parseRange(rangeHeader, totalSize);
    if (rangeHeader && !range) {
      await cleanup();
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? totalSize - 1;
    const length = end - start + 1;
    const isPartial = !!range;
    const limitChunks = Math.ceil(length / REQUEST_SIZE) + 1;

    const iter = client.iterDownload({
      file: info.location,
      offset: bigInt(start),
      requestSize: REQUEST_SIZE,
      chunkSize: REQUEST_SIZE,
      limit: limitChunks,
      dcId: info.dcId,
      fileSize: info.fileSize,
    });
    const iterator = iter[Symbol.asyncIterator]();

    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (emitted >= length) {
            controller.close();
            await cleanup();
            return;
          }
          const { value, done } = await iterator.next();
          if (done || !value) {
            controller.close();
            await cleanup();
            return;
          }
          const chunk =
            value instanceof Uint8Array ? value : new Uint8Array(value);
          const remaining = length - emitted;
          if (chunk.byteLength <= remaining) {
            emitted += chunk.byteLength;
            controller.enqueue(chunk);
          } else {
            emitted += remaining;
            controller.enqueue(chunk.subarray(0, remaining));
            controller.close();
            await cleanup();
          }
        } catch (err) {
          controller.error(err);
          await cleanup();
        }
      },
      async cancel() {
        try {
          await iter.close();
        } catch {
          // ignore
        }
        await cleanup();
      },
    });

    const asciiName = info.fileName
      .replace(/"/g, "")
      .replace(/[^\x20-\x7E]/g, "_");
    const headers: Record<string, string> = {
      "Content-Type":
        mode === "attachment" ? "application/octet-stream" : info.mimeType,
      "Content-Length": String(length),
      "Content-Disposition": `${mode}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(info.fileName)}`,
      "Accept-Ranges": "bytes",
      "Cache-Control":
        mode === "attachment" ? "no-store" : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    if (isPartial) {
      headers["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
    }

    return new Response(stream, {
      status: isPartial ? 206 : 200,
      headers,
    });
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionString = searchParams.get("sessionString");
    const userId = searchParams.get("userId");
    const accessHash = searchParams.get("accessHash");
    const chatId = searchParams.get("chatId");
    const messageId = Number(searchParams.get("messageId"));
    const mode =
      searchParams.get("download") === "1" ? "attachment" : "inline";

    if (!sessionString || (!userId && !chatId) || !messageId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    // ?thumb=1 → serve the sharp poster thumbnail instead of the full media.
    if (searchParams.get("thumb") === "1") {
      return await streamThumbnail(
        sessionString,
        userId,
        accessHash,
        chatId,
        messageId,
      );
    }

    return await streamChatMedia(
      sessionString,
      userId,
      accessHash,
      chatId,
      messageId,
      mode,
      request.headers.get("range"),
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to load media";
    return Response.json({ error: message }, { status: 500 });
  }
}
