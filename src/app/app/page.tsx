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
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.requiresPassword) {
        setStep("password");
      } else {
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

  function startAddAccount() {
    setUser(null);
    setSessionString("");
    setPhoneNumber("");
    setPhoneCode("");
    setPhoneCodeHash("");
    setPassword("");
    setError("");
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
      <ForwardJobsProvider>
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
    );
  }

  // Login
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-blue-50/30 p-4 sm:p-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-blue-950/10">
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
