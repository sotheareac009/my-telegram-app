import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the current account_limit status for the signed-in access code:
 *   { limit: number | null, count: number, remaining: number | null, atLimit: boolean }
 *
 * Used by the client BEFORE the Add Account flow, so it can show an upfront
 * "limit reached" message instead of letting the user fight through phone +
 * SMS only to be rejected at sign-in.
 */
export async function GET() {
  const cookieStore = await cookies();
  const accessCode = cookieStore.get("app_access_code")?.value;
  if (!accessCode) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: code } = await supabase
    .from("access_codes")
    .select("account_limit")
    .eq("code", accessCode)
    .single();

  const limit: number | null =
    code?.account_limit != null ? Number(code.account_limit) : null;

  const { count } = await supabase
    .from("telegram_accounts")
    .select("id", { count: "exact", head: true })
    .eq("access_code", accessCode);

  const used = count ?? 0;
  const remaining = limit == null ? null : Math.max(0, limit - used);
  const atLimit = limit != null && used >= limit;

  return Response.json({ limit, count: used, remaining, atLimit });
}
