"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Live unread state, fed by the /api/telegram/updates/stream NDJSON endpoint.
 * One stream per Dashboard mount — Sidebar badges + Recent Chats unread chips
 * both read from the same context so they update in lock-step with Telegram's
 * own updates.
 *
 * The stream is auto-reconnecting: any drop fires a fresh fetch after a short
 * backoff and the server resends its `snapshot` event, so we never end up
 * silently stale.
 */

export interface UnreadState {
  users: number;
  groups: number;
  channels: number;
  /** Per-chat unread count keyed by the marked id used elsewhere in the app
   * (user id for DMs, "-…" for groups, "-100…" for channels). */
  perChat: Record<string, number>;
}

export interface UnreadContextValue extends UnreadState {
  /** Optimistically zero out a chat's unread when the user opens it. The
   * server will follow up with the real UpdateReadHistoryInbox event anyway,
   * but this prevents a brief flash where the badge persists. */
  markRead: (chatId: string) => void;
}

const ZERO: UnreadState = { users: 0, groups: 0, channels: 0, perChat: {} };

const UnreadCtx = createContext<UnreadContextValue>({
  ...ZERO,
  markRead: () => {},
});

export function useUnread(): UnreadContextValue {
  return useContext(UnreadCtx);
}

interface SnapshotEvent {
  kind: "snapshot";
  users: number;
  groups: number;
  channels: number;
  perChat: Record<string, number>;
}

interface DeltaEvent {
  kind: "delta";
  chatId: string;
  bucket: "users" | "groups" | "channels";
  unread: number;
}

interface ErrorEvent {
  kind: "error";
  message: string;
}

type StreamEvent =
  | SnapshotEvent
  | DeltaEvent
  | ErrorEvent
  | { kind: "heartbeat" };

export function UnreadProvider({
  sessionString,
  children,
}: {
  sessionString: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<UnreadState>(ZERO);
  // Keep the latest state in a ref so the streaming closure can apply deltas
  // without needing to re-subscribe on every change.
  const stateRef = useRef(state);
  stateRef.current = state;

  const markRead = useCallback((chatId: string) => {
    setState((prev) => {
      const cur = prev.perChat[chatId];
      if (!cur) return prev;
      const nextPerChat = { ...prev.perChat };
      delete nextPerChat[chatId];
      // We don't know which bucket this id belongs to from the id alone, so
      // walk the convention: user ids are positive, marked group/channel ids
      // are negative. The server's next delta will reconcile if we guess
      // wrong on an edge case.
      const isMarked = chatId.startsWith("-");
      const isChannel = chatId.startsWith("-100");
      const bucket: keyof UnreadState = isChannel
        ? "channels"
        : isMarked
          ? "groups"
          : "users";
      return {
        ...prev,
        [bucket]: Math.max(0, (prev[bucket] as number) - cur),
        perChat: nextPerChat,
      };
    });
  }, []);

  useEffect(() => {
    if (!sessionString) {
      setState(ZERO);
      return;
    }
    let cancelled = false;
    let abort: AbortController | null = null;
    let backoff = 1000;

    async function connect() {
      while (!cancelled) {
        abort = new AbortController();
        try {
          const res = await fetch("/api/telegram/updates/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionString }),
            signal: abort.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`stream returned ${res.status}`);
          }
          backoff = 1000;
          await readStream(res.body);
        } catch (err) {
          if (cancelled) return;
          if ((err as { name?: string }).name === "AbortError") return;
          // Network blip or server restart — back off then retry. Cap at 30 s
          // so a sleeping laptop doesn't take forever to recover on wake.
          await new Promise((resolve) => setTimeout(resolve, backoff));
          backoff = Math.min(30_000, backoff * 2);
        }
      }
    }

    async function readStream(body: ReadableStream<Uint8Array>) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          applyEvent(event);
        }
      }
    }

    function applyEvent(event: StreamEvent) {
      if (event.kind === "snapshot") {
        setState({
          users: event.users,
          groups: event.groups,
          channels: event.channels,
          perChat: { ...event.perChat },
        });
      } else if (event.kind === "delta") {
        setState((prev) => {
          const cur = prev.perChat[event.chatId] ?? 0;
          const next = Math.max(0, event.unread);
          if (cur === next) return prev;
          const nextPerChat = { ...prev.perChat };
          if (next === 0) delete nextPerChat[event.chatId];
          else nextPerChat[event.chatId] = next;
          return {
            ...prev,
            [event.bucket]: Math.max(0, (prev[event.bucket] as number) - cur + next),
            perChat: nextPerChat,
          };
        });
      }
      // heartbeat / error are ignored client-side — the reconnect loop
      // handles any actual error by retrying.
    }

    void connect();

    return () => {
      cancelled = true;
      abort?.abort();
    };
  }, [sessionString]);

  const value = useMemo<UnreadContextValue>(
    () => ({ ...state, markRead }),
    [state, markRead],
  );

  return <UnreadCtx.Provider value={value}>{children}</UnreadCtx.Provider>;
}
