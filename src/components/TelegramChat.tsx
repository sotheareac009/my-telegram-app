"use client";

import { useCallback, useState, useRef, useEffect, useLayoutEffect } from "react";
import { useChatNav, telegramLinkTarget } from "./ChatNavContext";
import { useForwardJobs } from "./ForwardJobsContext";
import DialogAvatar from "./DialogAvatar";
import type { ForwardInfo } from "@/app/api/telegram/conversation/route";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ChatMedia {
    kind:
        | "photo"
        | "video"
        | "sticker"
        | "gif"
        | "voice"
        | "audio"
        | "file"
        | "contact";
    /** Inline low-res preview (base64 JPEG data URL). */
    thumb?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    width?: number;
    height?: number;
    /** Shared-contact fields (kind === "contact"). */
    contactUserId?: string;
    contactFirstName?: string;
    contactLastName?: string;
    contactPhone?: string;
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
    /** Sender id / name — shown above incoming bubbles in a group chat. */
    senderId?: string;
    senderName?: string;
    /** Origin info when this message is a forward. */
    forwardedFrom?: ForwardInfo;
}

/** A chat the user can forward messages to (from /api/telegram/dialogs). */
interface ForwardDest {
    id: string;
    title: string;
    isChannel?: boolean;
    isGroup?: boolean;
    isUser?: boolean;
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
    /** Hide the message composer (read-only viewer). */
    readOnly?: boolean;
    /** Group/channel stream — show each incoming message's sender name. */
    isGroup?: boolean;
    /** Rendered in place of the composer (e.g. a Join button). */
    banner?: React.ReactNode;
    /**
     * Delete the given message ids. When provided, right-clicking a message
     * opens a Delete menu; when omitted, the native browser menu shows.
     */
    onDeleteMessage?: (messageIds: string[]) => void;
    /** When provided, a "shared media" button appears in the chat header. */
    onViewMedia?: () => void;
    /**
     * Called once a media send completes successfully. The composer uploads
     * the files itself (so it can show live progress on the previews) — this
     * callback is the parent's hook to refresh the conversation. When set,
     * the composer shows the attach button.
     */
    onMediaSent?: () => void;
}

/** Per-sender label colour, deterministic from the sender id. */
const SENDER_COLORS = [
    "#e17076", "#7bc862", "#65aadd", "#a695e7",
    "#ee7aae", "#6ec9cb", "#faa774", "#6a8cda",
];

function senderColor(id?: string): string {
    if (!id) return SENDER_COLORS[0];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
    return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
}

/**
 * Grab a poster frame from a video file as a JPEG data URL, plus the source
 * video's real width/height/duration. Telegram needs this so the chat bubble
 * has a poster to show — gramjs' server-side metadata extraction is a no-op,
 * so we have to capture the frame in the browser the way Telegram Web does.
 * Returns null if the browser can't decode the format (e.g. some HEVC .mov).
 */
async function extractVideoThumb(
    file: File,
): Promise<{
    dataUrl: string;
    width: number;
    height: number;
    duration: number;
} | null> {
    if (typeof document === "undefined") return null;
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        let done = false;
        const finish = (result: ReturnType<typeof extractVideoThumb> extends Promise<infer R> ? R : never) => {
            if (done) return;
            done = true;
            URL.revokeObjectURL(url);
            video.src = "";
            resolve(result);
        };

        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        // Decoding failure (unsupported codec etc.) — fall back to no thumb.
        video.onerror = () => finish(null);
        // Belt-and-braces: some browsers stall without ever firing 'seeked'.
        const timeout = setTimeout(() => finish(null), 5000);

        video.onloadedmetadata = () => {
            // Seek a tiny bit into the video — frame 0 is often black.
            const dur = isFinite(video.duration) ? video.duration : 0;
            video.currentTime = Math.min(0.1, dur / 2);
        };
        video.onseeked = () => {
            clearTimeout(timeout);
            try {
                const w0 = video.videoWidth || 1;
                const h0 = video.videoHeight || 1;
                // Telegram caps thumbs around 320px on the long edge.
                const maxEdge = 320;
                const scale = Math.min(1, maxEdge / Math.max(w0, h0));
                const w = Math.max(1, Math.round(w0 * scale));
                const h = Math.max(1, Math.round(h0 * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) return finish(null);
                ctx.drawImage(video, 0, 0, w, h);
                const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
                finish({
                    dataUrl,
                    width: w0,
                    height: h0,
                    duration: Math.round(isFinite(video.duration) ? video.duration : 0),
                });
            } catch {
                finish(null);
            }
        };
    });
}

/** One queued/uploading attachment, with the poster + per-file progress that
 * the outgoing bubble needs to render Telegram-Web-style during a send. */
interface UploadingItem {
    uploadId: string;
    file: File;
    /** The image we render in the bubble — blob URL for images, captured
     * poster data URL for videos. */
    previewUrl: string;
    /** Set when we created previewUrl ourselves and need to revoke it. */
    revokeOnDone: boolean;
    isVideo: boolean;
    width?: number;
    height?: number;
    duration?: number;
    /** Captured video poster data URL (also goes to the server as `thumb`). */
    thumb?: string;
    progress: number;
}

/** Decode an image file enough to learn its real width / height. Used so the
 * outgoing bubble can size itself like the sent message will. */
