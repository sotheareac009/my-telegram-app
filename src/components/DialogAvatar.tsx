"use client";

import { useEffect, useState } from "react";

interface DialogAvatarProps {
  session: string;
  groupId: string;
  title: string;
  fallbackClassName: string;
}

type AvatarCacheValue = string | "failed";
const avatarCache = new Map<string, AvatarCacheValue>();
const inflightAvatars = new Map<string, Promise<AvatarCacheValue>>();

function avatarKey(session: string, groupId: string) {
  return `${session}::${groupId}`;
}

function loadAvatar(
  session: string,
  groupId: string
): Promise<AvatarCacheValue> {
  const key = avatarKey(session, groupId);
  const cached = avatarCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const inflight = inflightAvatars.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<AvatarCacheValue> => {
    try {
      const res = await fetch("/api/telegram/dialog-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session, groupId }),
      });
      if (!res.ok) {
        avatarCache.set(key, "failed");
        return "failed";
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      avatarCache.set(key, url);
      return url;
    } catch {
      avatarCache.set(key, "failed");
      return "failed";
    } finally {
      inflightAvatars.delete(key);
    }
  })();

  inflightAvatars.set(key, promise);
  return promise;
}

export default function DialogAvatar({
  session,
  groupId,
  title,
  fallbackClassName,
}: DialogAvatarProps) {
  const initial = avatarCache.get(avatarKey(session, groupId));
  const [url, setUrl] = useState<string | null>(
    typeof initial === "string" ? initial : null
  );
  const [failed, setFailed] = useState(initial === "failed");
  const [loaded, setLoaded] = useState(typeof initial === "string");

  useEffect(() => {
    let cancelled = false;
    const cached = avatarCache.get(avatarKey(session, groupId));
    if (cached !== undefined) {
      if (cached === "failed") {
        setFailed(true);
        setUrl(null);
        setLoaded(false);
      } else {
        setFailed(false);
        setUrl(cached);
        setLoaded(true);
      }
      return;
    }

    void loadAvatar(session, groupId).then((result) => {
      if (cancelled) return;
      if (result === "failed") setFailed(true);
      else setUrl(result);
    });

    return () => {
      cancelled = true;
    };
  }, [groupId, session]);

  if (url && !failed) {
    return (
      <>
        {!loaded && (
          <div className="h-14 w-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
        )}
        <img
          src={url}
          alt={title}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
          className={`h-14 w-14 rounded-full object-cover shadow-md ${
            loaded ? "block" : "hidden"
          }`}
        />
      </>
    );
  }

  return (
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${fallbackClassName} text-lg font-bold text-white shadow-md`}
    >
      {title[0]?.toUpperCase()}
    </div>
  );
}
