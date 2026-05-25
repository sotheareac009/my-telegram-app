import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staging area for in-progress chunked uploads. Each upload writes its parts
 * here as `{uploadId}/00000000.part`, `00000001.part`, … so we can stream
 * them back in order during the final send.
 */
const UPLOAD_BASE = join(tmpdir(), "tg_uploads");

/** Strip anything that isn't safe to use as a directory name. */
function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

/**
 * Accept one chunk of a file upload. Headers carry the upload id and chunk
 * index; the body is the raw chunk bytes. Each chunk is small (the client
 * splits at ~2 MB) so this request never trips any body-size cap.
 */
export async function POST(request: Request) {
  const uploadId = safeId(request.headers.get("x-upload-id") || "");
  const indexStr = request.headers.get("x-chunk-index");
  if (!uploadId || indexStr === null) {
    return Response.json(
      { error: "Missing X-Upload-Id / X-Chunk-Index" },
      { status: 400 },
    );
  }
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0) {
    return Response.json({ error: "Invalid chunk index" }, { status: 400 });
  }

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length === 0) {
    return Response.json({ error: "Empty chunk" }, { status: 400 });
  }

  try {
    const dir = join(UPLOAD_BASE, uploadId);
    await fsp.mkdir(dir, { recursive: true });
    // Zero-pad so lexical sort = numeric sort when we reassemble.
    const file = join(dir, `${String(index).padStart(8, "0")}.part`);
    await fsp.writeFile(file, buf);
  } catch (err) {
    console.error("[upload-chunk] write failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to write chunk" },
      { status: 500 },
    );
  }

  return Response.json({ success: true, size: buf.length });
}
