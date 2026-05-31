/**
 * Bridge between mark-read (and similar mutation routes) and the long-lived
 * SSE update stream's in-memory snapshot.
 *
 * The stream's gramjs client gets bumped off Telegram when another route
 * opens its own connection on the same session (Telegram allows one MTProto
 * connection per session). The bumped client misses `UpdateReadHistoryInbox`,
 * so without an explicit nudge the stream's snapshot stays stale until the
 * 30 s resync catches up — a hard refresh in that window re-paints the
 * old badge. This helper lets the mutating route reach into the same shared
 * map (stashed on `globalThis` by the stream route for dev hot-reload safety)
 * and clear the chat itself, emitting a `delta: 0` to every connected client.
 */

type Bucket = "users" | "groups" | "channels";

interface ChatMeta {
  bucket: Bucket;
  markedId: string;
}

interface UnreadSnapshot {
  users: number;
  groups: number;
  channels: number;
  perChat: Record<string, number>;
  lastByChat: Record<string, { text: string; date: number }>;
}

interface ClientEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  snapshot: UnreadSnapshot;
  meta: Map<string, ChatMeta>;
  listeners: Set<(event: unknown) => void>;
}

type GlobalWithCache = typeof globalThis & {
  __tgUpdateClients?: Map<string, ClientEntry>;
};

/** Return the long-lived gramjs client backing this session's SSE stream,
 * if one exists. Lets other routes (e.g. sticker-file downloads) piggyback
 * on the already-connected socket instead of paying TCP + handshake cost
 * for every request. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSharedClient(sessionString: string): any | null {
  return (
    (globalThis as GlobalWithCache).__tgUpdateClients?.get(sessionString)
      ?.client ?? null
  );
}

/** Clear a chat's unread state in the SSE stream's snapshot and emit a delta
 * to every connected listener. Best-effort — does nothing if no stream entry
 * exists for this session (e.g. no tab is subscribed). */
export function notifyChatRead(
  sessionString: string,
  markedId: string,
): void {
  try {
    const entry = (globalThis as GlobalWithCache).__tgUpdateClients?.get(
      sessionString,
    );
    if (!entry) return;
    const cur = entry.snapshot.perChat[markedId] ?? 0;
    if (cur === 0) return;
    const meta = entry.meta.get(markedId);
    const bucket: Bucket = meta?.bucket ?? "users";
    entry.snapshot[bucket] = Math.max(0, entry.snapshot[bucket] - cur);
    delete entry.snapshot.perChat[markedId];
    for (const listener of entry.listeners) {
      try {
        listener({ kind: "delta", chatId: markedId, bucket, unread: 0 });
      } catch {
        // a single bad subscriber shouldn't take the others down
      }
    }
  } catch {
    // best-effort — the 30 s resync will eventually reconcile
  }
}
