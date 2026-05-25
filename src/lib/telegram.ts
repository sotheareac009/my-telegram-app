/* eslint-disable @typescript-eslint/no-require-imports */

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH!;

export function createClient(sessionString: string = "") {
  // Use require to avoid bundler creating duplicate module instances
  // which breaks the instanceof check inside GramJS
  const { TelegramClient } = require("telegram");
  const { StringSession } = require("telegram/sessions");

  const session = new StringSession(sessionString);
  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  }) as import("telegram").TelegramClient;
}

// ── Persistent client cache ────────────────────────────────────────────────────
// In Next.js, module-level variables persist across requests within the same
// Node.js process. By caching connected GramJS clients keyed by session string,
// we avoid re-running auth.ExportAuthorization on every request. The first
// thumbnail request for a session exports DC 4 auth once; every subsequent
// request reuses the already-authorized connection pool.
//
// TTL: evict clients unused for 10 minutes to avoid stale/zombie connections.

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedClient {
  client: import("telegram").TelegramClient;
  lastUsed: number;
}

// Use a global symbol to survive Next.js hot-reload
const CACHE_KEY = Symbol.for("telegram_client_cache");
declare global {
  // eslint-disable-next-line no-var
  var __telegramClientCache: Map<string, CachedClient> | undefined;
}

function getCache(): Map<string, CachedClient> {
  if (!global.__telegramClientCache) {
    global.__telegramClientCache = new Map();
  }
  return global.__telegramClientCache;
}

/**
 * Returns a connected, cached TelegramClient for the given session string.
 * If no cached client exists (or it is disconnected), creates and connects a
 * new one, stores it, then returns it.
 *
 * Callers MUST NOT call client.disconnect() — the client is shared.
 */
export async function getConnectedClient(
  sessionString: string,
): Promise<import("telegram").TelegramClient> {
  const cache = getCache();
  const now = Date.now();

  // Evict stale entries
  for (const [key, entry] of cache.entries()) {
    if (now - entry.lastUsed > CACHE_TTL_MS) {
      try { await entry.client.disconnect(); } catch { /* ignore */ }
      cache.delete(key);
    }
  }

  const existing = cache.get(sessionString);
  if (existing) {
    // Reconnect if the client dropped (e.g. after idle eviction)
    if (!existing.client.connected) {
      try { await existing.client.connect(); } catch { /* will retry on use */ }
    }
    existing.lastUsed = now;
    return existing.client;
  }

  const client = createClient(sessionString);
  await client.connect();
  cache.set(sessionString, { client, lastUsed: now });
  return client;
}
