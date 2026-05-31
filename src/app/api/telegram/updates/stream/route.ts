import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live unread-count stream. The browser opens one of these per tab and stays
 * subscribed; the server keeps a single gramjs client per session string and
 * forwards Telegram's updates (new messages, read events) as NDJSON deltas.
 *
 * Event shapes:
 *   {"kind":"snapshot","users":N,"groups":N,"channels":N,"perChat":{id:N}}
 *   {"kind":"delta","chatId":"…","bucket":"users"|"groups"|"channels","unread":N}
 *   {"kind":"heartbeat"}
 *   {"kind":"error","message":"…"}
 */

type Bucket = "users" | "groups" | "channels";

interface ChatMeta {
  bucket: Bucket;
  /** Marked id used by the rest of the app to address this chat. */
  markedId: string;
}

interface LastMessage {
  /** Plain-text message body, capped at 80 chars to match
   * /api/telegram/recent-dialogs's format. Empty when the message had no text
   * (e.g. a photo with no caption). */
  text: string;
  date: number;
}

interface UnreadSnapshot {
  users: number;
  groups: number;
  channels: number;
  perChat: Record<string, number>;
  /** Latest message preview per chat, keyed by marked id. Drives the recent
   * chats / contacts list previews so they refresh while the user is reading
   * the open chat. */
  lastByChat: Record<string, LastMessage>;
}

interface ClientEntry {
  client: TelegramClient;
  refs: number;
  /** Pending disconnect timeout — cancelled if a new listener subscribes
   * before it fires. */
  shutdownTimer: ReturnType<typeof setTimeout> | null;
  /** Last known unread state, kept in sync with Telegram updates. */
  snapshot: UnreadSnapshot;
  /** Maps the various peer id forms (raw id, marked id) to their bucket so
   * an UpdateReadHistoryInbox can find the right counter. Populated from the
   * initial getDialogs and refreshed on demand for new dialogs. */
  meta: Map<string, ChatMeta>;
  /** Live SSE subscribers — each receives every delta. */
  listeners: Set<(event: unknown) => void>;
  /** The detach function returned by addEventHandler so we can unsubscribe
   * cleanly on shutdown. */
  removeUpdateHandler: (() => void) | null;
  /** Safety-net resync that re-runs getDialogs every 30 s so any updates the
   * live stream missed (e.g. while other API routes were briefly the active
   * gramjs connection) still surface within half a minute. */
  resyncTimer: ReturnType<typeof setInterval> | null;
}

// Dev hot-reload safe — the module gets re-evaluated on file changes, so
// stash the cache on globalThis. In production the module evaluates once.
type GlobalWithCache = typeof globalThis & {
  __tgUpdateClients?: Map<string, ClientEntry>;
};
const globalAny = globalThis as GlobalWithCache;
const clients: Map<string, ClientEntry> =
  globalAny.__tgUpdateClients ?? new Map();
globalAny.__tgUpdateClients = clients;

/** Compute the bucket + marked id for a dialog/entity. */
function classify(entity: unknown):
  | (ChatMeta & { unread: number })
  | null {
  // Library calls back with the entity directly off the dialog — use a
  // duck-typed instanceof so we don't trip TypeScript on `unknown`.
  if (entity instanceof Api.User) {
    if (entity.self) return null;
    return {
      bucket: "users",
      markedId: entity.id.toString(),
      unread: 0,
    };
  }
  if (entity instanceof Api.Channel) {
    // Telegram marks channel ids with a "-100" prefix so the rest of the app
    // can distinguish them from basic group / user ids.
    return {
      bucket: entity.broadcast ? "channels" : "groups",
      markedId: `-100${entity.id.toString()}`,
      unread: 0,
    };
  }
  if (entity instanceof Api.Chat) {
    return {
      bucket: "groups",
      markedId: `-${entity.id.toString()}`,
      unread: 0,
    };
  }
  return null;
}

/** Look up an existing meta entry by any id form we might receive in an
 * update (raw, marked, or the channel id from UpdateReadChannelInbox). */
function findMeta(entry: ClientEntry, candidates: string[]): ChatMeta | null {
  for (const c of candidates) {
    const m = entry.meta.get(c);
    if (m) return m;
  }
  return null;
}

