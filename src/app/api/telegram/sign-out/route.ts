import { createClient } from "@/lib/telegram";
import { cancelAllJobs, userKeyFromSession } from "@/lib/forward-registry";
import { Api } from "telegram";
import { unlinkCurrentAccount } from "@/lib/telegram-account-link";

export async function POST(request: Request) {
  try {
    const { sessionString } = await request.json();
    if (!sessionString) {
      return Response.json({ success: true });
    }

    // Cancel any in-flight forwards for this account before the session is
    // invalidated — otherwise their detached workers would keep running and
    // then fail on a dead session. Switching accounts does NOT call sign-out,
    // so those jobs are left untouched and keep running.
    const cancelled = cancelAllJobs(userKeyFromSession(sessionString));
    if (cancelled > 0) {
      console.info(`[sign-out] cancelled ${cancelled} in-flight forward(s)`);
    }

    const client = createClient(sessionString);
    await client.connect();

    // Grab the telegram_id BEFORE the LogOut call — once the session is
    // invalidated we can't address it anymore, so we'd never know which row
    // to delete from telegram_accounts.
    let telegramId: string | null = null;
    try {
      const res = await client.invoke(
        new Api.users.GetFullUser({ id: "me" }),
      );
      const u = res.users[0];
      if (u && u.className === "User") telegramId = u.id.toString();
    } catch {
      // session may already be dead — proceed without unlinking, the
      // best-effort delete below silently no-ops on a null id.
    }

    await client.invoke(new Api.auth.LogOut());
    await client.disconnect();

    // Remove the (access_code, telegram_id) link row. Runs after LogOut so
    // a Telegram-side failure doesn't leave us with a dangling DB row.
    if (telegramId) {
      await unlinkCurrentAccount(telegramId);
    }

    return Response.json({ success: true });
  } catch {
    return Response.json({ success: true });
  }
}
