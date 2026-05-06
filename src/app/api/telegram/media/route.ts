import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { sessionString, groupId, limit = 50, offsetId = 0 } = await request.json();
    if (!sessionString || !groupId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    const messages = await client.getMessages(groupId, {
      limit,
      offsetId,
    });

    const media = messages
      .filter((msg) => msg.media)
      .map((msg) => {
        let type: "photo" | "video" | "file" | "unknown" = "unknown";
        let fileName = "";
        let fileSize = 0;
        let mimeType = "";
        let thumbBase64 = "";
        let duration = 0;

        if (msg.media instanceof Api.MessageMediaPhoto) {
          type = "photo";
        } else if (msg.media instanceof Api.MessageMediaDocument) {
          const doc = msg.media.document;
          if (doc instanceof Api.Document) {
            mimeType = doc.mimeType;
            fileSize = Number(doc.size);
            for (const attr of doc.attributes) {
              if (attr instanceof Api.DocumentAttributeFilename) {
                fileName = attr.fileName;
              }
              if (attr instanceof Api.DocumentAttributeVideo) {
                type = "video";
                duration = attr.duration;
              }
              if (attr instanceof Api.DocumentAttributeAudio) {
                type = "file";
              }
            }
            if (type === "unknown") {
              type = "file";
            }
          }
        }

        if (type === "unknown") return null;

        // Try to get thumbnail
        if (msg.media instanceof Api.MessageMediaPhoto) {
          const photo = msg.media.photo;
          if (photo instanceof Api.Photo && photo.sizes.length > 0) {
            const stripped = photo.sizes.find(
              (s) => s instanceof Api.PhotoStrippedSize
            );
            if (stripped && stripped instanceof Api.PhotoStrippedSize) {
              thumbBase64 = Buffer.from(stripped.bytes).toString("base64");
            }
          }
        } else if (msg.media instanceof Api.MessageMediaDocument) {
          const doc = msg.media.document;
          if (doc instanceof Api.Document && doc.thumbs && doc.thumbs.length > 0) {
            const stripped = doc.thumbs.find(
              (s) => s instanceof Api.PhotoStrippedSize
            );
            if (stripped && stripped instanceof Api.PhotoStrippedSize) {
              thumbBase64 = Buffer.from(stripped.bytes).toString("base64");
            }
          }
        }

        return {
          id: msg.id,
          type,
          date: msg.date,
          caption: msg.message || "",
          fileName,
          fileSize,
          mimeType,
          thumbBase64,
          duration,
        };
      })
      .filter(Boolean);

    const hasMore =
      messages.length === limit &&
      messages[messages.length - 1]?.id !== undefined;
    const nextOffsetId =
      messages.length > 0 ? messages[messages.length - 1].id : 0;

    await client.disconnect();

    return Response.json({ media, hasMore, nextOffsetId });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch media";
    return Response.json({ error: message }, { status: 500 });
  }
}
