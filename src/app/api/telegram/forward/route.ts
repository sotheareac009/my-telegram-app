import { createClient } from "@/lib/telegram";

export async function POST(request: Request) {
  let client;

  try {
    const { sessionString, fromGroupId, toGroupId, messageIds } = await request.json();

    if (
      !sessionString ||
      !fromGroupId ||
      !toGroupId ||
      !Array.isArray(messageIds) ||
      messageIds.length === 0
    ) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    client = createClient(sessionString);
    await client.connect();

    const parsedMessageIds = messageIds.map((id: unknown) => Number(id)).filter(
      (id) => Number.isFinite(id),
    );

    if (parsedMessageIds.length === 0) {
      return Response.json({ error: "Invalid message IDs" }, { status: 400 });
    }

    await client.forwardMessages(toGroupId, {
      messages: parsedMessageIds,
      fromPeer: fromGroupId,
    });

    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to forward messages";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore disconnect failures
      }
    }
  }
}
