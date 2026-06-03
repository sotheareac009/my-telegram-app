import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * React to a chat message with a single emoji (Telegram-Web style). Sending
 * an empty emoji removes the current reaction. Works for 1-to-1 DMs
 * (userId + accessHash) and for groups / channels (chatId).
 *
 * Wraps `messages.sendReaction`. Telegram caps the reaction set per chat
 * (admins choose), so a server-side rejection is surfaced as-is — the
 * caller can show it inline.
 */
export async function POST(request: Request) {
  const { sessionString, userId, accessHash, chatId, messageId, emoji } =
    await request.json().catch(() => ({}));

  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!userId && !chatId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }
  const msgIdNum = Number(messageId);
  if (!Number.isFinite(msgIdNum) || msgIdNum <= 0) {
    return Response.json({ error: "Missing messageId" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();

    const target = chatId
      ? String(chatId)
      : await resolveUserPeer(client, userId, accessHash);
    const peer = await client.getInputEntity(target);

    const reaction =
      typeof emoji === "string" && emoji.length > 0
        ? [new Api.ReactionEmoji({ emoticon: emoji })]
        : []; // empty array clears any existing reaction

    await client.invoke(
      new Api.messages.SendReaction({
        peer,
        msgId: msgIdNum,
        reaction,
      }),
    );

    return Response.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to react";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
