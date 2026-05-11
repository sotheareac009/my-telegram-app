/* eslint-disable @typescript-eslint/no-require-imports */
import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { sessionString, userId, accessHash } = await request.json();
    if (!sessionString || !userId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    try {
      // Construct InputUser with the accessHash we already have from the
      // getMessages response — no getEntity() call needed, so this works
      // even with a freshly-created client that has an empty entity cache.
      const inputUser = new Api.InputUser({
        userId: bigInt(String(userId)),
        accessHash: bigInt(String(accessHash ?? "0")),
      });

      const photo = await client.downloadProfilePhoto(inputUser, {
        isBig: false,
      });

      if (!photo) {
        return Response.json({ error: "No photo" }, { status: 404 });
      }

      const data = photo instanceof Buffer ? photo : Buffer.from(photo);
      return new Response(data as unknown as BodyInit, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } finally {
      await client.disconnect();
    }
  } catch {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
