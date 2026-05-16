import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build the peer to address. With an accessHash we construct an explicit
 * InputPeerUser — this works for *anyone* you've chatted with, contact or
 * not. Without it we fall back to the bare id (only reliable for contacts).
 */
function resolvePeer(userId: string, accessHash?: string) {
  if (accessHash) {
    return new Api.InputPeerUser({
      userId: bigInt(String(userId)),
      accessHash: bigInt(String(accessHash)),
    });
  }
  return String(userId);
}

export type ChatMessage = {
  id: number;
  text: string;
  date: number;
  fromMe: boolean;
  status?: "sent" | "read";
};

/** Map a GramJS message to the client-facing shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMessage(msg: any): ChatMessage | null {
  if (!(msg instanceof Api.Message)) return null;
  let text: string = msg.message || "";
  if (!text && msg.media) text = "[media]";
  const fromMe = Boolean(msg.out);
  return {
    id: msg.id,
    text,
    date: msg.date,
    fromMe,
    status: fromMe ? "sent" : undefined,
  };
}

export async function POST(request: Request) {
  const { sessionString, userId, accessHash, limit, offsetId } =
    await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();

    const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
    // offsetId paginates into older history — getMessages returns messages
    // with id < offsetId. Omitted/0 ⇒ newest messages.
    const getOpts: { limit: number; offsetId?: number } = { limit: pageSize };
    const parsedOffset = Number(offsetId);
    if (Number.isFinite(parsedOffset) && parsedOffset > 0) {
      getOpts.offsetId = parsedOffset;
    }
    const messages = await client.getMessages(
      resolvePeer(userId, accessHash),
      getOpts,
    );

    // getMessages returns newest-first; reverse for chronological display.
    const mapped: ChatMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = mapMessage(messages[i]);
      if (m) mapped.push(m);
    }

    return Response.json({ messages: mapped });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load conversation";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
