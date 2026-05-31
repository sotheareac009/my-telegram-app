"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TgsSticker from "./TgsSticker";

export interface PickerSticker {
  id: string;
  accessHash: string;
  fileReference: string;
  mimeType: string;
  width?: number;
  height?: number;
  thumb?: string;
}

interface StickerSetMeta {
  id: string;
  accessHash: string;
  title: string;
  count: number;
  thumb?: string;
}

interface PickerData {
  recent: PickerSticker[];
  faved: PickerSticker[];
  sets: StickerSetMeta[];
  /** Lazy-loaded per-set stickers, keyed by set id. */
  setStickers: Record<string, PickerSticker[]>;
}

// Module-level cache: re-opening the picker reuses what we already fetched
// instead of starting over. Survives until the page (or WebView) reloads.
const dataCache = new Map<string, PickerData>();
const inflightSetLoads = new Map<string, Promise<void>>();

interface Section {
  key: string;
  title: string;
  iconThumb?: string;
  iconText?: string;
  setMeta?: StickerSetMeta;
  /** Already loaded stickers, or null while the set is being fetched. */
  stickers: PickerSticker[] | null;
}

/** Build the URL for the full sticker bytes. */
function stickerFileUrl(s: PickerSticker, sessionString: string): string {
  const params = new URLSearchParams({
    sessionString,
    id: s.id,
    accessHash: s.accessHash,
    fileReference: s.fileReference,
    mimeType: s.mimeType,
  });
  return `/api/telegram/sticker-file?${params.toString()}`;
}

/** One sticker tile — lazily fetches the real file once it scrolls near. */
function StickerTile({
  sticker,
  sessionString,
  onClick,
}: {
  sticker: PickerSticker;
  sessionString: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  const fileUrl = visible ? stickerFileUrl(sticker, sessionString) : "";

  let content: React.ReactNode;
  if (!visible) {
    content = sticker.thumb ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sticker.thumb}
        alt=""
        className="h-full w-full object-contain"
      />
    ) : (
      <div className="h-full w-full rounded bg-zinc-200 dark:bg-zinc-700" />
    );
  } else if (sticker.mimeType === "video/webm") {
    content = (
      <video
        src={fileUrl}
        poster={sticker.thumb}
        muted
        loop
        autoPlay
        playsInline
        className="h-full w-full object-contain"
      />
    );
  } else if (sticker.mimeType === "application/x-tgsticker") {
    content = (
      <TgsSticker
        src={fileUrl}
        thumb={sticker.thumb}
        className="h-full w-full"
      />
    );
  } else {
    content = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fileUrl}
        alt=""
        className="h-full w-full object-contain"
        style={{
          backgroundImage: sticker.thumb ? `url(${sticker.thumb})` : undefined,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }}
      />
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="flex aspect-square items-center justify-center rounded p-1 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title="Send sticker"
    >
      {content}
    </button>
  );
}

/**
 * Composer sticker picker — fast version. Renders the cached metadata
 * (recent / faved / installed pack list) immediately, then lazy-loads
 * each pack's stickers when the user scrolls to or taps its tab. Data is
 * cached at the module level so re-opening the picker is instant after
 * the first fetch.
 */