/** Derive meta from a raw peer when we haven't seen the chat before — covers
 * the case where the user starts a brand-new conversation that wasn't in the
 * initial getDialogs snapshot. We optimistically assign a bucket from the peer
 * kind; PeerChannel could be either a broadcast channel or a supergroup, so we
 * pick "channels" by default and let the next snapshot/refresh correct it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaFromPeer(peer: any): ChatMeta | null {
  if (!peer) return null;
  if (peer instanceof Api.PeerUser) {
    const id = peer.userId.toString();
    return { bucket: "users", markedId: id };
  }
  if (peer instanceof Api.PeerChat) {
    const id = peer.chatId.toString();
    return { bucket: "groups", markedId: `-${id}` };
  }
  if (peer instanceof Api.PeerChannel) {
    const id = peer.channelId.toString();
    return { bucket: "channels", markedId: `-100${id}` };
  }
  return null;
}

/** Find an existing meta entry, or create + index a new one from the peer
 * descriptor we received with the update. Returns null only if the peer is
 * malformed. */
function ensureMeta(
  entry: ClientEntry,
  candidates: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  peer: any,
): ChatMeta | null {
  const existing = findMeta(entry, candidates);
  if (existing) return existing;
  const fresh = metaFromPeer(peer);
  if (!fresh) return null;
  for (const c of candidates) entry.meta.set(c, fresh);
  entry.meta.set(fresh.markedId, fresh);
  return fresh;
}

/** Walk the dialog list and reconcile any drift between Telegram's actual
 * per-chat unread + last message and our in-memory snapshot. Emits a delta
 * (unread) or lastMessage event for each chat that changed so the browser's
 * badges and previews resync. */
async function resyncSnapshot(entry: ClientEntry): Promise<void> {
  const dialogs = await entry.client.getDialogs({ limit: 1000 });
  const seen = new Set<string>();
  for (const d of dialogs) {
    const info = classify(d.entity);
    if (!info) continue;
    const unread = d.unreadCount ?? 0;
    seen.add(info.markedId);
    if (!entry.meta.has(info.markedId)) {
      entry.meta.set(info.markedId, {
        bucket: info.bucket,
        markedId: info.markedId,
      });
    }
    setUnread(entry, info.markedId, info.bucket, unread);
    // Reconcile the last-message preview too. If the stream's live
    // NewMessage handler missed events (because another route briefly owned
    // the gramjs connection), getDialogs still has the up-to-date last
    // message — emit a lastMessage delta so the list previews catch up.
    // Skip media-only messages whose text is empty so they don't blank out
    // an existing preview.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dMsg = (d.message as any)?.message;
    const dDate = d.date ?? 0;
    if (typeof dMsg === "string" && dMsg.length > 0) {
      updateLastMessage(entry, info.markedId, dMsg, dDate);
    }
  }
  // Anything in perChat that no longer appears in dialogs (left chat, etc.)
  // gets zeroed out so the badge isn't stuck.
  for (const markedId of Object.keys(entry.snapshot.perChat)) {
    if (seen.has(markedId)) continue;
    const m = entry.meta.get(markedId);
    if (!m) continue;
    setUnread(entry, markedId, m.bucket, 0);
  }
}

