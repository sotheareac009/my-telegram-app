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

export interface LastMessage {
  text: string;
  date: number;
}

export interface UnreadState {
  users: number;
  groups: number;
  channels: number;
  /** Per-chat unread count keyed by the marked id used elsewhere in the app
   * (user id for DMs, "-…" for groups, "-100…" for channels). */
  perChat: Record<string, number>;
  /** Per-chat preview of the most recent message (text + date) — drives live
   * "last message" updates in the recent-chats and contacts lists. */
  lastByChat: Record<string, LastMessage>;
}

export interface UnreadContextValue extends UnreadState {
  /** Optimistically zero out a chat's unread when the user opens it. The
   * server will follow up with the real UpdateReadHistoryInbox event anyway,
   * but this prevents a brief flash where the badge persists. */
  markRead: (chatId: string) => void;
  /** Push the latest message preview for a chat. Used after the user sends a
   * message from THIS client — Telegram doesn't echo own-sends back to the
   * source session, so the SSE stream never sees them. Date defaults to "now"
   * so the entry sorts above any historical fallback. */
  noteLastMessage: (chatId: string, text: string, date?: number) => void;
}

const ZERO: UnreadState = {
  users: 0,
  groups: 0,
  channels: 0,
  perChat: {},
  lastByChat: {},
};

