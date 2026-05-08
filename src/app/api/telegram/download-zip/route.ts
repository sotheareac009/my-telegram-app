import { createClient } from "@/lib/telegram";
import { buildMediaInfo } from "@/lib/telegram-media";
import { Api } from "telegram";
import bigInt from "big-integer";
import archiver from "archiver";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_SIZE = 512 * 1024;

type ZipParams = {
  sessionString: string;
  groupId: string;
  messageIds: number[];
  filename: string;
};

function parseMessageIds(value: string): number[] {
  return value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let counter = 1;
  let candidate = `${stem}_${counter}${ext}`;
  while (used.has(candidate)) {
    counter++;
    candidate = `${stem}_${counter}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

async function streamZipResponse(params: ZipParams) {
  const { sessionString, groupId, messageIds, filename } = params;
  const client = createClient(sessionString);
  await client.connect();

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await client.disconnect();
    } catch (err) {
      console.error("[download-zip] disconnect error:", err);
    }
  };

  let messagesRaw: Api.Message[];
  try {
    messagesRaw = (await client.getMessages(groupId, {
      ids: messageIds,
    })) as Api.Message[];
  } catch (err) {
    await cleanup();
    throw err;
  }

  const messagesById = new Map<number, Api.Message>();
  for (const msg of messagesRaw) {
    if (msg) messagesById.set(msg.id, msg);
  }

  // store: no compression — media is already compressed
  const archive = archiver("zip", { store: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const errorOnce = (err: unknown) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          // already errored
        }
      };

      archive.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(
            new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          );
        } catch (err) {
          console.error("[download-zip] enqueue error:", err);
        }
      });
      archive.on("end", () => {
        closeOnce();
      });
      archive.on("warning", (warn) => {
        console.warn("[download-zip] archive warning:", warn);
      });
      archive.on("error", (err) => {
        console.error("[download-zip] archive error:", err);
        errorOnce(err);
      });

      void (async () => {
        const used = new Set<string>();
        try {
          for (const messageId of messageIds) {
            const msg = messagesById.get(messageId);
            if (!msg || !msg.media) {
              console.warn(
                `[download-zip] message ${messageId} not found or has no media`
              );
              continue;
            }
            const info = buildMediaInfo(msg.media, messageId);
            if (!info) {
              console.warn(
                `[download-zip] message ${messageId} unsupported media`
              );
              continue;
            }

            const name = uniqueName(info.fileName, used);
            const totalSize = info.fileSize.toJSNumber();
            const limitChunks = Math.ceil(totalSize / REQUEST_SIZE) + 1;

            const iter = client.iterDownload({
              file: info.location,
              offset: bigInt(0),
              requestSize: REQUEST_SIZE,
              chunkSize: REQUEST_SIZE,
              limit: limitChunks,
              dcId: info.dcId,
              fileSize: info.fileSize,
            });

            const fileStream = Readable.from(
              (async function* () {
                try {
                  for await (const chunk of iter) {
                    yield chunk instanceof Uint8Array
                      ? chunk
                      : new Uint8Array(chunk as ArrayBufferLike);
                  }
                } catch (err) {
                  console.error(
                    `[download-zip] iter error for ${messageId}:`,
                    err
                  );
                  throw err;
                }
              })()
            );

            archive.append(fileStream, { name });
          }
          await archive.finalize();
        } catch (err) {
          console.error("[download-zip] processing error:", err);
          archive.abort();
          errorOnce(err);
        } finally {
          await cleanup();
        }
      })();
    },
    cancel() {
      archive.abort();
      void cleanup();
    },
  });

  const asciiName = filename.replace(/"/g, "").replace(/[^\x20-\x7E]/g, "_");
  const utf8Name = encodeURIComponent(filename);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sanitizeZipFilename(raw: string | null | undefined): string {
  const base = (raw && raw.trim()) || "telegram-media";
  const cleaned = base.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 100);
  return cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionString = searchParams.get("sessionString");
    const groupId = searchParams.get("groupId");
    const messageIds = parseMessageIds(searchParams.get("messageIds") ?? "");
    const filename = sanitizeZipFilename(searchParams.get("filename"));

    if (!sessionString || !groupId || messageIds.length === 0) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    return await streamZipResponse({
      sessionString,
      groupId,
      messageIds,
      filename,
    });
  } catch (error: unknown) {
    console.error("[download-zip] GET handler error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to build zip";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let sessionString: string | null = null;
    let groupId: string | null = null;
    let messageIds: number[] = [];
    let filenameRaw: string | null = null;

    if (contentType.includes("application/json")) {
      const body = await request.json();
      sessionString = body.sessionString ?? null;
      groupId = body.groupId ?? null;
      if (Array.isArray(body.messageIds)) {
        messageIds = body.messageIds
          .map((v: unknown) => Number(v))
          .filter((n: number) => Number.isFinite(n) && n > 0);
      } else if (typeof body.messageIds === "string") {
        messageIds = parseMessageIds(body.messageIds);
      }
      filenameRaw = body.filename ?? null;
    } else {
      const form = await request.formData();
      sessionString = String(form.get("sessionString") || "") || null;
      groupId = String(form.get("groupId") || "") || null;
      messageIds = parseMessageIds(String(form.get("messageIds") || ""));
      filenameRaw = (form.get("filename") as string | null) ?? null;
    }

    if (!sessionString || !groupId || messageIds.length === 0) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    return await streamZipResponse({
      sessionString,
      groupId,
      messageIds,
      filename: sanitizeZipFilename(filenameRaw),
    });
  } catch (error: unknown) {
    console.error("[download-zip] POST handler error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to build zip";
    return Response.json({ error: message }, { status: 500 });
  }
}
