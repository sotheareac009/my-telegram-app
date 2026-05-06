"use client";

import { useEffect, useState } from "react";
import DownloadProgressAlert from "./DownloadProgressAlert";
import MediaViewer from "./MediaViewer";
import Thumbnail from "./Thumbnail";
import { downloadTelegramMedia } from "@/lib/downloadTelegramMedia";

interface MediaItem {
  id: number;
  type: "photo" | "video" | "file";
  date: number;
  caption: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbBase64: string;
  duration: number;
}

interface GroupMediaProps {
  session: string;
  groupId: string;
  groupTitle: string;
}

type TabId = "all" | "photo" | "video" | "file";
type VideoLayout = "landscape" | "portrait";
const VIDEO_PER_PAGE = 50;

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

export default function GroupMedia({
  session,
  groupId,
  groupTitle,
}: GroupMediaProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<TabId>("all");
  const [videoLayout, setVideoLayout] = useState<VideoLayout>("portrait");
  const [videoPage, setVideoPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffsetId, setNextOffsetId] = useState(0);
  const [viewer, setViewer] = useState<MediaItem | null>(null);
  const [downloadState, setDownloadState] = useState<{
    name: string;
    progress: number | null;
    error?: string;
  } | null>(null);

  useEffect(() => {
    fetchMedia(0, true);
  }, [session, groupId]);

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
        if (reset) {
          setVideoPage(1);
        }
        setMedia((prev) => (reset ? data.media : [...prev, ...data.media]));
        setHasMore(data.hasMore);
        setNextOffsetId(data.nextOffsetId);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const filtered =
    tab === "all" ? media : media.filter((m) => m.type === tab);

  const photos = filtered.filter((m) => m.type === "photo");
  const videos = filtered.filter((m) => m.type === "video");
  const files = filtered.filter((m) => m.type === "file");
  const videoTotalPages = Math.ceil(videos.length / VIDEO_PER_PAGE);
  const currentVideoPage = Math.min(videoPage, Math.max(videoTotalPages, 1));
  const paginatedVideos = videos.slice(
    (currentVideoPage - 1) * VIDEO_PER_PAGE,
    currentVideoPage * VIDEO_PER_PAGE
  );

  const counts = {
    all: media.length,
    photo: media.filter((m) => m.type === "photo").length,
    video: media.filter((m) => m.type === "video").length,
    file: media.filter((m) => m.type === "file").length,
  };

  const videoGridClass =
    videoLayout === "portrait"
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
      : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
  const videoCardClass =
    videoLayout === "portrait" ? "aspect-[9/16]" : "aspect-video";

  async function handleDownload(item: MediaItem) {
    setDownloadState({
      name: item.fileName || `video_${item.id}.mp4`,
      progress: 0,
    });

    try {
      await downloadTelegramMedia({
        session,
        groupId,
        messageId: item.id,
        fileName: item.fileName || `video_${item.id}.mp4`,
        onProgress: (progress) => {
          setDownloadState((prev) =>
            prev
              ? {
                  ...prev,
                  progress,
                }
              : prev
          );
        },
      });

      setTimeout(() => {
        setDownloadState(null);
      }, 900);
    } catch {
      setDownloadState((prev) =>
        prev
          ? {
              ...prev,
              error: "The file could not be downloaded.",
            }
          : null
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-200 px-3 sm:px-6 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setVideoPage(1);
            }}
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
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
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
                  {photos.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setViewer(item)}
                      className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 transition-all hover:border-blue-300 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-800"
                    >
                      <Thumbnail
                        session={session}
                        groupId={groupId}
                        messageId={item.id}
                        alt={item.caption}
                        className="h-full w-full transition-transform group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                      <div className="absolute bottom-2 left-2 right-2 truncate text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {item.caption || formatDate(item.date)}
                      </div>
                    </button>
                  ))}
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
                  <div className="flex shrink-0 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
                    <button
                      type="button"
                      onClick={() => setVideoLayout("landscape")}
                      aria-label="Landscape video layout"
                      title="Landscape"
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                        videoLayout === "landscape"
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
                      onClick={() => setVideoLayout("portrait")}
                      aria-label="Portrait video layout"
                      title="Portrait"
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                        videoLayout === "portrait"
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      }`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="7" y="3" width="10" height="18" rx="2" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className={videoGridClass}>
                  {paginatedVideos.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setViewer(item)}
                      className={`group relative ${videoCardClass} overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900 transition-all hover:border-blue-300 hover:shadow-lg dark:border-zinc-800`}
                    >
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
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-transform group-hover:scale-110">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </div>
                      </div>
                      {item.duration > 0 && (
                        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {formatDuration(item.duration)}
                        </span>
                      )}
                      {item.fileSize > 0 && (
                        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/70">
                          {formatFileSize(item.fileSize)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownload(item);
                        }}
                        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100"
                        aria-label={`Download ${item.fileName || "video"}`}
                      >
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
                      </button>
                    </button>
                  ))}
                </div>
                {videoTotalPages > 1 && (
                  <div className="mt-4 flex items-center justify-start gap-2 overflow-x-auto border-t border-zinc-200 pt-4 sm:justify-center dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setVideoPage((page) => Math.max(1, page - 1))}
                      disabled={currentVideoPage === 1}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    {Array.from({ length: videoTotalPages }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setVideoPage(i + 1)}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                          currentVideoPage === i + 1
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setVideoPage((page) => Math.min(videoTotalPages, page + 1))
                      }
                      disabled={currentVideoPage === videoTotalPages}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                )}
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
                  {files.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setViewer(item)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-all hover:border-blue-200 hover:shadow-md sm:gap-4 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/20">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-600 dark:text-amber-400">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {item.fileName || "Unknown file"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {formatFileSize(item.fileSize)}
                          {item.mimeType && ` · ${item.mimeType}`}
                        </p>
                      </div>
                      <span className="hidden shrink-0 text-xs text-zinc-400 sm:block">
                        {formatDate(item.date)}
                      </span>
                    </button>
                  ))}
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

      {downloadState && (
        <DownloadProgressAlert
          title={downloadState.name}
          progress={downloadState.progress}
          error={downloadState.error}
        />
      )}
    </div>
  );
}
