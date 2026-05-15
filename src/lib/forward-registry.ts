import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";

/**
 * Server-side registry of in-flight forward jobs.
 *
 * Why this exists: forwards used to be tab-bound — the streaming `fetch` that
 * drove a job lived in one tab, so a reload cancelled it and other tabs
 * couldn't see it. This registry makes the server the source of truth. Tabs
 * subscribe to /api/telegram/forwards/stream and render whatever's in here.
 *
 * State lives on globalThis so HMR re-evaluation in `next dev` doesn't drop
 * in-flight jobs.
 */

export type ForwardProgressEvent =
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

/**
 * Snapshot of a job for the list endpoint. Mirrors the client's
 * ForwardJobState shape (without the React-specific bits).
 */
export type ForwardJobMeta = {
  jobId: string;
  userKey: string;
  fromGroupId: string;
  fromGroupTitle?: string;
  toGroupId: string;
  destinationTitle?: string;
  destinationIsChannel?: boolean;
  contentSummary?: string;
  contentThumbBase64?: string;
  messageIdsKey: string;
  firstMessageId?: number;
  total: number;
  /** Last progress snapshot — drives the UI without replaying every event. */
  progress: {
    step: "forwarding" | "queued" | "downloading" | "uploading" | "skipped";
    index: number;
    percent: number;
    loadedBytes?: number;
    totalBytes?: number;
  };
  /** Wall-clock start time (ms). Useful for sorting and stale detection. */
  startedAt: number;
};

type StoredJob = ForwardJobMeta & {
  controller: AbortController;
};

type RegistryEvent =
  | { kind: "job_added"; job: ForwardJobMeta }
  | { kind: "job_progress"; jobId: string; userKey: string; event: ForwardProgressEvent; progress: ForwardJobMeta["progress"] }
  | { kind: "job_removed"; jobId: string; userKey: string; reason: "done" | "error" | "cancelled"; errorMessage?: string };

type RegistryState = {
  jobs: Map<string, StoredJob>;
  emitter: EventEmitter;
};

declare global {
  // eslint-disable-next-line no-var
  var __forwardRegistry: RegistryState | undefined;
}

const state: RegistryState = (globalThis.__forwardRegistry ??= {
  jobs: new Map(),
  // Setting a high max so many simultaneous SSE subscribers don't trigger
  // Node's "MaxListenersExceededWarning".
  emitter: (() => {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    return e;
  })(),
});

/** Stable per-user identifier derived from the Telegram session string. */
export function userKeyFromSession(sessionString: string): string {
  return createHash("sha256").update(sessionString).digest("hex").slice(0, 32);
}

/** Create a new job ID. */
export function newJobId(): string {
  return randomUUID();
}

/** Add a job to the registry. Called when /api/telegram/forward starts work. */
export function registerJob(
  meta: Omit<ForwardJobMeta, "progress" | "startedAt"> & {
    progress?: ForwardJobMeta["progress"];
  },
  controller: AbortController,
): ForwardJobMeta {
  const job: StoredJob = {
    ...meta,
    progress: meta.progress ?? { step: "forwarding", index: 0, percent: 0 },
    startedAt: Date.now(),
    controller,
  };
  state.jobs.set(job.jobId, job);
  const { controller: _c, ...publicMeta } = job;
  void _c;
  state.emitter.emit("event", {
    kind: "job_added",
    job: publicMeta,
  } satisfies RegistryEvent);
  return publicMeta;
}

/** Update a job's progress and broadcast the event to subscribers. */
export function recordProgress(jobId: string, event: ForwardProgressEvent): void {
  const job = state.jobs.get(jobId);
  if (!job) return;

  // Update the rolled-up progress snapshot so newly-joining tabs don't have
  // to replay every event to know the current state.
  switch (event.type) {
    case "forwarding":
      job.progress = { step: "forwarding", index: 0, percent: 0 };
      break;
    case "queued":
      job.progress = { step: "queued", index: 0, percent: 0 };
      break;
    case "message_start":
      job.progress = {
        step: "downloading",
        index: event.index,
        percent: 0,
        loadedBytes: 0,
        totalBytes: event.size ?? undefined,
      };
      break;
    case "download_progress":
      job.progress = {
        step: "downloading",
        index: event.index,
        percent: event.total > 0 ? (event.loaded / event.total) * 100 : 0,
        loadedBytes: event.loaded,
        totalBytes: event.total,
      };
      break;
    case "download_done":
      job.progress = { step: "uploading", index: event.index, percent: 0 };
      break;
    case "upload_progress":
      job.progress = {
        step: "uploading",
        index: event.index,
        percent: event.progress * 100,
      };
      break;
    case "upload_done":
      job.progress = { step: "uploading", index: event.index, percent: 100 };
      break;
    case "message_skipped":
      job.progress = { step: "skipped", index: event.index, percent: 100 };
      break;
    // "start", "done", "error" don't change the rolled-up step.
  }

  state.emitter.emit("event", {
    kind: "job_progress",
    jobId,
    userKey: job.userKey,
    event,
    progress: job.progress,
  } satisfies RegistryEvent);
}

/** Remove a job (success, error, or cancellation). */
export function removeJob(
  jobId: string,
  reason: "done" | "error" | "cancelled",
  errorMessage?: string,
): void {
  const job = state.jobs.get(jobId);
  if (!job) return;
  state.jobs.delete(jobId);
  state.emitter.emit("event", {
    kind: "job_removed",
    jobId,
    userKey: job.userKey,
    reason,
    errorMessage,
  } satisfies RegistryEvent);
}

/** Cancel a job by signalling its AbortController. The job's own finally
 * blocks call removeJob — we don't remove here so the "cancelled" reason
 * propagates through the normal cleanup path. */
export function cancelJob(jobId: string, userKey: string): boolean {
  const job = state.jobs.get(jobId);
  if (!job || job.userKey !== userKey) return false;
  job.controller.abort();
  return true;
}

/** Snapshot of all jobs for a given user. */
export function listJobs(userKey: string): ForwardJobMeta[] {
  const out: ForwardJobMeta[] = [];
  for (const job of state.jobs.values()) {
    if (job.userKey === userKey) {
      const { controller: _c, ...meta } = job;
      void _c;
      out.push(meta);
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Subscribe to registry events for a single user. Returns an unsubscribe
 * function. Used by the SSE stream endpoint to push events to tabs.
 */
export function subscribe(
  userKey: string,
  onEvent: (event: RegistryEvent) => void,
): () => void {
  const listener = (event: RegistryEvent) => {
    if ("userKey" in event && event.userKey !== userKey) return;
    if (event.kind === "job_added" && event.job.userKey !== userKey) return;
    onEvent(event);
  };
  state.emitter.on("event", listener);
  return () => state.emitter.off("event", listener);
}

export type { RegistryEvent };
