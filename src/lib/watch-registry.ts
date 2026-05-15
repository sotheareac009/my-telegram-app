/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { createClient } from "@/lib/telegram";
import { buildMediaInfo } from "@/lib/telegram-media";
import { acquireDownloadSlot } from "@/lib/download-queue";
import { listAllWatches, type MediaWatch } from "@/lib/watch-store";
import {
  newJobId,
  recordProgress,
  registerJob,
  removeJob,
} from "@/lib/forward-registry";
import { Api } from "telegram";
import bigInt from "big-integer";
import { createWriteStream, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Runtime registry of "auto-archive" watchers.
 *
 * One persistent GramJS client per user (session). The client stays connected
 * so its update loop delivers NewMessage events. A single handler per client
 * checks each incoming message's chat against that user's watch configs and
 * copies new photos/videos to the configured archive chat.
 *
 * State is pinned on globalThis so HMR doesn't orphan live connections.
 */

const REQUEST_SIZE = 512 * 1024;
const RESTRICTED_PATTERNS = [
  /CHAT_FORWARDS_RESTRICTED/i,
  /FORWARD_RESTRICTED/i,
  /noforwards/i,
];

type UserWatchState = {
  client: any;
  /** watch id -> config */
  watches: Map<string, MediaWatch>;
  /** Resolves once the client is connected and the handler is attached. */
  ready: Promise<void>;
  handler: ((event: any) => void) | null;
};

declare global {
  var __watchRegistry: Map<string, UserWatchState> | undefined;
  var __watchRegistryResumed: boolean | undefined;
}

const userStates: Map<string, UserWatchState> =
  (globalThis.__watchRegistry ??= new Map());

function isRestrictedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return RESTRICTED_PATTERNS.some((re) => re.test(error.message));
}

/** True when a message carries a photo or a video document. */
function isPhotoOrVideo(message: Api.Message): boolean {
  if (message.media instanceof Api.MessageMediaPhoto) return true;
  if (message.media instanceof Api.MessageMediaDocument) {
    const doc = message.media.document;
    if (doc instanceof Api.Document) {
      return doc.attributes.some(
        (a) => a instanceof Api.DocumentAttributeVideo,
      );
    }
  }
  return false;
}

/** Extract the original document attributes so a re-uploaded video keeps its
 * aspect ratio / duration (Node has no ffprobe to re-derive them). */
function documentAttributes(
  message: Api.Message,
): Api.TypeDocumentAttribute[] {
  if (message.media instanceof Api.MessageMediaDocument) {
    const doc = message.media.document;
    if (doc instanceof Api.Document) return doc.attributes;
  }
  return [];
}

/** One-line summary of the media for the queue card. */
function describeMedia(message: Api.Message): string {
  return message.media instanceof Api.MessageMediaPhoto ? "1 photo" : "1 video";
}

type Emit = (event: Parameters<typeof recordProgress>[1]) => void;

/** Restricted path: download the media to a temp file then re-upload it,
 * emitting download/upload progress so the queue card animates. */
