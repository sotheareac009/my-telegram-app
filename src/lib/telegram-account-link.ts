import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

/**
 * Telegram user fields the link row carries. Sourced from gramjs's
 * `users.GetFullUser` (or equivalent) on the route side.
 */
export interface TelegramUserSummary {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

/**
 * Upsert the (access_code, telegram_id) link row backing the
 * `telegram_accounts` table. Reads the access code from the request cookie
 * itself — no need to trust caller input. Best-effort: a DB error never
 * blocks the caller's main response (sign-in / session check still succeed).
 *
 * Called from:
 *   - /api/telegram/sign-in   → new account links on sign-in
 *   - /api/telegram/check-session → backfills accounts that signed in
 *                                   before this table existed, plus a
 *                                   no-op refresh of updated_at on app load
 */
export async function linkCurrentAccount(
  user: TelegramUserSummary,
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const accessCode = cookieStore.get("app_access_code")?.value;
    if (!accessCode) return;
    await supabase.from("telegram_accounts").upsert(
      {
        access_code: accessCode,
        telegram_id: user.id,
        phone: user.phone ?? null,
        first_name: user.firstName ?? null,
        last_name: user.lastName ?? null,
        username: user.username ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "access_code,telegram_id" },
    );
  } catch (err) {
    console.warn("[linkCurrentAccount] upsert failed:", err);
  }
}

/**
 * Result of the account-limit check before a new link is created.
 *  - `allowed`: the sign-in should proceed.
 *  - `reason`: human-readable explanation when not allowed, suitable for
 *    surfacing to the end user.
 */
export interface AccountLimitDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Result of `validateNewAccount` — combines the numeric account_limit check
 * AND the identity-binding rule (once any telegram_id is linked under a
 * given access code, only those telegram_ids can sign in with it).
 *
 * The `code` discriminator lets the client show different UI for the two
 * rejection cases — a "limit reached" badge vs an "account invalid" badge.
 */
export interface AccountValidation {
  allowed: boolean;
  /** Machine-readable rejection reason. */
  code?: "invalid-account" | "limit-reached";
  /** Human-readable message to surface to the user. */
  message?: string;
  /** For limit-reached only — the configured cap. */
  limit?: number;
}

/**
 * Full check applied at sign-in (and check-session) time. Rules:
 *
 *   1. If the signing-in telegram_id is already linked to this access code,
 *      always allow — re-signing in an existing account never needs gating.
 *   2. If at least one OTHER telegram_id is already linked, reject with
 *      `invalid-account`. This binds the access code to its initial user(s);
 *      a third party who somehow obtained the code can't sign in to a
 *      different Telegram account with it.
 *   3. If no linked accounts yet and account_limit is positive, allow the
 *      first sign-in (which will create the binding).
 *
 * Fails open on DB errors — better to let a sign-in through during a
 * Supabase blip than to lock everyone out.
 */
export async function validateNewAccount(
  telegramId: string,
): Promise<AccountValidation> {
  try {
    const cookieStore = await cookies();
    const accessCode = cookieStore.get("app_access_code")?.value;
    if (!accessCode) return { allowed: true };

    // Pull existing linked telegram_ids in one query.
    const { data: existing } = await supabase
      .from("telegram_accounts")
      .select("telegram_id")
      .eq("access_code", accessCode);
    const linkedIds = new Set(
      (existing ?? []).map((r) => String(r.telegram_id)),
    );

    // Re-sign-in of an already-linked account is always fine.
    if (linkedIds.has(telegramId)) return { allowed: true };

    // Identity rule: any prior link means no NEW telegram_ids permitted.
    if (linkedIds.size > 0) {
      return {
        allowed: false,
        code: "invalid-account",
        message:
          "This Telegram account isn't authorized for this access code. Sign in with the original account, or ask the admin to issue a new code.",
      };
    }

    // No prior links — first sign-in. Still respect a hard 0/negative
    // account_limit if the admin set one (effectively "code disabled").
    const { data: code } = await supabase
      .from("access_codes")
      .select("account_limit")
      .eq("code", accessCode)
      .single();
    const limit: number | null =
      code?.account_limit != null ? Number(code.account_limit) : null;
    if (limit != null && limit <= 0) {
      return {
        allowed: false,
        code: "limit-reached",
        limit,
        message:
          "This access code is not currently accepting Telegram accounts.",
      };
    }

    return { allowed: true };
  } catch (err) {
    console.warn("[validateNewAccount] failed:", err);
    return { allowed: true };
  }
}

