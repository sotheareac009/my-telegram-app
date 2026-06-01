import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import {
  checkAccountLimit,
  linkCurrentAccount,
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
      // the account_limit. If this Telegram account was trimmed because the
      // admin lowered the cap, we mustn't silently re-insert it just because
      // the session is still in localStorage. The session itself remains
      // valid (we can't kill it server-side without an explicit sign-out),
      // but it stops being TRACKED and won't be allowed back in on a fresh
      // sign-in until the admin raises the limit.
      const decision = await checkAccountLimit(summary.id);
      if (decision.allowed) {
        await linkCurrentAccount(summary);
      }
      return Response.json({ valid: true, user: summary });
    }

    return Response.json({ valid: false });
  } catch {
    return Response.json({ valid: false });
  }
}
