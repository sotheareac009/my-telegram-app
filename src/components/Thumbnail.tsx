"use client";

import { useEffect, useState } from "react";

interface ThumbnailProps {
  session: string;
  groupId: string;
  messageId: number;
  alt?: string;
  className?: string;
  fallbackSrc?: string;
}

export default function Thumbnail({
  session,
  groupId,
  messageId,
  alt = "",
  className = "",
  fallbackSrc = "",
}: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      try {
        const res = await fetch("/api/telegram/thumb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionString: session,
            groupId,
            messageId,
          }),
        });
        if (!res.ok) {
          if (!cancelled) {
            setStatus(fallbackSrc ? "ready" : "error");
          }
          return;
        }
        const blob = await res.blob();
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setStatus(fallbackSrc ? "ready" : "error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fallbackSrc, session, groupId, messageId]);

  const imageSrc = url || fallbackSrc;

  if (!imageSrc) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800 ${className}`}
      >
        {status === "loading" && (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-600" />
        )}
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={`object-cover ${className}`}
    />
  );
}
