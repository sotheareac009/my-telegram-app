"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface SearchMessageResult {
  id: number;
  date: number;
  text: string;
  senderId: string;
  senderName: string;
  hasMedia: boolean;
  mediaType: "photo" | "video" | "file" | null;
}

interface MessageSearchProps {
  session: string;
  groupId: string;
  groupTitle: string;
  /** Called when the user wants to jump to a specific message in the media grid */
  onJumpToMessage?: (messageId: number) => void;
  onClose: () => void;
}

// ─── Telegram link parser ─────────────────────────────────────────────────────
// Handles:
//   https://t.me/username/123
//   https://t.me/c/1234567890/123
//   tg://resolve?domain=username&post=123
function parseTelegramLink(input: string): number | null {
  const s = input.trim();

  // t.me/c/<channelId>/<msgId>  (private / supergroup)
  const privateMatch = s.match(/t\.me\/c\/\d+\/(\d+)/);
  if (privateMatch) return parseInt(privateMatch[1], 10);

  // t.me/<username>/<msgId>
  const publicMatch = s.match(/t\.me\/[A-Za-z0-9_]+\/(\d+)/);
  if (publicMatch) return parseInt(publicMatch[1], 10);

  // tg://resolve?domain=...&post=<msgId>
  const tgMatch = s.match(/[?&]post=(\d+)/);
  if (tgMatch) return parseInt(tgMatch[1], 10);

  // Raw numeric message id
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return null;
}

