import { createClient } from "@/lib/telegram";

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ error: "No session" }, { status: 401 });
    }

    const client = createClient(sessionString);
    await client.connect();

    const dialogs = await client.getDialogs({ limit: 100 });

    const groups = dialogs
      .filter((d) => d.isGroup || d.isChannel)
      .map((d) => ({
        id: d.id?.toString() ?? "",
        title: d.title ?? "Untitled",
        unreadCount: d.unreadCount ?? 0,
        isChannel: d.isChannel ?? false,
        isGroup: d.isGroup ?? false,
        lastMessage: d.message?.message?.slice(0, 80) ?? "",
        date: d.message?.date ?? 0,
      }));

    await client.disconnect();

    return Response.json({ groups });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch dialogs";
    return Response.json({ error: message }, { status: 500 });
  }
}
