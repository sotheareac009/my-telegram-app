import { createClient } from "@/lib/telegram";

export async function POST(request: Request) {
  try {
    const { sessionString, groupId } = await request.json();
    if (!sessionString || !groupId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    try {
      const entity = await client.getEntity(groupId);
      const photo = await client.downloadProfilePhoto(entity, {
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
