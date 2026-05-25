import { createClient } from "@/lib/telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";
import { promises as fsp, createWriteStream, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Must match the writer in upload-chunk/route.ts. */
const UPLOAD_BASE = join(tmpdir(), "tg_uploads");

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

interface UploadDescriptor {
  uploadId: string;
  filename: string;
}

/** Stream-concat all `*.part` files under a chunk dir into one assembled file. */
async function assembleChunks(
  uploadId: string,
  filename: string,
): Promise<{ path: string; dir: string }> {
  const partsDir = join(UPLOAD_BASE, uploadId);
  const parts = (await fsp.readdir(partsDir))
    .filter((f) => f.endsWith(".part"))
    .sort();
  if (parts.length === 0) {
    throw new Error(`No chunks staged for upload ${uploadId}`);
  }

  const safeName = (filename || "file").replace(/[\/\\]/g, "_") || "file";
  const outDir = join(tmpdir(), `tg_send_${randomBytes(8).toString("hex")}`);
  await fsp.mkdir(outDir, { recursive: true });
  const outPath = join(outDir, safeName);

  const out = createWriteStream(outPath);
  for (const part of parts) {
    const src = createReadStream(join(partsDir, part));
    await new Promise<void>((resolve, reject) => {
      src.on("error", reject);
      src.on("end", resolve);
      src.pipe(out, { end: false });
    });
  }
  await new Promise<void>((resolve, reject) => {
    out.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });

  return { path: outPath, dir: outDir };
}

/**
 * Reassemble the chunks staged by /api/telegram/upload-chunk and send them
 * to a chat via gramjs sendFile. Response is the same NDJSON progress stream
 * as before:
 *   {"kind":"progress","percent":0.42}
 *   {"kind":"done"}
 *   {"kind":"error","message":"…"}
 */
export async function POST(request: Request) {
  let body: {
    sessionString?: string;
    chatId?: string;
    userId?: string;
    accessHash?: string;
    caption?: string;
    uploads?: UploadDescriptor[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionString, chatId, userId, accessHash, caption, uploads } = body;
  if (!sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!chatId && !userId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }
  if (!Array.isArray(uploads) || uploads.length === 0) {
    return Response.json({ error: "No uploads to send" }, { status: 400 });
  }

  // Sanitize incoming descriptors; ignore anything obviously malformed.
  const safeUploads = uploads
    .filter(
      (u): u is UploadDescriptor =>
        !!u && typeof u.uploadId === "string" && u.uploadId.length > 0,
    )
    .map((u) => ({ uploadId: safeId(u.uploadId), filename: u.filename || "file" }));
  if (safeUploads.length === 0) {
    return Response.json({ error: "No valid uploads" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      const cleanupDirs: string[] = [];
      // Also cleanup the staging chunk dirs once we're done with them.
      for (const u of safeUploads) cleanupDirs.push(join(UPLOAD_BASE, u.uploadId));

      const assembled: string[] = [];
      const client = createClient(sessionString);
      try {
        for (const u of safeUploads) {
          const result = await assembleChunks(u.uploadId, u.filename);
          assembled.push(result.path);
          cleanupDirs.push(result.dir);
        }

        await client.connect();
        // A group/channel addresses by its marked id directly; a user needs
        // an explicit InputPeerUser so it resolves on a cold client.
        const peer = chatId
          ? String(chatId)
          : await resolveUserPeer(
              client,
              String(userId),
              accessHash ? String(accessHash) : undefined,
            );

        const text = typeof caption === "string" ? caption.trim() : "";
        // A single file → one message; an array → a grouped album.
        await client.sendFile(peer, {
          file: assembled.length === 1 ? assembled[0] : assembled,
          caption: text || undefined,
          forceDocument: false,
          supportsStreaming: true,
          progressCallback: (progress: number) => {
            emit({ kind: "progress", percent: progress });
          },
        });
        emit({ kind: "done" });
      } catch (error) {
        console.error("[upload-send] failed:", error);
        const message =
          error instanceof Error ? error.message : "Failed to send media";
        emit({ kind: "error", message });
      } finally {
        await Promise.all(
          cleanupDirs.map((d) =>
            fsp.rm(d, { recursive: true, force: true }).catch(() => undefined),
          ),
        );
        try {
          await client.disconnect();
        } catch {
          // ignore
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
