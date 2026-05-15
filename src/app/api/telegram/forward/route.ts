import { createClient } from "@/lib/telegram";
import { buildMediaInfo } from "@/lib/telegram-media";
import { acquireDownloadSlot } from "@/lib/download-queue";
import {
  newJobId,
  recordProgress,
  registerJob,
  removeJob,
  userKeyFromSession,
} from "@/lib/forward-registry";
import { Api } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import bigInt from "big-integer";
import { createWriteStream, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  | { type: "queued" }
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
  /** True when the source was a photo (MessageMediaPhoto). */
  isPhoto: boolean;
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

  const isPhoto = msg.media instanceof Api.MessageMediaPhoto;
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

  return {
    filePath: tmpPath,
    fileName: info.fileName,
    mimeType: info.mimeType,
    isPhoto,
    attributes,
    thumbPath,
  };
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
/** Telegram limit: a single album/grouped message can hold at most 10 items. */
const ALBUM_CHUNK_SIZE = 10;

/**
 * Split a list of message IDs into batches that preserve original album
 * grouping. Each batch is either:
 *  - A single message ID (standalone, or only one item from an album was selected).
 *  - A run of message IDs that share the same `groupedId` — these will be
 *    re-uploaded as a Telegram album (max 10 per album, so longer runs are
 *    split into multiple chunks).
 *
 * The result preserves the input order so the user sees items appear in the
 * destination in the same sequence they had in the source chat.
 */
function groupMessagesByAlbum(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[],
): number[][] {
  // Bucket messages by groupedId, preserving first-seen order across buckets.
  // bucketOrder lists groupedId values (or null for standalones) in the order
  // they first appear in `messages` — this drives output ordering.
  const buckets = new Map<string, number[]>();
  const bucketOrder: string[] = [];
  for (const msg of messages) {
    if (!msg) continue;
    // groupedId may be a BigInt-like object; stringify safely.
    const key = msg.groupedId ? `g:${msg.groupedId.toString()}` : `s:${msg.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      bucketOrder.push(key);
    }
    buckets.get(key)!.push(msg.id as number);
  }
  const groups: number[][] = [];
  for (const key of bucketOrder) {
    const ids = buckets.get(key)!;
    if (key.startsWith("s:") || ids.length === 1) {
      groups.push([ids[0]]);
    } else {
      // Album run — split into ≤10-item chunks (Telegram's album limit).
      for (let i = 0; i < ids.length; i += ALBUM_CHUNK_SIZE) {
        groups.push(ids.slice(i, i + ALBUM_CHUNK_SIZE));
      }
    }
  }
  return groups;
}

async function resendAsNewMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  fromGroupId: string,
  toGroupId: string,
  messageIds: number[],
  emit: ProgressEmitter,
  signal: AbortSignal
): Promise<void> {
  // Fetch all messages up-front so we can read their groupedId and preserve
  // album grouping when re-uploading. One round-trip instead of N.
  const allMessages = await client.getMessages(fromGroupId, { ids: messageIds });
  const messageById = new Map<number, unknown>();
  for (const msg of allMessages) {
    if (msg) messageById.set(msg.id, msg);
  }

  const groups = groupMessagesByAlbum(allMessages);

  let globalIndex = 0;
  for (const group of groups) {
    throwIfAborted(signal);

    if (group.length === 1) {
      await resendSingle(
        client,
        fromGroupId,
        toGroupId,
        group[0],
        messageById.get(group[0]),
        globalIndex,
        emit,
        signal,
      );
      globalIndex += 1;
    } else {
      await resendAsAlbum(
        client,
        toGroupId,
        fromGroupId,
        group,
        group.map((id) => messageById.get(id)),
        globalIndex,
        emit,
        signal,
      );
      globalIndex += group.length;
    }
  }
}

/**
 * Re-send a single message: download → upload via sendFile. Behavior identical
 * to the original implementation (preserves attributes + thumb).
 */
async function resendSingle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  fromGroupId: string,
  toGroupId: string,
  messageId: number,
  message: unknown,
  index: number,
  emit: ProgressEmitter,
  signal: AbortSignal,
): Promise<void> {
  const fileResult = await downloadToTempFile(client, fromGroupId, messageId, index, emit, signal);
  if (!fileResult) {
    console.warn(`[forward] message ${messageId} has no downloadable media — skipping`);
    emit({ type: "message_skipped", messageId, index, reason: "no downloadable media" });
    return;
  }
  const caption: string =
    (message as { message?: string } | undefined)?.message ?? "";

  try {
    await client.sendFile(toGroupId, {
      file: fileResult.filePath,
      caption,
      forceDocument: false,
      supportsStreaming: true,
      attributes: fileResult.attributes.length > 0 ? fileResult.attributes : undefined,
      thumb: fileResult.thumbPath ?? undefined,
      progressCallback: (progress: number) => {
        emit({ type: "upload_progress", messageId, index, progress });
      },
    });
    emit({ type: "upload_done", messageId, index });
  } finally {
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

/**
 * Re-send a run of messages that share a `groupedId` as a single Telegram
 * album. Downloads each item sequentially (one temp file at a time in memory
 * pressure terms — they live on disk), then issues one `sendFile(...)` call
 * with parallel `file[]`, `caption[]`, and `attributes[]` arrays. GramJS
 * dispatches that as `messages.SendMultiMedia`, which is the actual album RPC.
 *
 * We bypass `client.sendFile` here because GramJS' `_sendAlbum` only accepts a
 * single `thumb` for the whole album — applying it to all items or dropping it
 * entirely. To preserve per-item video previews we drive the lower-level RPCs
 * directly: upload each file and its own thumb via `uploadFile`, stabilize the
 * upload through `messages.UploadMedia`, then commit the batch via
 * `messages.SendMultiMedia`.
 */
async function resendAsAlbum(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  toGroupId: string,
  fromGroupId: string,
  messageIds: number[],
  messages: unknown[],
  startIndex: number,
  emit: ProgressEmitter,
  signal: AbortSignal,
): Promise<void> {
  type DownloadedItem = {
    messageId: number;
    index: number;
    filePath: string;
    fileName: string;
    mimeType: string;
    isPhoto: boolean;
    thumbPath: string | null;
    attributes: Api.TypeDocumentAttribute[];
    caption: string;
  };
  const downloaded: DownloadedItem[] = [];

  try {
    // ── Phase 1: download every item in the album sequentially ──────────
    for (let i = 0; i < messageIds.length; i++) {
      throwIfAborted(signal);
      const messageId = messageIds[i];
      const index = startIndex + i;
      const fileResult = await downloadToTempFile(
        client,
        fromGroupId,
        messageId,
        index,
        emit,
        signal,
      );
      if (!fileResult) {
        console.warn(
          `[forward] album message ${messageId} has no downloadable media — skipping`,
        );
        emit({
          type: "message_skipped",
          messageId,
          index,
          reason: "no downloadable media",
        });
        continue;
      }
      downloaded.push({
        messageId,
        index,
        filePath: fileResult.filePath,
        fileName: fileResult.fileName,
        mimeType: fileResult.mimeType,
        isPhoto: fileResult.isPhoto,
        thumbPath: fileResult.thumbPath,
        attributes: fileResult.attributes,
        caption: (messages[i] as { message?: string } | undefined)?.message ?? "",
      });
    }

    if (downloaded.length === 0) return;

    // If only one item survived (others were skipped) fall back to a single
    // send — Telegram albums require ≥ 2 items. sendFile handles the thumb
    // correctly for single uploads, so no need for the manual path here.
    if (downloaded.length === 1) {
      const only = downloaded[0];
      throwIfAborted(signal);
      await client.sendFile(toGroupId, {
        file: only.filePath,
        caption: only.caption,
        forceDocument: false,
        supportsStreaming: true,
        attributes: only.attributes.length > 0 ? only.attributes : undefined,
        thumb: only.thumbPath ?? undefined,
        progressCallback: (progress: number) => {
          emit({
            type: "upload_progress",
            messageId: only.messageId,
            index: only.index,
            progress,
          });
        },
      });
      emit({ type: "upload_done", messageId: only.messageId, index: only.index });
      return;
    }

    // ── Phase 2: build each item's media via the lower-level RPC chain ──
    const inputEntity = await client.getInputEntity(toGroupId);
    const albumItems: Api.InputSingleMedia[] = [];

    for (const item of downloaded) {
      throwIfAborted(signal);

      // Upload the main file. uploadFile gates progress callbacks per file.
      const fileStat = await fsp.stat(item.filePath);
      const mainHandle = await client.uploadFile({
        file: new CustomFile(item.fileName, fileStat.size, item.filePath),
        workers: 1,
        onProgress: (progress: number) => {
          emit({
            type: "upload_progress",
            messageId: item.messageId,
            index: item.index,
            progress,
          });
        },
      });

      // Upload the thumb separately so we can reference it in the media item.
      // Skipped for photos — Telegram generates photo thumbnails server-side.
      let thumbHandle: Api.TypeInputFile | undefined;
      if (item.thumbPath && !item.isPhoto) {
        const thumbStat = await fsp.stat(item.thumbPath);
        thumbHandle = await client.uploadFile({
          file: new CustomFile(basename(item.thumbPath), thumbStat.size, item.thumbPath),
          workers: 1,
        });
      }

      // Build the InputMedia for this item — photo or document — then stabilize
      // via messages.UploadMedia to get a re-usable InputMediaDocument/Photo
      // reference that SendMultiMedia accepts.
      const uploadedMedia: Api.TypeInputMedia = item.isPhoto
        ? new Api.InputMediaUploadedPhoto({ file: mainHandle })
        : new Api.InputMediaUploadedDocument({
            file: mainHandle,
            mimeType: item.mimeType,
            attributes: item.attributes,
            thumb: thumbHandle,
          });

      const stabilized = await client.invoke(
        new Api.messages.UploadMedia({ peer: inputEntity, media: uploadedMedia }),
      );

      let stableInputMedia: Api.TypeInputMedia = uploadedMedia;
      if (stabilized instanceof Api.MessageMediaDocument) {
        const doc = stabilized.document;
        if (doc instanceof Api.Document) {
          stableInputMedia = new Api.InputMediaDocument({
            id: new Api.InputDocument({
              id: doc.id,
              accessHash: doc.accessHash,
              fileReference: doc.fileReference,
            }),
          });
        }
      } else if (stabilized instanceof Api.MessageMediaPhoto) {
        const photo = stabilized.photo;
        if (photo instanceof Api.Photo) {
          stableInputMedia = new Api.InputMediaPhoto({
            id: new Api.InputPhoto({
              id: photo.id,
              accessHash: photo.accessHash,
              fileReference: photo.fileReference,
            }),
          });
        }
      }

      albumItems.push(
        new Api.InputSingleMedia({
          media: stableInputMedia,
          message: item.caption,
          randomId: bigInt.randBetween(
            "-9223372036854775808",
            "9223372036854775807",
          ),
          entities: [],
        }),
      );
    }

    throwIfAborted(signal);
    await client.invoke(
      new Api.messages.SendMultiMedia({
        peer: inputEntity,
        multiMedia: albumItems,
      }),
    );
    for (const item of downloaded) {
      emit({ type: "upload_done", messageId: item.messageId, index: item.index });
    }
  } finally {
    // Clean up every temp file that made it onto disk, even on partial failure.
    for (const item of downloaded) {
      await fsp.unlink(item.filePath).catch((e) => {
        console.warn(`[forward] failed to delete temp file ${item.filePath}:`, e);
      });
      if (item.thumbPath) {
        await fsp.unlink(item.thumbPath).catch((e) => {
          console.warn(`[forward] failed to delete temp thumb ${item.thumbPath}:`, e);
        });
      }
    }
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    sessionString,
    fromGroupId,
    toGroupId,
    messageIds,
    fromGroupTitle,
    destinationTitle,
    destinationIsChannel,
    contentSummary,
    contentThumbBase64,
  } = body;

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

  // Job lifecycle is now decoupled from the HTTP request. The work runs
  // detached on the server so reloading the tab or opening the queue in
  // another tab can't cancel it; cancellation only happens via the explicit
  // cancel endpoint (which aborts this controller through the registry).
  const ac = new AbortController();

  const jobId = newJobId();
  const userKey = userKeyFromSession(sessionString);
  const messageIdsKey = [...parsedMessageIds].sort((a, b) => a - b).join(",");

  registerJob(
    {
      jobId,
      userKey,
      fromGroupId,
      fromGroupTitle: typeof fromGroupTitle === "string" ? fromGroupTitle : undefined,
      toGroupId,
      destinationTitle: typeof destinationTitle === "string" ? destinationTitle : undefined,
      destinationIsChannel: typeof destinationIsChannel === "boolean" ? destinationIsChannel : undefined,
      contentSummary: typeof contentSummary === "string" ? contentSummary : undefined,
      contentThumbBase64: typeof contentThumbBase64 === "string" ? contentThumbBase64 : undefined,
      messageIdsKey,
      firstMessageId: parsedMessageIds[0],
      total: parsedMessageIds.length,
    },
    ac,
  );

  // Detached worker. We don't await it from the request handler — the POST
  // returns immediately with { jobId } and the work proceeds in the
  // background. Clients track progress via /api/telegram/forwards/stream.
  void (async () => {
    const emit: ProgressEmitter = (event) => recordProgress(jobId, event);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;
    let removeReason: "done" | "error" | "cancelled" = "done";
    let removeErrorMessage: string | undefined;

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
            `falling back to download→resend for ${parsedMessageIds.length} message(s)`,
        );

        emit({ type: "queued" });
        let releaseSlot: (() => void) | null = null;
        try {
          releaseSlot = await acquireDownloadSlot(ac.signal);
        } catch (err) {
          // Aborted while waiting in the queue.
          throw err instanceof Error ? err : new ClientDisconnected();
        }
        try {
          emit({ type: "forwarding" });
          await resendAsNewMessages(
            client,
            fromGroupId,
            toGroupId,
            parsedMessageIds,
            emit,
            ac.signal,
          );
          emit({ type: "done", method: "resend" });
        } finally {
          releaseSlot();
        }
      }
    } catch (error: unknown) {
      if (error instanceof ClientDisconnected || ac.signal.aborted) {
        console.info(`[forward] job ${jobId} cancelled mid-operation`);
        removeReason = "cancelled";
      } else {
        const message = error instanceof Error ? error.message : "Failed to forward messages";
        emit({ type: "error", message });
        removeReason = "error";
        removeErrorMessage = message;
      }
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // ignore disconnect failures
        }
      }
      removeJob(jobId, removeReason, removeErrorMessage);
    }
  })();

  return Response.json({ jobId });
}
