"use client";

import { useEffect, useRef, useState } from "react";
import LinksModal, { type LinkEntry } from "./LinksModal";
import ForwardModal, { type ForwardDestination } from "./ForwardModal";
import MediaViewer from "./MediaViewer";
import MessageSearch from "./MessageSearch";
import Thumbnail from "./Thumbnail";

function buildDownloadUrl(session: string, groupId: string, messageId: number) {
  const params = new URLSearchParams({
    sessionString: session,
    groupId,
    messageId: String(messageId),
    download: "1",
  });
  return `/api/telegram/download?${params.toString()}`;
}

export interface Sender {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  photoBase64?: string;
}

export interface SingleMediaItem {
  id: number;
  type: "photo" | "video" | "file";
  date: number;
  caption: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbBase64: string;
  duration: number;
  sender?: Sender;
}

export interface MediaItem extends SingleMediaItem {
  album?: {
    groupedId: string;
    items: SingleMediaItem[];
  };
}

export interface MediaCacheEntry {
  media: MediaItem[];
  hasMore: boolean;
  nextOffsetId: number;
}

interface GroupMediaProps {
  session: string;
  groupId: string;
  groupTitle: string;
  cache: MediaCacheEntry | undefined;
  onCacheUpdate: (groupId: string, entry: MediaCacheEntry) => void;
  destinationChats?: ForwardDestination[];
}

type TabId = "all" | "photo" | "video" | "file";
type VideoLayout = "landscape" | "portrait";

const VIDEO_LAYOUT_STORAGE_KEY = "telegram-media-video-layout";
const ALBUM_LAYOUT_STORAGE_KEY = "telegram-media-album-layout";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  {
    id: "all",
    label: "All",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: "photo",
    label: "Photos",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    id: "video",
    label: "Videos",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
  },
  {
    id: "file",
    label: "Files",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
];