async function downloadAndReupload(
  client: any,
  watch: MediaWatch,
  message: Api.Message,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  if (!message.media) return;
  const info = buildMediaInfo(message.media as Api.TypeMessageMedia, message.id);
  if (!info) return;

  const totalSize = info.fileSize.toJSNumber();
  emit({ type: "message_start", messageId: message.id, index: 0, size: totalSize });

  const ext = info.fileName.includes(".")
    ? info.fileName.slice(info.fileName.lastIndexOf("."))
    : "";
  const tmpPath = join(
    tmpdir(),
    `tg_archive_${randomBytes(8).toString("hex")}${ext}`,
  );

  try {
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

    const writeStream = createWriteStream(tmpPath);
    let loaded = 0;
    try {
      for await (const chunk of iter) {
        if (signal.aborted) throw new Error("cancelled");
        const buf =
          chunk instanceof Uint8Array
            ? chunk
            : new Uint8Array(chunk as ArrayBufferLike);
        await new Promise<void>((resolve, reject) => {
          writeStream.write(buf, (e) => (e ? reject(e) : resolve()));
        });
        loaded += buf.byteLength;
        emit({
          type: "download_progress",
          messageId: message.id,
          index: 0,
          loaded,
          total: totalSize,
        });
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((e?: Error | null) => (e ? reject(e) : resolve()));
      });
    } catch (err) {
      writeStream.destroy();
      throw err;
    }
    emit({ type: "download_done", messageId: message.id, index: 0 });

    const attributes = documentAttributes(message);
    await client.sendFile(watch.archiveChatId, {
      file: tmpPath,
      caption: message.message || "",
      forceDocument: false,
      supportsStreaming: true,
      attributes: attributes.length > 0 ? attributes : undefined,
      progressCallback: (progress: number) => {
        emit({ type: "upload_progress", messageId: message.id, index: 0, progress });
      },
    });
    emit({ type: "upload_done", messageId: message.id, index: 0 });
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Copy one message's media into the archive chat as a tracked forward job.
 *
 * The job is registered in the shared forward-registry (kind: "archive") so
 * it shows up live in the Queue dashboard and can be cancelled there. It is
 * gated through the same download-slot semaphore as manual forwards, so at
 * most 5 copies/forwards run concurrently; the rest sit as "queued".
 *
 *  - First tries a native forward (fast, no bytes through this server).
 *  - If the source chat restricts forwarding, downloads + re-uploads.
 */
async function copyToArchive(
  client: any,
  watch: MediaWatch,
  message: Api.Message,
): Promise<void> {
  const jobId = newJobId();
  const controller = new AbortController();

  registerJob(
    {
      jobId,
      userKey: watch.userKey,
      kind: "archive",
      fromGroupId: watch.sourceChatId,
      fromGroupTitle: watch.sourceChatTitle,
      toGroupId: watch.archiveChatId,
      destinationTitle: watch.archiveChatTitle,
      contentSummary: describeMedia(message),
      messageIdsKey: String(message.id),
      firstMessageId: message.id,
      total: 1,
    },
    controller,
  );

  const emit: Emit = (event) => recordProgress(jobId, event);
  let reason: "done" | "error" | "cancelled" = "done";
  let errorMessage: string | undefined;
  let release: (() => void) | null = null;

  try {
    emit({ type: "start", total: 1 });
    // Gate through the shared 5-slot queue — shows as "queued" while waiting.
    emit({ type: "queued" });
    release = await acquireDownloadSlot(controller.signal);

    emit({ type: "forwarding" });
    try {
      await client.forwardMessages(watch.archiveChatId, {
        messages: [message.id],
        fromPeer: watch.sourceChatId,
      });
      emit({ type: "done", method: "forward" });
    } catch (err) {
      if (!isRestrictedError(err)) throw err;
      await downloadAndReupload(client, watch, message, emit, controller.signal);
      emit({ type: "done", method: "resend" });
    }
  } catch (err) {
    if (controller.signal.aborted) {
      reason = "cancelled";
    } else {
      reason = "error";
      errorMessage =
        err instanceof Error ? err.message : "Auto-archive failed";
      emit({ type: "error", message: errorMessage });
    }
  } finally {
    release?.();
    removeJob(jobId, reason, errorMessage);
  }
}

/** Build the NewMessage handler for a user. Closes over `state` so it always
 * sees the current watch set even as watches are added/removed. */
function makeHandler(state: UserWatchState) {
  return (event: any) => {
    void (async () => {
      try {
        const message: Api.Message | undefined = event?.message;
        if (!message || !message.media) return;
        if (!isPhotoOrVideo(message)) return;

        const chatId = message.chatId?.toString();
        if (!chatId) return;

        for (const watch of state.watches.values()) {
          if (watch.sourceChatId !== chatId) continue;
          // Guard against an accidental archive→archive loop.
          if (watch.archiveChatId === watch.sourceChatId) continue;
          try {
            await copyToArchive(state.client, watch, message);
            console.info(
              `[auto-archive] copied message ${message.id} from ${watch.sourceChatTitle} to ${watch.archiveChatTitle}`,
            );
          } catch (err) {
            console.error(
              `[auto-archive] failed to copy message ${message.id} for watch ${watch.id}:`,
              err,
            );
          }
        }
      } catch (err) {
        console.error("[auto-archive] handler error:", err);
      }
    })();
  };
}

/** Lazily create + connect the per-user client and attach the handler. */
async function ensureUserState(
  userKey: string,
  sessionString: string,
): Promise<UserWatchState> {
  const existing = userStates.get(userKey);
  if (existing) {
    await existing.ready;
    return existing;
  }

  const client = createClient(sessionString);
  const state: UserWatchState = {
    client,
    watches: new Map(),
    handler: null,
    ready: Promise.resolve(),
  };
  userStates.set(userKey, state);

  state.ready = (async () => {
    const { NewMessage } = require("telegram/events");
    await client.connect();
    const handler = makeHandler(state);
    state.handler = handler;
    client.addEventHandler(handler, new NewMessage({}));
  })();

  try {
    await state.ready;
  } catch (err) {
    userStates.delete(userKey);
    throw err;
  }
  return state;
}

/** Start (or refresh) a watch — connects the user client if needed. */
export async function startWatch(watch: MediaWatch): Promise<void> {
  const state = await ensureUserState(watch.userKey, watch.sessionString);
  state.watches.set(watch.id, watch);
}

/** Stop a watch. Disconnects the user's client once their last watch is gone. */
export async function stopWatch(
  userKey: string,
  watchId: string,
): Promise<void> {
  const state = userStates.get(userKey);
  if (!state) return;
  state.watches.delete(watchId);
  if (state.watches.size === 0) {
    userStates.delete(userKey);
    try {
      if (state.handler) {
        const { NewMessage } = require("telegram/events");
        state.client.removeEventHandler(state.handler, new NewMessage({}));
      }
      await state.client.disconnect();
    } catch (err) {
      console.error(`[auto-archive] error stopping client for ${userKey}:`, err);
    }
  }
}

/** Load every persisted watch and start its watcher. Called once on boot. */
export async function resumeAllWatches(): Promise<void> {
  if (globalThis.__watchRegistryResumed) return;
  globalThis.__watchRegistryResumed = true;
  try {
    const watches = await listAllWatches();
    console.info(`[auto-archive] resuming ${watches.length} watch(es) on boot`);
    for (const watch of watches) {
      try {
        await startWatch(watch);
      } catch (err) {
        console.error(
          `[auto-archive] failed to resume watch ${watch.id}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error("[auto-archive] resumeAllWatches failed:", err);
  }
}
