import { createClient } from "@/lib/telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { sessionString, chatId, userId, accessHash, messageIds } =
    await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!chatId && !userId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }
  const ids = Array.isArray(messageIds)
    ? messageIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) {
    return Response.json({ error: "No messages to delete" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    // A group/channel addresses by its marked id directly; a user needs an
    // explicit InputPeerUser so it resolves on a cold client.
    const peer = chatId
      ? String(chatId)
      : await resolveUserPeer(client, userId, accessHash);
    // revoke: true → delete for everyone. Telegram enforces permissions here —
    // it rejects the call when the account isn't allowed to delete a message,
    // which surfaces as the 500 below (the caller keeps the message).
    await client.deleteMessages(peer, ids, { revoke: true });
    return Response.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete message";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
