import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import {
  checkAccountLimit,
  linkCurrentAccount,
  type TelegramUserSummary,
} from "@/lib/telegram-account-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Look up the signed-in Telegram user. Returns null if gramjs hands us back
 * something other than a regular User (UserEmpty, etc.) — caller treats that
 * as "user info unavailable" and proceeds without persisting the link.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSelf(client: any): Promise<TelegramUserSummary | null> {
  try {
    const res = await client.invoke(new Api.users.GetFullUser({ id: "me" }));
    const u = res.users[0];
    if (!u || u.className !== "User") return null;
    return {
      id: u.id.toString(),
      firstName: u.firstName || undefined,
      lastName: u.lastName || undefined,
      username: u.username || undefined,
      phone: u.phone || undefined,
    };
  } catch {
    return null;
  }
}

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
        }),
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
            password: await client
              .invoke(new Api.account.GetPassword())
              .then(async (srpData) => {
                const { computeCheck } = await import("telegram/Password");
                return computeCheck(srpData, password);
              }),
          }),
        );
      } else {
        throw error;
      }
    }

    // Sign-in succeeded on Telegram's side. Before persisting the link or
    // returning the session, enforce this access code's account_limit.
    const self = await getSelf(client);
    if (self) {
      const decision = await checkAccountLimit(self.id);
      if (!decision.allowed) {
        // Roll back the freshly-created Telegram session so we don't leak
        // an authenticated session for an account that's been refused.
        try {
          await client.invoke(new Api.auth.LogOut());
        } catch {
          // Best effort — Telegram occasionally rejects LogOut on a brand
          // new session; the worst case is an orphan session the user can
          // revoke from their Active Sessions list.
        }
        await client.disconnect();
        return Response.json(
          { error: decision.reason ?? "Account limit reached" },
          { status: 403 },
        );
      }
      await linkCurrentAccount(self);
    }

    const savedSession = client.session.save() as unknown as string;
    await client.disconnect();

    return Response.json({ session: savedSession, user: self ?? undefined });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to sign in";
    return Response.json({ error: message }, { status: 500 });
  }
}
