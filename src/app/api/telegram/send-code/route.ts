import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { phoneNumber } = await request.json();
    if (!phoneNumber) {
      return Response.json({ error: "Phone number is required" }, { status: 400 });
    }

    const client = createClient();
    await client.connect();

    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber,
        apiId: Number(process.env.TELEGRAM_API_ID),
        apiHash: process.env.TELEGRAM_API_HASH!,
        settings: new Api.CodeSettings({}),
      })
    );

    const sessionString = client.session.save() as unknown as string;
    await client.disconnect();

    if (result.className === "auth.SentCodeSuccess") {
      await client.disconnect();
      return Response.json({ error: "Already logged in" }, { status: 400 });
    }

    return Response.json({
      phoneCodeHash: (result as Api.auth.SentCode).phoneCodeHash,
      sessionString,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send code";
    return Response.json({ error: message }, { status: 500 });
  }
}
