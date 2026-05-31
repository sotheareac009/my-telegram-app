import { createClient } from "@/lib/telegram";
import { Api, utils as telegramUtils } from "telegram";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Metadata for the composer's sticker picker. Returns the user's recent +
 * favorite stickers (small lists, cheap) plus the list of installed sticker
 * sets — only the set's id/title/icon, not the full sticker contents. The
 * picker loads each set on demand via `/api/telegram/stickers/set` so first
 * paint is one round trip instead of 12+.
 */

export interface StickerOut {
  id: string;
  accessHash: string;
  fileReference: string;
  mimeType: string;
  width?: number;
  height?: number;
  thumb?: string;
}

export interface StickerSetMeta {
  id: string;
  accessHash: string;
  title: string;
  count: number;
  /** Set cover thumb (inline base64 JPEG), if Telegram included one. */
  thumb?: string;
}

export interface StickersListResponse {
  recent: StickerOut[];
  faved: StickerOut[];
  sets: StickerSetMeta[];
}

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

function classifySticker(doc: Api.TypeDocument): StickerOut | null {
  if (!(doc instanceof Api.Document)) return null;
  const mimeType = doc.mimeType || "image/webp";
  let width: number | undefined;
  let height: number | undefined;
  for (const attr of doc.attributes) {
    if (attr instanceof Api.DocumentAttributeImageSize) {
      width = attr.w;
      height = attr.h;
    } else if (attr instanceof Api.DocumentAttributeVideo) {
      width = attr.w;
      height = attr.h;
    }
  }
  let thumb: string | undefined;
  for (const t of doc.thumbs ?? []) {
    if (t instanceof Api.PhotoStrippedSize) {
      thumb = strippedToDataUrl(t);
      break;
    }
  }
  return {
    id: doc.id.toString(),
    accessHash: doc.accessHash.toString(),
    fileReference: Buffer.from(doc.fileReference).toString("base64"),
    mimeType,
    width,
    height,
    thumb,
  };
}

function setMeta(set: Api.StickerSet): StickerSetMeta {
  let thumb: string | undefined;
  for (const t of set.thumbs ?? []) {
    if (t instanceof Api.PhotoStrippedSize) {
      thumb = strippedToDataUrl(t);
      break;
    }
  }
  return {
    id: set.id.toString(),
    accessHash: set.accessHash.toString(),
    title: set.title || "Stickers",
    count: set.count,
    thumb,
  };
}

export async function POST(request: Request) {
  const { sessionString } = await request.json().catch(() => ({}));
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();

    // Recent, faved, and the installed-sets index — all three are inexpensive
    // and independent, so fire them in parallel.
    const [recentResult, favedResult, allStickersResult] = await Promise.all([
      client
        .invoke(new Api.messages.GetRecentStickers({ hash: bigInt(0) }))
        .catch(() => null),
      client
        .invoke(new Api.messages.GetFavedStickers({ hash: bigInt(0) }))
        .catch(() => null),
      client
        .invoke(new Api.messages.GetAllStickers({ hash: bigInt(0) }))
        .catch(() => null),
    ]);

    const recent: StickerOut[] = [];
    if (recentResult instanceof Api.messages.RecentStickers) {
      for (const doc of recentResult.stickers) {
        const s = classifySticker(doc);
        if (s) recent.push(s);
      }
    }

    const faved: StickerOut[] = [];
    if (favedResult instanceof Api.messages.FavedStickers) {
      for (const doc of favedResult.stickers) {
        const s = classifySticker(doc);
        if (s) faved.push(s);
      }
    }

    const sets: StickerSetMeta[] = [];
    if (allStickersResult instanceof Api.messages.AllStickers) {
      for (const set of allStickersResult.sets) {
        sets.push(setMeta(set));
      }
    }

    const payload: StickersListResponse = { recent, faved, sets };
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load stickers";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
