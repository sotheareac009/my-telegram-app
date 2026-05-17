"use client";

import { useEffect, useMemo, useState } from "react";
import DialogAvatar from "./DialogAvatar";

export interface ForwardDestination {
  id: string;
  title: string;
  isChannel: boolean;
  isGroup: boolean;
  /** True for a 1-to-1 private chat. */
  isUser?: boolean;
}

/** Progress snapshot for the download→resend fallback used on restricted chats. */
export interface ForwardProgress {
  /** Total number of messages being processed. */
  total: number;
  /** 0-based index of the current message. */
  index: number;
  /** Current step. "forwarding" = trying native forward; "queued" = waiting for a download slot; rest = re-upload pipeline. */
  step: "forwarding" | "queued" | "downloading" | "uploading" | "skipped";
  /** Percentage (0–100) of the current step. */
  percent: number;
  /** Bytes downloaded so far for the current message (downloading step only). */
  loadedBytes?: number;
  /** Total bytes for the current message (downloading step only). */
  totalBytes?: number;
  /** Title of the destination group/channel the user is forwarding to. */
  destinationTitle?: string;
  /** Whether the destination is a channel (vs. group). Drives the label. */
  destinationIsChannel?: boolean;
  /** Title of the source group/channel the user is forwarding from. */
  sourceTitle?: string;
  /** Human-readable summary of *what* is being forwarded (e.g., "3 photos"). */
  contentSummary?: string;
  /** Optional thumbnail (base64 data URL) for the first item being forwarded. */
  contentThumbBase64?: string;
}

