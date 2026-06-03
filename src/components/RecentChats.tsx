"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid, List, ChevronLeft, ChevronRight, Search, X, ArrowLeft, Pin, PinOff } from "lucide-react";
import TelegramChat from "@/components/TelegramChat";
import { useUnread } from "@/components/UnreadContext";
import GroupMedia, { type MediaCacheEntry } from "@/components/GroupMedia";
import type {
    ChatMedia,
    ForwardInfo,
    LinkPreview,
    MessageReaction,
    TextEntity,
} from "@/app/api/telegram/conversation/route";

/** Chat message shape consumed by <TelegramChat>. */
type ChatUiMessage = {
    id: string;
    text: string;
    timestamp: Date;
    fromMe: boolean;
    status?: "sent" | "delivered" | "read";
    media?: ChatMedia;
    groupedId?: string;
    forwardedFrom?: ForwardInfo;
    linkPreview?: LinkPreview;
    entities?: TextEntity[];
    reactions?: MessageReaction[];
    phoneCall?: {
        duration?: number;
        video?: boolean;
        reason?: "missed" | "disconnect" | "hangup" | "busy";
        isOutgoing: boolean;
    };
};

/** Raw message shape returned by /api/telegram/conversation. */
type ApiMessage = {
    id: number;
    text: string;
    date: number;
    fromMe: boolean;
    status?: "sent" | "read";
    media?: ChatMedia;
    groupedId?: string;
    forwardedFrom?: ForwardInfo;
    linkPreview?: LinkPreview;
    entities?: TextEntity[];
    reactions?: MessageReaction[];
    phoneCall?: {
        duration?: number;
        video?: boolean;
        reason?: "missed" | "disconnect" | "hangup" | "busy";
        isOutgoing: boolean;
    };
};

function toUiMessage(m: ApiMessage): ChatUiMessage {
    return {
        id: String(m.id),
        text: m.text,
        timestamp: new Date(m.date * 1000),
        fromMe: m.fromMe,
        status: m.status,
        media: m.media,
        groupedId: m.groupedId,
        forwardedFrom: m.forwardedFrom,
        linkPreview: m.linkPreview,
        entities: m.entities,
        reactions: m.reactions,
        phoneCall: m.phoneCall,
    };
}

/** Union two message lists by id (newer list wins, so read-status updates),
 * sorted oldest → newest. */
function mergeMessages(a: ChatUiMessage[], b: ChatUiMessage[]): ChatUiMessage[] {
    const map = new Map<string, ChatUiMessage>();
    for (const m of a) map.set(m.id, m);
    for (const m of b) map.set(m.id, m);
    return [...map.values()].sort(
        (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
    );
}

type Contact = {
    id: string;
    /** Telegram per-user security token — required to address non-contacts. */
    accessHash: string;
    firstName: string;
    lastName: string;
    username: string;
    phone: string;
    /** Unread (unseen) incoming message count for this chat. */
    unreadCount?: number;
    photo?: string;
    lastMessage?: string;
    /** Whether this dialog is pinned to the top of the chat list. */
    pinMessage?: boolean;
};

type ChatContact = {
    id: string;
    accessHash: string;
    firstName: string;
    lastName?: string;
    username?: string;
    phone?: string;
    photo?: string | null;
    isOnline?: boolean;
    lastSeen?: string | null;
};

const SELECTED_CHAT_KEY = "telegram-recent-selected-chat";

/** Restore the chat that was open before a refresh, if one was persisted. */
function readStoredChat(): ChatContact | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(SELECTED_CHAT_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (
            p &&
            typeof p.id === "string" &&
            typeof p.accessHash === "string" &&
            typeof p.firstName === "string"
        ) {
            return p as ChatContact;
        }
    } catch {
        // ignore
    }
    return null;
}

const AVATAR_GRADIENTS = [
    "from-violet-400 to-indigo-500",
    "from-sky-400 to-cyan-500",
    "from-emerald-400 to-teal-500",
    "from-rose-400 to-pink-500",
    "from-amber-400 to-orange-500",
    "from-fuchsia-400 to-purple-500",
];

