import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import bigInt from "big-integer";

export async function POST(request: Request) {
  try {
    const { sessionString, groupId, accessHash, peerType } =
      await request.json();
    if (!sessionString || !groupId) {
      return Response.json({ error: "Missing params" }, { status: 400 });
    }

    const client = createClient(sessionString);
    await client.connect();

    try {
      // With an access hash the peer resolves on a cold client — needed for
      // forward origins the account doesn't have in its own dialogs.
      const entity = await client.getEntity(
        accessHash && accessHash !== "0"
          ? peerType === "channel"
            ? new Api.InputPeerChannel({
                channelId: bigInt(String(groupId)),
                accessHash: bigInt(String(accessHash)),
              })
            : new Api.InputPeerUser({
                userId: bigInt(String(groupId)),
                accessHash: bigInt(String(accessHash)),
              })
          : groupId,
      );
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
