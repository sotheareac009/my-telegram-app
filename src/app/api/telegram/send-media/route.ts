import { createClient } from "@/lib/telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap a single send so one request can't upload an unbounded album. */
const MAX_FILES = 10;

/**
 * Stage a single uploaded file on disk. Returns the path + its containing dir
 * so we can clean both up afterwards. We keep the original filename so GramJS'
 * mime/extension detection picks "photo" / "video" correctly.
 */
async function writeTempFile(
  file: File,
): Promise<{ path: string; dir: string }> {
  const safeName = (file.name || "file").replace(/[\/\\]/g, "_") || "file";
  const dir = join(tmpdir(), `tg_send_${randomBytes(8).toString("hex")}`);
  await fsp.mkdir(dir, { recursive: true });
  const path = join(dir, safeName);
  const buf = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(path, buf);
  return { path, dir };
}

/**
 * Send media to a chat. Accepts multipart/form-data with the chat target, an
 * optional caption, and one or more `files`. A single file is sent as one
 * message; multiple files are sent together as a grouped album.
 *
 * The response is an NDJSON stream (one JSON object per line):
 *   {"kind":"progress","percent":0.42}   — emitted by gramjs as upload runs
 *   {"kind":"done"}                       — final, on success
 *   {"kind":"error","message":"…"}        — final, on failure
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const sessionString = form.get("sessionString");
  const chatId = form.get("chatId");
  const userId = form.get("userId");
  const accessHash = form.get("accessHash");
  const caption = form.get("caption");
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!chatId && !userId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }
  if (files.length === 0) {
    return Response.json({ error: "No files to send" }, { status: 400 });
  }

  const limitedFiles = files.slice(0, MAX_FILES);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      const staged: { path: string; dir: string }[] = [];
      const client = createClient(sessionString);
      try {
        await client.connect();
        const peer = chatId
          ? String(chatId)
          : await resolveUserPeer(
              client,
              String(userId),
              accessHash ? String(accessHash) : undefined,
            );

        for (const f of limitedFiles) staged.push(await writeTempFile(f));
        const paths = staged.map((s) => s.path);

        const text = typeof caption === "string" ? caption.trim() : "";
        // A single file → one message; an array → a grouped album.
        await client.sendFile(peer, {
          file: paths.length === 1 ? paths[0] : paths,
          caption: text || undefined,
          forceDocument: false,
          supportsStreaming: true,
          progressCallback: (progress: number) => {
            emit({ kind: "progress", percent: progress });
          },
        });
        emit({ kind: "done" });
      } catch (error) {
        console.error("[send-media] failed:", error);
        const message =
          error instanceof Error ? error.message : "Failed to send media";
        emit({ kind: "error", message });
      } finally {
        await Promise.all(
          staged.map((s) =>
            fsp
              .rm(s.dir, { recursive: true, force: true })
              .catch(() => undefined),
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
