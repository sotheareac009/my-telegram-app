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
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleJoin}
        disabled={joining}
        className="w-full rounded-xl bg-[#3390ec] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2b7fd4] disabled:opacity-60"
      >
        {joining ? "Joining…" : `Join ${isChannel ? "Channel" : "Group"}`}
      </button>
      {joinError && (
        <span className="text-center text-[11px] text-red-500">
          {joinError}
        </span>
      )}
    </div>
  );

  // ── Preview mode — private invite, not a member, no readable history ──
  if (!chatId) {
    return (
     <div className="flex h-full justify-center bg-stone-100 dark:bg-zinc-900">
      <div className="flex h-full w-full max-w-[700px] flex-col bg-[#f0f2f5] shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
          <button
            onClick={onClose}
            className="text-[#8a9aaa] transition-colors hover:text-[#3390ec]"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="truncate text-[13px] font-medium text-stone-800">
            {target.title}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-3xl font-bold text-white shadow-lg">
            {target.title.charAt(0).toUpperCase()}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-stone-900">
              {target.title}
            </h2>
            {!!target.participants && (
              <p className="text-sm text-stone-500">
                {target.participants.toLocaleString()}{" "}
                {isChannel ? "subscribers" : "members"}
              </p>
            )}
            {target.about && (
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone-600">
                {target.about}
              </p>
            )}
          </div>
          <div className="w-full max-w-xs">{joinBanner}</div>
        </div>
      </div>
     </div>
    );
  }

  // ── Chat mode — render the message stream (read-only viewer) ──
  return (
    <div className="flex h-full justify-center bg-stone-100 dark:bg-zinc-900">
      <div className="flex h-full w-full max-w-[700px] flex-col shadow-sm">
        <TelegramChat
          contact={{
            id: chatId,
            firstName: target.title,
            lastSeen: isChannel ? "Channel" : "Group",
          }}
          messages={messages}
          onSendMessage={() => {}}
          onBack={onClose}
          isLoading={loading}
          onLoadOlder={loadOlder}
          hasMoreOlder={hasMoreOlder}
          loadingOlder={loadingOlder}
          sessionString={sessionString}
          readOnly
          isGroup
          banner={member ? undefined : joinBanner}
        />
      </div>
    </div>
  );
}
