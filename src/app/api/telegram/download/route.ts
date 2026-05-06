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

    const messages = await client.getMessages(groupId, {
      ids: [messageId],
    });

    const msg = messages[0];
    if (!msg || !msg.media) {
      await client.disconnect();
      return Response.json({ error: "Media not found" }, { status: 404 });
    }

    let mimeType = "application/octet-stream";
    let fileName = "file";

    if (msg.media instanceof Api.MessageMediaPhoto) {
      mimeType = "image/jpeg";
      fileName = `photo_${messageId}.jpg`;
    } else if (msg.media instanceof Api.MessageMediaDocument) {
      const doc = msg.media.document;
      if (doc instanceof Api.Document) {
        mimeType = doc.mimeType;
        for (const attr of doc.attributes) {
          if (attr instanceof Api.DocumentAttributeFilename) {
            fileName = attr.fileName;
          }
        }
      }
    }

    const buffer = await client.downloadMedia(msg.media, {});
    await client.disconnect();

    if (!buffer) {
      return Response.json({ error: "Download failed" }, { status: 500 });
    }

    const data = buffer instanceof Buffer ? buffer : Buffer.from(buffer);

    return new Response(data as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to download";
    return Response.json({ error: message }, { status: 500 });
  }
}
