import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import {
  linkCurrentAccount,
  validateNewAccount,
  type TelegramUserSummary,
  type ValidateNewAccountOptions,
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
    const { phoneNumber, phoneCode, phoneCodeHash, sessionString, password, addAccount, activeAccountIds } =
      await request.json();

    const validateOpts: ValidateNewAccountOptions = {
      addAccount: Boolean(addAccount),
      activeAccountIds: Array.isArray(activeAccountIds) ? activeAccountIds : undefined,
    };

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
    // returning the session, run the combined validation: limit + identity
    // binding. If anything rejects, log the fresh session out so we don't
    // leak it.
    const savedSession = client.session.save() as unknown as string;
    const self = await getSelf(client);
    if (self) {
      const decision = await validateNewAccount(self.id, validateOpts);
      if (!decision.allowed) {
        try {
          await client.invoke(new Api.auth.LogOut());
        } catch {
          // Best effort — Telegram occasionally rejects LogOut on a brand
          // new session; the worst case is an orphan session the user can
          // revoke from their Active Sessions list.
        }
        await client.disconnect();
        return Response.json(
          {
            error: decision.message ?? "Account not permitted",
            // Discriminator so the client can render the right modal
            // ("Account limit reached" vs "Account not authorized").
            code: decision.code,
            limit: decision.limit,
          },
          { status: 403 },
        );
      }
      await linkCurrentAccount(self, savedSession);
    }

    await client.disconnect();

    return Response.json({ session: savedSession, user: self ?? undefined });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to sign in";
    return Response.json({ error: message }, { status: 500 });
  }
}
