import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import type { BigInteger } from "big-integer";
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const bigInt = require("big-integer") as (n: number) => BigInteger;

export interface SearchMessageResult {
  id: number;
  date: number;
  text: string;
  senderId: string;
  senderName: string;
  hasMedia: boolean;
  mediaType: "photo" | "video" | "file" | null;
}

export async function POST(request: Request) {
  try {
    const {
      sessionString,
      groupId,
      query,
      messageId,
      limit = 40,
      offsetId = 0,
    } = await request.json() as {
      sessionString: string;
      groupId: string;
      query?: string;
      messageId?: number;
      limit?: number;
      offsetId?: number;
    };

    if (!sessionString || !groupId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    // ── Jump to a specific message by ID ──────────────────────────────────
    if (messageId) {
      const msgs = await client.getMessages(groupId, { ids: [messageId] });
      const msg = msgs[0];

      if (!msg) {
        await client.disconnect();
        return Response.json({ results: [], hasMore: false });
      }

      let senderName = "Unknown";
      try {
        if (msg.senderId) {
          const entity = await client.getEntity(msg.senderId);
          if ("firstName" in entity || "lastName" in entity) {
            const u = entity as { firstName?: string; lastName?: string; username?: string };
            senderName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "User";
          } else if ("title" in entity) {
            senderName = (entity as { title: string }).title;
          }
        }
      } catch { /* best-effort */ }

      let mediaType: SearchMessageResult["mediaType"] = null;
      if (msg.media instanceof Api.MessageMediaPhoto) {
        mediaType = "photo";
      } else if (msg.media instanceof Api.MessageMediaDocument) {
        const doc = msg.media.document;
        if (doc instanceof Api.Document) {
          const isVideo = doc.attributes.some(
            (a) => a instanceof Api.DocumentAttributeVideo
          );
          mediaType = isVideo ? "video" : "file";
        }
      }

      const result: SearchMessageResult = {
        id: msg.id,
        date: msg.date,
        text: msg.message || "",
        senderId: msg.senderId?.toString() ?? "",
        senderName,
        hasMedia: !!msg.media,
        mediaType,
      };

      await client.disconnect();
      return Response.json({ results: [result], hasMore: false, jumped: true });
    }

    // ── Full-text search ──────────────────────────────────────────────────
    if (!query || query.trim().length === 0) {
      await client.disconnect();
      return Response.json({ error: "Missing query" }, { status: 400 });
    }

    const peer = await client.getEntity(groupId);
    const searchResult = await client.invoke(
      new Api.messages.Search({
        peer,
        q: query.trim(),
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetId,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      })
    );

    const rawMessages =
      "messages" in searchResult ? searchResult.messages : [];

    // Build a sender-name cache to avoid repeated API calls
    const senderCache = new Map<string, string>();

    const results: SearchMessageResult[] = [];

    for (const raw of rawMessages) {
      if (!(raw instanceof Api.Message)) continue;

      const senderId = raw.senderId?.toString() ?? "";
      let senderName = "Unknown";

      if (senderId) {
        if (senderCache.has(senderId)) {
          senderName = senderCache.get(senderId)!;
        } else {
          try {
            const entity = await client.getEntity(raw.senderId!);
            if ("firstName" in entity || "lastName" in entity) {
              const u = entity as { firstName?: string; lastName?: string; username?: string };
              senderName = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "User";
            } else if ("title" in entity) {
              senderName = (entity as { title: string }).title;
            }
            senderCache.set(senderId, senderName);
          } catch { /* best-effort */ }
        }
      }

      let mediaType: SearchMessageResult["mediaType"] = null;
      if (raw.media instanceof Api.MessageMediaPhoto) {
        mediaType = "photo";
      } else if (raw.media instanceof Api.MessageMediaDocument) {
        const doc = raw.media.document;
        if (doc instanceof Api.Document) {
          const isVideo = doc.attributes.some(
            (a) => a instanceof Api.DocumentAttributeVideo
          );
          mediaType = isVideo ? "video" : "file";
        }
      }

      results.push({
        id: raw.id,
        date: raw.date,
        text: raw.message || "",
        senderId,
        senderName,
        hasMedia: !!raw.media,
        mediaType,
      });
    }

    const hasMore = rawMessages.length >= limit;
    const nextOffsetId =
      results.length > 0
        ? results.reduce((min, r) => (r.id < min ? r.id : min), results[0].id)
        : 0;

    await client.disconnect();
    return Response.json({ results, hasMore, nextOffsetId });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to search messages";
    return Response.json({ error: message }, { status: 500 });
  }
}