async function measureImage(
    file: File,
): Promise<{ width: number; height: number } | null> {
    if (typeof document === "undefined") return null;
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            URL.revokeObjectURL(url);
            resolve(w && h ? { width: w, height: h } : null);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

/**
 * Trigger an action menu on either right-click (desktop) or a long-press
 * (mobile). The returned props are meant to be spread on the same element that
 * previously held just `onContextMenu`.
 */
function useActionMenu(
    onTrigger: ((clientX: number, clientY: number) => void) | undefined,
): {
    onContextMenu?: (e: React.MouseEvent) => void;
    onTouchStart?: (e: React.TouchEvent) => void;
    onTouchMove?: (e: React.TouchEvent) => void;
    onTouchEnd?: () => void;
    onTouchCancel?: () => void;
} {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const cancel = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startRef.current = null;
    }, []);
    useEffect(() => cancel, [cancel]);
    if (!onTrigger) return {};
    return {
        onContextMenu: (e) => {
            e.preventDefault();
            onTrigger(e.clientX, e.clientY);
        },
        onTouchStart: (e) => {
            const t = e.touches[0];
            if (!t) return;
            startRef.current = { x: t.clientX, y: t.clientY };
            timerRef.current = setTimeout(() => {
                if (startRef.current) {
                    onTrigger(startRef.current.x, startRef.current.y);
                }
                timerRef.current = null;
            }, 500);
        },
        onTouchMove: (e) => {
            const start = startRef.current;
            if (!start) return;
            const t = e.touches[0];
            if (!t) return;
            // Treat any scroll/scroll-attempt as "user is not long-pressing".
            if (
                Math.abs(t.clientX - start.x) > 10 ||
                Math.abs(t.clientY - start.y) > 10
            ) {
                cancel();
            }
        },
        onTouchEnd: cancel,
        onTouchCancel: cancel,
    };
}

/** Build a chat-media stream URL for a message attachment. */
function buildMediaUrl(
    sessionString: string,
    contact: Contact,
    messageId: string,
    isGroup: boolean,
    opts?: { download?: boolean; thumb?: boolean },
): string {
    const params = new URLSearchParams({
        sessionString,
        messageId: String(messageId),
    });
    if (isGroup) {
        // contact.id is the group/channel marked id in group mode.
        params.set("chatId", contact.id);
    } else {
        params.set("userId", contact.id);
        if (contact.accessHash) params.set("accessHash", contact.accessHash);
    }
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

    if (media?.kind === "voice" || media?.kind === "audio") {
        return (
            <div className="flex flex-col gap-1 py-1">
                <audio src={url} controls className="h-9 max-w-[240px]" />
                {media?.kind === "audio" && media?.fileName && (
                    <span className="max-w-[240px] truncate text-[11px] text-[#8a9aaa] dark:text-zinc-400">
                        {media.fileName}
                    </span>
                )}
            </div>
        );
    }

    if (media?.kind === "contact") {
        return <ContactCard media={media} />;
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
                <span className="block max-w-[180px] truncate text-[13px] font-medium text-[#111] dark:text-zinc-100">
                    {media.fileName || "File"}
                </span>
                <span className="block text-[11px] text-[#8a9aaa] dark:text-zinc-400">
                    {formatFileSize(media.fileSize) || "Download"}
                </span>
            </span>
        </a>
    );
}