async function getOrCreateClient(
  sessionString: string,
): Promise<ClientEntry> {
  const existing =
    clients.get(
      sessionString,
    );

  if (existing) {
    if (
      existing.shutdownTimer
    ) {
      clearTimeout(
        existing.shutdownTimer,
      );

      existing.shutdownTimer =
        null;
    }

    existing.refs++;

    return existing;
  }

  const client =
    createClient(
      sessionString,
    );

  await client.connect();

  // Prime the update channel. Without these, gramjs has been observed to
  // silently not deliver new-message updates until *some* other request
  // triggers them. getMe seeds _selfInputPeer (the dispatcher guards on it
  // before firing handlers) and updates.GetState forces Telegram to start
  // pushing the live update stream to this connection.
  try {
    await client.getMe();
  } catch (err) {
    console.warn("[updates/stream] getMe prime failed:", err);
  }
  try {
    await client.invoke(new Api.updates.GetState());
  } catch (err) {
    console.warn("[updates/stream] GetState prime failed:", err);
  }

  const snapshot:
    UnreadSnapshot = {
    users: 0,
    groups: 0,
    channels: 0,
    perChat: {},
    lastByChat: {},
  };

  const meta =
    new Map<
      string,
      ChatMeta
    >();

  const dialogs =
    await client.getDialogs(
      {
        limit: 1000,
      },
    );

  for (const d of dialogs) {
    const info =
      classify(
        d.entity,
      );

    if (!info)
      continue;

    const unread =
      d.unreadCount ??
      0;

    const rawId = (
      d.entity instanceof
      Api.User
        ? d.entity.id
        : d.entity instanceof
            Api.Channel
          ? d.entity.id
          : d.entity instanceof
              Api.Chat
            ? d.entity.id
            : null
    )?.toString();

    if (rawId) {
      meta.set(
        rawId,
        {
          bucket:
            info.bucket,
          markedId:
            info.markedId,
        },
      );
    }

    meta.set(
      info.markedId,
      {
        bucket:
          info.bucket,
        markedId:
          info.markedId,
      },
    );

    if (unread > 0) {
      snapshot.perChat[
        info.markedId
      ] = unread;

      snapshot[
        info.bucket
      ] += unread;
    }

    // Seed the lastMessage preview for every dialog (even those at zero unread)
    // so the recent-chats list has a starting point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dMsg = (d.message as any)?.message;
    const dDate = d.date ?? 0;
    if (typeof dMsg === "string" && (dMsg.length > 0 || dDate > 0)) {
      snapshot.lastByChat[info.markedId] = {
        text: dMsg.slice(0, 80),
        date: dDate,
      };
    }
  }

  const entry:
    ClientEntry = {
    client,
    refs: 1,
    shutdownTimer:
      null,
    snapshot,
    meta,
    listeners:
      new Set(),
    removeUpdateHandler:
      null,
    resyncTimer:
      null,
  };

  // Safety-net resync: re-walk the dialog list every 30 s and emit deltas
  // for anything that drifted vs the in-memory snapshot. This keeps badges
  // accurate even if the live push happened to be off briefly.
  entry.resyncTimer = setInterval(() => {
    void resyncSnapshot(entry).catch((err: unknown) =>
      console.warn("[updates/stream] resync failed:", err),
    );
  }, 30_000);

  const newMessageEvent =
    new NewMessage({});

  // NEW MESSAGE
  const handleNewMessage =
    (
      event: any,
    ) => {
      try {
        const msg = event.message;
        if (!msg)
          return;

        const peerIds =
          peerToCandidates(
            msg.peerId,
          );

        const chatMeta =
          ensureMeta(
            entry,
            peerIds,
            msg.peerId,
          );

        if (!chatMeta)
          return;

        // Update the chat's preview text — both incoming and outgoing messages
        // count as the "last message" in the list view. Only incoming bumps
        // unread.
        updateLastMessage(
          entry,
          chatMeta.markedId,
          msg.message ?? "",
          msg.date ?? 0,
        );

        if (msg.out)
          return;

        bumpUnread(
          entry,
          chatMeta.markedId,
          chatMeta.bucket,
          1,
        );
      } catch (
        err
      ) {
        console.error(
          "[NEW MESSAGE]",
          err,
        );
      }
    };

  // READ RECEIPTS
  const handleRawUpdate =
    (
      update: any,
    ) => {
      try {
        applyUpdate(
          entry,
          update,
        );
      } catch (
        err
      ) {
        console.error(
          "[RAW UPDATE]",
          err,
        );
      }
    };

  client.addEventHandler(
    handleNewMessage,
    newMessageEvent,
  );

  client.addEventHandler(
    handleRawUpdate,
  );

  entry.removeUpdateHandler =
    () => {
      try {
        client.removeEventHandler(
          handleNewMessage,
          newMessageEvent,
        );

        (
          client as any
        ).removeEventHandler(
          handleRawUpdate,
        );
      } catch {
        //
      }
    };

  clients.set(
    sessionString,
    entry,
  );

  return entry;
}

function releaseClient(sessionString: string) {
  const entry = clients.get(sessionString);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  // Defer disconnect — a quick reload should reuse the same client. 60 s
  // gives the new tab time to land before we tear down the gramjs session.
  entry.shutdownTimer = setTimeout(async () => {
    if (entry.refs > 0) return;
    clients.delete(sessionString);
    if (entry.resyncTimer) {
      clearInterval(entry.resyncTimer);
      entry.resyncTimer = null;
    }
    try {
      entry.removeUpdateHandler?.();
    } catch {
      // ignore
    }
    try {
      await entry.client.disconnect();
    } catch {
      // ignore
    }
  }, 60_000);
}

/** Apply one raw Telegram update to the in-memory snapshot and emit deltas
 * to every listener for the chats that changed. */
