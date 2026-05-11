"use client";

import { useEffect, useState } from "react";
import DialogAvatar from "./DialogAvatar";

export interface Group {
  id: string;
  title: string;
  unreadCount: number;
  isChannel: boolean;
  isGroup: boolean;
  lastMessage: string;
  date: number;
  folderIds: string[];
}

export interface GroupInfo {
  id: string;
  title: string;
}

export interface ChatFolder {
  id: string;
  title: string;
}

interface GroupsGridProps {
  session: string;
  type: "groups" | "channels";
  activeFolderId: string;
  onActiveFolderChange: (folderId: string) => void;
  onGroupSelect: (group: GroupInfo) => void;
  groups: Group[] | null;
  folders: ChatFolder[] | null;
  onGroupsLoaded: (groups: Group[]) => void;
  onFoldersLoaded: (folders: ChatFolder[]) => void;
  page: number;
  onPageChange: (page: number) => void;
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
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function GroupsGrid({
  session, type, activeFolderId, onActiveFolderChange, onGroupSelect,
  groups, folders, onGroupsLoaded, onFoldersLoaded, page, onPageChange,
}: GroupsGridProps) {
  const loading = groups === null || folders === null;
  const [search, setSearch] = useState("");
  const perPage = 20;

  useEffect(() => {
    if (!session) return;
    if (groups !== null && folders !== null) return;
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/telegram/dialogs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session }),
        });
        const data = await res.json();
        if (!cancelled) { onGroupsLoaded(data.groups ?? []); onFoldersLoaded(data.folders ?? []); }
      } catch {
        if (!cancelled) { onGroupsLoaded([]); onFoldersLoaded([]); }
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [session, folders, groups, onFoldersLoaded, onGroupsLoaded]);

  const typedGroups = (groups ?? []).filter((g) =>
    type === "channels" ? g.isChannel && !g.isGroup : g.isGroup
  );
  const visibleFolders = (folders ?? []).filter((folder) =>
    typedGroups.some((group) => group.folderIds.includes(folder.id))
  );
  const selectedFolderId =
    activeFolderId === "all" || visibleFolders.some((f) => f.id === activeFolderId)
      ? activeFolderId : "all";
  const folderFiltered = selectedFolderId === "all"
    ? typedGroups
    : typedGroups.filter((g) => g.folderIds.includes(selectedFolderId));
  const filtered = folderFiltered.filter((g) =>
    g.title.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filtered.length / perPage);
  const currentPage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const title = type === "channels" ? "Channels" : "Groups";

  return (
    <div className="flex h-full flex-col">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/90 px-4 py-4 backdrop-blur-xl sm:px-6 dark:border-zinc-800/80 dark:bg-zinc-950/90">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
            <p className="text-xs text-zinc-400">
              {loading ? "Loading…" : `${filtered.length} ${title.toLowerCase()} found`}
            </p>
          </div>
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={`Filter ${title.toLowerCase()}…`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); onPageChange(1); }}
              className="h-9 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-4 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/15 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-100 dark:focus:bg-zinc-800"
            />
          </div>
        </div>

        {/* Folder pills */}
        {visibleFolders.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {[{ id: "all", title: "All" }, ...visibleFolders].map((folder) => {
              const isActive = selectedFolderId === folder.id;
              const count = folder.id === "all"
                ? typedGroups.length
                : typedGroups.filter((g) => g.folderIds.includes(folder.id)).length;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => { onActiveFolderChange(folder.id); onPageChange(1); }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                      : "border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
                  }`}
                >
                  <span className="max-w-28 truncate">{folder.title}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="h-14 w-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-2 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-semibold text-zinc-600 dark:text-zinc-400">No {title.toLowerCase()} found</p>
            <p className="mt-1 text-xs text-zinc-400">Try a different search term</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {paginated.map((group, index) => {
              const globalIndex = (currentPage - 1) * perPage + index;
              return (
                <button
                  key={group.id}
                  onClick={() => onGroupSelect({ id: group.id, title: group.title })}
                  className="group relative flex flex-col items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/8 dark:border-zinc-800/80 dark:bg-zinc-900 dark:hover:border-blue-800"
                >
                  {/* Unread badge */}
                  {group.unreadCount > 0 && (
                    <span className="absolute right-2.5 top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white shadow-sm">
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

                  {/* Name */}
                  <div className="w-full text-center">
                    <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                      {group.title}
                    </p>
                    {group.lastMessage && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-400">
                        {group.lastMessage}
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex w-full items-center justify-between gap-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${group.isChannel ? "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400" : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"}`}>
                      {group.isChannel ? "Channel" : "Group"}
                    </span>
                    {group.date > 0 && (
                      <span className="shrink-0 text-[10px] text-zinc-400">
                        {formatTime(group.date)}
                      </span>
                    )}
                  </div>

                  {/* Hover arrow */}
                  <div className="absolute inset-x-0 bottom-0 flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="mb-2 rounded-full bg-blue-600 px-3 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                      Open →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-zinc-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-950/80">
          <button
            onClick={() => {
              console.log(`Pagination clicked: previous for ${title.toLowerCase()}`);
              onPageChange(Math.max(1, page - 1));
            }}
            disabled={page === 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => {
                console.log(`Pagination clicked for ${title.toLowerCase()} page ${i + 1}`);
                onPageChange(i + 1);
              }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold transition-colors ${
                currentPage === i + 1
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => {
              console.log(`Pagination clicked: next for ${title.toLowerCase()}`);
              onPageChange(Math.min(totalPages, page + 1));
            }}
            disabled={page === totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
