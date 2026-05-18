import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a 1-to-1 chat as read — clears its unread badge. Called when the user
 * opens a conversation. `maxId: 0` marks the whole history read.
 */
export async function POST(request: Request) {
  const { sessionString, userId, accessHash } = await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    const resolved = await resolveUserPeer(client, userId, accessHash);
    const peer = await client.getInputEntity(resolved);
    await client.invoke(new Api.messages.ReadHistory({ peer, maxId: 0 }));
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