interface ForwardModalProps {
  session: string;
  destinations: ForwardDestination[];
  currentChatId: string;
  loading: boolean;
  error?: string | null;
  /** When true the selected items come from a noforwards-restricted chat. */
  isRestricted?: boolean;
  /** Live progress for the download→resend fallback. */
  progress?: ForwardProgress | null;
  onClose: () => void;
  onSelectDestination: (destinationId: string) => void;
  /** Abort the in-flight forward. Shown as a Cancel button while progress is live. */
  onCancel?: () => void;
  /** Destination IDs that currently have at least one in-flight forward job. */
  inProgressDestinationIds?: ReadonlySet<string>;
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

export default function ForwardModal({
  session,
  destinations,
  currentChatId,
  loading,
  error,
  isRestricted = false,
  progress = null,
  onClose,
  onSelectDestination,
  onCancel,
  inProgressDestinationIds,
}: ForwardModalProps) {
  const [cancelling, setCancelling] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  // Reset the local cancelling flag whenever progress clears (i.e., job ended).
  useEffect(() => {
    if (!progress) setCancelling(false);
  }, [progress]);
  useEffect(() => {
    setThumbBroken(false);
  }, [progress?.contentThumbBase64]);
  const handleCancelClick = () => {
    if (cancelling || !onCancel) return;
    setCancelling(true);
    onCancel();
  };
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredDestinations = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return destinations
      .filter((destination) => destination.id !== currentChatId)
      .filter((destination) =>
        destination.title.toLowerCase().includes(normalized) ||
        destination.id.toLowerCase().includes(normalized),
      );
  }, [destinations, currentChatId, search]);

  const groupedDestinations = useMemo(() => {
    return {
      groups: filteredDestinations.filter((destination) => destination.isGroup),
      channels: filteredDestinations.filter(
        (destination) => destination.isChannel,
      ),
      privateChats: filteredDestinations.filter(
        (destination) => destination.isUser,
      ),
    };
  }, [filteredDestinations]);

  /** Render one labelled section of destination rows. */
  function renderSection(
    label: string,
    items: ForwardDestination[],
    fallbackClassName: string,
    typeLabel: string,
  ) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="px-4 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </div>
        <ul className="space-y-2">
          {items.map((destination) => (
            <li key={destination.id}>
              <button
                type="button"
                onClick={() => onSelectDestination(destination.id)}
                disabled={loading}
                className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
              >
                <div className="flex items-center gap-3">
                  <DialogAvatar
                    session={session}
                    groupId={destination.id}
                    title={destination.title}
                    fallbackClassName={fallbackClassName}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {destination.title}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {typeLabel}
                    </p>
                  </div>
                </div>
                {inProgressDestinationIds?.has(destination.id) ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Forwarding…
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isRestricted
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {isRestricted ? "Re-upload" : "Forward"}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Forward to another chat
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Choose a group, channel or private chat for the selected media.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Live progress for the download→resend fallback */}
        {progress && (
          <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950/70">
            <div className="mb-2 flex items-center justify-between gap-2">
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
                <span />
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={handleCancelClick}
                  disabled={cancelling}
                  className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                >
                  {cancelling ? "Cancelling…" : "Cancel"}
                </button>
              )}
            </div>
            {progress.contentSummary && (
              <div className="mb-2 flex items-center gap-2">
                {progress.contentThumbBase64 && !thumbBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/jpeg;base64,${progress.contentThumbBase64}`}
                    alt=""
                    onError={() => setThumbBroken(true)}
                    className="h-8 w-8 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    ✦
                  </div>
                )}
                <p className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {progress.contentSummary}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {progress.step === "forwarding" && "Forwarding…"}
                {progress.step === "queued" && "Queued — waiting for a slot…"}
                {progress.step === "downloading" &&
                  `Downloading ${progress.index + 1} of ${progress.total}`}
                {progress.step === "uploading" &&
                  `Uploading ${progress.index + 1} of ${progress.total}`}
                {progress.step === "skipped" &&
                  `Skipped ${progress.index + 1} of ${progress.total}`}
              </p>
              <p className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {progress.step === "queued"
                  ? ""
                  : progress.step === "downloading" && progress.totalBytes
                    ? `${formatBytes(progress.loadedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
                    : `${Math.round(progress.percent)}%`}
              </p>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full transition-[width] duration-150 ease-out ${
                  progress.step === "downloading"
                    ? "bg-blue-500"
                    : progress.step === "uploading"
                      ? "bg-emerald-500"
                      : progress.step === "queued"
                        ? "bg-amber-400"
                        : "bg-zinc-400"
                }`}
                style={{
                  width:
                    progress.step === "forwarding" || progress.step === "queued"
                      ? "100%"
                      : `${Math.max(0, Math.min(100, progress.percent))}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {progress.step === "forwarding" &&
                "Trying native forward — falling back to re-upload if blocked."}
              {progress.step === "queued" &&
                "Other forwards are running. This one will start automatically."}
              {progress.step === "downloading" && "Fetching original media from source chat…"}
              {progress.step === "uploading" &&
                (progress.destinationTitle
                  ? `Re-uploading to ${progress.destinationTitle}…`
                  : "Re-uploading to the destination…")}
            </p>
          </div>
        )}

        {/* Restricted content warning */}
        {isRestricted && !progress && (
          <div className="flex items-start gap-3 border-b border-amber-200/80 bg-amber-50 px-5 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Restricted content</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                This chat restricts forwarding. Files will be downloaded and re-uploaded — this may take longer for large media.
              </p>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          <label className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Search chats
          </label>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups, channels or chats…"
            className="p-[1rem] mb-4 h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:bg-zinc-900"
          />

          <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950/70">
            {filteredDestinations.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                No chats match your search.
              </div>
            ) : (
              <div className="space-y-4">
                {renderSection(
                  "Channels",
                  groupedDestinations.channels,
                  "from-violet-500 to-pink-500",
                  "Channel",
                )}
                {renderSection(
                  "Groups",
                  groupedDestinations.groups,
                  "from-blue-500 to-cyan-500",
                  "Group",
                )}
                {renderSection(
                  "Private chats",
                  groupedDestinations.privateChats,
                  "from-emerald-500 to-teal-500",
                  "Private chat",
                )}
              </div>
            )}
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
