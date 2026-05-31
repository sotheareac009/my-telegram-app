import { createClient } from "@/lib/telegram";
import { Api, utils as telegramUtils } from "telegram";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extract the raw channel id from a marked id ("-1001234" → "1234") so we
 * can pair it with an accessHash to build an InputChannel. */
function rawChannelId(markedOrRaw: string): string {
  const s = String(markedOrRaw);
  if (s.startsWith("-100")) return s.slice(4);
  if (s.startsWith("-")) return s.slice(1);
  return s;
}

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
    const { sessionString, inviteHash, chatId, accessHash } =
      await request.json();
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

      // Fast path: caller passed both chatId + accessHash → build an
      // InputChannel directly. Works on a cold gramjs client because no
      // entity lookup is needed. This is the case for the forward-modal
      // / link-resolver flow that already has the metadata in hand.
      if (accessHash) {
        const inputChannel = new Api.InputChannel({
          channelId: bigInt(rawChannelId(String(chatId))),
          accessHash: bigInt(String(accessHash)),
        });
        await client.invoke(
          new Api.channels.JoinChannel({ channel: inputChannel }),
        );
        return Response.json({ ok: true });
      }

      // Legacy path: caller only has a chatId/username. Resolution may fail
      // on a cold client; preferred callers should supply accessHash above.
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
