import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a sticker by reference — no file upload. The client picks a sticker
 * from `/api/telegram/stickers/recent`, then POSTs back the id + accessHash
 * + fileReference so Telegram knows which stored document to forward into
 * the chat. Handles both DMs (userId) and groups/channels (chatId).
 */
export async function POST(request: Request) {
  const {
    sessionString,
    userId,
    accessHash,
    chatId,
    documentId,
    documentAccessHash,
    fileReference,
  } = await request.json().catch(() => ({}));

  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!userId && !chatId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }
  if (!documentId || !documentAccessHash || !fileReference) {
    return Response.json(
      { error: "Missing sticker reference" },
      { status: 400 },
    );
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    const target = chatId
      ? String(chatId)
      : await resolveUserPeer(client, userId, accessHash);
    const peer = await client.getInputEntity(target);

    const inputDoc = new Api.InputDocument({
      id: bigInt(String(documentId)),
      accessHash: bigInt(String(documentAccessHash)),
      fileReference: Buffer.from(String(fileReference), "base64"),
    });

    // Telegram needs a per-message random id to dedupe retries. JS numbers
    // can't represent the full 64-bit range cleanly, so build one from two
    // 32-bit halves.
    const randomId = bigInt(
      Math.floor(Math.random() * 0xffffffff),
    )
      .shiftLeft(32)
      .add(bigInt(Math.floor(Math.random() * 0xffffffff)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await client.invoke(
      new Api.messages.SendMedia({
        peer,
        media: new Api.InputMediaDocument({ id: inputDoc }),
        message: "",
        randomId,
      }),
    );

    // SendMedia returns TypeUpdates — the sent Message is one of the inner
    // UpdateNewMessage entries. Fall back to a synthesised stub if we can't
    // find it (the client will still pick the real one up on the next poll).
    let sentId: number = Math.floor(Date.now() / 1000);
    let sentDate: number = Math.floor(Date.now() / 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any[] = result?.updates ?? [];
    for (const upd of updates) {
      if (upd?.message instanceof Api.Message) {
        sentId = upd.message.id;
        sentDate = upd.message.date;
        break;
      }
    }

    return Response.json({
      message: {
        id: sentId,
        date: sentDate,
        fromMe: true,
        status: "sent",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send sticker";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
