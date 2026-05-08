import { Api } from "telegram";
import bigInt from "big-integer";

export type MediaInfo = {
  location: Api.TypeInputFileLocation;
  dcId: number;
  fileSize: bigInt.BigInteger;
  mimeType: string;
  fileName: string;
};

export function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/x-matroska": ".mkv",
    "video/webm": ".webm",
    "video/3gpp": ".3gp",
    "video/x-msvideo": ".avi",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
  };
  return map[mimeType.toLowerCase()] ?? "";
}

export function buildMediaInfo(
  media: Api.TypeMessageMedia,
  messageId: number
): MediaInfo | null {
  if (media instanceof Api.MessageMediaDocument) {
    const doc = media.document;
    if (!(doc instanceof Api.Document)) return null;

    let fileName = "";
    for (const attr of doc.attributes) {
      if (attr instanceof Api.DocumentAttributeFilename) {
        fileName = attr.fileName;
      }
    }

    const mimeType = doc.mimeType || "application/octet-stream";
    if (!fileName) {
      fileName = `file_${messageId}${extensionForMime(mimeType)}`;
    }

    return {
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: "",
      }),
      dcId: doc.dcId,
      fileSize: doc.size,
      mimeType,
      fileName,
    };
  }

  if (media instanceof Api.MessageMediaPhoto) {
    const photo = media.photo;
    if (!(photo instanceof Api.Photo)) return null;

    let largest: Api.PhotoSize | Api.PhotoSizeProgressive | undefined;
    let largestBytes = 0;
    for (const size of photo.sizes) {
      if (size instanceof Api.PhotoSize && size.size > largestBytes) {
        largest = size;
        largestBytes = size.size;
      } else if (size instanceof Api.PhotoSizeProgressive) {
        const max = size.sizes[size.sizes.length - 1] ?? 0;
        if (max > largestBytes) {
          largest = size;
          largestBytes = max;
        }
      }
    }
    if (!largest) return null;

    return {
      location: new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: largest.type,
      }),
      dcId: photo.dcId,
      fileSize: bigInt(largestBytes),
      mimeType: "image/jpeg",
      fileName: `photo_${messageId}.jpg`,
    };
  }

  return null;
}
