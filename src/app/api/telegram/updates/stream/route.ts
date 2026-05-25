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

interface UnreadSnapshot {
  users: number;
  groups: number;
  channels: number;
  perChat: Record<string, number>;
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

  const snapshot:
    UnreadSnapshot = {
    users: 0,
    groups: 0,
    channels: 0,
    perChat: {},
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
  };

  const newMessageEvent =
    new NewMessage({});

  // NEW MESSAGE
  const handleNewMessage =
    (
      event: any,
    ) => {
      try {
        const msg =
          event.message;

        if (!msg)
          return;

        // ignore our own sends
        if (msg.out)
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

      // Initial snapshot so the UI can populate immediately.
      send({
        kind: "snapshot",
        users: entry.snapshot.users,
        groups: entry.snapshot.groups,
        channels: entry.snapshot.channels,
        perChat: entry.snapshot.perChat,
      });

      listener = send;
      entry.listeners.add(listener);

      // 25 s heartbeat so the browser fetch reader / proxy timers don't
      // assume the connection is dead.
      heartbeat = setInterval(() => send({ kind: "heartbeat" }), 25_000);
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
