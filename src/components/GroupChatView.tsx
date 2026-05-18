"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TelegramChat from "./TelegramChat";
import type { ChatMedia } from "@/app/api/telegram/conversation/route";

/** A resolved Telegram link the viewer should open. */
export interface GroupChatTarget {
  kind: "channel" | "group" | "invite-preview";
  /** Marked chat id — present for channel/group; absent for invite-preview. */
  id?: string;
  title: string;
  /** Whether the account is already a member (channel/group only). */
  isMember?: boolean;
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
}: {
  sessionString: string;
  target: GroupChatTarget;
  onClose: () => void;
}) {
  const [chatId, setChatId] = useState<string | undefined>(target.id);
  const [member, setMember] = useState<boolean>(target.isMember ?? false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // Discards in-flight fetches if the open chat changes (e.g. after joining).
  const activeRef = useRef<string | undefined>(chatId);

  const loadConversation = useCallback(
    async (id: string, initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const res = await fetch("/api/telegram/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString, chatId: id, limit: 60 }),
        });
        const data = await res.json();
        if (activeRef.current !== id) return;
        if (Array.isArray(data.messages)) {
          setMessages((prev) =>
            merge(prev, (data.messages as ApiMessage[]).map(toUi)),
          );
        }
      } catch {
        // ignore — keep whatever is already shown
      } finally {
        if (initial) setLoading(false);
      }
    },
    [sessionString],
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
        body: JSON.stringify({
          sessionString,
          chatId: id,
          limit: 50,
          offsetId: Number(oldest.id),
        }),
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
    try {
      const res = await fetch("/api/telegram/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString, chatId: id, text }),
      });
      const data = await res.json();
      if (data.message && activeRef.current === id) {
        setMessages((prev) => merge(prev, [toUi(data.message)]));
      }
    } catch {
      // ignore — the poll will pick the message up if it actually sent
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
            : { sessionString, chatId },
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
  return (
    <div className="relative flex h-full justify-center overflow-hidden bg-gradient-to-b from-zinc-100 via-blue-50/40 to-zinc-100 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950">
      {/* Soft background glow behind the chat panel */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-72 w-[640px] -translate-x-1/2 rounded-full bg-blue-300/20 blur-[120px] dark:bg-blue-500/10" />
      </div>
      <div className="flex h-full w-full max-w-[700px] flex-col overflow-hidden shadow-xl shadow-blue-500/5 ring-1 ring-black/5 dark:shadow-black/30 dark:ring-white/5">
        <TelegramChat
          contact={{
            id: chatId,
            firstName: target.title,
            lastSeen: isChannel ? "Channel" : "Group",
          }}
          messages={messages}
          onSendMessage={handleSend}
          onBack={onClose}
          isLoading={loading}
          onLoadOlder={loadOlder}
          hasMoreOlder={hasMoreOlder}
          loadingOlder={loadingOlder}
          sessionString={sessionString}
          readOnly={!member}
          isGroup
          banner={member ? undefined : joinBanner}
        />
      </div>
    </div>
  );
}
