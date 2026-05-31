import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";
import { getSharedClient } from "@/lib/unread-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream the raw bytes of a stored sticker (or any document) referenced by
 * id + accessHash + fileReference. Used by the composer's sticker picker
 * to render real sticker images instead of the blurry stripped thumbnail.
 *
 * Cached aggressively — sticker file bytes don't change once published, so
 * the WebView can reuse them across picker openings. The proxy's no-store
 * default explicitly excludes /api/telegram/chat-media; this route piggybacks
 * on the same exclusion via its own Cache-Control header below.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionString = url.searchParams.get("sessionString");
  const id = url.searchParams.get("id");
  const accessHash = url.searchParams.get("accessHash");
  const fileReference = url.searchParams.get("fileReference");
  const mimeType =
    url.searchParams.get("mimeType") || "application/octet-stream";

  if (!sessionString || !id || !accessHash || !fileReference) {
    return new Response("Missing params", { status: 400 });
  }

  // If the SSE update stream already has a connected gramjs client for this
  // session, reuse it — saves ~3 round-trips of MTProto handshake per file.
  // For a picker rendering 50+ stickers in parallel that's the difference
  // between "feels instant" and "feels janky".
  const shared = getSharedClient(sessionString);
  const client = shared ?? createClient(sessionString);
  const ownsClient = !shared;

  try {
    if (ownsClient) {
      await client.connect();
    }
    const buf = await client.downloadFile(
      new Api.InputDocumentFileLocation({
        id: bigInt(id),
        accessHash: bigInt(accessHash),
        fileReference: Buffer.from(fileReference, "base64"),
        thumbSize: "",
      }),
      {},
    );
    if (!buf) {
      return new Response("Empty", { status: 404 });
    }
    // gramjs may return Buffer or string here; the platform Response accepts
    // both at runtime but TypeScript's lib targets the strict BodyInit union.
    // Same cast pattern as src/app/api/telegram/dialog-photo/route.ts.
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Failed", { status: 500 });
  } finally {
    // Only disconnect clients we created ourselves — never the SSE stream's
    // long-lived one, or we'd kill its live-updates subscription.
    if (ownsClient) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
    }
  }
}
