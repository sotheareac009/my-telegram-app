"use client";

import { useEffect, useState } from "react";
import DialogAvatar from "./DialogAvatar";

interface Group {
  id: string;
  title: string;
  unreadCount: number;
  isChannel: boolean;
  isGroup: boolean;
  lastMessage: string;
  date: number;
}

export interface GroupInfo {
  id: string;
  title: string;
}

interface GroupsGridProps {
  session: string;
  type: "groups" | "channels";
  onGroupSelect: (group: GroupInfo) => void;
}

const GRADIENT_COLORS = [
  "from-blue-500 to-cyan-400",
  "from-violet-500 to-purple-400",
  "from-rose-500 to-pink-400",
  "from-amber-500 to-orange-400",
  "from-emerald-500 to-teal-400",
  "from-indigo-500 to-blue-400",
  "from-fuchsia-500 to-pink-400",
  "from-sky-500 to-cyan-400",
];

function getGradient(index: number) {
  return GRADIENT_COLORS[index % GRADIENT_COLORS.length];
}

function formatTime(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function GroupsGrid({ session, type, onGroupSelect }: GroupsGridProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/telegram/dialogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session }),
        });
        const data = await res.json();
        if (!cancelled && data.groups) {
          setGroups(data.groups);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const filtered = groups
    .filter((g) => (type === "channels" ? g.isChannel : g.isGroup))
    .filter((g) => g.title.toLowerCase().includes(search.toLowerCase()));

  const totalPages = Math.ceil(filtered.length / perPage);
  const currentPage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice(
    (currentPage - 1) * perPage,
    currentPage * perPage
  );

  const title = type === "channels" ? "Channels" : "Groups";

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-zinc-900 sm:text-2xl dark:text-zinc-100">
            {title}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {loading
              ? "Loading..."
              : `${filtered.length} ${title.toLowerCase()} found`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-10 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800/80"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex min-w-0 flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="h-14 w-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-2 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-zinc-400"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-500">
              No {title.toLowerCase()} found
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Try a different search term
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {paginated.map((group, index) => {
              const globalIndex = (currentPage - 1) * perPage + index;
              return (
                <button
                  key={group.id}
                  onClick={() =>
                    onGroupSelect({ id: group.id, title: group.title })
                  }
                  className="group relative flex min-w-0 flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 transition-all hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/5 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
                >
                  {/* Unread Badge */}
                  {group.unreadCount > 0 && (
                    <span className="absolute right-3 top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                      {group.unreadCount > 99 ? "99+" : group.unreadCount}
                    </span>
                  )}

                  {/* Avatar */}
                  <DialogAvatar
                    session={session}
                    groupId={group.id}
                    title={group.title}
                    fallbackClassName={getGradient(globalIndex)}
                  />

                  {/* Info */}
                  <div className="w-full text-center">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {group.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {group.lastMessage || "No messages yet"}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                      {group.isChannel ? "Channel" : "Group"}
                    </span>
                    {group.date > 0 && (
                      <span className="shrink-0 text-[10px] text-zinc-400">
                        {formatTime(group.date)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-start gap-2 overflow-x-auto border-t border-zinc-200 pt-4 sm:mt-6 sm:justify-center dark:border-zinc-800">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i + 1)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                currentPage === i + 1
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
