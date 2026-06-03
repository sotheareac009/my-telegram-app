"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TelegramChat from "./TelegramChat";
import { useUnread } from "./UnreadContext";
import type {
  ChatMedia,
  ForwardInfo,
  LinkPreview,
  MessageReaction,
  TextEntity,
} from "@/app/api/telegram/conversation/route";

/** A resolved Telegram link the viewer should open. */
export interface GroupChatTarget {
  kind: "channel" | "group" | "invite-preview" | "user";
  /**
   * Marked chat id for channel/group; the user id for a `user` DM; absent for
   * invite-preview.
   */
  id?: string;
  title: string;
  /** Whether the account is already a member (channel/group only). */
  isMember?: boolean;
  /** `user` kind only — resolves the peer on a cold client. */
  accessHash?: string;
  /** invite-preview only. */
  about?: string;
  participants?: number;
  inviteHash?: string;
  isChannel?: boolean;
}

type ApiMessage = {
  id: number;
  text: string;
  date: number;
  fromMe: boolean;
  status?: "sent" | "read";
  media?: ChatMedia;
  groupedId?: string;
  senderId?: string;
  senderName?: string;
  forwardedFrom?: ForwardInfo;
  linkPreview?: LinkPreview;
  entities?: TextEntity[];
  reactions?: MessageReaction[];
};

type UiMessage = {
  id: string;
  text: string;
  timestamp: Date;
  fromMe: boolean;
  status?: "sent" | "delivered" | "read";
  media?: ChatMedia;
  groupedId?: string;
  senderId?: string;
  senderName?: string;
  forwardedFrom?: ForwardInfo;
  linkPreview?: LinkPreview;
  entities?: TextEntity[];
  reactions?: MessageReaction[];
};

function toUi(m: ApiMessage): UiMessage {
  return {
    id: String(m.id),
    text: m.text,
    timestamp: new Date(m.date * 1000),
    fromMe: m.fromMe,
    status: m.status,
    media: m.media,
    groupedId: m.groupedId,
    senderId: m.senderId,
    senderName: m.senderName,
    forwardedFrom: m.forwardedFrom,
    linkPreview: m.linkPreview,
    entities: m.entities,
    reactions: m.reactions,
  };
}