function isLinkQuery(q: string): boolean {
  return (
    q.includes("t.me/") ||
    q.startsWith("tg://") ||
    /^\d{5,}$/.test(q.trim())
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateKey(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query || query.length < 2) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        className="rounded-sm bg-blue-500/25 text-blue-700 dark:text-blue-300"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function MediaBadge({ type }: { type: "photo" | "video" | "file" }) {
  if (type === "photo")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        Photo
      </span>
    );
  if (type === "video")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" />
        </svg>
        Video
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      File
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MessageSearch({
  session,
  groupId,
  groupTitle,
  onJumpToMessage,
  onClose,
}: MessageSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMessageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffsetId, setNextOffsetId] = useState(0);
  const [error, setError] = useState("");
  const [jumpedId, setJumpedId] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount animation
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    inputRef.current?.focus();
  }, []);

  // Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 250);
  }

  // ── Search execution ────────────────────────────────────────────────────
  const doSearch = useCallback(
    async (q: string, offsetId = 0, append = false) => {
      if (!q.trim()) {
        setResults([]);
        setHasMore(false);
        setError("");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const linkId = parseTelegramLink(q);
        const body =
          linkId !== null
            ? { sessionString: session, groupId, messageId: linkId }
            : {
                sessionString: session,
                groupId,
                query: q.trim(),
                offsetId,
                limit: 40,
              };

        const res = await fetch("/api/telegram/search-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = (await res.json()) as {
          results?: SearchMessageResult[];
          hasMore?: boolean;
          nextOffsetId?: number;
          jumped?: boolean;
          error?: string;
        };

        if (data.error) {
          setError(data.error);
        } else {
          const incoming = data.results ?? [];
          setResults((prev) => (append ? [...prev, ...incoming] : incoming));
          setHasMore(data.hasMore ?? false);
          setNextOffsetId(data.nextOffsetId ?? 0);

          if (data.jumped && incoming.length > 0) {
            setJumpedId(incoming[0].id);
          } else {
            setJumpedId(null);
          }
        }
      } catch {
        setError("Search failed. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [session, groupId]
  );

  // Debounced input handler
  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      setHasMore(false);
      setError("");
      return;
    }

    // Link queries → instant
    if (isLinkQuery(q)) {
      void doSearch(q);
      return;
    }

    // Text queries → debounced 400ms
    debounceRef.current = setTimeout(() => void doSearch(q), 400);
  }

  function handleLoadMore() {
    void doSearch(query, nextOffsetId, true);
  }

  function handleJump(id: number) {
    onJumpToMessage?.(id);
  }

  // ── Group results by date ──────────────────────────────────────────────
  const grouped: { key: string; label: string; items: SearchMessageResult[] }[] =
    [];
  for (const r of results) {
    const k = dateKey(r.date);
    const last = grouped[grouped.length - 1];
    if (last?.key === k) {
      last.items.push(r);
    } else {
      grouped.push({ key: k, label: formatDate(r.date), items: [r] });
    }
  }

  const isLink = isLinkQuery(query);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-250 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />

      {/* Panel */}
      <aside
        className={`fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-250 ease-out dark:border-zinc-800 dark:bg-zinc-950 ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              ref={inputRef}
              id="message-search-input"
              type="text"
              value={query}
              onChange={handleInput}
              placeholder="Search messages or paste link…"
              className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-4 text-sm outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:bg-zinc-900"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setHasMore(false);
                  setError("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label="Clear"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Context chip */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-900">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="truncate text-[11px] text-zinc-400">{groupTitle}</span>
          {isLink && query && (
            <span className="ml-auto shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300">
              Link mode
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
              <p className="text-xs text-zinc-400">Searching…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="mx-4 mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && query && results.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-500">No messages found</p>
                <p className="mt-1 text-xs text-zinc-400">Try a different search term</p>
              </div>
            </div>
          )}

          {/* Prompt state */}
          {!loading && !error && !query && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 dark:from-blue-500/10 dark:to-cyan-500/10">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Search group messages
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Type to search, or paste a&nbsp;
                  <span className="font-medium text-blue-500">t.me link</span>
                  &nbsp;to jump to a message
                </p>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-2 px-6">
                {[
                  { icon: "🔍", label: "Search by keyword" },
                  { icon: "🔗", label: "Paste t.me link" },
                  { icon: "#️⃣", label: "Enter message ID" },
                ].map((tip) => (
                  <span
                    key={tip.label}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                  >
                    {tip.icon} {tip.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {!loading && results.length > 0 && (
            <div className="pb-4">
              {/* Jumped result banner */}
              {jumpedId !== null && (
                <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Message found via link — click to jump
                </div>
              )}

              {/* Count */}
              {!jumpedId && (
                <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {results.length} result{results.length !== 1 ? "s" : ""}
                  {hasMore ? "+" : ""}
                </p>
              )}

              {grouped.map((group) => (
                <div key={group.key}>
                  {/* Date separator */}
                  {!jumpedId && (
                    <div className="flex items-center gap-2 px-4 py-2">
                      <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
                    </div>
                  )}

                  {group.items.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      id={`search-result-${result.id}`}
                      onClick={() => handleJump(result.id)}
                      className={`group flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                        result.id === jumpedId
                          ? "bg-blue-50/60 dark:bg-blue-950/20"
                          : ""
                      }`}
                    >
                      {/* Avatar placeholder */}
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-bold text-white">
                        {result.senderName[0]?.toUpperCase() ?? "?"}
                      </div>

                      <div className="min-w-0 flex-1">
                        {/* Top row */}
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {result.senderName}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                            {formatTime(result.date)}
                          </span>
                        </div>

                        {/* Message text */}
                        <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                          {result.hasMedia && !result.text && result.mediaType ? (
                            <MediaBadge type={result.mediaType} />
                          ) : (
                            <>
                              {result.hasMedia && result.mediaType && (
                                <span className="mr-1.5 inline-block">
                                  <MediaBadge type={result.mediaType} />
                                </span>
                              )}
                              {highlightText(result.text, isLink ? "" : query)}
                            </>
                          )}
                        </p>

                        {/* Jump chip */}
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800">
                            #{result.id}
                          </span>
                          <span className="text-[10px] text-blue-500 opacity-0 transition-opacity group-hover:opacity-100">
                            Jump to message →
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}

              {/* Load more */}
              {hasMore && !jumpedId && (
                <div className="flex justify-center px-4 pt-2">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-all hover:border-blue-200 hover:shadow-md disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="7 13 12 18 17 13" />
                      <polyline points="7 6 12 11 17 6" />
                    </svg>
                    Load more results
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
