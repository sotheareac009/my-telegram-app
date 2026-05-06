"use client";

interface DownloadProgressAlertProps {
  title: string;
  progress: number | null;
  error?: string;
}

export default function DownloadProgressAlert({
  title,
  progress,
  error = "",
}: DownloadProgressAlertProps) {
  const isIndeterminate = progress === null;

  return (
    <div className="fixed bottom-5 right-5 z-[70] w-80 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {error ? "Download failed" : "Downloading"}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {title}
          </p>
        </div>
        {!error && (
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {isIndeterminate ? "..." : `${progress}%`}
          </span>
        )}
      </div>

      {error ? (
        <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>
      ) : (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full bg-blue-600 transition-[width,transform] duration-300 ${
              isIndeterminate ? "w-1/3 animate-[shimmer_1.2s_infinite]" : ""
            }`}
            style={isIndeterminate ? undefined : { width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