function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function AlbumPreviewLayer({
  item,
  session,
  groupId,
  className,
}: {
  item?: SingleMediaItem;
  session: string;
  groupId: string;
  className: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute z-0 overflow-hidden rounded-t-xl border border-black/35 bg-transparent shadow-sm dark:border-white/25 ${className}`}
    >
      {item ? (
        item.type === "file" ? (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900/85 text-zinc-500">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
        ) : (
          <Thumbnail
            session={session}
            groupId={groupId}
            messageId={item.id}
            alt={item.caption || item.fileName}
            fallbackSrc={
              item.thumbBase64
                ? `data:image/jpeg;base64,${item.thumbBase64}`
                : ""
            }
            className="h-full w-full opacity-80"
          />
        )
      ) : null}
    </div>
  );
}

function AlbumBadge({
  count,
  items,
  session,
  groupId,
}: {
  count: number;
  items: SingleMediaItem[];
  session: string;
  groupId: string;
}) {
  const previews = items.slice(1, 3);

  return (
    <>
      <AlbumPreviewLayer
        item={previews[1] ?? previews[0]}
        session={session}
        groupId={groupId}
        className="inset-x-3 -top-3 h-5"
      />
      <AlbumPreviewLayer
        item={previews[0]}
        session={session}
        groupId={groupId}
        className="inset-x-1.5 -top-1.5 h-5"
      />
      <span className="pointer-events-none absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded bg-black/80 px-1.5 py-1 text-[10px] font-semibold leading-none text-white backdrop-blur-sm">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 5h11v2H4V5Zm0 4h11v2H4V9Zm0 4h7v2H4v-2Zm10.5-1.5L20 15l-5.5 3.5v-7Z" />
        </svg>
        {count}
      </span>
    </>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={`pointer-events-none absolute left-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full border text-white shadow-sm ${
        selected
          ? "border-blue-500 bg-blue-600"
          : "border-white/70 bg-black/45"
      }`}
    >
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}

function LayoutToggle({
  value,
  onChange,
  label,
}: {
  value: VideoLayout;
  onChange: (value: VideoLayout) => void;
  label: string;
}) {
  return (
    <div
      className="flex shrink-0 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => onChange("landscape")}
        aria-label="Landscape layout"
        title="Landscape"
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          value === "landscape"
            ? "bg-blue-600 text-white shadow-sm"
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="6" width="18" height="12" rx="2" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange("portrait")}
        aria-label="Portrait layout"
        title="Portrait"
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          value === "portrait"
            ? "bg-blue-600 text-white shadow-sm"
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="7" y="3" width="10" height="18" rx="2" />
        </svg>
      </button>
    </div>
  );
}

function downloadFileName(item: SingleMediaItem): string {
  if (item.fileName) return item.fileName;
  if (item.type === "photo") return `photo_${item.id}.jpg`;
  if (item.type === "video") return `video_${item.id}.mp4`;
  return `file_${item.id}`;
}

function itemsForSelection(item: MediaItem): SingleMediaItem[] {
  return item.album ? item.album.items : [item];
}

function flattenMedia(items: MediaItem[]): SingleMediaItem[] {
  const seen = new Set<number>();
  const out: SingleMediaItem[] = [];
  for (const item of items) {
    for (const sub of itemsForSelection(item)) {
      if (seen.has(sub.id)) continue;
      seen.add(sub.id);
      out.push(sub);
    }
  }
  return out;
}

function isVideoLayout(value: string | null): value is VideoLayout {
  return value === "portrait" || value === "landscape";
}

function readStoredLayout(key: string, fallback: VideoLayout): VideoLayout {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return isVideoLayout(value) ? value : fallback;
}

/** Avatar colors — deterministic from the last digit of user ID. */
const SENDER_COLORS = [
  "from-blue-500 to-cyan-500",
  "from-violet-500 to-purple-500",
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
  "from-sky-500 to-indigo-500",
  "from-fuchsia-500 to-pink-500",
  "from-lime-500 to-green-500",
  "from-red-500 to-rose-500",
  "from-cyan-500 to-blue-500",
];

function senderDisplayName(sender: Sender): string {
  return (
    [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
    (sender.username ? `@${sender.username}` : "") ||
    `User ${sender.id.slice(-5)}`
  );
}

function UserAvatar({ sender }: { sender: Sender }) {
  const name = senderDisplayName(sender);
  const initials = name.split(" ").map((w) => w.replace("@", "")[0]).join("").slice(0, 2).toUpperCase();
  const color = SENDER_COLORS[parseInt(sender.id.slice(-1), 10) % SENDER_COLORS.length];

  if (sender.photoBase64) {
    return (
      <img
        src={`data:image/jpeg;base64,${sender.photoBase64}`}
        alt={name}
        className="h-5 w-5 shrink-0 rounded-full object-cover shadow-sm ring-1 ring-white/20"
      />
    );
  }
  return (
    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${color} text-[9px] font-bold text-white shadow-sm`}>
      {initials || "?"}
    </div>
  );
}

