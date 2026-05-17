import { createClient } from "@/lib/telegram";
import { Api, utils as telegramUtils } from "telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Join a chat. Accepts either an invite hash (private link) or a chatId
 * (public channel/group). Returns the joined chat's marked id + title so the
 * caller can immediately open it.
 */
function chatToResult(chat: Api.TypeChat | undefined) {
  if (chat instanceof Api.Channel) {
    return {
      kind: chat.megagroup ? ("group" as const) : ("channel" as const),
      id: telegramUtils
        .getPeerId(new Api.PeerChannel({ channelId: chat.id }))
        .toString(),
      title: chat.title || "Chat",
    };
  }
  if (chat instanceof Api.Chat) {
    return {
      kind: "group" as const,
      id: telegramUtils
        .getPeerId(new Api.PeerChat({ chatId: chat.id }))
        .toString(),
      title: chat.title || "Chat",
    };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { sessionString, inviteHash, chatId } = await request.json();
    if (!sessionString || (!inviteHash && !chatId)) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();
    try {
      if (inviteHash) {
        // Private invite — joining returns Updates carrying the joined chat.
        const updates = await client.invoke(
          new Api.messages.ImportChatInvite({ hash: String(inviteHash) }),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chats: Api.TypeChat[] = (updates as any)?.chats ?? [];
        const result = chatToResult(chats[0]);
        return Response.json(result ?? { ok: true });
      }

      // Public channel/group — resolve the entity, then join it.
      const entity = await client.getEntity(String(chatId));
      await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
      return Response.json({ ok: true });
    } finally {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to join";
    return Response.json({ error: message }, { status: 500 });
  }
}
