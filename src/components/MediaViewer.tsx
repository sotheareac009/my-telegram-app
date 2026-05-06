"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    loadMedia();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  async function loadMedia() {
    try {
      const res = await fetch("/api/telegram/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session, groupId, messageId }),
      });
      if (!res.ok) {
        setError("Failed to load media");
        return;
      }
      const blob = await res.blob();
      setUrl(URL.createObjectURL(blob));
    } catch {
      setError("Failed to load media");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Content */}
      <div className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-4">
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
            className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
          />
        )}

        {url && type === "video" && (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[80vh] max-w-[85vw] rounded-lg shadow-2xl"
          />
        )}

        {url && type === "file" && (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-zinc-900 p-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white">{fileName}</p>
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
          <p className="max-w-lg text-center text-sm text-white/70">{caption}</p>
        )}
      </div>
    </div>
  );
}
