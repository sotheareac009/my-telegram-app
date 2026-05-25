import { createClient } from "@/lib/telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";
import { promises as fsp, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Api, utils as telegramUtils, client as telegramClient } from "telegram";

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
  /** Optional poster frame for videos, encoded as a base64 data URL. */
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
}

/** Decode a `data:image/jpeg;base64,…` URL to disk and return the temp path. */
async function writeThumbFromDataUrl(
  dataUrl: string,
): Promise<{ path: string; dir: string } | null> {
  const match = /^data:image\/(jpe?g|png);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const ext = match[1].toLowerCase().startsWith("jp") ? "jpg" : "png";
  const buf = Buffer.from(match[2], "base64");
  if (buf.length === 0) return null;
  const dir = join(tmpdir(), `tg_thumb_${randomBytes(8).toString("hex")}`);
  await fsp.mkdir(dir, { recursive: true });
  const path = join(dir, `thumb.${ext}`);
  await fsp.writeFile(path, buf);
  return { path, dir };
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

  // Sequential append — chunks are ~2 MB each, so the per-iteration buffer is
  // small and we don't have to juggle pipe() backpressure across stream resets.
  const outFh = await fsp.open(outPath, "w");
  try {
    for (const part of parts) {
      const src = createReadStream(join(partsDir, part));
      for await (const chunk of src) {
        await outFh.write(chunk as Buffer);
      }
    }
  } finally {
    await outFh.close();
  }

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
    .map((u) => ({
      uploadId: safeId(u.uploadId),
      filename: u.filename || "file",
      thumb: typeof u.thumb === "string" ? u.thumb : undefined,
      width: typeof u.width === "number" ? u.width : undefined,
      height: typeof u.height === "number" ? u.height : undefined,
      duration: typeof u.duration === "number" ? u.duration : undefined,
      mimeType: typeof u.mimeType === "string" ? u.mimeType : undefined,
    }));
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
          // Log the assembled file's size + first 4 bytes so we can verify the
          // chunks reassembled into a valid image/video header (FFD8 = JPEG,
          // 89504E47 = PNG, 0000xxxx ftyp = MP4 box).
          try {
            const st = await fsp.stat(result.path);
            const fh = await fsp.open(result.path, "r");
            const head = Buffer.alloc(8);
            await fh.read(head, 0, 8, 0);
            await fh.close();
            console.log(
              `[upload-send] assembled ${u.filename}: size=${st.size} head=${head.toString("hex")}`,
            );
          } catch (logErr) {
            console.warn("[upload-send] assembled stat failed:", logErr);
          }
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

        if (safeUploads.length === 1) {
          // Single-file send — gramjs' sendFile is enough here and accepts a
          // thumb + per-file attributes directly.
          let thumbFile: { path: string; dir: string } | undefined;
          let attributes: Api.TypeDocumentAttribute[] | undefined;
          const u = safeUploads[0];
          if (u.thumb) {
            const t = await writeThumbFromDataUrl(u.thumb);
            if (t) {
              thumbFile = t;
              cleanupDirs.push(t.dir);
            }
          }
          const isVideoMime =
            typeof u.mimeType === "string" && u.mimeType.startsWith("video/");
          if (isVideoMime && (u.width || u.height || u.duration)) {
            attributes = [
              new Api.DocumentAttributeVideo({
                w: u.width ?? 1,
                h: u.height ?? 1,
                duration: u.duration ?? 0,
                supportsStreaming: true,
              }),
            ];
          }

          const sent = await client.sendFile(peer, {
            file: assembled[0],
            caption: text || undefined,
            forceDocument: false,
            supportsStreaming: true,
            thumb: thumbFile?.path,
            attributes,
            progressCallback: (progress: number) => {
              emit({ kind: "progress", percent: progress });
            },
          });
          const sentArr = Array.isArray(sent) ? sent : [sent];
          for (const m of sentArr) {
            const mediaCtor = m?.media?.className ?? m?.media?.constructor?.name;
            console.log(`[upload-send] sent: media=${mediaCtor}`);
          }
        } else {
          // Album path. gramjs' high-level _sendAlbum doesn't accept per-file
          // thumbs (it passes one global thumb to every file). We replicate
          // its structure manually so each video gets its own poster frame.
          // messages.UploadMedia / SendMultiMedia require a resolved InputPeer
          // (sendFile resolves implicitly, raw invoke doesn't).
          const inputPeer = await client.getInputEntity(peer);
          const albumEntries: Api.InputSingleMedia[] = [];
          for (let i = 0; i < safeUploads.length; i++) {
            const u = safeUploads[i];
            const filePath = assembled[i];
            const stat = await fsp.stat(filePath);
            const name = basename(filePath);

            // 1. Upload the file bytes → InputFile/InputFileBig. Progress is
            // emitted per-file (with index) so the outgoing bubble can show
            // the correct percentage on each tile.
            const fileHandle = await client.uploadFile({
              file: new telegramClient.uploads.CustomFile(
                name,
                stat.size,
                filePath,
              ),
              workers: 1,
              onProgress: (p: number) => {
                emit({ kind: "progress", index: i, percent: p });
              },
            });

            // 2. Decide photo vs document and build InputMediaUploaded* with
            //    the per-file thumb + attributes we computed in the browser.
            const ext = name.toLowerCase().split(".").pop() ?? "";
            const isImage =
              ext === "jpg" || ext === "jpeg" || ext === "png";

            let uploaded: Api.TypeInputMedia;
            if (isImage) {
              uploaded = new Api.InputMediaUploadedPhoto({ file: fileHandle });
            } else {
              let thumbHandle: Api.TypeInputFile | undefined;
              if (u.thumb) {
                const t = await writeThumbFromDataUrl(u.thumb);
                if (t) {
                  cleanupDirs.push(t.dir);
                  const tStat = await fsp.stat(t.path);
                  thumbHandle = await client.uploadFile({
                    file: new telegramClient.uploads.CustomFile(
                      basename(t.path),
                      tStat.size,
                      t.path,
                    ),
                    workers: 1,
                  });
                }
              }
              const mime =
                u.mimeType ||
                (ext === "mp4"
                  ? "video/mp4"
                  : ext === "mov"
                    ? "video/quicktime"
                    : "application/octet-stream");
              const attrs: Api.TypeDocumentAttribute[] = [
                new Api.DocumentAttributeFilename({ fileName: name }),
              ];
              if (mime.startsWith("video/")) {
                attrs.push(
                  new Api.DocumentAttributeVideo({
                    w: u.width ?? 1,
                    h: u.height ?? 1,
                    duration: u.duration ?? 0,
                    supportsStreaming: true,
                  }),
                );
              }
              uploaded = new Api.InputMediaUploadedDocument({
                file: fileHandle,
                mimeType: mime,
                attributes: attrs,
                thumb: thumbHandle,
              });
            }

            // 3. UploadMedia resolves the uploaded file into a stable photo /
            //    document id we can reference from InputSingleMedia.
            const resolved = await client.invoke(
              new Api.messages.UploadMedia({
                peer: inputPeer,
                media: uploaded,
              }),
            );
            let resolvedMedia: Api.TypeInputMedia;
            if (resolved instanceof Api.MessageMediaPhoto && resolved.photo) {
              resolvedMedia = new Api.InputMediaPhoto({
                id: telegramUtils.getInputPhoto(resolved.photo),
              });
            } else if (
              resolved instanceof Api.MessageMediaDocument &&
              resolved.document
            ) {
              resolvedMedia = new Api.InputMediaDocument({
                id: telegramUtils.getInputDocument(resolved.document),
              });
            } else {
              throw new Error(
                "Telegram returned unexpected media for album item",
              );
            }

            albumEntries.push(
              new Api.InputSingleMedia({
                media: resolvedMedia,
                // Caption only on the first item, matching the official client.
                message: i === 0 ? text : "",
                entities: [],
              }),
            );
            console.log(
              `[upload-send] album[${i}]: ${isImage ? "photo" : "document"} ${name}`,
            );
          }

          await client.invoke(
            new Api.messages.SendMultiMedia({
              peer: peer as Api.TypeInputPeer | string,
              multiMedia: albumEntries,
            }),
          );
        }
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
