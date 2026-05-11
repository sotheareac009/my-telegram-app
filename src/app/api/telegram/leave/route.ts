import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let client;
  try {
    const { sessionString, groupId } = await request.json();

    if (!sessionString || !groupId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    client = createClient(sessionString);
    await client.connect();

    const entity = await client.getEntity(groupId);

    if (entity instanceof Api.Channel) {
      // Supergroups and channels
      await client.invoke(
        new Api.channels.LeaveChannel({ channel: entity })
      );
    } else if (entity instanceof Api.Chat) {
      // Basic groups — use DeleteChatUser with self
      await client.invoke(
        new Api.messages.DeleteChatUser({
          chatId: entity.id,
          userId: new Api.InputUserSelf(),
        })
      );
    } else {
      return Response.json(
        { error: "Cannot leave this type of chat" },
        { status: 400 }
      );
    }

    return Response.json({ success: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to leave";
    console.error("[leave] error:", message);
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (client) {
      try { await client.disconnect(); } catch { /* ignore */ }
    }
  }
}

