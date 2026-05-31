import { createClient } from "@/lib/telegram";
import { Api, utils as telegramUtils } from "telegram";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fetch the stickers in a single installed pack. Called by the composer's
 * sticker picker once the user navigates to a pack tab, so first paint of
 * the picker doesn't pay for every pack the user has installed.
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

export async function POST(request: Request) {
  const { sessionString, setId, accessHash } = await request
    .json()
    .catch(() => ({}));
  if (typeof sessionString !== "string" || !sessionString) {
    return Response.json({ error: "Missing sessionString" }, { status: 400 });
  }
  if (!setId || !accessHash) {
    return Response.json({ error: "Missing set id" }, { status: 400 });
  }

  const client = createClient(sessionString);
  try {
    await client.connect();
    const result = await client.invoke(
      new Api.messages.GetStickerSet({
        stickerset: new Api.InputStickerSetID({
          id: bigInt(String(setId)),
          accessHash: bigInt(String(accessHash)),
        }),
        hash: 0,
      }),
    );
    const stickers: StickerOut[] = [];
    if (result instanceof Api.messages.StickerSet) {
      for (const doc of result.documents) {
        const s = classifySticker(doc);
        if (s) stickers.push(s);
      }
    }
    return Response.json({ stickers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load sticker set";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}
