import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";
import { notifyChatRead } from "@/lib/unread-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a chat as read — clears its unread badge. Called when the user opens a
 * conversation. Handles 1-to-1 chats (userId) and groups/channels (chatId).
 *
 * Telegram's readHistory takes `maxId` = the id of the last message that
 * should be marked read; messages up to and including that id are read.
 * Passing 0 reads NOTHING — so we fetch the latest message's id first and
 * use that, which is how the official clients do it.
 */
async function latestMessageId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  peer: any,
): Promise<number> {
  try {
    const messages = await client.getMessages(peer, { limit: 1 });
    const raw = messages?.[0]?.id;
    // gramjs may surface ids as plain numbers or BigInteger wrappers — coerce
    // defensively so the readHistory call always gets a usable int.
    const id = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(id) && id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

export async function POST(request: Request) {
  const { sessionString, userId, accessHash, chatId } = await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!userId && !chatId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    if (chatId) {
      // Warm the entity cache so a channel/supergroup marked id resolves on
      // this otherwise-cold client.
      try {
        await client.getDialogs({ limit: 200 });
      } catch {
        // ignore — proceed without the warm-up
      }
      const peer = await client.getInputEntity(String(chatId));
      const maxId = await latestMessageId(client, peer);
      if (maxId === 0) {
        // Nothing to mark — empty chat or fetch failed. Still notify the SSE
        // stream so a stale snapshot can't re-paint a phantom badge.
        notifyChatRead(sessionString, String(chatId));
        return Response.json({ success: true });
      }
      if (peer instanceof Api.InputPeerChannel) {
        // Channels & supergroups read through channels.readHistory.
        await client.invoke(
          new Api.channels.ReadHistory({
            channel: new Api.InputChannel({
              channelId: peer.channelId,
              accessHash: peer.accessHash,
            }),
            maxId,
          }),
        );
      } else {
        // Basic groups read through messages.readHistory.
        await client.invoke(new Api.messages.ReadHistory({ peer, maxId }));
      }
      // Telegram has now committed the read. Push the same state into the
      // SSE stream's snapshot in case its gramjs client was bumped off this
      // session and missed UpdateReadHistoryInbox — otherwise a refresh
      // within the next 30 s (the resync interval) would re-paint the badge.
      notifyChatRead(sessionString, String(chatId));
    } else {
      const resolved = await resolveUserPeer(client, userId, accessHash);
      const peer = await client.getInputEntity(resolved);
      const maxId = await latestMessageId(client, peer);
      if (maxId === 0) {
        notifyChatRead(sessionString, String(userId));
        return Response.json({ success: true });
      }
      await client.invoke(new Api.messages.ReadHistory({ peer, maxId }));
      notifyChatRead(sessionString, String(userId));
    }
    return Response.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to mark read";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
