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

type ThumbCacheValue = string | "failed";
const thumbCache = new Map<string, ThumbCacheValue>();
const inflightThumbs = new Map<string, Promise<ThumbCacheValue>>();

function thumbKey(session: string, groupId: string, messageId: number) {
  return `${session}::${groupId}::${messageId}`;
}

function loadThumb(
  session: string,
  groupId: string,
  messageId: number
): Promise<ThumbCacheValue> {
  const key = thumbKey(session, groupId, messageId);
  const cached = thumbCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const inflight = inflightThumbs.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<ThumbCacheValue> => {
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
        thumbCache.set(key, "failed");
        return "failed";
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      thumbCache.set(key, url);
      return url;
    } catch {
      thumbCache.set(key, "failed");
      return "failed";
    } finally {
      inflightThumbs.delete(key);
    }
  })();

  inflightThumbs.set(key, promise);
  return promise;
}

export default function Thumbnail({
  session,
  groupId,
  messageId,
  alt = "",
  className = "",
  fallbackSrc = "",
}: ThumbnailProps) {
  const initial = thumbCache.get(thumbKey(session, groupId, messageId));
  const [url, setUrl] = useState<string | null>(
    typeof initial === "string" ? initial : null
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() => {
    if (typeof initial === "string") return "ready";
    if (initial === "failed" && !fallbackSrc) return "error";
    return "loading";
  });
  const [imageLoaded, setImageLoaded] = useState(typeof initial === "string");

  useEffect(() => {
    let cancelled = false;
    const cached = thumbCache.get(thumbKey(session, groupId, messageId));
    if (cached !== undefined) {
      if (cached === "failed") {
        setUrl(null);
        if (!fallbackSrc) setStatus("error");
        setImageLoaded(false);
      } else {
        setUrl(cached);
        setStatus("ready");
        setImageLoaded(true);
      }
      return;
    }

    void loadThumb(session, groupId, messageId).then((result) => {
      if (cancelled) return;
      if (result === "failed") {
        if (!fallbackSrc) setStatus("error");
      } else {
        setUrl(result);
      }
    });

    return () => {
      cancelled = true;
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