/**
 * Check whether the current access code is allowed to link a new Telegram
 * account. Reads `access_codes.account_limit` (null = unlimited) and the
 * current count of rows in `telegram_accounts` for this code.
 *
 * Always allows the sign-in if the same telegram_id is already linked under
 * this access code — re-authenticating an existing account never trips the
 * limit (it's just an updated_at refresh).
 *
 * Fails open: if the DB lookup errors, the sign-in proceeds. We'd rather
 * not lock users out because of a transient DB blip.
 */
export async function checkAccountLimit(
  telegramId: string,
): Promise<AccountLimitDecision> {
  try {
    const cookieStore = await cookies();
    const accessCode = cookieStore.get("app_access_code")?.value;
    if (!accessCode) return { allowed: true };

    const { data: code } = await supabase
      .from("access_codes")
      .select("account_limit")
      .eq("code", accessCode)
      .single();

    const limit = code?.account_limit;
    if (limit == null || limit <= 0) return { allowed: true };

    // Re-signing in an account that's already linked is always fine — it
    // just refreshes the row, doesn't add to the count.
    const { count: alreadyCount } = await supabase
      .from("telegram_accounts")
      .select("id", { count: "exact", head: true })
      .eq("access_code", accessCode)
      .eq("telegram_id", telegramId);
    if ((alreadyCount ?? 0) > 0) return { allowed: true };

    const { count: total } = await supabase
      .from("telegram_accounts")
      .select("id", { count: "exact", head: true })
      .eq("access_code", accessCode);

    if ((total ?? 0) >= limit) {
      return {
        allowed: false,
        reason: `This access code has reached its limit of ${limit} Telegram account${limit === 1 ? "" : "s"}. Ask the admin to raise it or sign out an existing account first.`,
      };
    }
    return { allowed: true };
  } catch (err) {
    console.warn("[checkAccountLimit] failed:", err);
    return { allowed: true };
  }
}

/**
 * Trim the access code's telegram_accounts down to its current
 * account_limit. Deletes the **least recently active** rows first
 * (by updated_at), so accounts the user is actively using are preserved
 * and dormant ones get dropped.
 *
 * `check-session` and `linkCurrentAccount` both refresh `updated_at` on
 * every app load and sign-in, so a Telegram account currently in the
 * user's localStorage will always have a more recent `updated_at` than
 * one that hasn't been touched in days.
 *
 * No-op if account_limit is null or the count is already within bounds.
 */
export async function trimAccountsToLimit(
  accessCode: string,
  limit: number | null,
): Promise<number> {
  if (limit == null || limit <= 0) return 0;
  try {
    const { data: rows } = await supabase
      .from("telegram_accounts")
      .select("id, updated_at")
      .eq("access_code", accessCode)
      // Least-recently active first so they get sliced off the front.
      .order("updated_at", { ascending: true });
    const all = rows ?? [];
    if (all.length <= limit) return 0;
    const excess = all.slice(0, all.length - limit).map((r) => r.id);
    if (excess.length === 0) return 0;
    await supabase
      .from("telegram_accounts")
      .delete()
      .in("id", excess);
    return excess.length;
  } catch (err) {
    console.warn("[trimAccountsToLimit] failed:", err);
    return 0;
  }
}

/**
 * Remove the (access_code, telegram_id) link row for the current access
 * code. Called from sign-out so the DB stops tracking a Telegram account
 * after the user has explicitly logged it out from this access code.
 * Best-effort like the upsert above.
 */
export async function unlinkCurrentAccount(telegramId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    const accessCode = cookieStore.get("app_access_code")?.value;
    if (!accessCode) return;
    await supabase
      .from("telegram_accounts")
      .delete()
      .eq("access_code", accessCode)
      .eq("telegram_id", telegramId);
  } catch (err) {
    console.warn("[unlinkCurrentAccount] delete failed:", err);
  }
}
