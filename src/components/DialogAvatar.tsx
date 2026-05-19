"use client";

import { useEffect, useState } from "react";

interface DialogAvatarProps {
  session: string;
  groupId: string;
  title: string;
  fallbackClassName: string;
  /** Tailwind size (h/w) classes for the avatar. Defaults to a 56px circle. */
  sizeClassName?: string;
  /** Font-size class for the fallback initial. */
  textClassName?: string;
  /** Access hash — lets a non-dialog peer (e.g. a forward origin) resolve. */
  accessHash?: string;
  /** Peer kind, paired with accessHash, so the photo endpoint builds the peer. */
  peerType?: "channel" | "user";
}

type AvatarCacheValue = string | "failed";
const avatarCache = new Map<string, AvatarCacheValue>();
const inflightAvatars = new Map<string, Promise<AvatarCacheValue>>();

function avatarKey(session: string, groupId: string) {
  return `${session}::${groupId}`;
}

function loadAvatar(
  session: string,
  groupId: string,
  accessHash?: string,
  peerType?: "channel" | "user"
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
        body: JSON.stringify({
          sessionString: session,
          groupId,
          accessHash,
          peerType,
        }),
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
  sizeClassName = "h-14 w-14",
  textClassName = "text-lg",
  accessHash,
  peerType,
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

    void loadAvatar(session, groupId, accessHash, peerType).then((result) => {
      if (cancelled) return;
      if (result === "failed") setFailed(true);
      else setUrl(result);
    });

    return () => {
      cancelled = true;
    };
  }, [groupId, session, accessHash, peerType]);

  if (url && !failed) {
    return (
      <>
        {!loaded && (
          <div
            className={`${sizeClassName} animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700`}
          />
        )}
        <img
          src={url}
          alt={title}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
          className={`${sizeClassName} rounded-full object-cover shadow-md ${
            loaded ? "block" : "hidden"
          }`}
        />
      </>
    );
  }

  return (
    <div
      className={`flex ${sizeClassName} items-center justify-center rounded-full bg-gradient-to-br ${fallbackClassName} ${textClassName} font-bold text-white shadow-md`}
    >
      {title[0]?.toUpperCase()}
    </div>
  );
}
