import { createClient } from "@/lib/telegram";

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ error: "Missing session" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    try {
      const photo = await client.downloadProfilePhoto("me", {
        isBig: false,
      });

      if (!photo) {
        return Response.json({ error: "No photo" }, { status: 404 });
      }

      const data = photo instanceof Buffer ? photo : Buffer.from(photo);

      return new Response(data as unknown as BodyInit, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } finally {
      await client.disconnect();
    }
  } catch {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
