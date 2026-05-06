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
  const [imageLoaded, setImageLoaded] = useState(false);

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
            if (!fallbackSrc) {
              setStatus("error");
            }
          }
          return;
        }
        const blob = await res.blob();
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch {
        if (!cancelled) {
          if (!fallbackSrc) {
            setStatus("error");
          }
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
  const showSkeleton = status === "loading" || (!!imageSrc && !imageLoaded);

  if (!imageSrc || showSkeleton) {
    return (
      <>
        {imageSrc && (
          <img
            src={imageSrc}
            alt={alt}
            onLoad={() => {
              setImageLoaded(true);
              setStatus("ready");
            }}
            onError={() => {
              setImageLoaded(false);
              setStatus("error");
            }}
            className={`hidden object-cover ${className}`}
          />
        )}
        <div
          className={`relative overflow-hidden bg-zinc-200 dark:bg-zinc-800 ${className}`}
        >
          {status === "error" ? (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-zinc-400 dark:text-zinc-500"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
          ) : (
          <>
            <div className="absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
            <div className="absolute inset-y-0 -left-1/2 w-1/2 animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10" />
          </>
          )}
        </div>
      </>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      onError={() => setStatus("error")}
      className={`object-cover ${className}`}
    />
  );
}
