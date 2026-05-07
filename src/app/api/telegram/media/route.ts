import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

type SingleMediaItem = {
  id: number;
  type: "photo" | "video" | "file";
  date: number;
  caption: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbBase64: string;
  duration: number;
};

type MediaEntry = SingleMediaItem & {
  album?: {
    groupedId: string;
    items: SingleMediaItem[];
  };
};

type RawMessage = Awaited<
  ReturnType<
    ReturnType<typeof createClient>["getMessages"]
  >
>[number];

function buildItem(msg: RawMessage): SingleMediaItem | null {
  if (!msg.media) return null;

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
      if (type === "unknown") type = "file";
    }
  }

  if (type === "unknown") return null;

  if (msg.media instanceof Api.MessageMediaPhoto) {
    const photo = msg.media.photo;
    if (photo instanceof Api.Photo && photo.sizes.length > 0) {
      const stripped = photo.sizes.find(
        (s) => s instanceof Api.PhotoStrippedSize
      );
      if (stripped instanceof Api.PhotoStrippedSize) {
        thumbBase64 = Buffer.from(stripped.bytes).toString("base64");
      }
    }
  } else if (msg.media instanceof Api.MessageMediaDocument) {
    const doc = msg.media.document;
    if (doc instanceof Api.Document && doc.thumbs && doc.thumbs.length > 0) {
      const stripped = doc.thumbs.find(
        (s) => s instanceof Api.PhotoStrippedSize
      );
      if (stripped instanceof Api.PhotoStrippedSize) {
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
}

export async function POST(request: Request) {
  try {
    const {
      sessionString,
      groupId,
      limit = 50,
      offsetId = 0,
    } = await request.json();
    if (!sessionString || !groupId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    let messages = await client.getMessages(groupId, { limit, offsetId });

    // If the last (oldest in this batch) message belongs to an album, keep
    // pulling until we exit that album so a single album never spans pages.
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      const trailingGid = last.groupedId?.toString();
      if (trailingGid) {
        let extraOffsetId = last.id;
        let scanned = 0;
        const SCAN_LIMIT = 60;
        while (scanned < SCAN_LIMIT) {
          const more = await client.getMessages(groupId, {
            limit: 20,
            offsetId: extraOffsetId,
          });
          if (more.length === 0) break;
          let foundBoundary = false;
          for (const m of more) {
            if (m.groupedId?.toString() === trailingGid) {
              messages.push(m);
              extraOffsetId = m.id;
            } else {
              foundBoundary = true;
              break;
            }
          }
          scanned += more.length;
          if (foundBoundary) break;
        }
      }
    }

    const entries: MediaEntry[] = [];
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];
      const gid = msg.groupedId?.toString();

      if (!gid) {
        const item = buildItem(msg);
        if (item) entries.push(item);
        i += 1;
        continue;
      }

      const groupMsgs: RawMessage[] = [];
      let j = i;
      while (
        j < messages.length &&
        messages[j].groupedId?.toString() === gid
      ) {
        groupMsgs.push(messages[j]);
        j += 1;
      }
      i = j;

      // Telegram returns messages newest-first; reverse to get send order.
      groupMsgs.sort((a, b) => a.id - b.id);
      const items = groupMsgs
        .map(buildItem)
        .filter((x): x is SingleMediaItem => x !== null);
      if (items.length === 0) continue;

      if (items.length === 1) {
        entries.push(items[0]);
      } else {
        const cover = items[0];
        entries.push({
          ...cover,
          album: { groupedId: gid, items },
        });
      }
    }

    const hasMore = messages.length >= limit;
    const nextOffsetId =
      messages.length > 0
        ? messages.reduce(
            (min, m) => (m.id < min ? m.id : min),
            messages[0].id
          )
        : 0;

    await client.disconnect();

    return Response.json({ media: entries, hasMore, nextOffsetId });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch media";
    return Response.json({ error: message }, { status: 500 });
  }
}
