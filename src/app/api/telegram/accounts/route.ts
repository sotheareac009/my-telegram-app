import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram accounts linked to the currently signed-in access code. The link
 * row is created on every successful Telegram sign-in by /api/telegram/sign-in.
 * Sessions are NOT stored here — they stay in the browser's localStorage —
 * so this list is metadata only (telegram_id, display name, phone, etc.).
 *
 * Useful for: an admin view of who's using each access code, and the future
 * "this access code already has accounts on another device, restore them"
 * UX (which requires shipping session storage too — out of scope for now).
 */
export async function GET() {
  const cookieStore = await cookies();
  const accessCode = cookieStore.get("app_access_code")?.value;
  if (!accessCode) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("telegram_accounts")
    .select(
      "telegram_id, phone, first_name, last_name, username, created_at, updated_at",
    )
    .eq("access_code", accessCode)
    .order("updated_at", { ascending: false });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ accounts: data ?? [], accessCode });
}