export default function StickerPicker({
  sessionString,
  onSelect,
  onClose,
}: {
  sessionString: string;
  onSelect: (sticker: PickerSticker) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<PickerData | null>(
    () => dataCache.get(sessionString) ?? null,
  );
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // ── Initial metadata load (skipped if cached) ──────────────────────────
  useEffect(() => {
    if (data) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/telegram/stickers/recent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || body.error) {
          setError(body.error || "Failed to load stickers");
          return;
        }
        const fresh: PickerData = {
          recent: Array.isArray(body.recent) ? body.recent : [],
          faved: Array.isArray(body.faved) ? body.faved : [],
          sets: Array.isArray(body.sets) ? body.sets : [],
          setStickers: {},
        };
        dataCache.set(sessionString, fresh);
        setData(fresh);
      } catch {
        if (!cancelled) setError("Failed to load stickers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionString, data]);

  // ── On-demand load for a single set ────────────────────────────────────
  const loadSet = useCallback(
    async (setMeta: StickerSetMeta) => {
      const cached = dataCache.get(sessionString);
      if (!cached) return;
      if (cached.setStickers[setMeta.id]) return; // already loaded
      const key = `${sessionString}::${setMeta.id}`;
      // De-dupe parallel callers (visibility observer + tab click can fire together).
      if (inflightSetLoads.has(key)) {
        await inflightSetLoads.get(key);
        return;
      }
      const p = (async () => {
        try {
          const res = await fetch("/api/telegram/stickers/set", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionString,
              setId: setMeta.id,
              accessHash: setMeta.accessHash,
            }),
          });
          const body = await res.json();
          if (!res.ok || body.error) return;
          const stickers: PickerSticker[] = Array.isArray(body.stickers)
            ? body.stickers
            : [];
          cached.setStickers[setMeta.id] = stickers;
          forceRender((n) => n + 1);
        } catch {
          // best-effort — silently leave the section empty so the user can retry
        } finally {
          inflightSetLoads.delete(key);
        }
      })();
      inflightSetLoads.set(key, p);
      await p;
    },
    [sessionString],
  );

  // ── Close on outside click / Esc ───────────────────────────────────────
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // ── Compose section list from current data ─────────────────────────────
  const sections: Section[] = useMemo(() => {
    if (!data) return [];
    const out: Section[] = [];
    if (data.recent.length > 0) {
      out.push({
        key: "recent",
        title: "Recent",
        iconText: "🕒",
        stickers: data.recent,
      });
    }
    if (data.faved.length > 0) {
      out.push({
        key: "faved",
        title: "Favorites",
        iconText: "⭐",
        stickers: data.faved,
      });
    }
    for (const set of data.sets) {
      out.push({
        key: `set-${set.id}`,
        title: set.title,
        iconThumb: set.thumb,
        setMeta: set,
        stickers: data.setStickers[set.id] ?? null,
      });
    }
    return out;
  }, [data]);

  // Default active tab once data lands.
  useEffect(() => {
    if (!activeSection && sections.length > 0) {
      setActiveSection(sections[0].key);
    }
  }, [sections, activeSection]);

  // ── Track which section is currently in view + auto-load it ────────────
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || sections.length === 0) return;
    function onScroll() {
      const top = scrollEl!.scrollTop + 60;
      let current = sections[0]?.key ?? null;
      for (const s of sections) {
        const el = sectionRefs.current.get(s.key);
        if (el && el.offsetTop <= top) current = s.key;
      }
      setActiveSection(current);
      // If the section in view is a set we haven't loaded yet, fetch it.
      const sec = sections.find((s) => s.key === current);
      if (sec?.setMeta && sec.stickers === null) {
        void loadSet(sec.setMeta);
      }
    }
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    // Prime the first section's load if needed.
    onScroll();
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [sections, loadSet]);

  function jumpToSection(key: string) {
    const sec = sections.find((s) => s.key === key);
    if (sec?.setMeta && sec.stickers === null) {
      void loadSet(sec.setMeta);
    }
    const el = sectionRefs.current.get(key);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop, behavior: "smooth" });
    }
  }

  const tabs = sections.map((s) => ({
    key: s.key,
    title: s.title,
    iconThumb: s.iconThumb,
    iconText: s.iconText,
  }));

  return (
    <div
      ref={rootRef}
      style={{ width: "min(340px, calc(100vw - 1rem))" }}
      className="absolute bottom-full left-0 z-20 mb-2 flex max-h-96 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {tabs.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
          {tabs.map((t) => {
            const active = activeSection === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => jumpToSection(t.key)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base transition-colors ${
                  active
                    ? "bg-[#3390ec]/15"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                title={t.title}
                aria-label={t.title}
                aria-pressed={active}
              >
                {t.iconText ? (
                  <span>{t.iconText}</span>
                ) : t.iconThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.iconThumb}
                    alt=""
                    className="h-6 w-6 object-contain"
                  />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
                    {t.title.charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-5 gap-1.5 p-2">
            {Array.from({ length: 15 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-red-500">{error}</div>
        ) : sections.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400">
            No stickers — install a pack in Telegram to use one here.
          </div>
        ) : (
          sections.map((section) => (
            <div
              key={section.key}
              ref={(el) => {
                sectionRefs.current.set(section.key, el);
              }}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
            >
              <div className="bg-white/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur dark:bg-zinc-900/95">
                {section.title}
              </div>
              {section.stickers === null ? (
                <div className="grid grid-cols-5 gap-1.5 p-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square animate-pulse rounded bg-zinc-100 dark:bg-zinc-800"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-1.5 p-2">
                  {section.stickers.map((s) => (
                    <StickerTile
                      key={`${section.key}-${s.id}`}
                      sticker={s}
                      sessionString={sessionString}
                      onClick={() => onSelect(s)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
