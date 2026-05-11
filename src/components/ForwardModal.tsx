"use client";

import { useEffect, useMemo, useState } from "react";
import DialogAvatar from "./DialogAvatar";

export interface ForwardDestination {
  id: string;
  title: string;
  isChannel: boolean;
  isGroup: boolean;
}

interface ForwardModalProps {
  session: string;
  destinations: ForwardDestination[];
  currentChatId: string;
  loading: boolean;
  error?: string | null;
  /** When true the selected items come from a noforwards-restricted chat. */
  isRestricted?: boolean;
  onClose: () => void;
  onSelectDestination: (destinationId: string) => void;
}

export default function ForwardModal({
  session,
  destinations,
  currentChatId,
  loading,
  error,
  isRestricted = false,
  onClose,
  onSelectDestination,
}: ForwardModalProps) {
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
      channels: filteredDestinations.filter((destination) => destination.isChannel),
    };
  }, [filteredDestinations]);

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
              Choose a group or channel destination for the selected media.
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

        {/* Restricted content warning */}
        {isRestricted && (
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
            placeholder="Search groups or channels…"
            className="p-[1rem] mb-4 h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:bg-zinc-900"
          />

          <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950/70">
            {filteredDestinations.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                No other groups or channels match your search.
              </div>
            ) : (
              <div className="space-y-4">
                {groupedDestinations.channels.length > 0 && (
                  <div className="space-y-2">
                    <div className="px-4 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Channels
                    </div>
                    <ul className="space-y-2">
                      {groupedDestinations.channels.map((destination) => (
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
                                fallbackClassName="from-violet-500 to-pink-500"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                  {destination.title}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                  Channel
                                </p>
                              </div>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              isRestricted
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}>
                              {isRestricted ? "Re-upload" : "Forward"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {groupedDestinations.groups.length > 0 && (
                  <div className="space-y-2">
                    <div className="px-4 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Groups
                    </div>
                    <ul className="space-y-2">
                      {groupedDestinations.groups.map((destination) => (
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
                                fallbackClassName="from-blue-500 to-cyan-500"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                  {destination.title}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                  Group
                                </p>
                              </div>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              isRestricted
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}>
                              {isRestricted ? "Re-upload" : "Forward"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
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
