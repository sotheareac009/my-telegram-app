import { cookies } from "next/headers";
import { createClient } from "@/lib/telegram";
import { Api } from "telegram";
import { supabase } from "@/lib/supabase";
import { cancelAllJobs, userKeyFromSession } from "@/lib/forward-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Permanently remove a Telegram account from the current access code.
 *
 * Unlike sign-out (which preserves the link row so the identity binding
 * keeps rejecting unrelated accounts), this is the explicit "free the
 * slot" action. After it runs:
 *   - The Telegram session itself is logged out (auth.LogOut), so the
 *     session string left over in the now-deleted row can't be reused.
 *   - The row is deleted from telegram_accounts. If this was the last
 *     row for the access code, the identity binding is reset and a brand
 *     new Telegram account can sign in next.
 *
 * Body: { telegramId: string }
 * Cookie: app_access_code (set at access-code login)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const telegramId = body?.telegramId;
    if (!telegramId || typeof telegramId !== "string") {
      return Response.json({ error: "Missing telegramId" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessCode = cookieStore.get("app_access_code")?.value;
    if (!accessCode) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Look up the link row scoped to THIS access code, so a malicious
    // request can't delete rows belonging to a different code.
    const { data: row } = await supabase
      .from("telegram_accounts")
      .select("session")
      .eq("access_code", accessCode)
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (!row) {
      return Response.json(
        { error: "Account not linked to this access code" },
        { status: 404 },
      );
    }

    // Invalidate the Telegram session if we have one stashed. Best-effort:
    // a logged-out / revoked session just throws here, which is fine — we
    // still drop the row.
    const sessionString =
      typeof (row as { session?: unknown }).session === "string"
        ? ((row as { session: string }).session as string)
        : "";
    if (sessionString) {
      // Cancel any background forwards for this session first — otherwise
      // their workers keep firing against a dead client.
      const cancelled = cancelAllJobs(userKeyFromSession(sessionString));
      if (cancelled > 0) {
        console.info(
          `[accounts/remove] cancelled ${cancelled} in-flight forward(s)`,
        );
      }
      try {
        const client = createClient(sessionString);
        await client.connect();
        try {
          await client.invoke(new Api.auth.LogOut());
        } catch {
          // Session already dead or rejected LogOut — that's fine.
        }
        try {
          await client.disconnect();
        } catch {
          // ignore
        }
      } catch {
        // failed to even connect — proceed with the DB delete anyway.
      }
    }

    const { error: deleteError } = await supabase
      .from("telegram_accounts")
      .delete()
      .eq("access_code", accessCode)
      .eq("telegram_id", telegramId);
    if (deleteError) {
      return Response.json({ error: deleteError.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to remove account";
    return Response.json({ error: message }, { status: 500 });
  }
}