function SenderChip({ sender, overlay = false }: { sender: Sender; overlay?: boolean }) {
  const name = senderDisplayName(sender);

  if (overlay) {
    return (
      <div className="flex items-center gap-1.5">
        <UserAvatar sender={sender} />
        <span className="max-w-[8rem] truncate text-[10px] font-medium leading-none text-white drop-shadow">
          {name}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <UserAvatar sender={sender} />
      <span className="max-w-[8rem] truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        {name}
      </span>
    </div>
  );
}

/**
 * Overlay rendered on top of a photo or video card when it is the active
 * search-jump target. Shows a pulsing blue border glow + a "Search Result" pill.
 */
function SearchResultBadge() {
  return (
    <>
      {/* Pulsing blue vignette overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-20 animate-pulse rounded-xl"
        style={{
          boxShadow: "inset 0 0 0 3px rgba(59,130,246,0.9), inset 0 0 20px rgba(59,130,246,0.35)",
        }}
      />
      {/* Pill badge */}
      <span className="absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-lg shadow-blue-600/50 backdrop-blur-sm">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search result
      </span>
    </>
  );
}

export default function GroupMedia({
  session,
  groupId,
  groupTitle,
  cache,
  onCacheUpdate,
  destinationChats = [],
}: GroupMediaProps) {
  console.log("Rendering GroupMedia with props:", { groupTitle, cache, destinationChats });
  const media = cache?.media ?? [];
  const hasMore = cache?.hasMore ?? false;
  const nextOffsetId = cache?.nextOffsetId ?? 0;
  const [loading, setLoading] = useState(cache === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<TabId>("all");
  const [videoLayout, setVideoLayout] = useState<VideoLayout>(() =>
    readStoredLayout(VIDEO_LAYOUT_STORAGE_KEY, "portrait")
  );
  const [albumLayout, setAlbumLayout] = useState<VideoLayout>(() =>
    readStoredLayout(ALBUM_LAYOUT_STORAGE_KEY, "portrait")
  );
  const [viewer, setViewer] = useState<SingleMediaItem | null>(null);
  const [albumView, setAlbumView] = useState<MediaItem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [linksModalOpen, setLinksModalOpen] = useState(false);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [forwardSuccess, setForwardSuccess] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [leaveConfirming, setLeaveConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const availableForwardDestinations = destinationChats.filter((chat) => chat.id !== groupId);
  // React-managed highlight (replaces DOM class mutation)
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  // ID to jump to after a media reload triggered by search
  const [jumpTargetId, setJumpTargetId] = useState<number | null>(null);
  // True when the grid was reloaded from a search-jump offset (not from latest)
  const [isSearchJumpView, setIsSearchJumpView] = useState(false);

  /** Set a highlight that auto-clears after 3.5 s */
  function highlightMessage(id: number) {
    setHighlightedMessageId(id);
    setTimeout(() => setHighlightedMessageId(null), 3500);
  }

  async function handleLeave() {
    setLeaving(true);
    setLeaveError(null);
    try {
      const res = await fetch("/api/telegram/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session, groupId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to leave");
      // Reload the page so the group disappears from the sidebar
      window.location.reload();
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : "Failed to leave");
      setLeaving(false);
      setLeaveConfirming(false);
    }
  }

  // ── Scroll restoration when navigating into/out of album view ──────────
  /** Ref attached to the main scrollable content div */
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Saves the Y offset before entering album view so we can restore it */
  const savedScrollRef = useRef<number>(0);

  // Restore scroll position after returning from album view
  useEffect(() => {
    if (!albumView && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = savedScrollRef.current;
    }
  }, [albumView]);

  function openItem(item: MediaItem) {
    if (selectionMode) {
      toggleSelection(itemsForSelection(item));
      return;
    }
    if (item.album) {
      // Save current scroll position before unmounting the grid
      savedScrollRef.current = scrollContainerRef.current?.scrollTop ?? 0;
      setAlbumView(item);
      return;
    }
    const { album: _album, ...single } = item;
    void _album;
    setViewer(single);
  }

  function openAlbumItem(item: SingleMediaItem) {
    if (selectionMode) {
      toggleSelection([item]);
      return;
    }
    setViewer(item);
  }

  useEffect(() => {
    if (cache !== undefined) {
      setLoading(false);
      return;
    }
    setIsSearchJumpView(false);
    fetchMedia(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, groupId]);

  useEffect(() => {
    window.localStorage.setItem(VIDEO_LAYOUT_STORAGE_KEY, videoLayout);
  }, [videoLayout]);

  useEffect(() => {
    window.localStorage.setItem(ALBUM_LAYOUT_STORAGE_KEY, albumLayout);
  }, [albumLayout]);

  // After a jump-triggered reload, wait for the target item to appear then scroll to it
  useEffect(() => {
    if (jumpTargetId === null || loading) return;
    const id = jumpTargetId;

    let attempts = 0;
    const MAX_ATTEMPTS = 30; // up to ~3s of polling
    const interval = setInterval(() => {
      const el = document.getElementById(`media-item-${id}`);
      if (el) {
        clearInterval(interval);
        setJumpTargetId(null);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightMessage(id);
      } else {
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          clearInterval(interval);
          setJumpTargetId(null);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTargetId, loading]);

  async function fetchMedia(offsetId: number, reset: boolean) {
    if (reset) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await fetch("/api/telegram/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionString: session,
          groupId,
          limit: 50,
          offsetId,
        }),
      });
      const data = await res.json();
      if (data.media) {
        const prevMedia = reset ? [] : media;
        onCacheUpdate(groupId, {
          media: [...prevMedia, ...data.media],
          hasMore: data.hasMore,
          nextOffsetId: data.nextOffsetId,
        });
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // For specific tabs, flatten albums so individual items show through.
  const filtered: MediaItem[] = (() => {
    if (tab === "all") return media;
    const out: MediaItem[] = [];
    for (const item of media) {
      if (item.album) {
        for (const sub of item.album.items) {
          if (sub.type === tab) out.push(sub);
        }
      } else if (item.type === tab) {
        out.push(item);
      }
    }
    return out;
  })();

  const photos = filtered.filter((m) => m.type === "photo");
  const videos = filtered.filter((m) => m.type === "video");
  const files = filtered.filter((m) => m.type === "file");
  const allMediaItems = flattenMedia(media);
  const selectedItems = allMediaItems.filter((item) => selectedIds.has(item.id));
  const selectedCount = selectedItems.length;

  function isSelected(items: SingleMediaItem[]): boolean {
    return items.length > 0 && items.every((item) => selectedIds.has(item.id));
  }

  function toggleSelection(items: SingleMediaItem[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((item) => next.has(item.id));
      for (const item of items) {
        if (allSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function buildLinkEntries(): LinkEntry[] {
    const origin = window.location.origin;
    return selectedItems.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      caption: item.caption,
      type: item.type,
      url: `${origin}${buildDownloadUrl(session, groupId, item.id)}`,
    }));
  }

  async function handleForwardToDestination(destinationId: string) {
    if (selectedCount === 0) return;
    setForwardError(null);
    setForwarding(true);

    try {
      const response = await fetch("/api/telegram/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionString: session,
          fromGroupId: groupId,
          toGroupId: destinationId,
          messageIds: selectedItems.map((item) => item.id),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Failed to forward messages");
      }

      const target = destinationChats.find((chat) => chat.id === destinationId);
      setForwardSuccess(
        `Forwarded ${selectedCount} item${selectedCount === 1 ? "" : "s"} to ${
          target?.title ?? "the selected chat"
        }.`,
      );
      setForwardModalOpen(false);
      clearSelection();
    } catch (error: unknown) {
      setForwardError(error instanceof Error ? error.message : "Failed to forward messages");
    } finally {
      setForwarding(false);
    }
  }

  useEffect(() => {
    if (!forwardSuccess) return;
    const timeout = window.setTimeout(() => setForwardSuccess(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [forwardSuccess]);

  function openLinksModal() {
    if (selectedItems.length === 0) return;
    setLinksModalOpen(true);
  }

  function exportSelectedLinks() {
    const links = buildLinkEntries()
      .map((entry) => entry.url)
      .join("\n");
    if (!links) return;
    const blob = new Blob([links], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "telegram-media-links.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSelected() {
    if (selectedItems.length === 0) return;

    if (selectedItems.length === 1) {
      const item = selectedItems[0];
      const a = document.createElement("a");
      a.href = buildDownloadUrl(session, groupId, item.id);
      a.download = downloadFileName(item);
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    const safeTitle = (groupTitle || "telegram")
      .replace(/[^\w\-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "telegram";

    const params = new URLSearchParams({
      sessionString: session,
      groupId,
      messageIds: selectedItems.map((item) => item.id).join(","),
      filename: `${safeTitle}.zip`,
    });

    const a = document.createElement("a");
    a.href = `/api/telegram/download-zip?${params.toString()}`;
    a.download = `${safeTitle}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function removeSelectedFromLocalList() {
    if (selectedCount === 0) return;
    const shouldRemove = (item: SingleMediaItem) => selectedIds.has(item.id);
    const prune = (items: MediaItem[]): MediaItem[] =>
      items.flatMap((item) => {
        if (!item.album) return shouldRemove(item) ? [] : [item];
        const remaining = item.album.items.filter((sub) => !shouldRemove(sub));
        if (remaining.length === 0) return [];
        if (remaining.length === 1) return [remaining[0]];
        return [
          {
            ...remaining[0],
            album: {
              groupedId: item.album.groupedId,
              items: remaining,
            },
          },
        ];
      });

    onCacheUpdate(groupId, {
      media: prune(media),
      hasMore,
      nextOffsetId,
    });
    setAlbumView((prev) => {
      if (!prev?.album) return prev;
      const remaining = prev.album.items.filter((item) => !shouldRemove(item));
      if (remaining.length === 0) return null;
      return {
        ...remaining[0],
        album: {
          groupedId: prev.album.groupedId,
          items: remaining,
        },
      };
    });
    if (viewer && shouldRemove(viewer)) setViewer(null);
    clearSelection();
  }

  function countByType(type: SingleMediaItem["type"]): number {
    let n = 0;
    for (const item of media) {
      if (item.album) {
        for (const sub of item.album.items) if (sub.type === type) n += 1;
      } else if (item.type === type) {
        n += 1;
      }
    }
    return n;
  }

  const counts = {
    all: media.reduce(
      (n, m) => n + (m.album ? m.album.items.length : 1),
      0
    ),
    photo: countByType("photo"),
    video: countByType("video"),
    file: countByType("file"),
  };

  const selectionToolbar = selectionMode && (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 sm:px-6 dark:border-zinc-800">
      <span className="mr-auto text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {selectedCount} selected
      </span>
      <button
        type="button"
        onClick={downloadSelected}
        disabled={selectedCount === 0}
        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Download
      </button>
      <button
        type="button"
        onClick={openLinksModal}
        disabled={selectedCount === 0}
        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Copy links
      </button>
      <button
        type="button"
        onClick={exportSelectedLinks}
        disabled={selectedCount === 0}
        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Export
      </button>
      <button
        type="button"
        onClick={() => {
          setForwardError(null);
          setForwardModalOpen(true);
        }}
        disabled={selectedCount === 0 || availableForwardDestinations.length === 0}
        title={
          availableForwardDestinations.length === 0
            ? "No available destination chats"
            : undefined
        }
        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Forward
      </button>
      <button
        type="button"
        onClick={removeSelectedFromLocalList}
        disabled={selectedCount === 0}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        Remove
      </button>
      <button
        type="button"
        onClick={clearSelection}
        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        Cancel
      </button>
    </div>
  );

  const videoGridClass =
    videoLayout === "portrait"
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
      : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
  const videoCardClass =
    videoLayout === "portrait" ? "aspect-[9/16]" : "aspect-video";
  const albumGridClass =
    albumLayout === "portrait"
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
      : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
  const albumCardClass =
    albumLayout === "portrait" ? "aspect-[9/16]" : "aspect-video";


  if (albumView && albumView.album) {
    const albumItems = albumView.album.items;
    const viewerIndex = viewer
      ? albumItems.findIndex((item) => item.id === viewer.id)
      : -1;
    const photoCount = albumItems.filter((i) => i.type === "photo").length;
    const videoCount = albumItems.filter((i) => i.type === "video").length;
    const fileCount = albumItems.filter((i) => i.type === "file").length;
    const summary = [
      photoCount && `${photoCount} photo${photoCount > 1 ? "s" : ""}`,
      videoCount && `${videoCount} video${videoCount > 1 ? "s" : ""}`,
      fileCount && `${fileCount} file${fileCount > 1 ? "s" : ""}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const albumCaptions = Array.from(
      new Set(
        albumItems
          .map((item) => item.caption.trim())
          .filter((caption) => caption.length > 0)
      )
    );

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-zinc-200 px-3 py-3 sm:px-6 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setAlbumView(null)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Album · {albumItems.length} items
            </p>
            <p className="truncate text-xs text-zinc-500">{summary}</p>
          </div>
          <LayoutToggle
            value={albumLayout}
            onChange={setAlbumLayout}
            label="Album layout"
          />
          <button
            type="button"
            onClick={() => {
              setSelectionMode((value) => !value);
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectionMode
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Select
          </button>
        </div>
        {selectionToolbar}

        {forwardSuccess && (
          <div className="mx-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
            {forwardSuccess}
          </div>
        )}

        {albumCaptions.length > 0 && (
          <div className="border-b border-zinc-200 bg-zinc-50/60 px-3 py-3 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Message
            </p>
            <div className="space-y-2">
              {albumCaptions.map((caption, i) => (
                <p
                  key={i}
                  className="whitespace-pre-wrap wrap-break-word text-sm text-zinc-800 dark:text-zinc-200"
                >
                  {caption}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          <div className={albumGridClass}>
            {albumItems.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openAlbumItem(item)}
                aria-pressed={selectionMode ? selectedIds.has(item.id) : undefined}
                className={`group relative ${albumCardClass} overflow-hidden rounded-xl border bg-zinc-100 transition-all hover:border-blue-300 hover:shadow-lg dark:bg-zinc-800 ${
                  selectedIds.has(item.id)
                    ? "border-blue-500 ring-2 ring-blue-500/50"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                {selectionMode && <SelectionMark selected={selectedIds.has(item.id)} />}
                <Thumbnail
                  session={session}
                  groupId={groupId}
                  messageId={item.id}
                  alt={item.caption || item.fileName}
                  className="h-full w-full transition-transform group-hover:scale-105"
                />
                {item.type === "video" && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm transition-transform group-hover:scale-110">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                        <polygon points="6 4 20 12 6 20" />
                      </svg>
                    </div>
                  </div>
                )}
                {!selectionMode && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                    {i + 1}
                  </span>
                )}
                {!selectionMode && (
                  <a
                    href={buildDownloadUrl(session, groupId, item.id)}
                    download={downloadFileName(item)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100"
                    aria-label={`Download ${downloadFileName(item)}`}
                  >
                    <DownloadIcon />
                  </a>
                )}
                {item.type === "video" && item.duration > 0 && (
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {formatDuration(item.duration)}
                  </span>
                )}
                {item.fileSize > 0 && (
                  <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">
                    {formatFileSize(item.fileSize)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {viewer && (
          <MediaViewer
            session={session}
            groupId={groupId}
            messageId={viewer.id}
            type={viewer.type}
            fileName={viewer.fileName}
            caption={viewer.caption}
            onClose={() => setViewer(null)}
            currentIndex={viewerIndex >= 0 ? viewerIndex : undefined}
            totalItems={albumItems.length}
            onPrevious={() => {
              const index = viewerIndex >= 0 ? viewerIndex : 0;
              const previous =
                albumItems[(index - 1 + albumItems.length) % albumItems.length];
              setViewer(previous);
            }}
            onNext={() => {
              const index = viewerIndex >= 0 ? viewerIndex : 0;
              const next = albumItems[(index + 1) % albumItems.length];
              setViewer(next);
            }}
            items={albumItems}
            onSelectItem={setViewer}
          />
        )}

        {linksModalOpen && (
          <LinksModal
            entries={buildLinkEntries()}
            onClose={() => setLinksModalOpen(false)}
          />
        )}
        {forwardModalOpen && (
          <ForwardModal
            session={session}
            destinations={availableForwardDestinations}
            currentChatId={groupId}
            loading={forwarding}
            error={forwardError}
            onClose={() => setForwardModalOpen(false)}
            onSelectDestination={handleForwardToDestination}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-3 sm:px-6 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4 ${
              tab === t.id
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {t.icon}
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                tab === t.id
                  ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {counts[t.id]}
            </span>
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Search button */}
          <button
            type="button"
            id="group-search-btn"
            onClick={() => setSearchOpen(true)}
            title="Search messages"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          {/* Select button */}
          <button
            type="button"
            onClick={() => {
              setSelectionMode((value) => !value);
            }}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectionMode
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Select
          </button>
          {/* Leave button */}
          {!selectionMode && (
            <button
              type="button"
              onClick={() => setLeaveConfirming(true)}
              title="Leave this group or channel"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-red-800 dark:hover:bg-red-950/30 dark:hover:text-red-400"
            >
              {/* Door/exit icon */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {selectionToolbar}

      {/* Leave confirmation modal */}
      {leaveConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600 dark:text-red-400">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
            <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Leave &ldquo;{groupTitle}&rdquo;?
            </h2>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              You will no longer receive messages from this {groupTitle.toLowerCase().includes("channel") ? "channel" : "group"}.
              You can rejoin at any time if it&apos;s public.
            </p>
            {leaveError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">
                {leaveError}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => { setLeaveConfirming(false); setLeaveError(null); }}
                disabled={leaving}
                className="flex-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLeave}
                disabled={leaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {leaving && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {leaving ? "Leaving..." : "Leave"}
              </button>
            </div>
          </div>
        </div>
      )}

      {forwardSuccess && (
        <div className="mx-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {forwardSuccess}
        </div>
      )}

      {/* Search-jump view banner — shown when grid is reloaded from a search offset */}
      {isSearchJumpView && !selectionMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-blue-200/70 bg-blue-50/80 px-4 py-2 dark:border-blue-900/50 dark:bg-blue-950/30">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p className="min-w-0 flex-1 truncate text-xs text-blue-700 dark:text-blue-300">
            Showing results near searched message
          </p>
          <button
            type="button"
            onClick={() => {
              setIsSearchJumpView(false);
              void fetchMedia(0, true);
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 active:scale-95"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 12 6 7 11" />
              <polyline points="17 18 12 13 7 18" />
            </svg>
            Back to latest
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setIsSearchJumpView(false)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="space-y-6">
            {/* Photo skeleton */}
            <div>
              <div className="mb-3 h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                ))}
              </div>
            </div>
            {/* File skeleton */}
            <div>
              <div className="mb-3 h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-800/60">
                    <div className="h-10 w-10 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="h-2 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-500">No media found</p>
            <p className="mt-1 text-xs text-zinc-400">
              This {groupTitle ? "group" : "channel"} has no {tab === "all" ? "media" : tab + "s"} yet
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Photos section */}
            {(tab === "all" || tab === "photo") && photos.length > 0 && (
              <section>
                {tab === "all" && (
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    Photos ({photos.length})
                  </h3>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {photos.map((item) => {
                    const selectable = itemsForSelection(item);
                    const selected = isSelected(selectable);
                    const isHighlighted = highlightedMessageId === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`media-item-${item.id}`}
                        onClick={() => openItem(item)}
                        aria-pressed={selectionMode ? selected : undefined}
                        className={`group relative aspect-square cursor-pointer rounded-xl border bg-zinc-100 transition-all hover:border-blue-300 hover:shadow-lg dark:bg-zinc-800 ${
                          item.album ? "overflow-visible" : "overflow-hidden"
                        } ${
                          isHighlighted
                            ? "border-blue-500 shadow-lg shadow-blue-500/30 ring-2 ring-blue-500 ring-offset-1"
                            : selected
                            ? "border-blue-500 ring-2 ring-blue-500/50"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        {selectionMode && <SelectionMark selected={selected} />}
                        {item.album && (
                          <AlbumBadge
                            count={item.album.items.length}
                            items={item.album.items}
                            session={session}
                            groupId={groupId}
                          />
                        )}
                        <div className="relative z-10 h-full w-full overflow-hidden rounded-xl">
                          <Thumbnail
                            session={session}
                            groupId={groupId}
                            messageId={item.id}
                            alt={item.caption}
                            className="h-full w-full transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                          <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <div className="flex-1 truncate text-[11px] text-white drop-shadow">
                              {item.sender ? (
                                <SenderChip sender={item.sender} overlay />
                              ) : (
                                <span>{item.caption || formatDate(item.date)}</span>
                              )}
                            </div>
                          </div>
                          {isHighlighted && <SearchResultBadge />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Videos section */}
            {(tab === "all" || tab === "video") && videos.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  {tab === "all" ? (
                    <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                      Videos ({videos.length})
                    </h3>
                  ) : (
                    <span className="min-w-0" />
                  )}
                  <LayoutToggle
                    value={videoLayout}
                    onChange={setVideoLayout}
                    label="Video layout"
                  />
                </div>
                <div className={videoGridClass}>
                  {videos.map((item) => {
                    const selectable = itemsForSelection(item);
                    const selected = isSelected(selectable);
                    const isHighlighted = highlightedMessageId === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`media-item-${item.id}`}
                        onClick={() => openItem(item)}
                        aria-pressed={selectionMode ? selected : undefined}
                        className={`group relative ${videoCardClass} cursor-pointer rounded-xl border bg-zinc-900 transition-all hover:border-blue-300 hover:shadow-lg ${
                          item.album ? "overflow-visible" : "overflow-hidden"
                        } ${
                          isHighlighted
                            ? "border-blue-500 shadow-lg shadow-blue-500/30 ring-2 ring-blue-500 ring-offset-1"
                            : selected
                            ? "border-blue-500 ring-2 ring-blue-500/50"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        {selectionMode && <SelectionMark selected={selected} />}
                        {item.album && (
                          <AlbumBadge
                            count={item.album.items.length}
                            items={item.album.items}
                            session={session}
                            groupId={groupId}
                          />
                        )}
                        <div className="relative z-10 h-full w-full overflow-hidden rounded-xl">
                          <Thumbnail
                            session={session}
                            groupId={groupId}
                            messageId={item.id}
                            alt={item.caption || item.fileName}
                            fallbackSrc={
                              item.thumbBase64
                                ? `data:image/jpeg;base64,${item.thumbBase64}`
                                : ""
                            }
                            className="h-full w-full transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />
                          {!item.album && !selectionMode && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-transform group-hover:scale-110">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none">
                                  <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                              </div>
                            </div>
                          )}
                          {item.duration > 0 && (
                            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {formatDuration(item.duration)}
                            </span>
                          )}
                          {!item.album && item.fileSize > 0 && (
                            <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/70">
                              {formatFileSize(item.fileSize)}
                            </span>
                          )}
                          {/* Sender overlay — bottom-left, always visible */}
                          {item.sender && (
                            <div className="absolute bottom-2 left-2">
                              <SenderChip sender={item.sender} overlay />
                            </div>
                          )}
                          {!item.album && !selectionMode && (
                            <a
                              href={buildDownloadUrl(session, groupId, item.id)}
                              download={downloadFileName(item)}
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100"
                              aria-label={`Download ${downloadFileName(item)}`}
                            >
                              <DownloadIcon />
                            </a>
                          )}
                          {isHighlighted && <SearchResultBadge />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Files section */}
            {(tab === "all" || tab === "file") && files.length > 0 && (
              <section>
                {tab === "all" && (
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Files ({files.length})
                  </h3>
                )}
                <div className="space-y-2">
                  {files.map((item) => {
                    const selectable = itemsForSelection(item);
                    const selected = isSelected(selectable);
                    const isHighlighted = highlightedMessageId === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`media-item-${item.id}`}
                        onClick={() => openItem(item)}
                        aria-pressed={selectionMode ? selected : undefined}
                        className={`relative flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 text-left transition-all hover:border-blue-200 hover:shadow-md sm:gap-4 sm:p-4 dark:bg-zinc-900 dark:hover:border-blue-800 ${
                          isHighlighted
                            ? "border-blue-500 bg-blue-50/60 shadow-md shadow-blue-500/20 ring-2 ring-blue-500 ring-offset-1 dark:bg-blue-950/20"
                            : selected
                            ? "border-blue-500 ring-2 ring-blue-500/40"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        {selectionMode && <SelectionMark selected={selected} />}
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/20">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-600 dark:text-amber-400">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="flex items-center gap-2 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            <span className="truncate">
                              {item.fileName || "Unknown file"}
                            </span>
                            {item.album && (
                              <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                Album · {item.album.items.length}
                              </span>
                            )}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 truncate text-xs text-zinc-500">
                            <span className="truncate">
                              {formatFileSize(item.fileSize)}
                              {item.mimeType && ` · ${item.mimeType}`}
                            </span>
                            {item.sender && (
                              <SenderChip sender={item.sender} />
                            )}
                          </div>
                        </div>
                        <span className="hidden shrink-0 text-xs text-zinc-400 sm:block">
                          {formatDate(item.date)}
                        </span>
                        {isHighlighted && (
                          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <circle cx="11" cy="11" r="8" />
                              <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            Search result
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Load more */}
        {hasMore && !loading && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => fetchMedia(nextOffsetId, false)}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition-all hover:border-blue-200 hover:shadow-md disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-blue-800"
            >
              {loadingMore ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="7 13 12 18 17 13" />
                  <polyline points="7 6 12 11 17 6" />
                </svg>
              )}
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Media viewer modal */}
      {viewer && (
        <MediaViewer
          session={session}
          groupId={groupId}
          messageId={viewer.id}
          type={viewer.type}
          fileName={viewer.fileName}
          caption={viewer.caption}
          onClose={() => setViewer(null)}
        />
      )}

      {linksModalOpen && (
        <LinksModal
          entries={buildLinkEntries()}
          onClose={() => setLinksModalOpen(false)}
        />
      )}
      {forwardModalOpen && (
        <ForwardModal
          destinations={availableForwardDestinations}
          currentChatId={groupId}
          loading={forwarding}
          error={forwardError}
          session={session}
          onClose={() => setForwardModalOpen(false)}
          onSelectDestination={handleForwardToDestination}
        />
      )}

      {/* Message search panel */}
      {searchOpen && (
        <MessageSearch
          session={session}
          groupId={groupId}
          groupTitle={groupTitle}
          onClose={() => setSearchOpen(false)}
          onJumpToMessage={(messageId) => {
            setSearchOpen(false);

            const tryScrollNow = () => {
              const el = document.getElementById(`media-item-${messageId}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                highlightMessage(messageId);
                return true;
              }
              return false;
            };

            // Give the panel close animation time, then check DOM
            setTimeout(() => {
              if (!tryScrollNow()) {
                // Not loaded yet — reload grid from this message's position
                setJumpTargetId(messageId);
                setIsSearchJumpView(true);
                void fetchMedia(messageId + 1, true);
              }
            }, 280);
          }}
        />
      )}
    </div>
  );
}
