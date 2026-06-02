"use client";

import { useState, useEffect } from "react";
import Dashboard from "@/components/Dashboard";
import { ForwardJobsProvider } from "@/components/ForwardJobsContext";

type Step = "phone" | "code" | "password" | "done";

export interface UserInfo {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

export interface TelegramAccount {
  id: string;
  session: string;
  user: UserInfo;
}

const ACCOUNTS_KEY = "telegram_accounts";
const CURRENT_ACCOUNT_KEY = "telegram_current_account_id";
const LEGACY_SESSION_KEY = "telegram_session";

function readStoredAccounts(accessCode?: string): TelegramAccount[] {
  if (typeof window === "undefined") return [];

  try {
    const key = accessCode ? `telegram_accounts_${accessCode}` : ACCOUNTS_KEY;
    const raw = localStorage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (account): account is TelegramAccount =>
        typeof account?.id === "string" &&
        typeof account?.session === "string" &&
        typeof account?.user?.id === "string"
    );
  } catch {
    return [];
  }
}

function writeStoredAccounts(accounts: TelegramAccount[], currentId = "", accessCode?: string) {
  // We no longer write the accounts list or raw sessions to localstorage!
  // We only keep the active account ID preference as device-specific UI state.
  const currentAccountKey = accessCode ? `telegram_current_account_id_${accessCode}` : CURRENT_ACCOUNT_KEY;

  if (typeof window !== "undefined") {
    // Clean up any legacy accounts list or flat session keys for this access code
    if (accessCode) {
      localStorage.removeItem(`telegram_accounts_${accessCode}`);
      localStorage.removeItem(`telegram_session_${accessCode}`);
    }
    localStorage.removeItem(ACCOUNTS_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);

    if (currentId) {
      localStorage.setItem(currentAccountKey, currentId);
      return;
    }

    localStorage.removeItem(currentAccountKey);
  }
}

/**
 * Premium-styled overlay shown when a sign-in attempt is rejected. Two
 * variants: `limit` (cap exhausted) and `invalid` (Telegram account not
 * bound to this access code). Frosted backdrop, gradient badge, soft drop
 * shadow — matches the "Tigram" logo treatment on the auth screen so it
 * doesn't feel like a system alert.
 */
type AccessBlockedKind =
  | { kind: "limit"; limit: number }
  | { kind: "invalid" };

