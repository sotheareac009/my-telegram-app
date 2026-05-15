import { createClient } from "@/lib/telegram";
import { buildMediaInfo } from "@/lib/telegram-media";
import { acquireDownloadSlot } from "@/lib/download-queue";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_SIZE = 512 * 1024;

function parseRange(
  header: string | null,
  fileSize: number
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
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

async function streamMediaResponse(
  sessionString: string,
  groupId: string,
  messageId: number,
  mode: "inline" | "attachment",
  rangeHeader: string | null
) {
  const releaseSlot = await acquireDownloadSlot();

  const client = createClient(sessionString);
  try {
    await client.connect();
  } catch (err) {
    releaseSlot();
    throw err;
  }

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await client.disconnect();
    } catch {
      // ignore
    } finally {
      releaseSlot();
    }
  };

  try {
    const messages = await client.getMessages(groupId, { ids: [messageId] });
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

    const isAttachment = mode === "attachment";
    const asciiName = info.fileName
      .replace(/"/g, "")
      .replace(/[^\x20-\x7E]/g, "_");
    const utf8Name = encodeURIComponent(info.fileName);
    const disposition = `${mode}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;

    const headers: Record<string, string> = {
      "Content-Type": isAttachment ? "application/octet-stream" : info.mimeType,
      "Content-Length": String(length),
      "Content-Disposition": disposition,
      "Accept-Ranges": "bytes",
      "Cache-Control": isAttachment ? "no-store" : "private, max-age=3600",
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
    const groupId = searchParams.get("groupId");
    const messageId = Number(searchParams.get("messageId"));
    const mode =
      searchParams.get("download") === "1" ? "attachment" : "inline";

    if (!sessionString || !groupId || !messageId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    return await streamMediaResponse(
      sessionString,
      groupId,
      messageId,
      mode,
      request.headers.get("range")
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to download";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function HEAD(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionString = searchParams.get("sessionString");
    const groupId = searchParams.get("groupId");
    const messageId = Number(searchParams.get("messageId"));

    if (!sessionString || !groupId || !messageId) {
      return new Response(null, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();
    try {
      const messages = await client.getMessages(groupId, { ids: [messageId] });
      const msg = messages[0];
      if (!msg || !msg.media) return new Response(null, { status: 404 });

      const info = buildMediaInfo(msg.media, messageId);
      if (!info) return new Response(null, { status: 415 });

      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": info.mimeType,
          "Content-Length": info.fileSize.toString(),
          "Accept-Ranges": "bytes",
        },
      });
    } finally {
      await client.disconnect();
    }
  } catch {
    return new Response(null, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let sessionString: string | null = null;
    let groupId: string | null = null;
    let messageId = 0;
    let mode: "inline" | "attachment" = "inline";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      sessionString = body.sessionString;
      groupId = body.groupId;
      messageId = Number(body.messageId);
      mode = body.download ? "attachment" : "inline";
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      sessionString = String(form.get("sessionString") || "");
      groupId = String(form.get("groupId") || "");
      messageId = Number(form.get("messageId"));
      mode = form.get("download") === "1" ? "attachment" : "inline";
    }

    if (!sessionString || !groupId || !messageId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    return await streamMediaResponse(
      sessionString,
      groupId,
      messageId,
      mode,
      request.headers.get("range")
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to download";
    return Response.json({ error: message }, { status: 500 });
  }
}
