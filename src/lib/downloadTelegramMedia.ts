"use client";

interface DownloadTelegramMediaParams {
  session: string;
  groupId: string;
  messageId: number;
  fileName: string;
  onProgress?: (progress: number | null) => void;
}

export async function downloadTelegramMedia({
  session,
  groupId,
  messageId,
  fileName,
  onProgress,
}: DownloadTelegramMediaParams) {
  const body = new URLSearchParams({
    sessionString: session,
    groupId,
    messageId: String(messageId),
    download: "1",
  });

  const res = await fetch("/api/telegram/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error("Failed to download media");
  }

  const resolvedFileName =
    getFileNameFromDisposition(res.headers.get("content-disposition")) ||
    fileName;

  if (!res.body) {
    const blob = await res.blob();
    saveBlob(blob, resolvedFileName);
    onProgress?.(100);
    return;
  }

  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    received += value.length;

    if (total > 0) {
      onProgress?.(Math.min(100, Math.round((received / total) * 100)));
    } else {
      onProgress?.(null);
    }
  }

  const blob = new Blob(chunks, {
    type: res.headers.get("content-type") || "application/octet-stream",
  });

  saveBlob(blob, resolvedFileName);
  onProgress?.(100);
}

function saveBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

function getFileNameFromDisposition(contentDisposition: string | null) {
  if (!contentDisposition) return "";

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const basicMatch = contentDisposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  return basicMatch?.[1]?.trim() || "";
}
