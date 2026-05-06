"use client";

import { useEffect, useState } from "react";

interface DialogAvatarProps {
  session: string;
  groupId: string;
  title: string;
  fallbackClassName: string;
}

export default function DialogAvatar({
  session,
  groupId,
  title,
  fallbackClassName,
}: DialogAvatarProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      try {
        const res = await fetch("/api/telegram/dialog-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionString: session,
            groupId,
          }),
        });

        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }

        const blob = await res.blob();
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
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
