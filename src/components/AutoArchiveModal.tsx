"use client";

import { useEffect, useMemo, useState } from "react";
import type { ForwardDestination } from "./ForwardModal";

interface PublicWatch {
  id: string;
  sourceChatId: string;
  sourceChatTitle: string;
  archiveChatId: string;
  archiveChatTitle: string;
  createdAt: string;
}

interface AutoArchiveModalProps {
  session: string;
  sourceChatId: string;
  sourceChatTitle: string;
  /** Candidate archive destinations (the user's groups/channels). */
  destinations: ForwardDestination[];
  onClose: () => void;
}

export default function AutoArchiveModal({
  session,
  sourceChatId,
  sourceChatTitle,
  destinations,
  onClose,
}: AutoArchiveModalProps) {
  const [loading, setLoading] = useState(true);
  const [watch, setWatch] = useState<PublicWatch | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load whether this chat is already being watched.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/telegram/watches/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error ?? "Failed to load");
        const existing = (data.watches as PublicWatch[]).find(
          (w) => w.sourceChatId === sourceChatId,
        );
        setWatch(existing ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, sourceChatId]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return destinations
      .filter((d) => d.id !== sourceChatId)
      .filter(
        (d) =>
          d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q),
      );
  }, [destinations, search, sourceChatId]);

  async function enable() {
    if (!selectedId || busy) return;
    const dest = destinations.find((d) => d.id === selectedId);
    if (!dest) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/watches/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionString: session,
          sourceChatId,
          sourceChatTitle,
          archiveChatId: dest.id,
          archiveChatTitle: dest.title,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to enable");
      setWatch(data.watch as PublicWatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!watch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/watches/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session, watchId: watch.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to turn off");
      setWatch(null);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to turn off");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
                <rect x="3" y="4" width="18" height="4" rx="1" />
                <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
                <path d="M10 12h4" />
              </svg>
              Auto-archive new media
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              New photos &amp; videos from{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {sourceChatTitle}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
            </div>
          ) : watch ? (
            // ── Already enabled ──────────────────────────────────────────
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    Auto-archive is on
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-emerald-700 dark:text-emerald-400">
                    Saving to {watch.archiveChatTitle || watch.archiveChatId}
                  </p>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                New photos and videos posted to this chat are copied to your
                archive automatically. Restricted media is re-uploaded.
              </p>
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
              <button
                onClick={disable}
                disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Turning off…" : "Turn off auto-archive"}
              </button>
            </div>
          ) : (
            // ── Not enabled — pick a destination ─────────────────────────
            <>
              <div className="px-5 pt-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Pick the chat to archive into:
                </p>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search chats…"
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                {candidates.length === 0 ? (
                  <p className="px-2 py-8 text-center text-xs text-zinc-400">
                    No chats found.
                  </p>
                ) : (
                  candidates.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        selectedId === d.id
                          ? "bg-blue-50 dark:bg-blue-950/40"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {d.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            d.isChannel
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          }`}
                        >
                          {d.isChannel ? "Channel" : "Group"}
                        </span>
                        {selectedId === d.id && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-400">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
                {error && (
                  <p className="mb-2 text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
                <button
                  onClick={enable}
                  disabled={!selectedId || busy}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Enabling…" : "Enable auto-archive"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
