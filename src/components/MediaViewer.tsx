"use client";

import { useEffect, useState } from "react";
import DownloadProgressAlert from "./DownloadProgressAlert";
import { downloadTelegramMedia } from "@/lib/downloadTelegramMedia";

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
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadState, setDownloadState] = useState<{
    name: string;
    progress: number | null;
    error?: string;
  } | null>(null);

  async function handleDownload() {
    setDownloadState({
      name: fileName || `video_${messageId}.mp4`,
      progress: 0,
    });

    try {
      await downloadTelegramMedia({
        session,
        groupId,
        messageId,
        fileName: fileName || `video_${messageId}.mp4`,
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

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/telegram/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session, groupId, messageId }),
        });
        if (!res.ok) {
          if (!cancelled) {
            setError("Failed to load media");
            setLoading(false);
          }
          return;
        }
        const blob = await res.blob();
        if (!cancelled) {
          setUrl(URL.createObjectURL(blob));
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load media");
          setLoading(false);
        }
      }
    }

    void run();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKey);
    };
  }, [groupId, messageId, onClose, session]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4 sm:top-4"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Content */}
      <div className="flex max-h-[90dvh] w-full max-w-[90rem] flex-col items-center gap-4 overflow-hidden">
        {loading && (
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-sm text-white/60">Loading media...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-900/50 px-6 py-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {url && type === "photo" && (
          <img
            src={url}
            alt={caption || fileName}
            className="max-h-[78dvh] max-w-full rounded-lg object-contain shadow-2xl"
          />
        )}

        {url && type === "video" && (
          <div className="flex w-full flex-col items-center gap-4">
            <video
              src={url}
              controls
              autoPlay
              muted
              className="max-h-[72dvh] w-full max-w-5xl rounded-lg shadow-2xl"
            />
            <button
              type="button"
              onClick={() => {
                void handleDownload();
              }}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Download Video
            </button>
          </div>
        )}

        {url && type === "file" && (
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
              href={url}
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
