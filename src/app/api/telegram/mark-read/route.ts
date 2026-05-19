import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a chat as read — clears its unread badge. Called when the user opens a
 * conversation. Handles 1-to-1 chats (userId) and groups/channels (chatId).
 * `maxId: 0` marks the whole history read.
 */
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
      if (peer instanceof Api.InputPeerChannel) {
        // Channels & supergroups read through channels.readHistory.
        await client.invoke(
          new Api.channels.ReadHistory({
            channel: new Api.InputChannel({
              channelId: peer.channelId,
              accessHash: peer.accessHash,
            }),
            maxId: 0,
          }),
        );
      } else {
        // Basic groups read through messages.readHistory.
        await client.invoke(new Api.messages.ReadHistory({ peer, maxId: 0 }));
      }
    } else {
      const resolved = await resolveUserPeer(client, userId, accessHash);
      const peer = await client.getInputEntity(resolved);
      await client.invoke(new Api.messages.ReadHistory({ peer, maxId: 0 }));
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
