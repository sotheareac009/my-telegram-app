"use client";

import { useEffect, useMemo } from "react";
import Thumbnail from "./Thumbnail";

interface MediaViewerItem {
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

interface MediaViewerProps {
  session: string;
  groupId: string;
  messageId: number;
  type: "photo" | "video" | "file";
  fileName: string;
  caption: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  currentIndex?: number;
  totalItems?: number;
  items?: MediaViewerItem[];
  onSelectItem?: (item: MediaViewerItem) => void;
}

export default function MediaViewer({
  session,
  groupId,
  messageId,
  type,
  fileName,
  caption,
  onClose,
  onPrevious,
  onNext,
  currentIndex,
  totalItems,
  items,
  onSelectItem,
}: MediaViewerProps) {
  const inlineUrl = useMemo(() => {
    const params = new URLSearchParams({
      sessionString: session,
      groupId,
      messageId: String(messageId),
    });
    return `/api/telegram/download?${params.toString()}`;
  }, [session, groupId, messageId]);

  const downloadUrl = useMemo(() => {
    const params = new URLSearchParams({
      sessionString: session,
      groupId,
      messageId: String(messageId),
      download: "1",
    });
    return `/api/telegram/download?${params.toString()}`;
  }, [session, groupId, messageId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrevious?.();
      if (e.key === "ArrowRight") onNext?.();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, onPrevious, onNext]);

  const canNavigate = !!onPrevious && !!onNext && totalItems && totalItems > 1;
  const canSelectItems = !!items?.length && !!onSelectItem && items.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6">
      <button
        onClick={onClose}
        className="absolute right-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4 sm:top-4"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {canNavigate && (
        <>
          <button
            type="button"
            onClick={onPrevious}
            className="absolute left-3 top-1/2 z-50 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-4"
            aria-label="Previous media"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNext}
            className="absolute right-3 top-1/2 z-50 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4"
            aria-label="Next media"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      <div
        className={`flex h-full max-h-[calc(100dvh-2rem)] w-full max-w-[90rem] flex-col items-center justify-center gap-3 overflow-hidden ${
          canSelectItems ? "pb-24 sm:pb-28" : ""
        }`}
      >
        {canNavigate && currentIndex !== undefined && totalItems && (
          <div className="rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white/80">
            {currentIndex + 1} / {totalItems}
          </div>
        )}

        {type === "photo" && (
          <img
            src={inlineUrl}
            alt={caption || fileName}
            className={`max-w-full rounded-lg object-contain shadow-2xl ${
              canSelectItems ? "max-h-[58dvh]" : "max-h-[78dvh]"
            }`}
          />
        )}

        {type === "video" && (
          <div className="flex w-full flex-col items-center gap-4">
            <video
              src={inlineUrl}
              controls
              autoPlay
              muted
            playsInline
            preload="metadata"
              className={`w-full max-w-5xl rounded-lg shadow-2xl ${
                canSelectItems ? "max-h-[54dvh]" : "max-h-[72dvh]"
              }`}
            />
            <a
              href={downloadUrl}
              download={fileName || `video_${messageId}.mp4`}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Download Video
            </a>
          </div>
        )}

        {type === "file" && (
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-zinc-900 p-6 sm:p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <p className="max-w-full truncate text-sm font-medium text-white">
              {fileName}
            </p>
            <a
              href={downloadUrl}
              download={fileName}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Download File
            </a>
          </div>
        )}

        {caption && (
          <p className="max-w-full text-center text-sm text-white/70 sm:max-w-lg">
            {caption}
          </p>
        )}

      </div>

      {canSelectItems && (
        <div className="absolute bottom-3 left-4 right-4 z-50 mx-auto max-w-4xl overflow-x-auto rounded-xl bg-black/35 px-2 py-2 backdrop-blur-sm sm:bottom-4">
          <div className="flex justify-center gap-2">
            {items.map((item, index) => {
              const active = item.id === messageId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectItem(item)}
                  className={`relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border transition-all sm:h-16 sm:w-16 ${
                    active
                      ? "border-blue-400 ring-2 ring-blue-400/70"
                      : "border-white/15 opacity-70 hover:border-white/50 hover:opacity-100"
                  }`}
                  aria-label={`Open album item ${index + 1}`}
                >
                  {item.type === "file" ? (
                    <div className="flex h-full w-full items-center justify-center bg-zinc-900">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
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
                      className="h-full w-full"
                    />
                  )}
                  {item.type === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                          <polygon points="7 4 19 12 7 20" />
                        </svg>
                      </span>
                    </span>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[10px] font-medium text-white">
                    {index + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
