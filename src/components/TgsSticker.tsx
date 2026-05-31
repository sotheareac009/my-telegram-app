"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a Telegram animated sticker (`.tgs`).
 *
 * `.tgs` is gzipped Lottie JSON. The browser can't decode it as an image, so
 * we fetch the bytes, gunzip with the platform's `DecompressionStream`, parse
 * the JSON, and hand it to `lottie-web` for canvas-based playback. The
 * runtime is dynamically imported on first use so it doesn't inflate the
 * initial bundle for chats with no animated stickers.
 *
 * Falls back to the inline stripped thumbnail if anything goes wrong (older
 * browser without DecompressionStream, network error, etc.) — same behaviour
 * as the rest of MediaContent.
 */
export default function TgsSticker({
  src,
  thumb,
  className,
}: {
  src: string;
  thumb?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let anim: any = null;

    async function play() {
      try {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("DecompressionStream unsupported");
        }
        const res = await fetch(src);
        if (!res.ok || !res.body) {
          throw new Error(`tgs fetch ${res.status}`);
        }
        const decompressed = res.body.pipeThrough(
          new DecompressionStream("gzip"),
        );
        const text = await new Response(decompressed).text();
        const data = JSON.parse(text);
        if (cancelled || !containerRef.current) return;
        // Dynamic import keeps lottie-web out of the initial bundle.
        const lottie = (await import("lottie-web")).default;
        if (cancelled || !containerRef.current) return;
        anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: data,
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void play();

    return () => {
      cancelled = true;
      try {
        anim?.destroy();
      } catch {
        // ignore
      }
    };
  }, [src]);

  if (failed && thumb) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={thumb} alt="Sticker" className={className} />
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      // Reserve space immediately so the bubble doesn't jump when the
      // animation mounts. The stripped thumb shows underneath until then.
      style={{
        backgroundImage: thumb ? `url(${thumb})` : undefined,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }}
    />
  );
}
