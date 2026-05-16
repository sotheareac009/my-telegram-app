import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";
import type { ChatMessage } from "@/app/api/telegram/conversation/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** See conversation/route.ts — an explicit InputPeerUser works for anyone. */
function resolvePeer(userId: string, accessHash?: string) {
  if (accessHash) {
    return new Api.InputPeerUser({
      userId: bigInt(String(userId)),
      accessHash: bigInt(String(accessHash)),
    });
  }
  return String(userId);
}

export async function POST(request: Request) {
  const { sessionString, userId, accessHash, text } = await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) {
    return Response.json({ error: "Message is empty" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    const sent = await client.sendMessage(resolvePeer(userId, accessHash), {
      message: body,
    });

    const message: ChatMessage = {
      id: sent instanceof Api.Message ? sent.id : Date.now(),
      text: body,
      date:
        sent instanceof Api.Message
          ? sent.date
          : Math.floor(Date.now() / 1000),
      fromMe: true,
      status: "sent",
    };
    return Response.json({ message });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send message";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
