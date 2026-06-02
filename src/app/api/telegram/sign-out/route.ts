import { createClient } from "@/lib/telegram";
import { cancelAllJobs, userKeyFromSession } from "@/lib/forward-registry";
import { Api } from "telegram";

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
    await client.invoke(new Api.auth.LogOut());
    await client.disconnect();

    // Clear the active session in the database so it's no longer tracked as active
    const { supabase } = await import("@/lib/supabase");
    await supabase
      .from("telegram_accounts")
      .update({ session: null })
      .eq("session", sessionString);

    // NOTE: we intentionally do NOT delete the (access_code, telegram_id)
    // row from telegram_accounts here. The row IS the identity binding —
    // deleting it would clear the binding and let any other Telegram
    // account claim the access code on the next sign-in. The Telegram
    // session is gone (auth.LogOut above), but the link record persists
    // so re-signing in with the same telegram_id is still recognised and
    // unrelated accounts stay rejected. To explicitly free the slot, an
    // admin should delete the row directly (or use a future admin action).

    return Response.json({ success: true });
  } catch {
    return Response.json({ success: true });
  }
}