function getAvatarGradient(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function ContactAvatar({
    contact,
    name,
    gradient,
    size = "md",
    className = "",
}: {
    contact: any;
    name: string;
    gradient: string;
    size?: "md" | "lg";
    className?: string;
}) {
    const [imgError, setImgError] = useState(false);
    const dims = size === "lg" ? "w-14 h-14" : "w-10 h-10";
    const text = size === "lg" ? "text-xl" : "text-[15px]";
    return (
        <div
            className={`${dims} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold ${text} shrink-0 shadow-sm overflow-hidden ${className}`}
        >
            {contact.photo && !imgError ? (
                <img
                    src={contact.photo}
                    alt={contact.firstName}
                    className={`${dims} rounded-full object-cover`}
                    onError={() => setImgError(true)}
                />
            ) : (
                name.charAt(0).toUpperCase()
            )}
        </div>
    );
}

export default function RecentChats({ sessionString }: { sessionString: string }) {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<"list" | "grid">("list");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    // Live unread counts piped in from Telegram's update stream. The initial
    // contacts fetch still seeds `contact.unreadCount` so we render correctly
    // before the stream is connected; once it's connected, the per-chat value
    // here takes over so the badge updates in real time.
    const {
        perChat: unreadByChat,
        lastByChat,
        markRead,
        noteLastMessage,
    } = useUnread();

    // ── Chat state ──
    const [selectedContact, setSelectedContact] = useState<ChatContact | null>(
        readStoredChat,
    );
    // "chat" by default; flips to "media" when the user taps the shared-media
    // button in the chat header. Renders GroupMedia configured for a user DM.
    const [chatView, setChatView] = useState<"chat" | "media">("chat");
    // Media tab cache scoped to this Recent Chats mount — kept simple since the
    // user can re-fetch on demand.
    const [userMediaCache, setUserMediaCache] = useState<
        Record<string, MediaCacheEntry>
    >({});
    const [messages, setMessages] = useState<ChatUiMessage[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [hasMoreOlder, setHasMoreOlder] = useState(true);
    const [loadingOlder, setLoadingOlder] = useState(false);
    // The currently-open chat id. Used to discard in-flight fetches/polls
    // that resolve after the user has switched to a different chat.
    const activeChatIdRef = useRef<string | null>(null);

    // Pin state — id of the contact whose pin button is currently working, so
    // we can show a per-row spinner without freezing the rest of the list.
    const [pinningId, setPinningId] = useState<string | null>(null);
    // Toast for pin success/error (notably the Telegram pin-limit of 5).
    const [toast, setToast] = useState<
        { kind: "success" | "error"; message: string } | null
    >(null);
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(t);
    }, [toast]);

    async function togglePin(contact: Contact) {
        if (pinningId) return;
        const nextPinned = !contact.pinMessage;
        setPinningId(contact.id);
        // Optimistic flip so the icon updates immediately; we revert on failure.
        setContacts((prev) =>
            prev.map((c) =>
                c.id === contact.id ? { ...c, pinMessage: nextPinned } : c,
            ),
        );
        try {
            const res = await fetch("/api/telegram/pin-unpin-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionString,
                    userId: contact.id,
                    accessHash: contact.accessHash,
                    pinned: nextPinned,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                // Revert the optimistic flip.
                setContacts((prev) =>
                    prev.map((c) =>
                        c.id === contact.id
                            ? { ...c, pinMessage: !nextPinned }
                            : c,
                    ),
                );
                if (data?.code === "PINNED_DIALOGS_TOO_MUCH") {
                    setToast({
                        kind: "error",
                        message:
                            "Pin limit reached — Telegram allows up to 5 pinned chats. Unpin one to pin another.",
                    });
                } else {
                    setToast({
                        kind: "error",
                        message: data?.error || "Failed to update pin.",
                    });
                }
                return;
            }
            setToast({
                kind: "success",
                message: nextPinned ? "Chat pinned." : "Chat unpinned.",
            });
        } catch (err) {
            setContacts((prev) =>
                prev.map((c) =>
                    c.id === contact.id
                        ? { ...c, pinMessage: !nextPinned }
                        : c,
                ),
            );
            setToast({
                kind: "error",
                message:
                    err instanceof Error ? err.message : "Failed to update pin.",
            });
        } finally {
            setPinningId(null);
        }
    }

    /** Infinite scroll up: fetch a page of messages older than the oldest one
     * currently loaded, and merge them in. */
    async function loadOlder() {
        const contact = selectedContact;
        if (!contact || loadingOlder || !hasMoreOlder) return;
        const oldest = messages[0];
        if (!oldest) return;
        setLoadingOlder(true);
        try {
            const res = await fetch("/api/telegram/conversation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionString,
                    userId: contact.id,
                    accessHash: contact.accessHash,
                    limit: 50,
                    offsetId: Number(oldest.id),
                }),
            });
            const data = await res.json();
            if (activeChatIdRef.current !== contact.id) return;
            const older = Array.isArray(data.messages)
                ? (data.messages as ApiMessage[]).map(toUiMessage)
                : [];
            // Fewer than a full page back ⇒ we've reached the start of history.
            if (older.length < 50) setHasMoreOlder(false);
            if (older.length > 0) {
                setMessages((prev) => mergeMessages(prev, older));
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingOlder(false);
        }
    }

    async function loadConversation(
        userId: string,
        accessHash: string,
        initial: boolean,
    ) {
        if (initial) setMessagesLoading(true);
        try {
            const res = await fetch("/api/telegram/conversation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionString, userId, accessHash, limit: 100 }),
            });
            const data = await res.json();
            if (activeChatIdRef.current !== userId) return; // switched chats
            if (Array.isArray(data.messages) && data.messages.length > 0) {
                const incoming = (data.messages as ApiMessage[]).map(toUiMessage);
                setMessages((prev) => mergeMessages(prev, incoming));
                // Feed the newest message into the shared lastByChat so the
                // recent-chats list preview stays in sync even when the SSE
                // stream skips deltas (mobile WebViews don't always honour
                // incremental fetch streams). Skip media-only messages whose
                // text is empty so they don't blank out an existing preview.
                const newest = data.messages[
                    data.messages.length - 1
                ] as ApiMessage;
                if (newest.text) {
                    noteLastMessage(userId, newest.text, newest.date);
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (initial) setMessagesLoading(false);
        }
    }

    async function handleSendMessage(text: string) {
        const contact = selectedContact;
        if (!contact) return;
        // Optimistic: Telegram doesn't echo own-sends back to this session, so
        // bump the list preview ourselves the moment the user hits send.
        noteLastMessage(contact.id, text);
        try {
            const res = await fetch("/api/telegram/send-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionString,
                    userId: contact.id,
                    accessHash: contact.accessHash,
                    text,
                }),
            });
            const data = await res.json();
            if (data.message && activeChatIdRef.current === contact.id) {
                setMessages((prev) => mergeMessages(prev, [toUiMessage(data.message)]));
                // Refine with the server timestamp once it lands.
                if (typeof data.message.date === "number") {
                    noteLastMessage(contact.id, text, data.message.date);
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    /** Pull the just-sent media in immediately (TelegramChat handles the
     * upload itself so it can show live progress on the previews). */
    function handleMediaSent() {
        const c = selectedContact;
        if (!c || activeChatIdRef.current !== c.id) return;
        void loadConversation(c.id, c.accessHash, false);
    }

    /** Delete messages from the open chat. Only drops them from the view once
     * the API confirms — Telegram rejects deletes that aren't allowed. */
    async function handleDeleteMessage(ids: string[]) {
        const contact = selectedContact;
        if (!contact || ids.length === 0) return;
        const messageIds = ids.map(Number).filter((n) => Number.isFinite(n));
        if (messageIds.length === 0) return;
        try {
            const res = await fetch("/api/telegram/delete-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionString,
                    userId: contact.id,
                    accessHash: contact.accessHash,
                    messageIds,
                }),
            });
            const data = await res.json();
            if (res.ok && !data.error) {
                setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
            }
        } catch (err) {
            console.error(err);
        }
    }

    // Auto-mark-read while the chat is open: if a new incoming message arrives
    // and bumps this chat's unread (via the SSE stream), immediately clear it
    // both locally and on Telegram. Matches Telegram's own behaviour.
    const activeContactId = selectedContact?.id;
    const activeAccessHash = selectedContact?.accessHash;
    const liveUnreadForActive = activeContactId
        ? (unreadByChat[activeContactId] ?? 0)
        : 0;
    useEffect(() => {
        if (!activeContactId || liveUnreadForActive <= 0) return;
        markRead(activeContactId);
        void fetch("/api/telegram/mark-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionString,
                userId: activeContactId,
                accessHash: activeAccessHash,
            }),
        });
    }, [
        activeContactId,
        liveUnreadForActive,
        markRead,
        sessionString,
        activeAccessHash,
    ]);

    // Live updates: poll the open conversation every 3s. The ref keeps the
    // interval stable while always calling the latest closure.
    const pollRef = useRef<() => void>(() => { });
    pollRef.current = () => {
        if (selectedContact) {
            void loadConversation(
                selectedContact.id,
                selectedContact.accessHash,
                false,
            );
        }
    };
    useEffect(() => {
        const id = selectedContact?.id;
        if (!id) return;
        const interval = setInterval(() => pollRef.current(), 3000);
        return () => clearInterval(interval);
    }, [selectedContact?.id]);

    // Persist the open chat so a page refresh restores it.
    useEffect(() => {
        try {
            if (selectedContact) {
                window.localStorage.setItem(
                    SELECTED_CHAT_KEY,
                    JSON.stringify(selectedContact),
                );
            } else {
                window.localStorage.removeItem(SELECTED_CHAT_KEY);
            }
        } catch {
            // ignore
        }
    }, [selectedContact]);

    // On mount, load the conversation for a chat restored after a refresh.
    useEffect(() => {
        const c = selectedContact;
        if (!c) return;
        activeChatIdRef.current = c.id;
        void loadConversation(c.id, c.accessHash, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function closeChat() {
        activeChatIdRef.current = null;
        setSelectedContact(null);
        setMessages([]);
        setHasMoreOlder(true);
        setLoadingOlder(false);
        // Drop back to the chat sub-view so the next contact you open doesn't
        // land on the previous one's shared-media tab.
        setChatView("chat");
    }

    async function loadContacts(currentPage = 1, currentSearch = "") {
        try {
            setLoading(true);
            const res = await fetch("/api/telegram/recent-dialogs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionString, page: currentPage, limit: 30, search: currentSearch }),
            });
            const data = await res.json();
            setContacts(data.contacts || []);
            setTotalPages(data.totalPages || 1);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadContacts(page, search); }, [page, search]);

    async function openChat(contact: Contact) {
        // optimistically show chat immediately with basic info
        setSelectedContact({
            id: contact.id,
            accessHash: contact.accessHash,
            firstName: contact.firstName,
            lastName: contact.lastName,
            username: contact.username,
            phone: contact.phone,
            photo: contact.photo ?? null,
        });
        // Reset the conversation and start loading this chat's history.
        activeChatIdRef.current = contact.id;
        setMessages([]);
        setHasMoreOlder(true);
        setLoadingOlder(false);
        // New chat opens on the chat sub-view, not whichever tab the previous
        // contact was last on.
        setChatView("chat");
        void loadConversation(contact.id, contact.accessHash, true);

        // Mark the chat seen — clear its unread badge locally and server-side.
        // The stream will also emit a read-receipt delta shortly; markRead just
        // avoids the brief flash where the badge stays until then.
        setContacts((prev) =>
            prev.map((c) =>
                c.id === contact.id ? { ...c, unreadCount: 0 } : c,
            ),
        );
        markRead(contact.id);
        void fetch("/api/telegram/mark-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionString,
                userId: contact.id,
                accessHash: contact.accessHash,
            }),
        });

        // fetch full user details (online status, bio, etc.)
        try {
            const res = await fetch("/api/telegram/user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionString,
                    userId: contact.id,
                    accessHash: contact.accessHash,
                }),
            });
            const data = await res.json();
            // Ignore if the user switched chats while this was in flight.
            if (data.success && activeChatIdRef.current === contact.id) {
                // The /user response omits accessHash — keep the one we have.
                setSelectedContact({ ...data.user, accessHash: contact.accessHash });
            }
        } catch (err) {
            console.error(err);
        }
    }

    function getName(c: Contact) {
        return `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Unknown";
    }

    function handleSearch() { setPage(1); setSearch(searchInput); }
    function clearSearch() { setSearchInput(""); setSearch(""); setPage(1); }

    // ── Chat view ──────────────────────────────────────────────────────────────
    if (selectedContact) {
        return (
            <div className="flex flex-col h-full">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-stone-200 dark:border-zinc-800 shrink-0">
                    <button
                        onClick={closeChat}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-stone-500 dark:text-zinc-400 hover:text-indigo-500 transition-colors"
                    >
                        <ArrowLeft size={15} />
                        Contacts
                    </button>
                    <span className="text-stone-300 dark:text-zinc-600 text-sm">/</span>
                    <span className="text-[13px] font-medium text-stone-800 dark:text-zinc-200 truncate">
                        {`${selectedContact.firstName} ${selectedContact.lastName || ""}`.trim()}
                    </span>
                </div>

                {/* Chat / Media — both stay mounted (visibility-toggled) so
                    switching back and forth keeps each one's scroll + state. */}
                <div className="h-[calc(100%-61px)] flex justify-center">
                    <div className="w-full bg-amber-300 h-full flex flex-col relative"
                        style={{
                            backgroundImage: `
        linear-gradient(
            rgba(238,246,252,0.9),
            rgba(238,246,252,0.9)
        ),
        url("/telegram-bg.png")
    `,
                            backgroundRepeat: "repeat",
                            backgroundSize: "700px auto",
                        }}
                    >
                        <div
                            className={`absolute inset-0 ${chatView === "chat" ? "" : "invisible"}`}
                        >
                            <TelegramChat
                                //@ts-ignore
                                contact={selectedContact}
                                messages={messages}
                                onSendMessage={handleSendMessage}
                                onMediaSent={handleMediaSent}
                                onDeleteMessage={handleDeleteMessage}
                                isLoading={messagesLoading}
                                onLoadOlder={loadOlder}
                                hasMoreOlder={hasMoreOlder}
                                loadingOlder={loadingOlder}
                                sessionString={sessionString}
                                onViewMedia={() => setChatView("media")}
                            />
                        </div>
                        <div
                            className={`absolute inset-0 ${chatView === "media" ? "" : "invisible"}`}
                        >
                            <GroupMedia
                                session={sessionString}
                                groupId={selectedContact.id}
                                groupTitle={`${selectedContact.firstName} ${selectedContact.lastName || ""}`.trim()}
                                isUser
                                accessHash={selectedContact.accessHash}
                                onViewChat={() => setChatView("chat")}
                                mediaCache={userMediaCache}
                                onCacheUpdate={(key, entry) =>
                                    setUserMediaCache((prev) => ({
                                        ...prev,
                                        [key]: entry,
                                    }))
                                }
                            />
                        </div>
                    </div>
                </div>

            </div>
        );
    }

    // ── List / Grid view ───────────────────────────────────────────────────────
    return (
        <div className="flex h-full flex-col bg-stone-50 dark:bg-zinc-950">

            {/* ── Header ── */}
            <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-stone-200 dark:border-zinc-800/80 px-6 pt-5 pb-4 shadow-[0_1px_6px_0_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-[18px] font-semibold tracking-tight text-stone-900 dark:text-zinc-100 leading-tight">
                            Contacts
                        </h2>
                        <p className="text-[11px] font-mono text-stone-400 dark:text-zinc-500 mt-0.5">
                            Page {page} of {totalPages}
                        </p>
                    </div>

                    <div className="flex items-center gap-1 bg-stone-100 dark:bg-zinc-800 rounded-xl p-1 border border-stone-200 dark:border-zinc-800">
                        <button
                            onClick={() => setView("list")}
                            className={`flex items-center justify-center rounded-lg p-2 transition-all duration-150 ${view === "list"
                                ? "bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm border border-stone-200 dark:border-zinc-800"
                                : "text-stone-400 dark:text-zinc-500 hover:text-stone-600 dark:text-zinc-400"
                                }`}
                        >
                            <List size={15} />
                        </button>
                        <button
                            onClick={() => setView("grid")}
                            className={`flex items-center justify-center rounded-lg p-2 transition-all duration-150 ${view === "grid"
                                ? "bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-sm border border-stone-200 dark:border-zinc-800"
                                : "text-stone-400 dark:text-zinc-500 hover:text-stone-600 dark:text-zinc-400"
                                }`}
                        >
                            <LayoutGrid size={15} />
                        </button>
                    </div>
                </div>

                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-500 pointer-events-none" />
                        <input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder="Search contacts…"
                            className="w-full bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-800 text-stone-800 dark:text-zinc-200 text-[13.5px] placeholder-stone-400 rounded-xl py-2.5 pl-9 pr-9 outline-none transition-all focus:bg-white dark:bg-zinc-900 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                        />
                        {searchInput && (
                            <button
                                onClick={clearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-500 hover:text-stone-600 dark:text-zinc-400 transition-colors"
                            >
                                <X size={13} />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={handleSearch}
                        className="bg-indigo-500 hover:bg-indigo-600 active:scale-[0.97] text-white text-[13.5px] font-medium px-4 rounded-xl transition-all shadow-sm shadow-indigo-200 whitespace-nowrap"
                    >
                        Search
                    </button>
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-3">
                        <div className="w-6 h-6 rounded-full border-2 border-stone-200 dark:border-zinc-800 border-t-indigo-500 animate-spin" />
                        <span className="text-[13px] text-stone-400 dark:text-zinc-500">Loading contacts…</span>
                    </div>
                ) : contacts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-2">
                        <span className="text-3xl opacity-30">🔍</span>
                        <span className="text-[13px] text-stone-400 dark:text-zinc-500">No contacts found</span>
                    </div>
                ) : view === "list" ? (
                    <div className="py-2">
                        {contacts.map((contact) => {
                            const name = getName(contact);
                            const gradient = getAvatarGradient(name);
                            // Prefer the live stream value; fall back to the
                            // initial fetch so the badge isn't blank during the
                            // brief window before the stream's first snapshot.
                            const liveUnread =
                                unreadByChat[contact.id] ?? contact.unreadCount ?? 0;
                            // Prefer the live last-message preview from the
                            // SSE stream; fall back to the initial fetch.
                            const liveLast = lastByChat[contact.id]?.text;
                            const previewText =
                                liveLast ??
                                contact.lastMessage ??
                                (contact.username ? `@${contact.username}` : contact.phone);
                            return (
                                <div
                                    key={contact.id}
                                    onClick={() => openChat(contact)}
                                    className="flex items-center gap-3.5 px-6 py-3 hover:bg-white dark:hover:bg-zinc-800 dark:bg-zinc-900 transition-colors cursor-pointer border-b border-stone-100 dark:border-zinc-800 last:border-0"
                                >
                                    <ContactAvatar contact={contact} name={name} gradient={gradient} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[13.5px] font-medium text-stone-800 dark:text-zinc-200 truncate leading-tight">
                                            {name}
                                        </p>
                                        <p className="text-[11.5px] font-mono text-stone-400 dark:text-zinc-500 truncate mt-0.5">
                                            {previewText}
                                        </p>
                                    </div>
                                    {liveUnread > 0 && (
                                        <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[11px] font-semibold text-white">
                                            {liveUnread > 99 ? "99+" : liveUnread}
                                        </span>
                                    )}
                                    <button
                                        disabled={pinningId === contact.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void togglePin(contact);
                                        }}
                                        title={contact.pinMessage ? "Unpin chat" : "Pin chat"}
                                        className={`ml-2 relative flex items-center justify-center w-6 h-6 rounded-full cursor-pointer transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${pinningId === contact.id ? "opacity-60 cursor-not-allowed" : ""} ${contact.pinMessage
                                            ? "bg-indigo-500 text-white shadow-md shadow-indigo-200 hover:bg-indigo-600 focus-visible:ring-indigo-400 hover:scale-110 hover:shadow-indigo-300"
                                            : "bg-transparent text-slate-400 border border-slate-200 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50 focus-visible:ring-indigo-300 hover:scale-110"
                                            } active:scale-95`}
                                    >
                                        {pinningId === contact.id ? (
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        ) : contact.pinMessage ? (
                                            <PinOff size={11} strokeWidth={2.5} />
                                        ) : (
                                            <Pin size={11} strokeWidth={2.5} />
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-5">
                        {contacts.map((contact) => {
                            const name = getName(contact);
                            const gradient = getAvatarGradient(name);
                            const liveUnread =
                                unreadByChat[contact.id] ?? contact.unreadCount ?? 0;
                            const liveLast = lastByChat[contact.id]?.text;
                            const previewText =
                                liveLast ??
                                contact.lastMessage ??
                                (contact.username ? `@${contact.username}` : contact.phone);
                            return (
                                <div
                                    key={contact.id}
                                    onClick={() => openChat(contact)}
                                    className="relative bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl p-4 text-center cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-stone-200/80 hover:border-stone-300 dark:border-zinc-700 transition-all duration-150"
                                >
                                    {liveUnread > 0 && (
                                        <span className="absolute right-2 top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[11px] font-semibold text-white">
                                            {liveUnread > 99 ? "99+" : liveUnread}
                                        </span>
                                    )}
                                    <button
                                        disabled={pinningId === contact.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void togglePin(contact);
                                        }}
                                        title={contact.pinMessage ? "Unpin chat" : "Pin chat"}
                                        className={`absolute left-2 top-2 flex items-center justify-center w-6 h-6 rounded-full cursor-pointer transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${pinningId === contact.id ? "opacity-60 cursor-not-allowed" : ""} ${contact.pinMessage
                                            ? "bg-indigo-500 text-white shadow-md shadow-indigo-200 hover:bg-indigo-600 focus-visible:ring-indigo-400 hover:scale-110"
                                            : "bg-white/90 text-slate-400 border border-slate-200 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50 focus-visible:ring-indigo-300 hover:scale-110"
                                            } active:scale-95`}
                                    >
                                        {pinningId === contact.id ? (
                                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        ) : contact.pinMessage ? (
                                            <PinOff size={11} strokeWidth={2.5} />
                                        ) : (
                                            <Pin size={11} strokeWidth={2.5} />
                                        )}
                                    </button>
                                    <ContactAvatar
                                        contact={contact}
                                        name={name}
                                        gradient={gradient}
                                        size="lg"
                                        className="mx-auto mb-3"
                                    />
                                    <p className="text-[13px] font-medium text-stone-800 dark:text-zinc-200 truncate leading-tight">
                                        {name}
                                    </p>
                                    <p className="text-[11px] font-mono text-stone-400 dark:text-zinc-500 truncate mt-1">
                                        {previewText}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Pagination ── */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600 dark:text-zinc-400 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-800 px-3.5 py-2 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={14} />
                    Prev
                </button>

                <div className="flex items-center gap-1.5">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => (
                        <button
                            key={i}
                            onClick={() => setPage(i + 1)}
                            className={`rounded-full transition-all duration-200 ${i + 1 === page
                                ? "w-5 h-2 bg-indigo-500"
                                : "w-2 h-2 bg-stone-300 hover:bg-stone-400"
                                }`}
                        />
                    ))}
                </div>

                <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600 dark:text-zinc-400 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-800 px-3.5 py-2 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    Next
                    <ChevronRight size={14} />
                </button>
            </div>

            {toast && (
                <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4 sm:px-6">
                    <div
                        role="status"
                        className={`pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-2.5 text-[13px] font-medium leading-snug shadow-lg text-center wrap-break-word ${toast.kind === "success"
                            ? "bg-emerald-600 text-white"
                            : "bg-red-600 text-white"
                            }`}
                    >
                        {toast.message}
                    </div>
                </div>
            )}
        </div>
    );
}