/** Union two message lists by id, sorted oldest → newest. */
function merge(a: UiMessage[], b: UiMessage[]): UiMessage[] {
  const map = new Map<string, UiMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort(
    (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
  );
}

export default function GroupChatView({
  sessionString,
  target,
  onClose,
  onViewMedia,
}: {
  sessionString: string;
  target: GroupChatTarget;
  onClose: () => void;
  /** When set, the chat header shows a button to open this chat's media grid. */
  onViewMedia?: () => void;
}) {
  // A `user` chat is a 1-to-1 DM — addressed by userId/accessHash and always
  // sendable (no join step, no read-only state).
  const isUser = target.kind === "user";
  const [chatId, setChatId] = useState<string | undefined>(target.id);
  // true | false | "pending" — "pending" while a membership check is still in
  // flight (a forward-origin chat opened without known membership), so the
  // Join button doesn't flash before the real answer arrives.
  const [member, setMember] = useState<boolean | "pending">(
    isUser ? true : (target.isMember ?? "pending"),
  );
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // Object URL for the chat's profile picture — fetched once per chatId and
  // threaded down to TelegramChat so its header Avatar shows the real photo
  // instead of the title-initial fallback.
  const [photo, setPhoto] = useState<string | null>(null);
  // True while the photo fetch is in flight — used together with `loading` to
  // gate the chat render so the header doesn't pop in after the messages.
  const [photoLoading, setPhotoLoading] = useState(true);
  // Discards in-flight fetches if the open chat changes (e.g. after joining).
  const activeRef = useRef<string | undefined>(chatId);

  const loadConversation = useCallback(
    async (id: string, initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const res = await fetch("/api/telegram/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isUser
              ? {
                  sessionString,
                  userId: id,
                  accessHash: target.accessHash,
                  limit: 60,
                  initial,
                }
              : {
                  sessionString,
                  chatId: id,
                  accessHash: target.accessHash,
                  limit: 60,
                  initial,
                },
          ),
        });
        const data = await res.json();
        if (activeRef.current !== id) return;
        // The route reports membership on initial load — used to hide the
        // Join button when the account is already in the chat.
        if (typeof data.isMember === "boolean") setMember(data.isMember);
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) =>
            merge(prev, (data.messages as ApiMessage[]).map(toUi)),
          );
          // Feed the newest message into the shared lastByChat so the
          // groups / channels / recent-chats lists update even when the SSE
          // stream skips deltas. Skip media-only messages (empty text) so
          // they don't blank out an existing preview.
          const newest = data.messages[
            data.messages.length - 1
          ] as ApiMessage;
          if (newest.text) {
            noteLastMessage(id, newest.text, newest.date);
          }
        }
      } catch {
        // ignore — keep whatever is already shown
      } finally {
        if (initial) setLoading(false);
      }
    },
    [sessionString, isUser, target.accessHash],
  );

  async function loadOlder() {
    const id = chatId;
    if (!id || loadingOlder || !hasMoreOlder) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await fetch("/api/telegram/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUser
            ? {
                sessionString,
                userId: id,
                accessHash: target.accessHash,
                limit: 50,
                offsetId: Number(oldest.id),
              }
            : {
                sessionString,
                chatId: id,
                accessHash: target.accessHash,
                limit: 50,
                offsetId: Number(oldest.id),
              },
        ),
      });
      const data = await res.json();
      if (activeRef.current !== id) return;
      const older = Array.isArray(data.messages)
        ? (data.messages as ApiMessage[]).map(toUi)
        : [];
      if (older.length < 50) setHasMoreOlder(false);
      if (older.length > 0) setMessages((prev) => merge(prev, older));
    } catch {
      // ignore
    } finally {
      setLoadingOlder(false);
    }
  }

  // Load on mount and whenever the chat id becomes available (after joining
  // a private invite). In preview mode (no chatId) there's nothing to load —
  // `loading` is irrelevant since the preview card renders instead.
  useEffect(() => {
    if (!chatId) return;
    activeRef.current = chatId;
    void loadConversation(chatId, true);
  }, [chatId, loadConversation]);

  // Auto-mark-read while the chat is open: if a new incoming message arrives
  // and bumps this chat's unread (via the SSE stream), immediately clear it
  // both locally and on Telegram. Matches the official client's behaviour —
  // you don't carry an unread badge for messages you literally just read.
  const { perChat: unreadByChat, markRead, noteLastMessage } = useUnread();
  const unreadForThisChat = chatId ? (unreadByChat[chatId] ?? 0) : 0;
  useEffect(() => {
    if (!chatId || unreadForThisChat <= 0) return;
    markRead(chatId);
    void fetch("/api/telegram/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isUser
          ? {
              sessionString,
              userId: chatId,
              accessHash: target.accessHash,
            }
          : { sessionString, chatId },
      ),
    });
  }, [
    chatId,
    unreadForThisChat,
    markRead,
    sessionString,
    isUser,
    target.accessHash,
  ]);

  // Fetch the chat's profile picture once per chatId. The API returns a JPEG
  // blob; we wrap it in an object URL so the Avatar can render it. Cleaned up
  // on unmount / chat switch so we don't leak the previous chat's blob.
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    const peerType: "channel" | "user" = isUser ? "user" : "channel";
    setPhotoLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/telegram/dialog-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionString,
            groupId: chatId,
            accessHash: target.accessHash,
            peerType,
          }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setPhoto(createdUrl);
      } catch {
        // ignore — Avatar will fall back to the title initial
      } finally {
        // Whether the fetch succeeded or 404'd, the loading gate must lift so
        // chats with no profile photo aren't stuck on the spinner.
        if (!cancelled) setPhotoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setPhoto(null);
    };
  }, [chatId, sessionString, isUser, target.accessHash]);

  // Poll for new messages every 5s.
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    if (chatId) void loadConversation(chatId, false);
  };
  useEffect(() => {
    if (!chatId) return;
    const interval = setInterval(() => pollRef.current(), 5000);
    return () => clearInterval(interval);
  }, [chatId]);

  // Send a message into the group/channel. Only reachable once `member` is
  // true (the composer is hidden otherwise). The optimistic message returned
  // by the API is merged in; the 5s poll reconciles anything that diverges.
  async function handleSend(text: string) {
    const id = chatId;
    if (!id) return;
    // Optimistic list-preview bump — Telegram doesn't deliver own-sends back
    // to this session via the update stream, so the SSE-driven preview won't
    // change for messages you send from here unless we update it ourselves.
    noteLastMessage(id, text);
    try {
      const res = await fetch("/api/telegram/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUser
            ? { sessionString, userId: id, accessHash: target.accessHash, text }
            : { sessionString, chatId: id, text },
        ),
      });
      const data = await res.json();
      if (data.message && activeRef.current === id) {
        setMessages((prev) => merge(prev, [toUi(data.message)]));
        if (typeof data.message.date === "number") {
          noteLastMessage(id, text, data.message.date);
        }
      }
    } catch {
      // ignore — the poll will pick the message up if it actually sent
    }
  }

  // Pull the just-sent media in immediately (TelegramChat handles the upload
  // itself so it can show live progress on the preview thumbnails).
  function handleMediaSent() {
    const id = chatId;
    if (!id || activeRef.current !== id) return;
    void loadConversation(id, false);
  }

  // Delete one or more messages. Telegram enforces permissions server-side, so
  // the messages are only dropped from the view when the API confirms success;
  // a disallowed delete leaves them in place.
  async function handleDelete(ids: string[]) {
    const id = chatId;
    if (!id || ids.length === 0) return;
    const messageIds = ids.map(Number).filter((n) => Number.isFinite(n));
    if (messageIds.length === 0) return;
    try {
      const res = await fetch("/api/telegram/delete-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUser
            ? {
                sessionString,
                userId: id,
                accessHash: target.accessHash,
                messageIds,
              }
            : { sessionString, chatId: id, messageIds },
        ),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      }
    } catch {
      // ignore — the message stays if the delete didn't go through
    }
  }

  async function handleJoin() {
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch("/api/telegram/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target.inviteHash
            ? { sessionString, inviteHash: target.inviteHash }
            : {
                sessionString,
                chatId,
                // Pass accessHash so the server can build an InputChannel
                // directly — avoids "Could not find the input entity" on a
                // cold gramjs client when joining via the forward-modal
                // profile preview.
                accessHash: target.accessHash,
              },
        ),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setJoinError(data.error || "Failed to join");
        return;
      }
      setMember(true);
      // A private invite has no id until we join — adopt the joined chat's id,
      // which kicks off the message load.
      if (!chatId && data.id) setChatId(String(data.id));
    } catch {
      setJoinError("Failed to join");
    } finally {
      setJoining(false);
    }
  }

  const isChannel = target.kind === "channel" || target.isChannel === true;

  const joinBanner = (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleJoin}
        disabled={joining}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:-translate-y-0.5 hover:shadow-blue-500/40 disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
      >
        {joining ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Joining…
          </>
        ) : (
          <>
            Join {isChannel ? "Channel" : "Group"}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </>
        )}
      </button>
      {joinError && (
        <span className="text-center text-[11px] font-medium text-red-500">
          {joinError}
        </span>
      )}
    </div>
  );

  // ── Preview mode — private invite, not a member, no readable history ──
  if (!chatId) {
    return (
      <div className="relative flex h-full justify-center overflow-hidden bg-gradient-to-b from-white via-blue-50/40 to-cyan-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950">
        {/* Background orbs */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-blue-300/30 blur-[120px] dark:bg-blue-500/10" />
          <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-cyan-300/25 blur-[100px] dark:bg-cyan-500/10" />
        </div>
        <div className="flex h-full w-full max-w-[700px] flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-zinc-200/70 bg-white/70 px-4 py-3 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-900/60">
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-blue-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-blue-400"
              aria-label="Back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {target.title}
            </span>
          </div>
          {/* Body */}
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-3xl border border-zinc-200/80 bg-white/80 p-8 text-center shadow-xl shadow-blue-500/10 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:shadow-black/30">
              {/* Avatar with glow */}
              <div className="relative mx-auto w-fit">
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-cyan-400 text-4xl font-bold text-white shadow-lg shadow-blue-500/30">
                  {target.title.charAt(0).toUpperCase()}
                </div>
                <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-blue-500 to-cyan-400 opacity-30 blur-xl" />
              </div>
              <h2 className="mt-5 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                {target.title}
              </h2>
              {!!target.participants && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {target.participants.toLocaleString()}{" "}
                  {isChannel ? "subscribers" : "members"}
                </div>
              )}
              {target.about && (
                <p className="mt-4 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {target.about}
                </p>
              )}
              <div className="mt-6">{joinBanner}</div>
              <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                You&apos;re previewing this {isChannel ? "channel" : "group"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat mode — render the message stream ──
  // Members get a live composer; non-members see the Join banner instead and
  // the stream stays read-only until they join.
  // Hold the whole chat behind a spinner until BOTH the conversation and the
  // profile photo finish loading — avoids the header avatar popping in after
  // the message list is already up.
  if (loading || photoLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-b from-zinc-100 via-blue-50/40 to-zinc-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500 dark:border-zinc-700 dark:border-t-blue-400" />
          <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
            Loading {isChannel ? "channel" : isUser ? "chat" : "group"}…
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex h-full justify-center overflow-hidden bg-gradient-to-b from-zinc-100 via-blue-50/40 to-zinc-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950">
      {/* Soft background glow behind the chat panel */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-72 w-[640px] -translate-x-1/2 rounded-full bg-blue-300/20 blur-[120px] dark:bg-blue-500/10" />
      </div>
      <div className="flex h-full w-full flex-col overflow-hidden shadow-xl shadow-blue-500/5 ring-1 ring-black/5 dark:shadow-black/30 dark:ring-white/5"
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
        <TelegramChat
          contact={{
            id: chatId,
            accessHash: isUser ? target.accessHash : undefined,
            firstName: target.title,
            lastSeen: isUser ? undefined : isChannel ? "Channel" : "Group",
            photo,
          }}
          messages={messages}
          onSendMessage={handleSend}
          onMediaSent={handleMediaSent}
          onDeleteMessage={handleDelete}
          onBack={onClose}
          isLoading={loading}
          onLoadOlder={loadOlder}
          hasMoreOlder={hasMoreOlder}
          loadingOlder={loadingOlder}
          sessionString={sessionString}
          readOnly={member !== true}
          isGroup={!isUser}
          banner={member === false ? joinBanner : undefined}
          onViewMedia={onViewMedia}
        />
      </div>
    </div>
  );
}