function AccessBlockedModal({
  payload,
  onClose,
}: {
  payload: AccessBlockedKind;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Per-variant copy + icon. The shell + animation is shared.
  const view =
    payload.kind === "limit"
      ? {
          title: "Account limit reached",
          body: (
            <>
              Your access code is limited to{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {payload.limit} Telegram account
                {payload.limit === 1 ? "" : "s"}
              </span>
              .
            </>
          ),
          subtle:
            "Sign out an existing account from the menu, or ask your admin to raise the limit.",
          gradient: "from-amber-400 to-rose-500",
          tintFrom: "from-amber-500/15",
          tintVia: "via-rose-500/10",
          icon: (
            <>
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </>
          ),
        }
      : {
          title: "Account not authorized",
          body: (
            <>
              This Telegram account isn&apos;t linked to your access code.
            </>
          ),
          subtle:
            "Sign in with the original Telegram account that registered this code, or contact your admin to issue a new code.",
          gradient: "from-rose-500 to-fuchsia-600",
          tintFrom: "from-rose-500/15",
          tintVia: "via-fuchsia-500/10",
          icon: (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </>
          ),
        };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-zinc-950/55 px-4 pb-8 pt-16 backdrop-blur-md sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={view.title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-white/95 shadow-2xl shadow-zinc-900/30 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-900/95"
      >
        {/* Decorative top gradient strip */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${view.tintFrom} ${view.tintVia} to-transparent`}
        />

        {/* Floating gradient badge */}
        <div className="relative flex justify-center pt-7">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${view.gradient} shadow-lg shadow-rose-500/30 ring-4 ring-white/80 dark:ring-zinc-900/80`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {view.icon}
            </svg>
          </div>
        </div>

        <div className="relative px-6 pb-6 pt-4 text-center">
          <h2 className="text-[17px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {view.title}
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {view.body}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-500">
            {view.subtle}
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-zinc-900/20 transition hover:bg-zinc-800 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Premium-styled confirmation modal for removing a Telegram account from
 * the current access code. Matches the `AccessBlockedModal` treatment but
 * with destructive red gradient and a trash-icon badge so the user
 * registers it as a destructive action.
 */
function RemoveAccountModal({
  accountName,
  willPushToLogin,
  loading,
  onCancel,
  onConfirm,
}: {
  accountName: string;
  /** True when this is the last linked account — the handler will land the
   * user on the phone-login form after removal. */
  willPushToLogin: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, loading]);

  return (
    <div
      onClick={loading ? undefined : onCancel}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-zinc-950/55 px-4 pb-8 pt-16 backdrop-blur-md sm:items-center sm:p-6"
      role="alertdialog"
      aria-modal="true"
      aria-label="Remove account"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-white/95 shadow-2xl shadow-zinc-900/30 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-900/95"
      >
        {/* Decorative red tint strip */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-red-500/15 via-rose-500/10 to-transparent" />

        {/* Trash icon badge */}
        <div className="relative flex justify-center pt-7">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/30 ring-4 ring-white/80 dark:ring-zinc-900/80">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </div>
        </div>

        <div className="relative px-6 pb-6 pt-4 text-center">
          <h2 className="text-[17px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Remove account?
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {accountName}
            </span>{" "}
            will be signed out of Telegram and unlinked from this access code.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-500">
            {willPushToLogin
              ? "You'll be returned to the sign-in screen to add a different Telegram account."
              : "You'll stay signed in to your other accounts."}
          </p>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="flex flex-1 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-red-500/30 transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Removing…
                </span>
              ) : (
                "Remove"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [password, setPassword] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [sessionString, setSessionString] = useState("");
  const [user, setUser] = useState<UserInfo | null>(null);
  const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
  const [activeAccessCode, setActiveAccessCode] = useState("");
  const [currentAccountId, setCurrentAccountId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  /** True when the user clicked "Add account" from the header menu.
   * Passed to the sign-in API so it skips the identity-binding check
   * and only enforces the count limit. */
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  /** Premium-styled overlay shown when a sign-in / add-account attempt is
   * blocked. Two reasons: cap exhausted, or the Telegram account isn't
   * authorized for this access code. Null = hidden. */
  const [blockedModal, setBlockedModal] = useState<AccessBlockedKind | null>(
    null,
  );
  /** Premium remove-confirm dialog state. Null = hidden. */
  const [removeConfirm, setRemoveConfirm] = useState<
    | {
        accountId: string;
        name: string;
        /** True when removing this account will land on the phone-login
         * form afterwards (it's the last linked account). */
        willPushToLogin: boolean;
      }
    | null
  >(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    async function initSession() {
      try {
        // Fetch accounts linked to this access code from the server
        const accountsRes = await fetch("/api/telegram/accounts");
        if (!accountsRes.ok) {
          // If the server says we are not authenticated (e.g. 401), we can't load anyway
          setChecking(false);
          return;
        }

        const accountsData = await accountsRes.json();
        const accessCode = accountsData.accessCode || "";
        setActiveAccessCode(accessCode);

        // Server-returned accounts
        const serverAccounts: TelegramAccount[] = accountsData.accounts ?? [];

        // Read stored accounts from access-code-specific or legacy keys for session migration
        let localAccounts = readStoredAccounts(accessCode);
        if (localAccounts.length === 0) {
          localAccounts = readStoredAccounts();
        }

        // Map of telegram_id -> session from local storage
        const localSessionMap = new Map<string, string>();
        for (const acc of localAccounts) {
          if (acc.session) {
            localSessionMap.set(String(acc.id), acc.session);
          }
        }

        // Build the combined list of accounts:
        // Use server accounts as the source of truth, but if a session is missing on the server,
        // fall back to the session from local storage.
        const mergedAccounts = serverAccounts.map((acc) => {
          const localSession = localSessionMap.get(String(acc.id));
          return {
            ...acc,
            session: acc.session || localSession || "",
          };
        });

        // If there's a session we retrieved from local storage that the server didn't have,
        // we trigger a check-session to backfill it in the DB.
        mergedAccounts.forEach((acc) => {
          const serverAcc = serverAccounts.find((s) => String(s.id) === String(acc.id));
          if (acc.session && (!serverAcc || !serverAcc.session)) {
            // Trigger checkSession in background to save the session to the DB
            void validateSession(acc.session).catch(() => {});
          }
        });

        // Update state with clean list
        setAccounts(mergedAccounts);

        // Select the current account to initialize
        const currentAccountKey = accessCode
          ? `telegram_current_account_id_${accessCode}`
          : CURRENT_ACCOUNT_KEY;
        let savedCurrentId = localStorage.getItem(currentAccountKey) || "";

        // Migration of active account ID from old flat key
        if (!savedCurrentId && accessCode) {
          const oldCurrentId = localStorage.getItem(CURRENT_ACCOUNT_KEY) || "";
          if (oldCurrentId && mergedAccounts.some((acc) => acc.id === oldCurrentId)) {
            savedCurrentId = oldCurrentId;
            localStorage.setItem(currentAccountKey, oldCurrentId);
            localStorage.removeItem(CURRENT_ACCOUNT_KEY);
          }
        }

        const selectedAccount =
          mergedAccounts.find((account) => account.id === savedCurrentId) ??
          mergedAccounts[0];

        if (selectedAccount && selectedAccount.session) {
          void checkSession(selectedAccount.session, {
            accountId: selectedAccount.id,
            preserveAccounts: mergedAccounts,
            accessCode,
          });
          return;
        }

        // Check legacy session if no accounts are loaded yet
        if (mergedAccounts.length === 0) {
          const legacySessionKey = accessCode
            ? `telegram_session_${accessCode}`
            : LEGACY_SESSION_KEY;
          let legacySession = localStorage.getItem(legacySessionKey);

          // Migration of legacy session from old flat key
          if (!legacySession && accessCode) {
            const oldLegacySession = localStorage.getItem(LEGACY_SESSION_KEY);
            if (oldLegacySession) {
              legacySession = oldLegacySession;
              localStorage.setItem(legacySessionKey, oldLegacySession);
              localStorage.removeItem(LEGACY_SESSION_KEY);
            }
          }
          if (legacySession) {
            void checkSession(legacySession, {
              preserveAccounts: mergedAccounts,
              accessCode,
            });
            return;
          }
        }

        setChecking(false);
      } catch (err) {
        console.error("Failed to initialize session:", err);
        setChecking(false);
      }
    }

    void initSession();
  }, []);

  async function validateSession(session: string): Promise<UserInfo | null> {
    const res = await fetch("/api/telegram/check-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionString: session }),
    });
    const data = await res.json();
    return data.valid ? data.user : null;
  }

  async function checkSession(
    session: string,
    options: { accountId?: string; preserveAccounts?: TelegramAccount[]; accessCode?: string } = {}
  ) {
    const codeToUse = options.accessCode || activeAccessCode;
    try {
      const validUser = await validateSession(session);
      if (validUser) {
        const accountId = options.accountId ?? validUser.id;
        const baseAccounts = options.preserveAccounts ?? accounts;
        const nextAccount: TelegramAccount = {
          id: accountId,
          session,
          user: validUser,
        };
        const nextAccounts = [
          nextAccount,
          ...baseAccounts.filter((account) => account.id !== accountId),
        ];

        setAccounts(nextAccounts);
        setCurrentAccountId(accountId);
        setUser(validUser);
        setSessionString(session);
        setIsAddingAccount(false);
        setStep("done");
        writeStoredAccounts(nextAccounts, accountId, codeToUse);
      } else {
        const nextAccounts = (options.preserveAccounts ?? accounts).filter(
          (account) => account.session !== session
        );
        setAccounts(nextAccounts);
        writeStoredAccounts(nextAccounts, nextAccounts[0]?.id ?? "", codeToUse);
      }
    } catch {
      const legacySessionKey = codeToUse ? `telegram_session_${codeToUse}` : LEGACY_SESSION_KEY;
      localStorage.removeItem(legacySessionKey);
    } finally {
      setChecking(false);
    }
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setPhoneCodeHash(data.phoneCodeHash);
        setSessionString(data.sessionString);
        setStep("code");
      }
    } catch {
      setError("Failed to send code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber,
          phoneCode,
          phoneCodeHash,
          sessionString,
          password: step === "password" ? password : undefined,
          addAccount: isAddingAccount,
          // Provide the currently-active telegram IDs so the server can
          // compute the effective active count (intersection with DB rows)
          // instead of using the raw historical DB count, which can be
          // inflated by rows that persist after sign-out.
          activeAccountIds: isAddingAccount
            ? accounts.map((a) => a.user.id)
            : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: "invalid-account" | "limit-reached";
        limit?: number;
        requiresPassword?: boolean;
        session?: string;
      };
      if (data.error) {
        // Server attaches a `code` discriminator for the two structured
        // rejection cases — surface those via the premium modal instead of
        // the inline auth-card error.
        if (data.code === "invalid-account") {
          // Reset the login form back to the phone step BEFORE showing
          // the modal so that when the user clicks "Got it" they land on
          // the phone-number screen, not stuck at the 2FA/code step.
          setPhoneNumber("");
          setPhoneCode("");
          setPhoneCodeHash("");
          setPassword("");
          setStep("phone");
          setBlockedModal({ kind: "invalid" });
        } else if (
          data.code === "limit-reached" &&
          typeof data.limit === "number"
        ) {
          setBlockedModal({ kind: "limit", limit: data.limit });
        } else {
          setError(data.error);
        }
      } else if (data.requiresPassword) {
        setStep("password");
      } else if (data.session) {
        setSessionString(data.session);
        await checkSession(data.session);
      }
    } catch {
      setError("Failed to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setLoading(true);
    try {
      await fetch("/api/telegram/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString }),
      });
    } finally {
      const nextAccounts = accounts.filter(
        (account) => account.id !== currentAccountId
      );
      const nextAccount = nextAccounts[0];

      setAccounts(nextAccounts);
      if (nextAccount) {
        setUser(nextAccount.user);
        setSessionString(nextAccount.session);
        setCurrentAccountId(nextAccount.id);
        setStep("done");
        writeStoredAccounts(nextAccounts, nextAccount.id, activeAccessCode);
      } else {
        // Logout: just reset to the login screen — do NOT call
        // startAddAccount() here because that checks the account-limit
        // and would show the "limit reached" modal, which is only meant
        // for when the user explicitly tries to add a new account.
        writeStoredAccounts([], "", activeAccessCode);
        setUser(null);
        setSessionString("");
        setPhoneNumber("");
        setPhoneCode("");
        setPhoneCodeHash("");
        setPassword("");
        setIsAddingAccount(false);
        setStep("phone");
      }
      setLoading(false);
    }
  }

  /**
   * Permanently remove a linked Telegram account from this access code.
   * Calls the dedicated `accounts/remove` endpoint which both invalidates
   * the Telegram session (auth.LogOut) and deletes the link row.
   *
   * Differs from handleSignOut in two ways:
   *   1. It can target any account, not just the currently active one.
   *   2. It frees the slot — useful when the user wants to hand the
   *      access code over to a different Telegram account.
   */
  /** Opens the premium remove-confirm modal for the given account. */
  function handleRemoveAccount(accountId: string) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const name =
      [account.user.firstName, account.user.lastName]
        .filter(Boolean)
        .join(" ") ||
      account.user.username ||
      account.user.phone ||
      "this account";
    const isRemovingCurrent = accountId === currentAccountId;
    const isLastAccount = accounts.length === 1;
    setRemoveConfirm({
      accountId,
      name,
      willPushToLogin: isRemovingCurrent && isLastAccount,
    });
  }

  /** Actually performs the removal after the modal confirmation. */
  async function confirmRemoveAccount() {
    if (!removeConfirm) return;
    const { accountId } = removeConfirm;
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      setRemoveConfirm(null);
      return;
    }

    const isRemovingCurrent = accountId === currentAccountId;
    const nextAccounts = accounts.filter((a) => a.id !== accountId);
    // Pre-pick the account we'd auto-switch to (if any) so we can install
    // it BEFORE the API call. The Dashboard re-mounts cleanly via its
    // `key={currentAccountId}` so polls/streams cut over to the new
    // session before the old one gets logged out by the server.
    const fallbackAccount = isRemovingCurrent ? nextAccounts[0] : null;

    if (isRemovingCurrent) {
      if (fallbackAccount) {
        // Auto-switch to another account. Dashboard re-keys on
        // currentAccountId so this remounts the tree on the new session.
        setUser(fallbackAccount.user);
        setSessionString(fallbackAccount.session);
        setCurrentAccountId(fallbackAccount.id);
        setStep("done");
      } else {
        // Last account — unmount Dashboard and land on the phone form.
        setUser(null);
        setSessionString("");
        setCurrentAccountId("");
        setPhoneNumber("");
        setPhoneCode("");
        setPhoneCodeHash("");
        setPassword("");
        setIsAddingAccount(false);
        setStep("phone");
      }
    }

    setRemoving(true);
    try {
      const res = await fetch("/api/telegram/accounts/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: accountId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error || "Failed to remove account");
        return;
      }

      setAccounts(nextAccounts);

      // Persist the trimmed list with the right "current" pointer.
      if (isRemovingCurrent) {
        writeStoredAccounts(
          nextAccounts,
          fallbackAccount ? fallbackAccount.id : "",
          activeAccessCode,
        );
      } else {
        // Still on the current account — just persist the trimmed list.
        writeStoredAccounts(nextAccounts, currentAccountId, activeAccessCode);
      }
    } catch {
      setError("Failed to remove account");
    } finally {
      setRemoving(false);
      setRemoveConfirm(null);
    }
  }

  async function handleLogoutAccessCode() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch (err) {
      console.error("Failed to log out of access code:", err);
      setError("Failed to log out of access code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function startAddAccount() {
    setError("");

    // IMPORTANT: check the cap BEFORE resetting auth state. Wiping `user`
    // up front would unmount the Dashboard and render the login screen
    // instead, where the modal we're about to show isn't visible.
    try {
      const res = await fetch("/api/auth/account-limit", {
        method: "GET",
        // GET — no body. The cookie carries the access code.
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          atLimit?: boolean;
          limit?: number | null;
        };
        // Compare against the number of accounts currently ACTIVE in the
        // app rather than data.atLimit (which uses the raw DB count). The
        // DB keeps rows after sign-out for identity-binding reasons, so it
        // can report "at limit" even when the user has fewer active sessions
        // than the actual cap.
        if (
          typeof data.limit === "number" &&
          data.limit > 0 &&
          accounts.length >= data.limit
        ) {
          setBlockedModal({ kind: "limit", limit: data.limit });
          return;
        }
      }
    } catch {
      // Best-effort — if the check itself fails, fall through to the phone
      // form. The server-side limit check in /api/telegram/sign-in is the
      // real gate, so a transient network blip here doesn't compromise
      // enforcement.
    }

    // Only now reset the auth form. Doing this before the check would
    // briefly drop the user off the Dashboard.
    setIsAddingAccount(true);
    setUser(null);
    setSessionString("");
    setPhoneNumber("");
    setPhoneCode("");
    setPhoneCodeHash("");
    setPassword("");
    setStep("phone");
  }

  function handleSwitchAccount(accountId: string) {
    const account = accounts.find((item) => item.id === accountId);
    if (
      !account ||
      (account.id === currentAccountId &&
        step === "done" &&
        user !== null &&
        sessionString === account.session)
    ) {
      return;
    }

    // Persist the new current account first so the reload picks it up.
    writeStoredAccounts(accounts, account.id, activeAccessCode);
    window.location.reload();
  }

  // Loading state
  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
          <p className="text-sm text-zinc-500">Checking session...</p>
        </div>
      </div>
    );
  }

  // Dashboard
  if (step === "done" && user) {
    return (
      <>
        <ForwardJobsProvider session={sessionString}>
          <Dashboard
            user={user}
            session={sessionString}
            accounts={accounts}
            currentAccountId={currentAccountId}
            onSwitchAccount={handleSwitchAccount}
            onAddAccount={startAddAccount}
            onSignOut={handleSignOut}
            onRemoveAccount={handleRemoveAccount}
            onLogoutAccessCode={handleLogoutAccessCode}
          />
        </ForwardJobsProvider>
        {blockedModal && (
          <AccessBlockedModal
            payload={blockedModal}
            onClose={() => setBlockedModal(null)}
          />
        )}
        {removeConfirm && (
          <RemoveAccountModal
            accountName={removeConfirm.name}
            willPushToLogin={removeConfirm.willPushToLogin}
            loading={removing}
            onCancel={() => {
              if (!removing) setRemoveConfirm(null);
            }}
            onConfirm={confirmRemoveAccount}
          />
        )}
      </>
    );
  }

  // Login
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-blue-50/30 p-4 sm:p-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-blue-950/10">
      {/* Defensive: also render the modal here in case state lands on the
          login screen with the modal already set. The post-auth identity
          rejection in handleSignIn actually fires while we're rendering
          the login screen, so this isn't theoretical. Same idea for the
          remove-confirm dialog — when removing the last account, the
          unmount-then-API flow puts us here while the modal is still up. */}
      {blockedModal && (
        <AccessBlockedModal
          payload={blockedModal}
          onClose={() => setBlockedModal(null)}
        />
      )}
      {removeConfirm && (
        <RemoveAccountModal
          accountName={removeConfirm.name}
          willPushToLogin={removeConfirm.willPushToLogin}
          loading={removing}
          onCancel={() => {
            if (!removing) setRemoveConfirm(null);
          }}
          onConfirm={confirmRemoveAccount}
        />
      )}
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center gap-4 sm:mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/25 sm:h-16 sm:w-16">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.198 2.433a2.242 2.242 0 0 0-1.022.215l-16.5 7.5a2.25 2.25 0 0 0 .126 4.303l4.698 1.174v4.875a2.25 2.25 0 0 0 3.96 1.473l2.073-2.395 4.199 3.148A2.25 2.25 0 0 0 22.2 21.1l1.5-16.5A2.25 2.25 0 0 0 21.198 2.433z" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Tigram
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {step === "phone" && "Sign in with your phone number"}
              {step === "code" && "Enter the verification code"}
              {step === "password" && "Two-factor authentication"}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-xl shadow-zinc-200/40 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/20">
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          {step === "phone" && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="+1 234 567 890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:bg-zinc-800"
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || !phoneNumber}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition-all hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  "Continue"
                )}
              </button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Verification Code
                </label>
                <input
                  type="text"
                  placeholder="12345"
                  value={phoneCode}
                  onChange={(e) => setPhoneCode(e.target.value)}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-center text-lg tracking-[0.3em] outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:bg-zinc-800"
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || !phoneCode}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition-all hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  "Verify"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError("");
                }}
                className="w-full text-sm text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Use a different number
              </button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  2FA Password
                </label>
                <input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:bg-zinc-800"
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading || !password}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition-all hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 disabled:shadow-none"
              >
                {loading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Secured with Telegram&apos;s MTProto encryption
        </p>
        {accounts.length > 0 && (
          <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="px-2 pb-2 text-xs font-semibold text-zinc-500">
              Saved accounts
            </p>
            <div className="space-y-1">
              {accounts.map((account) => {
                const name =
                  [account.user.firstName, account.user.lastName]
                    .filter(Boolean)
                    .join(" ") ||
                  account.user.username ||
                  account.user.phone ||
                  "User";
                const initials =
                  (account.user.firstName?.[0] ?? "") +
                    (account.user.lastName?.[0] ?? "") || "U";

                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => handleSwitchAccount(account.id)}
                    className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-bold text-white">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {name}
                      </p>
                      {account.user.username && (
                        <p className="truncate text-xs text-zinc-500">
                          @{account.user.username}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
