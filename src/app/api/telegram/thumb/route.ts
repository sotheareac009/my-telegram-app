import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { sessionString, groupId, messageId } = await request.json();
    if (!sessionString || !groupId || !messageId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    const messages = await client.getMessages(groupId, { ids: [messageId] });
    const msg = messages[0];

    if (!msg || !msg.media) {
      await client.disconnect();
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Download the smallest available thumbnail
    const thumb = await client.downloadMedia(msg.media, {
      thumb: 1, // smallest thumb
    });

    await client.disconnect();

    if (!thumb) {
      return Response.json({ error: "No thumbnail" }, { status: 404 });
    }

    const data = thumb instanceof Buffer ? thumb : Buffer.from(thumb);

    return new Response(data as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
