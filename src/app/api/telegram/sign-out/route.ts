import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ success: true });
    }

    const client = createClient(sessionString);
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
    await client.disconnect();

    return Response.json({ success: true });
  } catch {
    return Response.json({ success: true });
  }
}
