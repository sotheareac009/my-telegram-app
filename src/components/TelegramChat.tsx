"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ChatMedia {
    kind: "photo" | "video" | "sticker" | "gif" | "voice" | "audio" | "file";
    /** Inline low-res preview (base64 JPEG data URL). */
    thumb?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    width?: number;
    height?: number;
}

interface Message {
    id: string;
    text: string;
    timestamp: Date;
    fromMe: boolean;
    status?: "sent" | "delivered" | "read";
    media?: ChatMedia;
    /** Shared id for messages sent together as one album. */
    groupedId?: string;
}

/** A single openable item inside the full-screen media viewer. */
interface ViewerItem {
    messageId: string;
    kind: ChatMedia["kind"];
    thumb?: string;
}

interface Contact {
    id: string;
    /** Per-user security token — needed to stream this chat's media. */
    accessHash?: string;
    firstName: string;
    lastName?: string;
    username?: string;
    photo?: string | null;
    lastSeen?: string;
    isOnline?: boolean;
}

interface TelegramChatProps {
    contact: Contact;
    messages: Message[];
    onSendMessage: (text: string) => void;
    onBack?: () => void;
    isLoading?: boolean;
    /** Pull older history when the user scrolls near the top. */
    onLoadOlder?: () => void;
    /** Whether more older messages may exist. */
    hasMoreOlder?: boolean;
    /** True while an older-history batch is being fetched. */
    loadingOlder?: boolean;
    /** Telegram session — required to build media stream URLs. */
    sessionString?: string;
}

/** Build a chat-media stream URL for a message attachment. */
function buildMediaUrl(
    sessionString: string,
    contact: Contact,
    messageId: string,
    opts?: { download?: boolean; thumb?: boolean },
): string {
    const params = new URLSearchParams({
        sessionString,
        userId: contact.id,
        messageId: String(messageId),
    });
    if (contact.accessHash) params.set("accessHash", contact.accessHash);
    if (opts?.download) params.set("download", "1");
    if (opts?.thumb) params.set("thumb", "1");
    return `/api/telegram/chat-media?${params.toString()}`;
}

/** Signature of the per-message URL builder threaded through the bubbles. */
type MediaUrlFn = (
    messageId: string,
    opts?: { download?: boolean; thumb?: boolean },
) => string;

