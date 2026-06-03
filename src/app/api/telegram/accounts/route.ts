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

  // Check if the access code is still active AND grab the holder info
  // (the contact name + phone the admin entered when issuing the code).
  // Surfaced in the Header menu so the user can tell at a glance whose
  // code they're operating under.
  const { data: codeRow, error: codeErr } = await supabase
    .from("access_codes")
    .select("is_active, first_name, last_name, phone_number")
    .eq("code", accessCode)
    .single();

  if (codeErr || !codeRow || !codeRow.is_active) {
    try {
      cookieStore.delete("app_access_code");
    } catch {
      // Safe fallback if delete fails
    }
    return Response.json({ error: "Access code revoked" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("telegram_accounts")
    .select(
      "telegram_id, phone, first_name, last_name, username, session, created_at, updated_at",
    )
    .eq("access_code", accessCode)
    .order("updated_at", { ascending: false });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const accounts = (data ?? []).map((row) => ({
    id: String(row.telegram_id),
    session: row.session || "",
    user: {
      id: String(row.telegram_id),
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      username: row.username || undefined,
      phone: row.phone || undefined,
    },
  }));

  return Response.json({
    accounts,
    accessCode,
    accessCodeHolder: {
      firstName: codeRow.first_name || undefined,
      lastName: codeRow.last_name || undefined,
      phoneNumber: codeRow.phone_number || undefined,
    },
  });
}
