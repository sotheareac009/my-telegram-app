"use client";

import { useEffect, useState } from "react";
import type { ForwardProgress } from "./ForwardModal";

interface FloatingForwardProgressProps {
  progress: ForwardProgress;
  onCancel?: () => void;
}

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

export default function FloatingForwardProgress({
  progress,
  onCancel,
}: FloatingForwardProgressProps) {
  const [cancelling, setCancelling] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  useEffect(() => {
    // Reset the local state if progress changes (e.g., a new job starts).
    setCancelling(false);
  }, [progress.destinationTitle]);
  useEffect(() => {
    setThumbBroken(false);
  }, [progress.contentThumbBase64]);

  const stepLabel =
    progress.step === "forwarding"
      ? "Forwarding…"
      : progress.step === "downloading"
        ? `Downloading ${progress.index + 1} of ${progress.total}`
        : progress.step === "uploading"
          ? `Uploading ${progress.index + 1} of ${progress.total}`
          : `Skipped ${progress.index + 1} of ${progress.total}`;

  const sideLabel =
    progress.step === "downloading" && progress.totalBytes
      ? `${formatBytes(progress.loadedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
      : `${Math.round(progress.percent)}%`;

  const barWidth =
    progress.step === "forwarding"
      ? "100%"
      : `${Math.max(0, Math.min(100, progress.percent))}%`;

  const barColor =
    progress.step === "downloading"
      ? "bg-blue-500"
      : progress.step === "uploading"
        ? "bg-emerald-500"
        : "bg-zinc-400";

  const handleCancelClick = () => {
    if (cancelling || !onCancel) return;
    setCancelling(true);
    onCancel();
  };

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] shrink-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        {progress.destinationTitle ? (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            {progress.sourceTitle && (
              <>
                <span className="min-w-0 truncate font-medium">{progress.sourceTitle}</span>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">→</span>
              </>
            )}
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
          </div>
        ) : (
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Forwarding…
          </p>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={cancelling}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      {progress.contentSummary && (
        <div className="mt-3 flex items-center gap-2">
          {progress.contentThumbBase64 && !thumbBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/jpeg;base64,${progress.contentThumbBase64}`}
              alt=""
              onError={() => setThumbBroken(true)}
              className="h-8 w-8 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              ✦
            </div>
          )}
          <p className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
            {progress.contentSummary}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {stepLabel}
        </p>
        <p className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {sideLabel}
        </p>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ease-out ${barColor}`}
          style={{ width: barWidth }}
        />
      </div>
    </div>
  );
}
