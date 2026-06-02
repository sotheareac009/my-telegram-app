import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import {
  linkCurrentAccount,
  validateNewAccount,
} from "@/lib/telegram-account-link";

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
      const summary = {
        id: userInfo.id.toString(),
        firstName: userInfo.firstName ?? undefined,
        lastName: userInfo.lastName ?? undefined,
        username: userInfo.username ?? undefined,
        phone: userInfo.phone ?? undefined,
      };
      // Backfill / refresh the (access_code, telegram_id) row — but respect
      // both the account_limit AND the identity binding. If this Telegram
      // account was trimmed by a manual delete (or never authorized for
      // this code), we mustn't silently re-insert it just because the
      // session is still in localStorage. The session itself remains valid
      // (we can't kill it server-side without an explicit sign-out), but it
      // stops being TRACKED.
      const decision = await validateNewAccount(summary.id);
      if (!decision.allowed) {
        return Response.json({
          valid: false,
          error: decision.message ?? "Account not permitted",
          code: decision.code,
        });
      }
      await linkCurrentAccount(summary, sessionString);
      return Response.json({ valid: true, user: summary });
    }

    return Response.json({ valid: false });
  } catch {
    return Response.json({ valid: false });
  }
}