const UnreadCtx = createContext<UnreadContextValue>({
  ...ZERO,
  markRead: () => {},
  noteLastMessage: () => {},
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
  lastByChat?: Record<string, LastMessage>;
}

interface DeltaEvent {
  kind: "delta";
  chatId: string;
  bucket: "users" | "groups" | "channels";
  unread: number;
}

interface LastMessageEvent {
  kind: "lastMessage";
  chatId: string;
  text: string;
  date: number;
}

interface ErrorEvent {
  kind: "error";
  message: string;
}

type StreamEvent =
  | SnapshotEvent
  | DeltaEvent
  | LastMessageEvent
  | ErrorEvent
  | { kind: "heartbeat" };

/** Imperative handle so code outside the provider (e.g. Dashboard, which
 * mounts the provider itself) can still call markRead optimistically. */
export interface UnreadHandle {
  markRead: (chatId: string) => void;
}

export function UnreadProvider({
  sessionString,
  apiRef,
  loadingFallback,
  loadingTimeoutMs = 4000,
  children,
}: {
  sessionString: string;
  /** Optional ref the provider writes its imperative API into on mount. */
  apiRef?: React.RefObject<UnreadHandle | null>;
  /** Element rendered while the initial unread snapshot is loading. When
   * omitted, children render immediately (legacy behaviour). */
  loadingFallback?: React.ReactNode;
  /** How long to wait for the initial snapshot before giving up and rendering
   * the app anyway (without populated badges). Ignored when no loadingFallback
   * is supplied. */
  loadingTimeoutMs?: number;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<UnreadState>(ZERO);
  // `ready` gates rendering of children when loadingFallback is supplied.
  // Becomes true on the first snapshot event, on a stream error, or when the
  // timeout fires — whichever happens first.
  const [ready, setReady] = useState(!loadingFallback);
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

  const noteLastMessage = useCallback(
    (chatId: string, text: string, date?: number) => {
      const stamp = date && date > 0 ? date : Math.floor(Date.now() / 1000);
      setState((prev) => {
        const existing = prev.lastByChat[chatId];
        // Defensive: don't overwrite a strictly newer entry.
        if (existing && existing.date > stamp) return prev;
        return {
          ...prev,
          lastByChat: {
            ...prev.lastByChat,
            [chatId]: { text: text.slice(0, 80), date: stamp },
          },
        };
      });
    },
    [],
  );

  // Expose markRead through the imperative ref so a parent that itself
  // renders this provider (e.g. Dashboard) can clear a bucket optimistically.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { markRead };
    return () => {
      if (apiRef.current?.markRead === markRead) apiRef.current = null;
    };
  }, [apiRef, markRead]);

  useEffect(() => {
    if (!sessionString) {
      setState(ZERO);
      return;
    }
    let cancelled = false;
    let abort: AbortController | null = null;
    let backoff = 500;

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
          backoff = 500;
          await readStream(res.body);
        } catch (err) {
          if (cancelled) return;
          if ((err as { name?: string }).name === "AbortError") {
            // Either intentional cleanup or a visibility-triggered reconnect —
            // loop back and reconnect immediately without backoff.
            continue;
          }
          // Stream failed before we got a snapshot — unblock the UI anyway so
          // the app isn't stuck on the spinner. Badges render as 0 until the
          // retry succeeds.
          setReady(true);
          // Network blip or server restart — back off then retry. Cap at 15 s
          // so a backgrounded mobile WebView recovers quickly when foregrounded.
          await new Promise((resolve) => setTimeout(resolve, backoff));
          backoff = Math.min(15_000, backoff * 2);
        }
      }
    }

    // Mobile WebViews freeze network when the app is backgrounded and the
    // SSE connection often comes back dead. Force a reconnect whenever the
    // document becomes visible again so the user sees fresh state in <1s.
    function onVisible() {
      if (document.visibilityState === "visible" && !cancelled) {
        abort?.abort();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

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
        // The snapshot can fire again on reconnect (Telegram drops the
        // stream's gramjs client when another route opens a session, then
        // we reconnect). The server's seed lastByChat is whatever getDialogs
        // saw at that moment — often older than an optimistic noteLastMessage
        // or an incoming delta we already applied. Merge per-chat by date so
        // a stale seed doesn't clobber newer entries.
        setState((prev) => {
          const incoming = event.lastByChat ?? {};
          const mergedLast: Record<string, LastMessage> = { ...prev.lastByChat };
          for (const [id, m] of Object.entries(incoming)) {
            const cur = mergedLast[id];
            if (!cur || (m.date ?? 0) >= (cur.date ?? 0)) {
              mergedLast[id] = m;
            }
          }
          return {
            users: event.users,
            groups: event.groups,
            channels: event.channels,
            perChat: { ...event.perChat },
            lastByChat: mergedLast,
          };
        });
        // First snapshot arrived — unblock the gated UI.
        setReady(true);
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
      } else if (event.kind === "lastMessage") {
        // Update the chat's preview text — drives the live "last message"
        // line in the recent-chats / contacts lists.
        setState((prev) => {
          const existing = prev.lastByChat[event.chatId];
          // Skip if we already have a newer one (defensive against out-of-
          // order arrival).
          if (existing && event.date > 0 && existing.date >= event.date) {
            return prev;
          }
          return {
            ...prev,
            lastByChat: {
              ...prev.lastByChat,
              [event.chatId]: { text: event.text, date: event.date },
            },
          };
        });
      }
      // heartbeat / error are ignored client-side — the reconnect loop
      // handles any actual error by retrying.
    }

    void connect();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      abort?.abort();
    };
  }, [sessionString]);

  // Safety net: if the snapshot never arrives (slow Telegram, dropped
  // connection before first event, etc.), unblock the UI after the timeout
  // so the app isn't held hostage by an unresponsive stream.
  useEffect(() => {
    if (!loadingFallback) return;
    if (ready) return;
    const timer = setTimeout(() => setReady(true), loadingTimeoutMs);
    return () => clearTimeout(timer);
  }, [loadingFallback, loadingTimeoutMs, ready]);

  const value = useMemo<UnreadContextValue>(
    () => ({ ...state, markRead, noteLastMessage }),
    [state, markRead, noteLastMessage],
  );

  if (loadingFallback && !ready) {
    return <>{loadingFallback}</>;
  }

  return <UnreadCtx.Provider value={value}>{children}</UnreadCtx.Provider>;
}