// ── Shared-contact card ────────────────────────────────────────────────────────
function ContactCard({ media }: { media: ChatMedia }) {
    const nav = useChatNav();
    const name =
        `${media.contactFirstName || ""} ${media.contactLastName || ""}`.trim() ||
        "Contact";
    const canOpen = !!nav && !!media.contactUserId;
    return (
        <button
            type="button"
            disabled={!canOpen}
            onClick={() => {
                if (nav && media.contactUserId) {
                    nav.openUserChat({
                        id: media.contactUserId,
                        firstName: media.contactFirstName || name,
                        lastName: media.contactLastName,
                    });
                }
            }}
            className="flex items-center gap-3 py-1 text-left enabled:cursor-pointer disabled:cursor-default"
        >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-base font-semibold text-white">
                {name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-[#111] dark:text-zinc-100">
                    {name}
                </span>
                <span className="block truncate text-[11.5px] text-[#3390ec]">
                    {media.contactPhone || (canOpen ? "Open chat" : "Contact")}
                </span>
            </span>
        </button>
    );
}

// ── Message text with clickable links ──────────────────────────────────────────
function MessageText({ text }: { text: string }) {
    const nav = useChatNav();
    if (!text) return null;

    // Fresh regex per call — a /g regex carries mutable lastIndex state.
    // The `@username` branch matches Telegram's 5–32 char rule (letter, then
    // letters/digits/underscores). A lookbehind for non-word chars stops us
    // from matching the middle of an email or another token.
    const linkRe =
        /(https?:\/\/[^\s<]+|t\.me\/[^\s<]+|www\.[^\s<]+|(?<![\w@])@[a-zA-Z][a-zA-Z0-9_]{3,31})/g;
    const out: React.ReactNode[] = [];
    let last = 0;
    let key = 0;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const raw = m[0];
        // Trailing sentence punctuation isn't part of the URL/mention.
        const clean = raw.replace(/[.,!?;:)]+$/, "");
        const trailing = raw.slice(clean.length);
        const isMention = clean.startsWith("@");
        const tgTarget = isMention ? null : telegramLinkTarget(clean);
        if (isMention && nav) {
            // Username mention — open the user's chat via the same resolver
            // path as a t.me link.
            const username = clean.slice(1);
            out.push(
                <button
                    key={key++}
                    type="button"
                    onClick={() =>
                        nav.openTelegramLink(`https://t.me/${username}`)
                    }
                    className="cursor-pointer text-[#3390ec] hover:underline"
                >
                    {clean}
                </button>,
            );
        } else if (tgTarget && nav) {
            // Telegram link (public username or private invite) — resolve and
            // open inside the app.
            out.push(
                <button
                    key={key++}
                    type="button"
                    onClick={() => nav.openTelegramLink(clean)}
                    className="cursor-pointer break-all text-[#3390ec] underline hover:no-underline"
                >
                    {clean}
                </button>,
            );
        } else if (isMention) {
            // No nav context (shouldn't really happen inside a chat bubble) —
            // fall through as plain text so we don't show a broken button.
            out.push(clean);
        } else {
            const href = clean.startsWith("http") ? clean : `https://${clean}`;
            out.push(
                <a
                    key={key++}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-[#3390ec] underline hover:no-underline"
                >
                    {clean}
                </a>,
            );
        }
        if (trailing) out.push(trailing);
        last = m.index + raw.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return <>{out}</>;
}

// ── Sender label (group chat) ──────────────────────────────────────────────────
function SenderLabel({ msg }: { msg: Message }) {
    if (!msg.senderName) return null;
    return (
        <span
            className="mb-0.5 block px-1 text-[12px] font-semibold leading-tight"
            style={{ color: senderColor(msg.senderId) }}
        >
            {msg.senderName}
        </span>
    );
}

/**
 * "Forwarded from …" header shown above a forwarded message. The origin's
 * name + avatar are clickable when reachable — a channel/group resolves like a
 * t.me link (opening a nested chat), a user opens directly.
 */
function ForwardLabel({
    info,
    session,
    padded,
}: {
    info: ForwardInfo;
    session: string;
    padded?: boolean;
}) {
    const nav = useChatNav();
    // The origin is reachable whenever it resolved to a peer id.
    const canOpen = !!nav && !!info.id;

    function open(e: React.MouseEvent) {
        e.stopPropagation();
        if (!nav || !info.id) return;
        if (info.isUser) {
            // A user — open the DM directly (always nests onto the chat stack).
            nav.openChat({
                kind: "user",
                id: info.id,
                accessHash: info.accessHash,
                title: info.name,
                isMember: true,
            });
        } else if (info.username) {
            // Public channel/group — resolve like a t.me link, which also
            // recovers correct membership.
            nav.openTelegramLink(`https://t.me/${info.username}`);
        } else {
            // Private channel/group — open directly by marked id + access hash.
            nav.openChat({
                kind: info.isChannel ? "channel" : "group",
                id: info.isChannel ? `-100${info.id}` : `-${info.id}`,
                accessHash: info.accessHash,
                title: info.name,
            });
        }
    }

    const avatar = info.id ? (
        <DialogAvatar
            session={session}
            groupId={info.id}
            title={info.name}
            fallbackClassName="from-blue-500 to-cyan-400"
            sizeClassName="h-4 w-4 shrink-0"
            textClassName="text-[9px]"
            accessHash={info.accessHash}
            peerType={info.isChannel ? "channel" : "user"}
        />
    ) : null;

    return (
        <span
            className={`mb-[0.5rem] flex items-center gap-1 text-[12px] leading-snug ${
                padded ? "px-2 pt-1" : ""
            }`}
        >
            <span className="shrink-0 text-[#8a9aaa] dark:text-zinc-400">Forwarded from</span>
            {canOpen ? (
                <button
                    type="button"
                    onClick={open}
                    title={`Open ${info.name}`}
                    className="flex min-w-0 cursor-pointer items-center gap-1"
                >
                    {avatar}
                    <span className="min-w-0 truncate font-semibold text-[#3390ec] hover:underline">
                        {info.name}
                    </span>
                </button>
            ) : (
                <>
                    {avatar}
                    <span className="min-w-0 truncate font-semibold text-[#3390ec]">
                        {info.name}
                    </span>
                </>
            )}
        </span>
    );
}

// ── Album bubble (grouped media → tiled grid) ──────────────────────────────────
function AlbumBubble({
    messages,
    mediaUrl,
    onOpenViewer,
    isGroup = false,
    onActionMenu,
    sessionString = "",
}: {
    messages: Message[];
    mediaUrl: MediaUrlFn;
    onOpenViewer: (items: ViewerItem[], index: number) => void;
    isGroup?: boolean;
    /** Open the actions menu (forward / delete) at the given screen point.
     * Fires on desktop right-click OR mobile long-press. */
    onActionMenu?: (clientX: number, clientY: number) => void;
    sessionString?: string;
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
    const actionHandlers = useActionMenu(onActionMenu);

    return (
        <div className={`flex ${fromMe ? "justify-end" : "justify-start"} mb-1`}>
            <div
                {...actionHandlers}
                className={`relative max-w-[280px] overflow-hidden rounded-2xl p-1 text-sm shadow-sm ${
                    fromMe
                        ? "bg-[#effdde] dark:bg-[#2b5278] rounded-br-sm"
                        : "bg-white dark:bg-zinc-900 rounded-bl-sm"
                }`}
            >
                {isGroup && !fromMe && (
                    <span className="px-1 pt-0.5">
                        <SenderLabel msg={messages[0]} />
                    </span>
                )}
                {messages[0]?.forwardedFrom && (
                    <ForwardLabel
                        info={messages[0].forwardedFrom}
                        session={sessionString}
                        padded
                    />
                )}
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
                        <MessageText text={caption} />
                    </span>
                )}
                <span className="block px-2 pb-1 text-right text-[10px] leading-none text-[#aab8c2] dark:text-zinc-500 select-none">
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
    isGroup = false,
    onActionMenu,
    sessionString = "",
}: {
    msg: Message;
    mediaUrl: MediaUrlFn;
    onOpenViewer: (items: ViewerItem[], index: number) => void;
    isGroup?: boolean;
    /** Open the actions menu (forward / delete) — fires on right-click or
     * long-press. */
    onActionMenu?: (clientX: number, clientY: number) => void;
    sessionString?: string;
}) {
    const actionHandlers = useActionMenu(onActionMenu);
    const media = msg?.media;
    const showSender = isGroup && !msg?.fromMe && !!msg?.senderName;
    const metaRow = (
        <span className="ml-2 whitespace-nowrap text-[10px] leading-none text-[#aab8c2] dark:text-zinc-500 select-none">
            {media?.kind === "video" || media?.kind === "voice" || media?.kind === "audio"
                ? formatDuration(media?.duration) + " · "
                : ""}
            {formatTime(msg?.timestamp)}
            {msg?.fromMe && <Ticks status={msg?.status} />}
        </span>
    );

    const openSelf = () => {
        if (media && isViewable(media?.kind)) {
            onOpenViewer(
                [{ messageId: msg?.id, kind: media?.kind, thumb: media?.thumb }],
                0,
            );
        }
    };

    // Stickers render bare — no chat bubble — the Telegram-native way?.
    if (media?.kind === "sticker") {
        return (
            <div className={`flex ${msg.fromMe ? "justify-end" : "justify-start"} mb-1`}>
                <div className="relative" {...actionHandlers}>
                    <MediaContent
                        media={media}
                        url={mediaUrl(msg?.id)}
                        downloadUrl={mediaUrl(msg?.id, { download: true })}
                        thumbUrl={mediaUrl(msg?.id, { thumb: true })}
                    />
                    <span className="absolute bottom-0 right-0 rounded-full bg-black/35 px-1.5 py-0.5 text-[10px] leading-none text-white select-none">
                        {formatTime(msg?.timestamp)}
                        {msg?.fromMe && <Ticks status={msg?.status} />}
                    </span>
                </div>
            </div>
        );
    }

    const isVisualMedia =
        media?.kind === "photo" || media?.kind === "video" || media?.kind === "gif";

    return (
        <div className={`flex ${msg?.fromMe ? "justify-end" : "justify-start"} mb-1`}>
            <div
                {...actionHandlers}
                className={`
                    relative max-w-[75%] rounded-2xl text-sm leading-relaxed
                    ${isVisualMedia ? "overflow-hidden p-1" : "px-3 py-2"}
                    ${msg?.fromMe
                        ? "bg-[#effdde] dark:bg-[#2b5278] text-[#111] dark:text-zinc-100 rounded-br-sm shadow-sm"
                        : "bg-white dark:bg-zinc-900 text-[#111] dark:text-zinc-100 rounded-bl-sm shadow-sm"
                    }
                `}
                style={{ wordBreak: "break-word" }}
            >
                {msg?.forwardedFrom && (
                    <ForwardLabel
                        info={msg.forwardedFrom}
                        session={sessionString}
                        padded={isVisualMedia}
                    />
                )}
                {showSender && (
                    <span className={isVisualMedia ? "block p-1" : ""}>
                        <SenderLabel msg={msg} />
                    </span>
                )}
                {media && (
                    <div className={isVisualMedia ? "relative" : ""}>
                        <MediaContent
                            media={media}
                            url={mediaUrl(msg?.id)}
                            downloadUrl={mediaUrl(msg?.id, { download: true })}
                            thumbUrl={mediaUrl(msg?.id, { thumb: true })}
                            onOpen={openSelf}
                        />
                        {/* For caption-less visual media, overlay the time?. */}
                        {isVisualMedia && !msg?.text && (
                            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] leading-none text-white select-none">
                                {formatTime(msg?.timestamp)}
                                {msg?.fromMe && <Ticks status={msg?.status} />}
                            </span>
                        )}
                    </div>
                )}
                {msg?.text && (
                    <span className={isVisualMedia ? "mt-1 block px-2 pb-1" : ""}>
                        <MessageText text={msg?.text} />
                    </span>
                )}
                {(!isVisualMedia || msg?.text) && (
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
    onForward,
}: {
    items: ViewerItem[];
    index: number;
    mediaUrl: MediaUrlFn;
    onClose: () => void;
    onIndex: (next: number) => void;
    /** Open the forward picker for this message and close the viewer. Hidden
     * if not provided (e.g. read-only or no session). */
    onForward?: (messageId: string) => void;
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

    const downloadUrl = mediaUrl(item.messageId, { download: true });

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={onClose}
        >
            {/* Top-right toolbar: download / forward / close. Each button is
                a small frosted pill so they read on top of any media. */}
            <div
                className="absolute right-4 top-4 flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                <a
                    href={downloadUrl}
                    download
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                    aria-label="Download"
                    title="Download"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </a>
                {onForward && (
                    <button
                        type="button"
                        onClick={() => onForward(item.messageId)}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 cursor-pointer"
                        aria-label="Forward"
                        title="Forward"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 17 20 12 15 7" />
                            <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                        </svg>
                    </button>
                )}
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 cursor-pointer"
                    aria-label="Close"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            {multiple && (
                <>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onIndex((index - 1 + items.length) % items.length);
                        }}
                        className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 cursor-pointer"
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
                        className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 cursor-pointer"
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
            <span className="bg-[#ffffffcc] text-[#8a9aaa] dark:text-zinc-400 text-[11px] px-3 py-1 rounded-full select-none backdrop-blur-sm shadow-sm">
                {label}
            </span>
        </div>
    );
}

// ── Outgoing media bubble (while uploading) ────────────────────────────────────
/**
 * Telegram-Web-style bubble that takes over from the composer chips once a send
 * starts. Each tile shows the file's preview (image blob URL, or the captured
 * video poster) full-size with a centered circular progress + cancel overlay
 * and the percentage in the corner. The whole thing lives at the end of the
 * messages list so the regular auto-scroll already keeps it in view.
 */
function OutgoingMediaBubble({
    items,
    caption,
    onCancel,
}: {
    items: UploadingItem[];
    caption: string;
    onCancel?: () => void;
}) {
    if (items.length === 0) return null;
    const n = items.length;
    const cols = n === 1 ? 1 : n === 2 || n === 4 ? 2 : 3;
    // Match the sent-message layout: single tile uses the file's real aspect
    // via mediaBox (the same helper Bubble uses on the message-side), albums
    // get a fixed 280px-wide grid like AlbumBubble.
    let containerStyle: React.CSSProperties;
    if (n === 1) {
        const box = mediaBox(items[0].width, items[0].height);
        containerStyle = { width: box.width };
    } else {
        containerStyle = { width: 280 };
    }
    return (
        <div className="flex justify-end mb-1">
            <div
                className="relative overflow-hidden rounded-2xl rounded-br-sm bg-[#effdde] dark:bg-[#2b5278] p-1 text-sm shadow-sm"
                style={containerStyle}
            >
                <div
                    className="grid gap-0.5 overflow-hidden rounded-lg"
                    style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                >
                    {items.map((it) => (
                        <UploadingTile
                            key={it.uploadId}
                            item={it}
                            single={n === 1}
                            onCancel={onCancel}
                        />
                    ))}
                </div>
                {caption && (
                    <span
                        className="mt-1 block px-2 pb-0.5"
                        style={{ wordBreak: "break-word" }}
                    >
                        <MessageText text={caption} />
                    </span>
                )}
                <span className="block px-2 pb-1 text-right text-[10px] leading-none text-[#aab8c2] dark:text-zinc-500 select-none">
                    {formatTime(new Date())}
                    <svg
                        className="ml-0.5 inline-block align-middle"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="12 7 12 12 15 14" />
                    </svg>
                </span>
            </div>
        </div>
    );
}

function UploadingTile({
    item,
    single,
    onCancel,
}: {
    item: UploadingItem;
    single: boolean;
    onCancel?: () => void;
}) {
    const pct = Math.round(item.progress * 100);
    // Single tile: the parent container is already sized via mediaBox, so the
    // tile just fills it and the poster lays out at the file's real aspect.
    // Album tiles: square, matching AlbumBubble.
    const tileStyle: React.CSSProperties = single
        ? {
              width: "100%",
              aspectRatio:
                  item.width && item.height
                      ? `${item.width} / ${item.height}`
                      : "16 / 9",
          }
        : { width: "100%", aspectRatio: "1 / 1" };
    return (
        <div
            className="relative overflow-hidden bg-black"
            style={tileStyle}
        >
            <img
                src={item.previewUrl}
                alt={item.isVideo ? "Video" : "Photo"}
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
            />
            <span className="pointer-events-none absolute left-2 top-1.5 z-10 text-[12px] font-medium text-white drop-shadow">
                {pct}%
            </span>
            <button
                type="button"
                onClick={onCancel}
                disabled={!onCancel}
                aria-label="Cancel upload"
                className="absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center"
            >
                {/* Dim backdrop behind the ring + icon */}
                <span className="absolute inset-0 rounded-full bg-black/45" />
                {/* Progress ring around the X */}
                <svg
                    width="48"
                    height="48"
                    viewBox="0 0 48 48"
                    className="absolute inset-0 -rotate-90"
                >
                    <circle
                        cx="24"
                        cy="24"
                        r="21"
                        fill="none"
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth="2.5"
                    />
                    <circle
                        cx="24"
                        cy="24"
                        r="21"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 21}
                        strokeDashoffset={
                            2 * Math.PI * 21 * (1 - Math.max(0, Math.min(1, item.progress)))
                        }
                        style={{ transition: "stroke-dashoffset 0.15s linear" }}
                    />
                </svg>
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="relative"
                >
                    <path d="M18 6 6 18M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}

// ── Typing Indicator ───────────────────────────────────────────────────────────
function TypingIndicator() {
    return (
        <div className="flex justify-start mb-2">
            <div className="bg-white dark:bg-zinc-900 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center shadow-sm">
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

/** Thumbnail/chip for one file queued in the composer, with a remove button. */
function FilePreview({
    file,
    onRemove,
    progress,
}: {
    file: File;
    onRemove: () => void;
    /** 0..1 upload progress (or null when not uploading). */
    progress?: number | null;
}) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    // Create/revoke the blob URL inside the effect so the pair survives
    // Strict Mode's intentional double-mount in dev (which would otherwise
    // revoke a `useMemo`-created URL and leave the <img> broken).
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!isImage && !isVideo) return;
        const u = URL.createObjectURL(file);
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [file, isImage, isVideo]);

    return (
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-800 bg-[#f0f2f5] dark:bg-zinc-800">
            {url && isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={url}
                    alt={file.name}
                    className="h-full w-full object-cover"
                />
            ) : url && isVideo ? (
                <video
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                />
            ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a9aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="line-clamp-2 break-all text-[8px] leading-tight text-[#8a9aaa] dark:text-zinc-400">
                        {file.name}
                    </span>
                </div>
            )}
            {isVideo && typeof progress !== "number" && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white shadow">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </span>
                </span>
            )}
            {typeof progress === "number" && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
                    <svg
                        width="32"
                        height="32"
                        viewBox="0 0 36 36"
                        className="-rotate-90"
                    >
                        <circle
                            cx="18"
                            cy="18"
                            r="14"
                            fill="none"
                            stroke="rgba(255,255,255,0.25)"
                            strokeWidth="3"
                        />
                        <circle
                            cx="18"
                            cy="18"
                            r="14"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray={2 * Math.PI * 14}
                            strokeDashoffset={
                                2 *
                                Math.PI *
                                14 *
                                (1 - Math.max(0, Math.min(1, progress)))
                            }
                            style={{ transition: "stroke-dashoffset 0.15s linear" }}
                        />
                    </svg>
                </span>
            )}
            {typeof progress !== "number" && (
            <button
                type="button"
                onClick={onRemove}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                aria-label="Remove"
            >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                </svg>
            </button>
            )}
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
    readOnly = false,
    isGroup = false,
    banner,
    onDeleteMessage,
    onViewMedia,
    onMediaSent,
}: TelegramChatProps) {
    const mediaUrl: MediaUrlFn = (messageId, opts) =>
        buildMediaUrl(sessionString, contact, messageId, isGroup, opts);
    const { startForward } = useForwardJobs();
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    // Media files queued in the composer, awaiting send.
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [sendingMedia, setSendingMedia] = useState(false);
    // Per-file state for the in-flight album. Driven by uploadMedia — replaces
    // the old single `sendProgress` so the outgoing bubble can show each tile's
    // own poster + percentage the way Telegram Web does.
    const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
    const updateUploadProgress = (uploadId: string, progress: number) =>
        setUploadingItems((prev) =>
            prev.map((it) =>
                it.uploadId === uploadId
                    ? { ...it, progress: Math.max(it.progress, progress) }
                    : it,
            ),
        );
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Full-screen media viewer state — null when closed.
    const [viewer, setViewer] = useState<{
        items: ViewerItem[];
        index: number;
    } | null>(null);
    const openViewer = (items: ViewerItem[], index: number) =>
        setViewer({ items, index });
    // Right-click context menu for message actions (forward / delete). Armed
    // when forwarding is possible (a session is present) or the parent passes
    // onDeleteMessage; otherwise right-click falls through to the native menu.
    const [menu, setMenu] = useState<{
        x: number;
        y: number;
        ids: string[];
    } | null>(null);
    function showActionMenu(clientX: number, clientY: number, ids: string[]) {
        if (!onDeleteMessage && !sessionString) return;
        setMenu({ x: clientX, y: clientY, ids });
    }
    useEffect(() => {
        if (!menu) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setMenu(null);
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [menu]);

    // ── Forward: pick a destination chat and forward the chosen messages ──
    const [forwardIds, setForwardIds] = useState<string[] | null>(null);
    const [destinations, setDestinations] = useState<ForwardDest[] | null>(null);
    const [destLoading, setDestLoading] = useState(false);
    const [destSearch, setDestSearch] = useState("");
    const [forwardingTo, setForwardingTo] = useState<string | null>(null);

    // Fetch the destination chat list — lazily, once, when the picker opens.
    async function loadDestinations() {
        if (destinations || destLoading || !sessionString) return;
        setDestLoading(true);
        try {
            const res = await fetch("/api/telegram/dialogs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionString }),
            });
            const data = await res.json();
            setDestinations(Array.isArray(data.groups) ? data.groups : []);
        } catch {
            setDestinations([]);
        } finally {
            setDestLoading(false);
        }
    }

    async function doForward(dest: ForwardDest) {
        if (!forwardIds || forwardingTo) return;
        const messageIds = forwardIds
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0);
        if (messageIds.length === 0) return;
        setForwardingTo(dest.id);
        // Routed through the shared forward pipeline: it tries a native forward
        // first and falls back to download→re-send for restricted chats. The
        // global floating card shows progress and the result toast.
        const jobId = await startForward({
            session: sessionString,
            fromGroupId: contact.id,
            fromGroupTitle:
                `${contact.firstName} ${contact.lastName ?? ""}`.trim() ||
                "Chat",
            toGroupId: dest.id,
            destinationTitle: dest.title,
            destinationIsChannel: dest.isChannel,
            messageIds,
            contentSummary: `${messageIds.length} message${
                messageIds.length === 1 ? "" : "s"
            }`,
        });
        setForwardingTo(null);
        if (jobId) {
            setForwardIds(null);
            setDestSearch("");
        }
    }

    const filteredDestinations = (destinations ?? [])
        .filter((d) => d.id !== contact.id)
        .filter((d) => {
            const q = destSearch.trim().toLowerCase();
            return !q || d.title.toLowerCase().includes(q);
        });
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

    async function handleSend() {
        // Queued media takes priority — the text box becomes its caption.
        if (pendingFiles.length > 0) {
            if (sendingMedia || !onMediaSent || !sessionString) return;

            // Extract posters + dimensions upfront so the outgoing bubble can
            // render Telegram-Web-style during the upload rather than waiting
            // for the conversation refresh after send.
            const items: UploadingItem[] = await Promise.all(
                pendingFiles.map(async (f) => {
                    const isVideo = f.type.startsWith("video/");
                    const isImage = f.type.startsWith("image/");
                    const thumb = isVideo ? await extractVideoThumb(f) : null;
                    // Need the real width/height to size the outgoing bubble
                    // the same way the sent message will end up (mediaBox).
                    const meta = thumb
                        ? { width: thumb.width, height: thumb.height }
                        : isImage
                            ? await measureImage(f)
                            : null;
                    // Use the captured poster when we have one (sharper, smaller);
                    // fall back to a blob URL so images and undecodable videos
                    // still get a preview.
                    let previewUrl: string;
                    let revokeOnDone: boolean;
                    if (thumb) {
                        previewUrl = thumb.dataUrl;
                        revokeOnDone = false;
                    } else {
                        previewUrl = URL.createObjectURL(f);
                        revokeOnDone = true;
                    }
                    return {
                        uploadId: crypto.randomUUID(),
                        file: f,
                        previewUrl,
                        revokeOnDone,
                        isVideo,
                        width: meta?.width,
                        height: meta?.height,
                        duration: thumb?.duration,
                        thumb: thumb?.dataUrl,
                        progress: 0,
                    };
                }),
            );

            setUploadingItems(items);
            setSendingMedia(true);
            forceScrollRef.current = true;
            try {
                await uploadMedia(items, input.trim());
                setPendingFiles([]);
                setInput("");
                if (inputRef.current) inputRef.current.style.height = "auto";
                onMediaSent?.();
            } catch (err) {
                // Files stay queued so the user can retry.
                console.error("[send-media]", err);
            } finally {
                // Revoke any blob URLs we created so we don't leak.
                for (const it of items) {
                    if (it.revokeOnDone) URL.revokeObjectURL(it.previewUrl);
                }
                setSendingMedia(false);
                setUploadingItems([]);
            }
            return;
        }
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

    /**
     * Upload the prepared `UploadingItem`s to the open chat, streaming progress
     * events from the route into per-item state. Throws on any failure so the
     * caller knows to keep the files queued and surface the error.
     */
    async function uploadMedia(items: UploadingItem[], caption: string) {
        // Chunked upload: split each file into 2 MB pieces and POST one piece
        // per request. Avoids the body-size cap that 17 MB+ multipart bodies
        // were hitting (same idea as Telegram Web's protocol-level chunking,
        // just via plain HTTP since the bytes still have to reach our server).
        const CHUNK_SIZE = 2 * 1024 * 1024;

        // ── Phase 1: ship each file's chunks to the staging endpoint. ──
        // Phase 1 fills the first half of each item's progress (0 → 0.5);
        // phase 2 (gramjs upload to Telegram) fills the second half.
        for (const it of items) {
            const total = Math.max(1, Math.ceil(it.file.size / CHUNK_SIZE));
            for (let i = 0; i < total; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, it.file.size);
                const chunk = it.file.slice(start, end);
                const res = await fetch("/api/telegram/upload-chunk", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/octet-stream",
                        "X-Upload-Id": it.uploadId,
                        "X-Chunk-Index": String(i),
                    },
                    body: chunk,
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => null);
                    throw new Error(
                        data?.error || `Chunk upload failed (HTTP ${res.status})`,
                    );
                }
                updateUploadProgress(it.uploadId, ((i + 1) / total) * 0.5);
            }
        }

        // ── Phase 2: tell the server to assemble + send via gramjs. ──
        const sendRes = await fetch("/api/telegram/upload-send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionString,
                chatId: isGroup ? contact.id : undefined,
                userId: isGroup ? undefined : contact.id,
                accessHash:
                    isGroup || !contact.accessHash ? undefined : contact.accessHash,
                caption,
                uploads: items.map((it) => ({
                    uploadId: it.uploadId,
                    filename: it.file.name || "file",
                    // Optional poster frame + measured dimensions for videos.
                    thumb: it.thumb,
                    width: it.width,
                    height: it.height,
                    duration: it.duration,
                    mimeType: it.file.type || undefined,
                })),
            }),
        });
        if (!sendRes.ok || !sendRes.body) {
            const data = await sendRes.json().catch(() => null);
            throw new Error(
                data?.error || `Send failed (HTTP ${sendRes.status})`,
            );
        }

        // Stream gramjs upload progress for phase 2 (0.5 → 1.0). The server
        // emits per-file events with an `index` for albums; single-file sends
        // and unknown indices fall back to the first item.
        const reader = sendRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let errorMessage: string | null = null;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                let event: {
                    kind?: string;
                    percent?: number;
                    index?: number;
                    message?: string;
                };
                try {
                    event = JSON.parse(line);
                } catch {
                    continue;
                }
                if (
                    event.kind === "progress" &&
                    typeof event.percent === "number"
                ) {
                    const clamped = Math.max(0, Math.min(1, event.percent));
                    const next = 0.5 + clamped * 0.5;
                    if (typeof event.index === "number") {
                        const target = items[event.index];
                        if (target) updateUploadProgress(target.uploadId, next);
                    } else {
                        // Single-file path: only one item to attribute to.
                        for (const it of items) {
                            updateUploadProgress(it.uploadId, next);
                        }
                    }
                } else if (
                    event.kind === "error" &&
                    typeof event.message === "string"
                ) {
                    errorMessage = event.message;
                }
            }
        }
        if (errorMessage) throw new Error(errorMessage);
    }

    function handleFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
        const picked = Array.from(e.target.files ?? []);
        if (picked.length > 0) {
            setPendingFiles((prev) => [...prev, ...picked].slice(0, 10));
        }
        // Reset so re-picking the same file still fires onChange.
        e.target.value = "";
    }

    function removeFile(index: number) {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
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
                // background: "#f0f2f5",
            }}
        >
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 shadow-sm shrink-0">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="text-[#8a9aaa] dark:text-zinc-400 hover:text-[#3390ec] transition-colors p-1 -ml-1 rounded-full hover:bg-[#3390ec]/10"
                        aria-label="Back"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                )}

                <Avatar contact={contact} size="md" />

                <div className="flex-1 min-w-0">
                    <p className="text-[#111] dark:text-zinc-100 font-medium text-[15px] truncate leading-tight">{name}</p>
                    <p className="text-[#8a9aaa] dark:text-zinc-400 text-[12px] truncate leading-tight">
                        {contact.isOnline ? (
                            <span className="text-[#4dcd5e]">online</span>
                        ) : (
                            contact.lastSeen || "last seen recently"
                        )}
                    </p>
                </div>

                {/* header actions */}
                <div className="flex gap-1 text-[#8a9aaa] dark:text-zinc-400">
                    {onViewMedia && (
                        <button
                            type="button"
                            onClick={onViewMedia}
                            title="Shared media"
                            className="p-2 hover:text-[#3390ec] hover:bg-[#3390ec]/10 rounded-full transition-colors"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                            </svg>
                        </button>
                    )}
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
                className="flex-1 overflow-y-auto px-4 py-2 w-full max-w-[550px] mx-auto border-r border-l border-gray-200 dark:border-zinc-800"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%234a90d9' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            >
                {isLoading ? (
                    <div className="flex justify-center items-center h-full">
                        <div className="w-8 h-8 border-2 border-[#3390ec] border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col justify-center items-center h-full gap-3 select-none">
                        <div className="w-16 h-16 rounded-full bg-white dark:bg-zinc-900 shadow flex items-center justify-center">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="#aab8c2" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </div>
                        <p className="text-[#aab8c2] dark:text-zinc-500 text-sm">No messages yet. Say hello!</p>
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
                                            isGroup={isGroup}
                                            sessionString={sessionString}
                                            onActionMenu={(x, y) =>
                                                showActionMenu(
                                                    x,
                                                    y,
                                                    unit.map((m) => m.id),
                                                )
                                            }
                                        />
                                    ) : (
                                        <Bubble
                                            key={unit.id}
                                            msg={ unit}
                                            mediaUrl={mediaUrl}
                                            onOpenViewer={openViewer}
                                            isGroup={isGroup}
                                            sessionString={sessionString}
                                            onActionMenu={(x, y) =>
                                                showActionMenu(x, y, [unit.id])
                                            }
                                        />
                                    ),
                                )}
                            </div>
                        ))}
                        {isTyping && <TypingIndicator />}
                    </>
                )}
                {sendingMedia && uploadingItems.length > 0 && (
                    <OutgoingMediaBubble
                        items={uploadingItems}
                        caption={input.trim()}
                    />
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
                    onForward={
                        sessionString
                            ? (messageId) => {
                                  setViewer(null);
                                  setForwardIds([messageId]);
                                  void loadDestinations();
                              }
                            : undefined
                    }
                />
            )}

            {/* ── Right-click message menu ── */}
            {menu && (
                <>
                    <div
                        className="fixed inset-0 z-50"
                        onClick={() => setMenu(null)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu(null);
                        }}
                    />
                    <div
                        className="fixed z-50 min-w-[170px] overflow-hidden rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 py-1 shadow-xl"
                        style={{
                            left: Math.min(menu.x, window.innerWidth - 190),
                            top: Math.min(menu.y, window.innerHeight - 60),
                        }}
                    >
                        {sessionString && (
                            <button
                                type="button"
                                onClick={() => {
                                    setForwardIds(menu.ids);
                                    setMenu(null);
                                    void loadDestinations();
                                }}
                                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 17 20 12 15 7" />
                                    <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                                </svg>
                                {menu.ids.length > 1
                                    ? `Forward ${menu.ids.length} messages`
                                    : "Forward message"}
                            </button>
                        )}
                        {onDeleteMessage && (
                            <button
                                type="button"
                                onClick={() => {
                                    onDeleteMessage?.(menu.ids);
                                    setMenu(null);
                                }}
                                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 6h18" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                                {menu.ids.length > 1
                                    ? `Delete ${menu.ids.length} messages`
                                    : "Delete message"}
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* ── Forward destination picker ── */}
            {forwardIds && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setForwardIds(null)}
                >
                    <div
                        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:bg-zinc-900 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
                            <h3 className="text-sm font-semibold text-zinc-900">
                                Forward{" "}
                                {forwardIds.length > 1
                                    ? `${forwardIds.length} messages`
                                    : "message"}{" "}
                                to…
                            </h3>
                            <button
                                type="button"
                                onClick={() => setForwardIds(null)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100"
                                aria-label="Close"
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="border-b border-zinc-100 p-3">
                            <input
                                type="search"
                                value={destSearch}
                                onChange={(e) => setDestSearch(e.target.value)}
                                placeholder="Search chats…"
                                className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-400 focus:bg-white dark:bg-zinc-900"
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-2">
                            {destLoading ? (
                                <div className="flex h-32 items-center justify-center">
                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
                                </div>
                            ) : filteredDestinations.length === 0 ? (
                                <p className="py-12 text-center text-sm text-zinc-400">
                                    No chats found.
                                </p>
                            ) : (
                                <ul className="space-y-0.5">
                                    {filteredDestinations.map((dest) => (
                                        <li key={dest.id}>
                                            <button
                                                type="button"
                                                disabled={!!forwardingTo}
                                                onClick={() => doForward(dest)}
                                                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-zinc-100 disabled:opacity-60"
                                            >
                                                <DialogAvatar
                                                    session={sessionString}
                                                    groupId={dest.id}
                                                    title={dest.title}
                                                    fallbackClassName="from-blue-500 to-cyan-400"
                                                    sizeClassName="h-9 w-9 shrink-0"
                                                    textClassName="text-sm"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium text-zinc-900">
                                                        {dest.title}
                                                    </span>
                                                    <span className="block text-xs text-zinc-400">
                                                        {dest.isChannel
                                                            ? "Channel"
                                                            : dest.isGroup
                                                              ? "Group"
                                                              : "Private chat"}
                                                    </span>
                                                </span>
                                                {forwardingTo === dest.id && (
                                                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Banner (Join button etc.) — replaces the composer ── */}
            {banner ? (
                <div className="shrink-0 border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2.5">
                    {banner}
                </div>
            ) : readOnly ? null : (
            /* ── Input Bar ── */
            <div className="shrink-0 px-3 py-2 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 w-full max-w-[550px] mx-auto rounded-2xl">
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFilesPicked}
                    className="hidden"
                />
                {/* Queued media — small chips while waiting to send. Once the
                    send starts, the chips hide and the in-flight items render
                    as an outgoing bubble at the bottom of the chat instead. */}
                {pendingFiles.length > 0 && !sendingMedia && (
                    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                        {pendingFiles.map((f, i) => (
                            <FilePreview
                                key={`${f.name}-${f.size}-${i}`}
                                file={f}
                                onRemove={() => removeFile(i)}
                                progress={null}
                            />
                        ))}
                    </div>
                )}
                <div className="flex items-end gap-2">
                {/* emoji button */}
                <button className="text-[#8a9aaa] dark:text-zinc-400 hover:text-[#3390ec] transition-colors p-2 rounded-full hover:bg-[#3390ec]/10 shrink-0 mb-0.5">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M8.5 14.5s1 1.5 3.5 1.5 3.5-1.5 3.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="9" cy="10" r="1" fill="currentColor" />
                        <circle cx="15" cy="10" r="1" fill="currentColor" />
                    </svg>
                </button>

                {/* textarea */}
                <div className="flex-1 bg-[#f0f2f5] dark:bg-zinc-800 rounded-2xl px-3 py-2 flex items-end gap-2">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            pendingFiles.length > 0 ? "Add a caption…" : "Message"
                        }
                        className="flex-1 bg-transparent text-[#111] dark:text-zinc-100 placeholder-[#aab8c2] dark:placeholder-zinc-500 text-sm resize-none outline-none leading-relaxed max-h-[120px] overflow-y-auto"
                        style={{ scrollbarWidth: "none" }}
                    />
                    {/* attach button */}
                    {onMediaSent && (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach photos, videos or files"
                            className="text-[#8a9aaa] dark:text-zinc-400 hover:text-[#3390ec] transition-colors shrink-0 mb-0.5"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* send / mic button */}
                <button
                    onClick={handleSend}
                    disabled={sendingMedia}
                    className={`
                        w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 mb-0.5
                        ${input.trim() || pendingFiles.length > 0
                            ? "bg-[#3390ec] text-white shadow-lg shadow-[#3390ec]/30 scale-100 hover:scale-105"
                            : "bg-[#f0f2f5] dark:bg-zinc-800 text-[#8a9aaa] dark:text-zinc-400"
                        }
                    `}
                    aria-label="Send"
                >
                    {sendingMedia ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : input.trim() || pendingFiles.length > 0 ? (
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
            )}
        </div>
    );
}