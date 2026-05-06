import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

async function downloadMediaResponse(
  sessionString: string,
  groupId: string,
  messageId: number,
  mode: "inline" | "attachment" = "inline"
) {
  const client = createClient(sessionString);
  await client.connect();

  try {
    const messages = await client.getMessages(groupId, {
      ids: [messageId],
    });

    const msg = messages[0];
    if (!msg || !msg.media) {
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
    if (!buffer) {
      return Response.json({ error: "Download failed" }, { status: 500 });
    }

    const data = buffer instanceof Buffer ? buffer : Buffer.from(buffer);

    return new Response(data as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${mode}; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } finally {
    await client.disconnect();
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionString = searchParams.get("sessionString");
    const groupId = searchParams.get("groupId");
    const messageId = Number(searchParams.get("messageId"));
    const mode =
      searchParams.get("download") === "1" ? "attachment" : "inline";

    if (!sessionString || !groupId || !messageId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    return await downloadMediaResponse(sessionString, groupId, messageId, mode);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to download";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let sessionString: string | null = null;
    let groupId: string | null = null;
    let messageId = 0;
    let mode: "inline" | "attachment" = "inline";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      sessionString = body.sessionString;
      groupId = body.groupId;
      messageId = Number(body.messageId);
      mode = body.download ? "attachment" : "inline";
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      sessionString = String(form.get("sessionString") || "");
      groupId = String(form.get("groupId") || "");
      messageId = Number(form.get("messageId"));
      mode = form.get("download") === "1" ? "attachment" : "inline";
    }

    if (!sessionString || !groupId || !messageId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    return await downloadMediaResponse(sessionString, groupId, messageId, mode);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to download";
    return Response.json({ error: message }, { status: 500 });
  }
}
