"use client";

import { useEffect, useMemo } from "react";

interface MediaViewerProps {
  session: string;
  groupId: string;
  messageId: number;
  type: "photo" | "video" | "file";
  fileName: string;
  caption: string;
  onClose: () => void;
}

export default function MediaViewer({
  session,
  groupId,
  messageId,
  type,
  fileName,
  caption,
  onClose,
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
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

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

      <div className="flex max-h-[90dvh] w-full max-w-[90rem] flex-col items-center gap-4 overflow-hidden">
        {type === "photo" && (
          <img
            src={inlineUrl}
            alt={caption || fileName}
            className="max-h-[78dvh] max-w-full rounded-lg object-contain shadow-2xl"
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
              className="max-h-[72dvh] w-full max-w-5xl rounded-lg shadow-2xl"
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
    </div>
  );
}