function formatFileSize(bytes?: number): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(seconds?: number): string {
    if (!seconds || seconds < 0) return "";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compute the on-screen box for a photo/video, preserving its real aspect
 * ratio — the way Telegram sizes chat media. Large media shrinks to fit a
 * max box; tiny media scales up so it isn't a postage stamp (the stripped
 * thumbnail's own pixel size must never drive the layout).
 */
function mediaBox(
    w?: number,
    h?: number,
): { width: number; height: number } {
    const MAX_W = 320;
    const MAX_H = 420;
    const MIN_W = 180;
    if (!w || !h || w <= 0 || h <= 0) {
        return { width: 260, height: 180 };
    }
    let dw = w;
    let dh = h;
    // Shrink to fit within the max box.
    const shrink = Math.min(MAX_W / dw, MAX_H / dh, 1);
    dw *= shrink;
    dh *= shrink;
    // Scale tiny media up to a sensible minimum width, then re-clamp height.
    if (dw < MIN_W) {
        const grow = MIN_W / dw;
        dw *= grow;
        dh *= grow;
        if (dh > MAX_H) {
            const s = MAX_H / dh;
            dw *= s;
            dh *= s;
        }
    }
    return { width: Math.round(dw), height: Math.round(dh) };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const gradients = [
    "from-[#FF6B6B] to-[#FF8E53]",
    "from-[#4FACFE] to-[#00F2FE]",
    "from-[#43E97B] to-[#38F9D7]",
    "from-[#FA709A] to-[#FEE140]",
    "from-[#A18CD1] to-[#FBC2EB]",
    "from-[#FD746C] to-[#FF9068]",
    "from-[#4481EB] to-[#04BEFE]",
];

function getGradient(id: string) {
    const idx = id?.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return gradients[idx % gradients.length];
}

function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(date: Date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function groupMessagesByDate(messages: Message[]) {
    const groups: { label: string; messages: Message[] }[] = [];
    let lastLabel = "";
    for (const msg of messages) {
        const label = formatDateLabel(msg.timestamp);
        if (label !== lastLabel) {
            groups.push({ label, messages: [msg] });
            lastLabel = label;
        } else {
            groups[groups.length - 1].messages.push(msg);
        }
    }
    return groups;
}

/**
 * Collapse runs of consecutive messages that share a `groupedId` into albums.
 * Returns a list where each entry is either a lone Message or a Message[]
 * (album) — mirroring how Telegram renders grouped media as one tiled block.
 */
function groupAlbums(messages: Message[]): (Message | Message[])[] {
    const out: (Message | Message[])[] = [];
    let i = 0;
    while (i < messages.length) {
        const m = messages[i];
        if (m.groupedId) {
            const run: Message[] = [m];
            let j = i + 1;
            while (j < messages.length && messages[j].groupedId === m.groupedId) {
                run.push(messages[j]);
                j++;
            }
            out.push(run.length > 1 ? run : run[0]);
            i = j;
        } else {
            out.push(m);
            i++;
        }
    }
    return out;
}

/** Visual media kinds that open in the full-screen viewer. */
function isViewable(kind?: ChatMedia["kind"]): boolean {
    return kind === "photo" || kind === "video" || kind === "gif";
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function Avatar({
    contact,
    size = "md",
}: {
    contact: Contact;
    size?: "sm" | "md" | "lg";
}) {
    const [imgError, setImgError] = useState(false);
    const gradient = getGradient(contact.id);
    const name = `${contact.firstName} ${contact.lastName || ""}`.trim();
    const sizeClass = size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-12 h-12 text-lg" : "w-10 h-10 text-sm";

    return (
        <div className="relative shrink-0">
            <div
                className={`${sizeClass} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold overflow-hidden`}
            >
                {contact.photo && !imgError ? (
                    <img
                        src={contact.photo}
                        alt={name}
                        className="w-full h-full object-cover"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    name.charAt(0).toUpperCase()
                )}
            </div>
            {contact.isOnline && (
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#4dcd5e] rounded-full border-2 border-white" />
            )}
        </div>
    );
}

// ── Tick (read receipt) ────────────────────────────────────────────────────────
function Ticks({ status }: { status?: Message["status"] }) {
    if (!status) return null;
    const color = status === "read" ? "#4dcd5e" : "#aab8c2";
    if (status === "sent") {
        return (
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="inline-block ml-1">
                <path d="M1 5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    return (
        <svg width="18" height="10" viewBox="0 0 18 10" fill="none" className="inline-block ml-1">
            <path d="M1 5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ── Media image (full image with stripped-thumb fallback) ──────────────────────
function MediaImage({
    src,
    thumb,
    alt,
    className,
    style,
}: {
    src: string;
    thumb?: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
}) {
    const [errored, setErrored] = useState(false);
    const [loaded, setLoaded] = useState(false);
    // If the full media fails (e.g. animated .tgs sticker the browser can't
    // decode), fall back to the inline thumbnail so something still shows.
    const finalSrc = errored && thumb ? thumb : src;
    return (
        <img
            src={finalSrc}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => !errored && setErrored(true)}
            className={className}
            style={{
                // Blurred thumb underneath until the real image paints.
                backgroundImage: thumb && !loaded ? `url(${thumb})` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
                ...style,
            }}
        />
    );
}

// ── Play badge (video overlay) ─────────────────────────────────────────────────
function PlayBadge() {
    return (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                    <polygon points="7 4 19 12 7 20" />
                </svg>
            </span>
        </span>
    );
}

// ── Media content (single attachment inside a bubble) ──────────────────────────
function MediaContent({
    media,
    url,
    downloadUrl,
    thumbUrl,
    onOpen,
}: {
    media: ChatMedia;
    url: string;
    downloadUrl: string;
    /** Sharp poster-thumbnail URL — used for the video/gif preview. */
    thumbUrl: string;
    /** Open the full-screen viewer (photo / video / gif only). */
    onOpen?: () => void;
}) {
    if (media.kind === "photo") {
        const box = mediaBox(media.width, media.height);
        return (
            <button type="button" onClick={onOpen} className="block cursor-pointer">
                <MediaImage
                    src={url}
                    thumb={media.thumb}
                    alt="Photo"
                    className="block rounded-lg object-cover"
                    style={{ width: box.width, height: box.height }}
                />
            </button>
        );
    }

    if (media.kind === "sticker") {
        return (
            <MediaImage
                src={url}
                thumb={media.thumb}
                alt="Sticker"
                className="block h-32 w-32 object-contain"
            />
        );
    }

    // Video & GIF — show the poster with a play badge; clicking opens the
    // viewer where it streams/plays (Telegram-web behaviour). The box keeps
    // the video's real aspect ratio so it isn't squished or microscopic.
    if (media.kind === "video" || media.kind === "gif") {
        const box = mediaBox(media.width, media.height);
        return (
            <button
                type="button"
                onClick={onOpen}
                className="relative block cursor-pointer overflow-hidden rounded-lg bg-zinc-800"
                style={{ width: box.width, height: box.height }}
            >
                {/* Sharp poster (real thumbnail) with the stripped blur as a
                    placeholder until it loads. */}
                <MediaImage
                    src={thumbUrl}
                    thumb={media.thumb}
                    alt={media.kind}
                    className="h-full w-full object-cover"
                />
                <PlayBadge />
            </button>
        );
    }

    if (media.kind === "voice" || media.kind === "audio") {
        return (
            <div className="flex flex-col gap-1 py-1">
                <audio src={url} controls className="h-9 max-w-[240px]" />
                {media.kind === "audio" && media.fileName && (
                    <span className="max-w-[240px] truncate text-[11px] text-[#8a9aaa]">
                        {media.fileName}
                    </span>
                )}
            </div>
        );
    }

    // file / document
    return (
        <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 py-1"
        >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3390ec] text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
            <span className="min-w-0">
                <span className="block max-w-[180px] truncate text-[13px] font-medium text-[#111]">
                    {media.fileName || "File"}
                </span>
                <span className="block text-[11px] text-[#8a9aaa]">
                    {formatFileSize(media.fileSize) || "Download"}
                </span>
            </span>
        </a>
    );
}

// ── Album bubble (grouped media → tiled grid) ──────────────────────────────────
function AlbumBubble({
    messages,
    mediaUrl,
    onOpenViewer,
}: {
    messages: Message[];
    mediaUrl: MediaUrlFn;
    onOpenViewer: (items: ViewerItem[], index: number) => void;
}) {
    const fromMe = messages[0].fromMe;
    const last = messages[messages.length - 1];
    const caption = messages.find((m) => m.text)?.text || "";
    const cells = messages.filter((m) => m.media);
    const viewerItems: ViewerItem[] = cells
        .filter((m) => isViewable(m.media?.kind))
        .map((m) => ({
            messageId: m.id,
            kind: m.media!.kind,
            thumb: m.media?.thumb,
        }));

    const n = cells.length;
    const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;

    return (
        <div className={`flex ${fromMe ? "justify-end" : "justify-start"} mb-1`}>
            <div
                className={`relative max-w-[280px] overflow-hidden rounded-2xl p-1 text-sm shadow-sm ${
                    fromMe
                        ? "bg-[#effdde] rounded-br-sm"
                        : "bg-white rounded-bl-sm"
                }`}
            >
                <div
                    className="grid gap-0.5 overflow-hidden rounded-lg"
                    style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                >
                    {cells.map((m) => {
                        const media = m.media!;
                        const viewerIdx = viewerItems.findIndex(
                            (v) => v.messageId === m.id,
                        );
                        const isVideo =
                            media.kind === "video" || media.kind === "gif";
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() =>
                                    viewerIdx >= 0 &&
                                    onOpenViewer(viewerItems, viewerIdx)
                                }
                                className="relative aspect-square cursor-pointer overflow-hidden bg-zinc-200"
                            >
                                {/* Photos load full-res; videos use the sharp
                                    poster thumbnail. Both blur-up from the
                                    inline stripped thumb. */}
                                <MediaImage
                                    src={
                                        media.kind === "photo"
                                            ? mediaUrl(m.id)
                                            : mediaUrl(m.id, { thumb: true })
                                    }
                                    thumb={media.thumb}
                                    alt={media.kind}
                                    className="h-full w-full object-cover"
                                />
                                {isVideo && <PlayBadge />}
                            </button>
                        );
                    })}
                </div>
                {caption && (
                    <span className="mt-1 block px-2 pb-0.5" style={{ wordBreak: "break-word" }}>
                        {caption}
                    </span>
                )}
                <span className="block px-2 pb-1 text-right text-[10px] leading-none text-[#aab8c2] select-none">
                    {formatTime(last.timestamp)}
                    {fromMe && <Ticks status={last.status} />}
                </span>
            </div>
        </div>
    );
}

// ── Bubble ─────────────────────────────────────────────────────────────────────
function Bubble({
    msg,
    mediaUrl,
    onOpenViewer,
}: {
    msg: Message;
    mediaUrl: MediaUrlFn;
    onOpenViewer: (items: ViewerItem[], index: number) => void;
}) {
    const media = msg.media;
    const metaRow = (
        <span className="ml-2 whitespace-nowrap text-[10px] leading-none text-[#aab8c2] select-none">
            {media?.kind === "video" || media?.kind === "voice" || media?.kind === "audio"
                ? formatDuration(media.duration) + " · "
                : ""}
            {formatTime(msg.timestamp)}
            {msg.fromMe && <Ticks status={msg.status} />}
        </span>
    );

    const openSelf = () => {
        if (media && isViewable(media.kind)) {
            onOpenViewer(
                [{ messageId: msg.id, kind: media.kind, thumb: media.thumb }],
                0,
            );
        }
    };

    // Stickers render bare — no chat bubble — the Telegram-native way.
    if (media?.kind === "sticker") {
        return (
            <div className={`flex ${msg.fromMe ? "justify-end" : "justify-start"} mb-1`}>
                <div className="relative">
                    <MediaContent
                        media={media}
                        url={mediaUrl(msg.id)}
                        downloadUrl={mediaUrl(msg.id, { download: true })}
                        thumbUrl={mediaUrl(msg.id, { thumb: true })}
                    />
                    <span className="absolute bottom-0 right-0 rounded-full bg-black/35 px-1.5 py-0.5 text-[10px] leading-none text-white select-none">
                        {formatTime(msg.timestamp)}
                        {msg.fromMe && <Ticks status={msg.status} />}
                    </span>
                </div>
            </div>
        );
    }

    const isVisualMedia =
        media?.kind === "photo" || media?.kind === "video" || media?.kind === "gif";

    return (
        <div className={`flex ${msg.fromMe ? "justify-end" : "justify-start"} mb-1`}>
            <div
                className={`
                    relative max-w-[75%] rounded-2xl text-sm leading-relaxed
                    ${isVisualMedia ? "overflow-hidden p-1" : "px-3 py-2"}
                    ${msg.fromMe
                        ? "bg-[#effdde] text-[#111] rounded-br-sm shadow-sm"
                        : "bg-white text-[#111] rounded-bl-sm shadow-sm"
                    }
                `}
                style={{ wordBreak: "break-word" }}
            >
                {media && (
                    <div className={isVisualMedia ? "relative" : ""}>
                        <MediaContent
                            media={media}
                            url={mediaUrl(msg.id)}
                            downloadUrl={mediaUrl(msg.id, { download: true })}
                            thumbUrl={mediaUrl(msg.id, { thumb: true })}
                            onOpen={openSelf}
                        />
                        {/* For caption-less visual media, overlay the time. */}
                        {isVisualMedia && !msg.text && (
                            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] leading-none text-white select-none">
                                {formatTime(msg.timestamp)}
                                {msg.fromMe && <Ticks status={msg.status} />}
                            </span>
                        )}
                    </div>
                )}
                {msg.text && (
                    <span className={isVisualMedia ? "mt-1 block px-2 pb-1" : ""}>
                        {msg.text}
                    </span>
                )}
                {(!isVisualMedia || msg.text) && (
                    <span className={isVisualMedia ? "block px-2 pb-1 text-right" : "float-right mt-1 -mb-0.5"}>
                        {metaRow}
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Full-screen media viewer (lightbox) ────────────────────────────────────────
function ChatMediaViewer({
    items,
    index,
    mediaUrl,
    onClose,
    onIndex,
}: {
    items: ViewerItem[];
    index: number;
    mediaUrl: MediaUrlFn;
    onClose: () => void;
    onIndex: (next: number) => void;
}) {
    const item = items[index];
    const multiple = items.length > 1;

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowLeft" && multiple) {
                onIndex((index - 1 + items.length) % items.length);
            }
            if (e.key === "ArrowRight" && multiple) {
                onIndex((index + 1) % items.length);
            }
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [index, items.length, multiple, onClose, onIndex]);

    if (!item) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={onClose}
        >
            <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                aria-label="Close"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>

            {multiple && (
                <>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onIndex((index - 1 + items.length) % items.length);
                        }}
                        className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                        aria-label="Previous"
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onIndex((index + 1) % items.length);
                        }}
                        className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                        aria-label="Next"
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                </>
            )}

            <div
                className="flex max-h-full max-w-full flex-col items-center gap-3"
                onClick={(e) => e.stopPropagation()}
            >
                {item.kind === "photo" ? (
                    <img
                        src={mediaUrl(item.messageId)}
                        alt="Photo"
                        className="max-h-[82vh] max-w-full rounded-lg object-contain"
                        style={{
                            backgroundImage: item.thumb ? `url(${item.thumb})` : undefined,
                            backgroundSize: "contain",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "center",
                        }}
                    />
                ) : (
                    <video
                        src={mediaUrl(item.messageId)}
                        poster={mediaUrl(item.messageId, { thumb: true })}
                        controls
                        autoPlay
                        loop={item.kind === "gif"}
                        playsInline
                        className="max-h-[82vh] max-w-full rounded-lg"
                    />
                )}
                {multiple && (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                        {index + 1} / {items.length}
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Date Divider ───────────────────────────────────────────────────────────────
function DateDivider({ label }: { label: string }) {
    return (
        <div className="flex justify-center my-3">
            <span className="bg-[#ffffffcc] text-[#8a9aaa] text-[11px] px-3 py-1 rounded-full select-none backdrop-blur-sm shadow-sm">
                {label}
            </span>
        </div>
    );
}

// ── Typing Indicator ───────────────────────────────────────────────────────────
function TypingIndicator() {
    return (
        <div className="flex justify-start mb-2">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center shadow-sm">
                {[0, 1, 2].map((i) => (
                    <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-[#aab8c2] animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                    />
                ))}
            </div>
        </div>
    );
}

// ── Main Chat Component ────────────────────────────────────────────────────────
export default function TelegramChat({
    contact,
    messages,
    onSendMessage,
    onBack,
    isLoading = false,
    onLoadOlder,
    hasMoreOlder = false,
    loadingOlder = false,
    sessionString = "",
}: TelegramChatProps) {
    const mediaUrl: MediaUrlFn = (messageId, opts) =>
        buildMediaUrl(sessionString, contact, messageId, opts);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    // Full-screen media viewer state — null when closed.
    const [viewer, setViewer] = useState<{
        items: ViewerItem[];
        index: number;
    } | null>(null);
    const openViewer = (items: ViewerItem[], index: number) =>
        setViewer({ items, index });
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const grouped = groupMessagesByDate(messages);

    // Scroll behaviour:
    //  - atBottomRef: is the user parked near the bottom of the history?
    //  - didInitialScrollRef: has the one-time jump-to-bottom run for this
    //    chat? Re-armed when the contact changes.
    //  - forceScrollRef: set when the user sends, so their own message is
    //    always revealed even if they were scrolled up reading history.
    const atBottomRef = useRef(true);
    const didInitialScrollRef = useRef(false);
    const forceScrollRef = useRef(false);
    // While an older-history batch is loading, holds the scrollHeight captured
    // *before* the prepend, so the viewport can be re-anchored afterwards.
    const prependAnchorRef = useRef<number | null>(null);

    function handleScroll() {
        const el = scrollRef.current;
        if (!el) return;
        const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
        atBottomRef.current = distanceFromBottom < 120;
        // Near the top — pull older history (infinite scroll up). The anchor
        // ref doubles as an in-flight guard so it fires once per batch.
        if (
            el.scrollTop < 80 &&
            hasMoreOlder &&
            !loadingOlder &&
            prependAnchorRef.current === null &&
            onLoadOlder
        ) {
            prependAnchorRef.current = el.scrollHeight;
            onLoadOlder();
        }
    }

    // Before paint: if older messages were just prepended, shift scrollTop by
    // the height they added so the user stays on the same message.
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el || prependAnchorRef.current === null) return;
        el.scrollTop += el.scrollHeight - prependAnchorRef.current;
        prependAnchorRef.current = null;
    }, [messages]);

    // Clear the anchor if a load-older finished without new messages (start
    // of history reached) — otherwise the in-flight guard would stay stuck.
    useEffect(() => {
        if (!loadingOlder) prependAnchorRef.current = null;
    }, [loadingOlder]);

    // New chat selected — re-arm the one-time jump-to-bottom.
    useEffect(() => {
        didInitialScrollRef.current = false;
        atBottomRef.current = true;
    }, [contact.id]);

    // Pin to the latest message only when appropriate, so a background poll
    // doesn't yank the user away from history they're scrolled up reading.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        // First batch for this chat — jump straight to the bottom.
        if (!didInitialScrollRef.current && messages.length > 0) {
            el.scrollTop = el.scrollHeight;
            didInitialScrollRef.current = true;
            atBottomRef.current = true;
            forceScrollRef.current = false;
            return;
        }
        // Otherwise only follow if the user is at the bottom, or just sent.
        if (forceScrollRef.current || atBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            forceScrollRef.current = false;
        }
    }, [messages, isTyping]);

    // auto-resize textarea
    function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setInput(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
    }

    function handleSend() {
        const text = input.trim();
        if (!text) return;
        // Reveal the user's own message even if they were reading history.
        forceScrollRef.current = true;
        onSendMessage(text);
        setInput("");
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    const name = `${contact.firstName} ${contact.lastName || ""}`.trim();

    return (
        <div
            className="flex flex-col h-full w-full"
            style={{
                background: "#f0f2f5",
                fontFamily: "'Roboto', sans-serif",
            }}
        >
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shadow-sm shrink-0">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="text-[#8a9aaa] hover:text-[#3390ec] transition-colors p-1 -ml-1 rounded-full hover:bg-[#3390ec]/10"
                        aria-label="Back"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                )}

                <Avatar contact={contact} size="md" />

                <div className="flex-1 min-w-0">
                    <p className="text-[#111] font-medium text-[15px] truncate leading-tight">{name}</p>
                    <p className="text-[#8a9aaa] text-[12px] truncate leading-tight">
                        {contact.isOnline ? (
                            <span className="text-[#4dcd5e]">online</span>
                        ) : (
                            contact.lastSeen || "last seen recently"
                        )}
                    </p>
                </div>

                {/* header actions */}
                <div className="flex gap-1 text-[#8a9aaa]">
                    <button className="p-2 hover:text-[#3390ec] hover:bg-[#3390ec]/10 rounded-full transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                    <button className="p-2 hover:text-[#3390ec] hover:bg-[#3390ec]/10 rounded-full transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* ── Messages ── */}
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-4 py-2"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%234a90d9' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            >
                {isLoading ? (
                    <div className="flex justify-center items-center h-full">
                        <div className="w-8 h-8 border-2 border-[#3390ec] border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col justify-center items-center h-full gap-3 select-none">
                        <div className="w-16 h-16 rounded-full bg-white shadow flex items-center justify-center">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="#aab8c2" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </div>
                        <p className="text-[#aab8c2] text-sm">No messages yet. Say hello!</p>
                    </div>
                ) : (
                    <>
                        {loadingOlder && (
                            <div className="flex justify-center py-2">
                                <div className="w-5 h-5 border-2 border-[#3390ec] border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                        {grouped.map((group) => (
                            <div key={group.label}>
                                <DateDivider label={group.label} />
                                {groupAlbums(group.messages).map((unit) =>
                                    Array.isArray(unit) ? (
                                        <AlbumBubble
                                            key={unit[0].id}
                                            messages={unit}
                                            mediaUrl={mediaUrl}
                                            onOpenViewer={openViewer}
                                        />
                                    ) : (
                                        <Bubble
                                            key={unit.id}
                                            msg={unit}
                                            mediaUrl={mediaUrl}
                                            onOpenViewer={openViewer}
                                        />
                                    ),
                                )}
                            </div>
                        ))}
                        {isTyping && <TypingIndicator />}
                    </>
                )}
                <div ref={bottomRef} />
            </div>

            {/* ── Full-screen media viewer ── */}
            {viewer && (
                <ChatMediaViewer
                    items={viewer.items}
                    index={viewer.index}
                    mediaUrl={mediaUrl}
                    onClose={() => setViewer(null)}
                    onIndex={(next) =>
                        setViewer((v) => (v ? { ...v, index: next } : v))
                    }
                />
            )}

            {/* ── Input Bar ── */}
            <div className="shrink-0 px-3 py-2 bg-white border-t border-gray-200 flex items-end gap-2">
                {/* emoji button */}
                <button className="text-[#8a9aaa] hover:text-[#3390ec] transition-colors p-2 rounded-full hover:bg-[#3390ec]/10 shrink-0 mb-0.5">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M8.5 14.5s1 1.5 3.5 1.5 3.5-1.5 3.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="9" cy="10" r="1" fill="currentColor" />
                        <circle cx="15" cy="10" r="1" fill="currentColor" />
                    </svg>
                </button>

                {/* textarea */}
                <div className="flex-1 bg-[#f0f2f5] rounded-2xl px-3 py-2 flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder="Message"
                        className="flex-1 bg-transparent text-[#111] placeholder-[#aab8c2] text-sm resize-none outline-none leading-relaxed max-h-[120px] overflow-y-auto"
                        style={{ scrollbarWidth: "none" }}
                    />
                    {/* attach button */}
                    <button className="text-[#8a9aaa] hover:text-[#3390ec] transition-colors shrink-0 mb-0.5">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>

                {/* send / mic button */}
                <button
                    onClick={handleSend}
                    className={`
                        w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 mb-0.5
                        ${input.trim()
                            ? "bg-[#3390ec] text-white shadow-lg shadow-[#3390ec]/30 scale-100 hover:scale-105"
                            : "bg-[#f0f2f5] text-[#8a9aaa]"
                        }
                    `}
                    aria-label="Send"
                >
                    {input.trim() ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
}