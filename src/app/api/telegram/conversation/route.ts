import { createClient } from "@/lib/telegram";
import { Api, utils as telegramUtils } from "telegram";
import { resolveUserPeer } from "@/lib/telegram-peer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Media attached to a chat message, classified for the UI to render. */
export type ChatMedia = {
  kind:
    | "photo"
    | "video"
    | "sticker"
    | "gif"
    | "voice"
    | "audio"
    | "file"
    | "contact";
  /** Inline low-res preview (base64 JPEG data URL) — shows instantly. */
  thumb?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  /** Seconds, for video / voice / audio. */
  duration?: number;
  width?: number;
  height?: number;
  /** Shared-contact fields (kind === "contact"). */
  contactUserId?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactPhone?: string;
};

export type ChatMessage = {
  id: number;
  text: string;
  date: number;
  fromMe: boolean;
  status?: "sent" | "read";
  media?: ChatMedia;
  /** Shared id for messages sent together as one album (grouped media). */
  groupedId?: string;
  /** Sender id — set for group/channel messages so the UI can label them. */
  senderId?: string;
  /** Sender display name — set for group/channel messages. */
  senderName?: string;
};

/** Decode a Telegram stripped thumbnail into an inline JPEG data URL. */
function strippedToDataUrl(
  stripped: Api.PhotoStrippedSize,
): string | undefined {
  try {
    const jpg = telegramUtils.strippedPhotoToJpg(Buffer.from(stripped.bytes));
    return `data:image/jpeg;base64,${Buffer.from(jpg).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Classify a message's media into a UI-friendly shape. */
function classifyMedia(media: Api.TypeMessageMedia): ChatMedia | null {
  if (media instanceof Api.MessageMediaContact) {
    return {
      kind: "contact",
      contactUserId: media.userId ? media.userId.toString() : undefined,
      contactFirstName: media.firstName || "",
      contactLastName: media.lastName || "",
      contactPhone: media.phoneNumber || "",
    };
  }

  if (media instanceof Api.MessageMediaPhoto) {
    const photo = media.photo;
    let thumb: string | undefined;
    let width: number | undefined;
    let height: number | undefined;
    if (photo instanceof Api.Photo) {
      for (const s of photo.sizes) {
        if (s instanceof Api.PhotoStrippedSize) {
          thumb = strippedToDataUrl(s);
        } else if (
          s instanceof Api.PhotoSize ||
          s instanceof Api.PhotoSizeProgressive
        ) {
          width = s.w;
          height = s.h;
        }
      }
    }
    return { kind: "photo", thumb, width, height };
  }

  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (!(doc instanceof Api.Document)) return null;

    let fileName: string | undefined;
    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let isVideo = false;
    let isVoice = false;
    let isSticker = false;
    let isAnimated = false;

    for (const attr of doc.attributes) {
      if (attr instanceof Api.DocumentAttributeFilename) {
        fileName = attr.fileName;
      } else if (attr instanceof Api.DocumentAttributeVideo) {
        isVideo = true;
        duration = attr.duration;
        width = attr.w;
        height = attr.h;
      } else if (attr instanceof Api.DocumentAttributeAudio) {
        duration = attr.duration;
        if (attr.voice) isVoice = true;
      } else if (attr instanceof Api.DocumentAttributeSticker) {
        isSticker = true;
      } else if (attr instanceof Api.DocumentAttributeAnimated) {
        isAnimated = true;
      } else if (attr instanceof Api.DocumentAttributeImageSize) {
        width = attr.w;
        height = attr.h;
      }
    }

    let kind: ChatMedia["kind"];
    if (isSticker) kind = "sticker";
    else if (isAnimated) kind = "gif";
    else if (isVideo) kind = "video";
    else if (isVoice) kind = "voice";
    else if ((doc.mimeType || "").startsWith("audio/")) kind = "audio";
    else kind = "file";

    let thumb: string | undefined;
    for (const t of doc.thumbs ?? []) {
      if (t instanceof Api.PhotoStrippedSize) thumb = strippedToDataUrl(t);
    }

    return {
      kind,
      thumb,
      fileName,
      fileSize: Number(doc.size),
      mimeType: doc.mimeType,
      duration,
      width,
      height,
    };
  }

  return null;
}

/** Extract the sender id + display name from a group/channel message. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSender(msg: any): { id?: string; name?: string } {
  const from = msg.fromId;
  let id: string | undefined;
  if (from instanceof Api.PeerUser) id = from.userId.toString();
  else if (from instanceof Api.PeerChannel) id = from.channelId.toString();
  else if (from instanceof Api.PeerChat) id = from.chatId.toString();
  // GramJS attaches the resolved entity as `_sender` after getMessages.
  const sender = msg._sender;
  let name = "";
  if (sender) {
    if (sender.firstName || sender.lastName) {
      name = `${sender.firstName || ""} ${sender.lastName || ""}`.trim();
    } else if (sender.title) {
      name = sender.title;
    }
  }
  return { id, name: name || undefined };
}

/** Map a GramJS message to the client-facing shape. */
function mapMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
  readOutboxMaxId: number,
  isGroup: boolean,
): ChatMessage | null {
  if (!(msg instanceof Api.Message)) return null;
  const text: string = msg.message || "";
  const fromMe = Boolean(msg.out);
  const media = msg.media ? classifyMedia(msg.media) : null;
  // Sender labelling is only relevant for group/channel streams.
  const sender = isGroup && !fromMe ? extractSender(msg) : {};
  return {
    id: msg.id,
    text,
    date: msg.date,
    fromMe,
    // Outgoing messages the peer has already read are "seen" — Telegram tracks
    // this per-dialog via readOutboxMaxId, not per-message.
    status: fromMe ? (msg.id <= readOutboxMaxId ? "read" : "sent") : undefined,
    media: media ?? undefined,
    groupedId: msg.groupedId ? msg.groupedId.toString() : undefined,
    senderId: sender.id,
    senderName: sender.name,
  };
}

export async function POST(request: Request) {
  const { sessionString, userId, accessHash, chatId, limit, offsetId } =
    await request.json();
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  // Either a 1-to-1 user chat (userId) or a group/channel stream (chatId).
  const isGroup = !!chatId;
  if (!userId && !chatId) {
    return Response.json({ error: "Missing chat target" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();

    // For a group/channel the marked id resolves directly; for a user we build
    // an explicit InputPeerUser so it works on a cold client.
    const peer = isGroup
      ? String(chatId)
      : await resolveUserPeer(client, userId, accessHash);

    // Read state — the highest outgoing message id the peer has read. Used to
    // mark our own messages as "seen". Best-effort; user chats only.
    let readOutboxMaxId = 0;
    if (!isGroup && peer instanceof Api.InputPeerUser) {
      try {
        const res = await client.invoke(
          new Api.messages.GetPeerDialogs({
            peers: [new Api.InputDialogPeer({ peer })],
          }),
        );
        const dialog = res.dialogs?.[0];
        if (dialog instanceof Api.Dialog) {
          readOutboxMaxId = dialog.readOutboxMaxId ?? 0;
        }
      } catch {
        // ignore — messages still load, just without seen ticks
      }
    }

    const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
    // offsetId paginates into older history — getMessages returns messages
    // with id < offsetId. Omitted/0 ⇒ newest messages.
    const getOpts: { limit: number; offsetId?: number } = { limit: pageSize };
    const parsedOffset = Number(offsetId);
    if (Number.isFinite(parsedOffset) && parsedOffset > 0) {
      getOpts.offsetId = parsedOffset;
    }
    const messages = await client.getMessages(peer, getOpts);

    // getMessages returns newest-first; reverse for chronological display.
    const mapped: ChatMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = mapMessage(messages[i], readOutboxMaxId, isGroup);
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
