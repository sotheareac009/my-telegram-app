import type { NextApiRequest, NextApiResponse } from "next";
import type { IncomingMessage } from "node:http";
import Busboy from "busboy";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

/**
 * Disable Next's body parser (so we get the raw IncomingMessage stream),
 * remove the response size cap (we stream NDJSON), and tell Next that we're
 * handling the response lifecycle ourselves.
 *
 * Lives under /pages/ instead of /app/ specifically because the App Router's
 * `Request.body` was getting truncated for ~17 MB+ uploads, even after
 * switching reader styles. Pages Router with `bodyParser: false` lets busboy
 * stream the raw HTTP body at any size without that cap.
 */
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

/** Cap a single send so one request can't upload an unbounded album. */
const MAX_FILES = 10;

interface ParsedMultipart {
  fields: Record<string, string>;
  files: Array<{
    field: string;
    name: string;
    type: string;
    data: Buffer;
  }>;
}

function parseMultipart(req: IncomingMessage): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: ParsedMultipart["files"] = [];
    const bb = Busboy({
      headers: req.headers,
      limits: { files: MAX_FILES, fileSize: 2 * 1024 * 1024 * 1024 },
    });
    bb.on("field", (name, value) => {
      fields[name] = value;
    });
    bb.on("file", (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        files.push({
          field: name,
          name: info.filename || "file",
          type: info.mimeType || "application/octet-stream",
          data: Buffer.concat(chunks),
        });
      });
      stream.on("error", reject);
    });
    bb.on("close", () => resolve({ fields, files }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

/** Stage a file part on disk so GramJS can read it for sendFile. */
async function writeTempFile(
  part: ParsedMultipart["files"][number],
): Promise<{ path: string; dir: string }> {
  const safeName = (part.name || "file").replace(/[\/\\]/g, "_") || "file";
  const dir = join(tmpdir(), `tg_send_${randomBytes(8).toString("hex")}`);
  await fsp.mkdir(dir, { recursive: true });
  const path = join(dir, safeName);
  await fsp.writeFile(path, part.data);
  return { path, dir };
}

/**
 * Send media to a chat. Accepts multipart/form-data with the chat target, an
 * optional caption, and one or more `files`. A single file is sent as one
 * message; multiple files are sent together as a grouped album. The response
 * is an NDJSON stream of progress events ending with done/error.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let parsed: ParsedMultipart;
  try {
    parsed = await parseMultipart(req as unknown as IncomingMessage);
  } catch (err) {
    console.error("[send-media] multipart parse failed:", err);
    const detail = err instanceof Error ? err.message : "unknown";
    return res.status(400).json({ error: `Invalid form data: ${detail}` });
  }

  const { fields } = parsed;
  const sessionString = fields.sessionString;
  const chatId = fields.chatId;
  const userId = fields.userId;
  const accessHash = fields.accessHash;
  const caption = fields.caption;
  const fileParts = parsed.files.filter(
    (f) => f.field === "files" && f.data.length > 0,
  );

  if (!sessionString) {
    return res.status(400).json({ error: "Missing sessionString" });
  }
  if (!chatId && !userId) {
    return res.status(400).json({ error: "Missing chat target" });
  }
  if (fileParts.length === 0) {
    return res.status(400).json({ error: "No files to send" });
  }

  // NDJSON stream of {kind:"progress"|"done"|"error", …}.
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const emit = (event: unknown) => res.write(JSON.stringify(event) + "\n");

  const staged: { path: string; dir: string }[] = [];
  const client = createClient(sessionString);
  try {
    await client.connect();
    // A group/channel addresses by its marked id directly; a user needs an
    // explicit InputPeerUser so it resolves on a cold client.
    const peer = chatId
      ? String(chatId)
      : await resolveUserPeer(
          client,
          String(userId),
          accessHash ? String(accessHash) : undefined,
        );

    for (const f of fileParts) staged.push(await writeTempFile(f));
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
        fsp.rm(s.dir, { recursive: true, force: true }).catch(() => undefined),
      ),
    );
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
    res.end();
  }
}
