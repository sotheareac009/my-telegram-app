import { createClient } from "@/lib/telegram";
import { Api } from "telegram";

export async function POST(request: Request) {
  try {
    const { phoneNumber, phoneCode, phoneCodeHash, sessionString, password } =
      await request.json();

    const client = createClient(sessionString);
    await client.connect();

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash,
          phoneCode,
        })
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes("SESSION_PASSWORD_NEEDED")
      ) {
        if (!password) {
          await client.disconnect();
          return Response.json({ requiresPassword: true });
        }
        await client.invoke(
          new Api.auth.CheckPassword({
            password: await client.invoke(new Api.account.GetPassword())
              .then(async (srpData) => {
                const { computeCheck } = await import("telegram/Password");
                return computeCheck(srpData, password);
              }),
          })
        );
      } else {
        throw error;
      }
    }

    const savedSession = client.session.save() as unknown as string;
    await client.disconnect();

    return Response.json({ session: savedSession });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to sign in";
    return Response.json({ error: message }, { status: 500 });
  }
}