function applyUpdate(
  entry: ClientEntry,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: any,
) {
  // New messages are handled by:
  // client.addEventHandler(
  //   handleNewMessage,
  //   new NewMessage({})
  // )

  const inner: any =
    update?.update ??
    update;

  const name:
    | string
    | undefined =
    inner?.className;

  // READ PRIVATE / GROUP
  if (
    name ===
    "UpdateReadHistoryInbox"
  ) {
    const peerId =
      peerToCandidates(
        inner.peer,
      );

    const meta =
      ensureMeta(
        entry,
        peerId,
        inner.peer,
      );

    if (!meta) return;

    setUnread(
      entry,
      meta.markedId,
      meta.bucket,
      inner.stillUnreadCount ??
      0,
    );

    return;
  }

  // READ CHANNEL
  if (
    name ===
    "UpdateReadChannelInbox"
  ) {
    const candidates:
      string[] = [];

    let synthPeer:
      | Api.PeerChannel
      | null =
      null;

    if (
      typeof inner.channelId !==
      "undefined"
    ) {
      const id =
        inner.channelId.toString();

      candidates.push(
        id,
        `-100${id}`,
      );

      synthPeer =
        new Api.PeerChannel(
          {
            channelId:
              inner.channelId,
          },
        );
    }

    const meta =
      ensureMeta(
        entry,
        candidates,
        synthPeer,
      );

    if (!meta) return;

    setUnread(
      entry,
      meta.markedId,
      meta.bucket,
      inner.stillUnreadCount ??
      0,
    );

    return;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function peerToCandidates(peer: any): string[] {
  if (!peer) return [];
  const out: string[] = [];
  if (peer instanceof Api.PeerUser) {
    out.push(peer.userId.toString());
  } else if (peer instanceof Api.PeerChannel) {
    const id = peer.channelId.toString();
    out.push(id, `-100${id}`);
  } else if (peer instanceof Api.PeerChat) {
    const id = peer.chatId.toString();
    out.push(id, `-${id}`);
  }
  return out;
}

function emit(entry: ClientEntry, event: unknown) {
  for (const listener of entry.listeners) {
    try {
      listener(event);
    } catch {
      // a single bad subscriber shouldn't take the others down
    }
  }
}

function bumpUnread(
  entry: ClientEntry,
  markedId: string,
  bucket: Bucket,
  by: number,
) {
  const cur = entry.snapshot.perChat[markedId] ?? 0;
  const next = Math.max(0, cur + by);
  entry.snapshot.perChat[markedId] = next;
  entry.snapshot[bucket] = Math.max(0, entry.snapshot[bucket] + by);
  emit(entry, { kind: "delta", chatId: markedId, bucket, unread: next });
}

/** Update the chat's preview text + emit a delta so the recent-chats list
 * reflects the new last-message in real time. Skips updates with an older
 * timestamp than what we already have (out-of-order arrival, retry, etc.). */
function updateLastMessage(
  entry: ClientEntry,
  markedId: string,
  text: string,
  date: number,
) {
  const prev = entry.snapshot.lastByChat[markedId];
  if (prev && date > 0 && prev.date >= date) return;
  const trimmed = text.slice(0, 80);
  entry.snapshot.lastByChat[markedId] = { text: trimmed, date };
  emit(entry, {
    kind: "lastMessage",
    chatId: markedId,
    text: trimmed,
    date,
  });
}

function setUnread(
  entry: ClientEntry,
  markedId: string,
  bucket: Bucket,
  value: number,
) {
  const cur = entry.snapshot.perChat[markedId] ?? 0;
  const next = Math.max(0, value);
  if (cur === next) return;
  entry.snapshot.perChat[markedId] = next;
  entry.snapshot[bucket] = Math.max(0, entry.snapshot[bucket] - cur + next);
  if (next === 0) delete entry.snapshot.perChat[markedId];
  emit(entry, { kind: "delta", chatId: markedId, bucket, unread: next });
}

export async function POST(request: Request) {
  const { sessionString } = await request.json().catch(() => ({}));
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }

  let entry: ClientEntry;
  try {
    entry = await getOrCreateClient(sessionString);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to connect";
    return Response.json({ error: message }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let listener: ((event: unknown) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let released = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // controller closed — listener will be detached by cancel()
        }
      };

      // Defeat WKWebView / Android WebView fetch-stream buffering. Both
      // WebViews wait for ~2 KB of body before letting JS read the first
      // chunk, which would otherwise delay the initial snapshot by seconds.
      // Sending a padded ignore-line up front forces the buffer to flush
      // immediately. The client's parser skips any line it can't parse.
      try {
        controller.enqueue(
          encoder.encode("/" + " ".repeat(2048) + "/\n"),
        );
      } catch {
        // controller closed before we even started — nothing to do
      }

      // Initial snapshot so the UI can populate immediately.
      send({
        kind: "snapshot",
        users: entry.snapshot.users,
        groups: entry.snapshot.groups,
        channels: entry.snapshot.channels,
        perChat: entry.snapshot.perChat,
        lastByChat: entry.snapshot.lastByChat,
      });

      listener = send;
      entry.listeners.add(listener);

      // 10 s heartbeat — short enough that a stalled connection is noticed
      // quickly on mobile (where the OS may freeze a backgrounded WebView's
      // network), long enough not to spam.
      heartbeat = setInterval(() => send({ kind: "heartbeat" }), 10_000);
    },
    cancel() {
      if (released) return;
      released = true;
      if (heartbeat) clearInterval(heartbeat);
      if (listener) entry.listeners.delete(listener);
      releaseClient(sessionString);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
