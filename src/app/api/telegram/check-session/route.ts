import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ valid: false });
    }

    const client = createClient(sessionString);
    await client.connect();

    const user = await client.invoke(new Api.users.GetFullUser({ id: "me" }));
    const userInfo = user.users[0];
    await client.disconnect();

    if (userInfo && userInfo.className === "User") {
      return Response.json({
        valid: true,
        user: {
          id: userInfo.id.toString(),
          firstName: userInfo.firstName,
          lastName: userInfo.lastName,
          username: userInfo.username,
          phone: userInfo.phone,
        },
      });
    }

    return Response.json({ valid: false });
  } catch {
    return Response.json({ valid: false });
  }
}
