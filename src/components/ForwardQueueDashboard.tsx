"use client";

import { useEffect, useState } from "react";
import { useForwardJobs } from "./ForwardJobsContext";
import type { ForwardProgress } from "./ForwardModal";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function stepLabel(progress: ForwardProgress): string {
  switch (progress.step) {
    case "forwarding":
      return "Forwarding…";
    case "queued":
      return "Queued — waiting for a slot…";
    case "downloading":
      return `Downloading ${progress.index + 1} of ${progress.total}`;
    case "uploading":
      return `Uploading ${progress.index + 1} of ${progress.total}`;
    case "skipped":
      return `Skipped ${progress.index + 1} of ${progress.total}`;
  }
}

function barColor(step: ForwardProgress["step"]): string {
  switch (step) {
    case "downloading":
      return "bg-blue-500";
    case "uploading":
      return "bg-emerald-500";
    case "queued":
      return "bg-amber-400";
    default:
      return "bg-zinc-400";
  }
}

export default function ForwardQueueDashboard() {
  const { jobs, cancelForward, setHideAllFloating, session } = useForwardJobs();
  const [confirmCancelAll, setConfirmCancelAll] = useState(false);

  // Hide every floating progress card while this view is mounted so the
  // page isn't covered by duplicate cards of the same jobs.
  useEffect(() => {
    setHideAllFloating(true);
    return () => setHideAllFloating(false);
  }, [setHideAllFloating]);

  const activeCount = jobs.length;
  const queuedJobs = jobs.filter((j) => j.progress.step === "queued");
  const activeJobs = jobs.filter((j) => j.progress.step !== "queued");

  const cancelAll = () => {
    for (const job of jobs) cancelForward(job.id);
    setConfirmCancelAll(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Forward queue
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {activeCount === 0
              ? "No forwards in progress."
              : `${activeCount} in progress${queuedJobs.length > 0 ? ` · ${queuedJobs.length} waiting` : ""}`}
          </p>
        </div>
        {activeCount > 0 && (
          <button
            onClick={() => setConfirmCancelAll(true)}
            className="cursor-pointer rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Cancel all
          </button>
        )}
      </div>

      {/* Empty state */}
      {activeCount === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-200 bg-white/50 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nothing forwarding right now
          </p>
          <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
            When you forward messages from restricted chats, the jobs appear here so you can track and cancel them.
          </p>
        </div>
      )}

      {/* Active jobs */}
      {activeJobs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Active ({activeJobs.length})
          </h2>
          <div className="flex flex-col gap-2">
            {activeJobs.map((job) => (
              <QueueRow
                key={job.id}
                jobId={job.id}
                progress={job.progress}
                session={session}
                sourceId={job.sourceId}
                firstMessageId={job.firstMessageId}
                onCancel={() => cancelForward(job.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Queued jobs */}
      {queuedJobs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Waiting ({queuedJobs.length})
          </h2>
          <div className="flex flex-col gap-2">
            {queuedJobs.map((job) => (
              <QueueRow
                key={job.id}
                jobId={job.id}
                progress={job.progress}
                session={session}
                sourceId={job.sourceId}
                firstMessageId={job.firstMessageId}
                onCancel={() => cancelForward(job.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Confirm-cancel-all dialog */}
      {confirmCancelAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Cancel all forwards?
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              This will stop {activeCount} forward{activeCount === 1 ? "" : "s"}. Messages already sent stay in the destination chat.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmCancelAll(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Keep them
              </button>
              <button
                onClick={cancelAll}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Cancel all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface QueueRowProps {
  jobId: string;
  progress: ForwardProgress;
  session: string | null;
  sourceId: string;
  firstMessageId?: number;
  onCancel: () => void;
}

// In-memory cache of fetched high-res thumb data URLs, keyed by `${sourceId}:${messageId}`.
// Survives navigations within a session so re-opening the queue doesn't re-fetch.
const thumbCache = new Map<string, string>();

function QueueRow({ progress, session, sourceId, firstMessageId, onCancel }: QueueRowProps) {
  const [cancelling, setCancelling] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const [hiResThumb, setHiResThumb] = useState<string | null>(() => {
    if (firstMessageId === undefined) return null;
    return thumbCache.get(`${sourceId}:${firstMessageId}`) ?? null;
  });

  useEffect(() => {
    setThumbBroken(false);
  }, [progress.contentThumbBase64]);

  // Fetch a sharper thumbnail to replace the blurry stripped-preview JPEG.
  // The inline thumb Telegram embeds in messages is ~40px wide; rendering it
  // at 48px upscales and looks blurry. /api/telegram/thumb downloads a proper
  // 100–320px JPEG from Telegram.
  useEffect(() => {
    if (firstMessageId === undefined || !session) return;
    const cacheKey = `${sourceId}:${firstMessageId}`;
    const cached = thumbCache.get(cacheKey);
    if (cached) {
      setHiResThumb(cached);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/telegram/thumb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session, groupId: sourceId, messageId: firstMessageId }),
          signal: ac.signal,
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        thumbCache.set(cacheKey, url);
        setHiResThumb(url);
      } catch {
        // ignore — fall back to the blurry inline thumb
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [session, sourceId, firstMessageId]);

  const handleCancel = () => {
    if (cancelling) return;
    setCancelling(true);
    onCancel();
  };

  const sideLabel =
    progress.step === "queued"
      ? ""
      : progress.step === "downloading" && progress.totalBytes
        ? `${formatBytes(progress.loadedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
        : `${Math.round(progress.percent)}%`;

  const barWidth =
    progress.step === "forwarding" || progress.step === "queued"
      ? "100%"
      : `${Math.max(0, Math.min(100, progress.percent))}%`;

  return (
    <div className="flex items-stretch gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Thumbnail — prefer the fetched high-res thumb; fall back to the
          blurry stripped-preview JPEG embedded in the message metadata. */}
      {(() => {
        const src = hiResThumb
          ? hiResThumb
          : progress.contentThumbBase64
            ? `data:image/jpeg;base64,${progress.contentThumbBase64}`
            : null;
        if (!src || thumbBroken) {
          return (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-sm font-semibold uppercase text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
              ✦
            </div>
          );
        }
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            onError={() => setThumbBroken(true)}
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        );
      })()}

      {/* Right column: title row + summary + progress */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Source → destination + cancel */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            {progress.sourceTitle && (
              <>
                <span className="min-w-0 truncate font-medium">{progress.sourceTitle}</span>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">→</span>
              </>
            )}
            {progress.destinationTitle && (
              <>
                <span
                  className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider ${
                    progress.destinationIsChannel
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  }`}
                >
                  {progress.destinationIsChannel ? "Channel" : "Group"}
                </span>
                <span className="min-w-0 truncate font-medium">{progress.destinationTitle}</span>
              </>
            )}
          </div>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="cursor-pointer shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </div>

        {/* Content summary */}
        {progress.contentSummary && (
          <p className="mt-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {progress.contentSummary}
          </p>
        )}

        {/* Step label + side label */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            {stepLabel(progress)}
          </p>
          {sideLabel && (
            <p className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {sideLabel}
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ease-out ${barColor(progress.step)}`}
            style={{ width: barWidth }}
          />
        </div>
      </div>
    </div>
  );
}
