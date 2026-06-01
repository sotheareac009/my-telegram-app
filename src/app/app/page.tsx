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

function readStoredAccounts(): TelegramAccount[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
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

function writeStoredAccounts(accounts: TelegramAccount[], currentId = "") {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));

  if (currentId) {
    const current = accounts.find((account) => account.id === currentId);
    localStorage.setItem(CURRENT_ACCOUNT_KEY, currentId);
    if (current) {
      localStorage.setItem(LEGACY_SESSION_KEY, current.session);
    }
    return;
  }

  localStorage.removeItem(CURRENT_ACCOUNT_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
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

export default function Home() {
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [password, setPassword] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [sessionString, setSessionString] = useState("");
  const [user, setUser] = useState<UserInfo | null>(null);
  const [accounts, setAccounts] = useState<TelegramAccount[]>(() =>
    readStoredAccounts()
  );
  const [currentAccountId, setCurrentAccountId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  /** Premium-styled overlay shown when a sign-in / add-account attempt is
   * blocked. Two reasons: cap exhausted, or the Telegram account isn't
   * authorized for this access code. Null = hidden. */
  const [blockedModal, setBlockedModal] = useState<AccessBlockedKind | null>(
    null,
  );

  useEffect(() => {
    const savedAccounts = readStoredAccounts();

    const savedCurrentId = localStorage.getItem(CURRENT_ACCOUNT_KEY) || "";
    const selectedAccount =
      savedAccounts.find((account) => account.id === savedCurrentId) ??
      savedAccounts[0];

    if (selectedAccount) {
      void checkSession(selectedAccount.session, {
        accountId: selectedAccount.id,
        preserveAccounts: savedAccounts,
      });
      return;
    }

    const legacySession = localStorage.getItem(LEGACY_SESSION_KEY);
    if (legacySession) {
      void checkSession(legacySession);
      return;
    }

    const id = window.setTimeout(() => setChecking(false), 0);
    return () => window.clearTimeout(id);
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
    options: { accountId?: string; preserveAccounts?: TelegramAccount[] } = {}
  ) {
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
        setStep("done");
        writeStoredAccounts(nextAccounts, accountId);
      } else {
        const nextAccounts = (options.preserveAccounts ?? accounts).filter(
          (account) => account.session !== session
        );
        setAccounts(nextAccounts);
        writeStoredAccounts(nextAccounts, nextAccounts[0]?.id ?? "");
      }
    } catch {
      localStorage.removeItem(LEGACY_SESSION_KEY);
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
        writeStoredAccounts(nextAccounts, nextAccount.id);
      } else {
        writeStoredAccounts([], "");
        startAddAccount();
      }
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
        if (data.atLimit && typeof data.limit === "number") {
          // Stay on the Dashboard — modal overlays over the existing screen.
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

    setUser(account.user);
    setSessionString(account.session);
    setCurrentAccountId(account.id);
    setStep("done");
    writeStoredAccounts(accounts, account.id);
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
            key={currentAccountId || sessionString}
            user={user}
            session={sessionString}
            accounts={accounts}
            currentAccountId={currentAccountId}
            onSwitchAccount={handleSwitchAccount}
            onAddAccount={startAddAccount}
            onSignOut={handleSignOut}
          />
        </ForwardJobsProvider>
        {blockedModal && (
          <AccessBlockedModal
            payload={blockedModal}
            onClose={() => setBlockedModal(null)}
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
          the login screen, so this isn't theoretical. */}
      {blockedModal && (
        <AccessBlockedModal
          payload={blockedModal}
          onClose={() => setBlockedModal(null)}
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
