"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

/**
 * Module-level cache: session string → blob object URL.
 * Persists for the lifetime of the browser tab so profile photos are
 * fetched at most once per session, regardless of how many times the
 * component mounts/unmounts (e.g. opening/closing the dropdown).
 */
const photoCache = new Map<string, string>();

/**
 * In-flight promise cache: prevents multiple concurrent fetches for the
 * same session when several components mount simultaneously.
 */
const photoInFlight = new Map<string, Promise<string | null>>();

async function fetchProfilePhoto(session: string): Promise<string | null> {
  // Return cached URL immediately.
  const cached = photoCache.get(session);
  if (cached) return cached;

  // Reuse an in-flight promise if one already started.
  const inFlight = photoInFlight.get(session);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const res = await fetch("/api/telegram/profile-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      photoCache.set(session, url);
      return url;
    } catch {
      return null;
    } finally {
      photoInFlight.delete(session);
    }
  })();

  photoInFlight.set(session, promise);
  return promise;
}

interface UserInfo {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

interface TelegramAccount {
  id: string;
  session: string;
  user: UserInfo;
}

interface HeaderProps {
  user: UserInfo;
  session: string;
  accounts: TelegramAccount[];
  currentAccountId: string;
  onSwitchAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onSignOut: () => void;
  /** Permanently unlink a Telegram account from the current access code
   * (LogOut + delete the link row). Frees the slot for a new account. */
  onRemoveAccount: (accountId: string) => void;
  onLogoutAccessCode: () => void;
}

type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "tigram-theme-mode";

function getInitials(user: UserInfo) {
  return (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "") || "U";
}

function getDisplayName(user: UserInfo) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.username || user.phone || "User";
}

function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

function InitialsAvatar({
  initials,
  size = "sm",
}: {
  initials: string;
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 font-bold text-white shadow-sm ${cls}`}
    >
      {initials}
    </div>
  );
}

function AccountAvatar({ account }: { account: TelegramAccount }) {
  // Seed from cache so there's no flash on remount (e.g. reopening the dropdown).
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    () => photoCache.get(account.session) ?? null
  );
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Already cached — nothing to do.
    if (photoCache.has(account.session)) return;

    fetchProfilePhoto(account.session).then((url) => {
      if (!cancelled) {
        if (url) setPhotoUrl(url);
        else setPhotoFailed(true);
      }
    });

    return () => { cancelled = true; };
  }, [account.session]);

  if (photoUrl && !photoFailed)
    return (
      <img
        src={photoUrl}
        alt={getDisplayName(account.user)}
        onError={() => setPhotoFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full object-cover shadow-sm"
      />
    );
  return <InitialsAvatar initials={getInitials(account.user)} />;
}

export default function Header({
  user,
  session,
  accounts,
  currentAccountId,
  onSwitchAccount,
  onAddAccount,
  onSignOut,
  onRemoveAccount,
  onLogoutAccessCode,
}: HeaderProps) {
  const [open, setOpen] = useState(false);
  // Seed from cache immediately so the header avatar never flashes on re-render.
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    () => photoCache.get(session) ?? null
  );
  const [photoFailed, setPhotoFailed] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [themeOpen, setThemeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const route = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target))
        setOpen(false);
      if (themeMenuRef.current && !themeMenuRef.current.contains(target))
        setThemeOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);

    if (themeMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyThemeMode("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;

    // If the session changes (account switch), reset failed state and
    // try to load. If already cached, just sync state without a network hit.
    setPhotoFailed(false);
    const cached = photoCache.get(session);
    if (cached) {
      setPhotoUrl(cached);
      return;
    }

    setPhotoUrl(null);
    fetchProfilePhoto(session).then((url) => {
      if (!cancelled) {
        if (url) setPhotoUrl(url);
        else setPhotoFailed(true);
      }
    });

    return () => { cancelled = true; };
  }, [session]);

  const initials = getInitials(user);
  const profileAvatar =
    photoUrl && !photoFailed ? (
      <img
        src={photoUrl}
        alt={user.firstName ?? "Profile"}
        onError={() => setPhotoFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-white/20"
      />
    ) : (
      <InitialsAvatar initials={initials} />
    );
  const themeLabel =
    themeMode === "system" ? "System" : themeMode === "dark" ? "Dark" : "Light";
  const themeOptions: { mode: ThemeMode; label: string; description: string }[] = [
    { mode: "system", label: "System", description: "Use device mode" },
    { mode: "light", label: "Light", description: "Always light" },
    { mode: "dark", label: "Dark", description: "Always dark" },
  ];
  const renderThemeIcon = (mode: ThemeMode) =>
    mode === "system" ? (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ) : mode === "dark" ? (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <path d="M20.2 14.3A7.5 7.5 0 0 1 9.7 3.8 8.5 8.5 0 1 0 20.2 14.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ) : (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-zinc-200/80 bg-white/90 px-4 shadow-sm backdrop-blur-xl sm:px-6 dark:border-zinc-800/80 dark:bg-zinc-950/90">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-md shadow-blue-500/30">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.198 2.433a2.242 2.242 0 0 0-1.022.215l-16.5 7.5a2.25 2.25 0 0 0 .126 4.303l4.698 1.174v4.875a2.25 2.25 0 0 0 3.96 1.473l2.073-2.395 4.199 3.148A2.25 2.25 0 0 0 22.2 21.1l1.5-16.5A2.25 2.25 0 0 0 21.198 2.433z" />
            </svg>
          </div>
          <span className="text-[15px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Tigram
          </span>
        </div>
      </div>

      {/* Right: Account */}
      <div className="flex items-center gap-2">
        <div className="relative" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => {
              setThemeOpen((value) => !value);
              setOpen(false);
            }}
            title={`Theme: ${themeLabel}`}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
            aria-label={`Theme mode: ${themeLabel}`}
            aria-expanded={themeOpen}
          >
            {renderThemeIcon(themeMode)}
            <span className="hidden sm:inline">{themeLabel}</span>
            <svg
              className={`hidden text-zinc-400 transition-transform duration-200 sm:block ${themeOpen ? "rotate-180" : ""}`}
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {themeOpen && (
            <div className="absolute right-0 top-full z-[60] mt-2 w-52 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-2xl shadow-zinc-200/60 dark:border-zinc-700/60 dark:bg-zinc-900 dark:shadow-black/40">
              {themeOptions.map((option) => {
                const selected = option.mode === themeMode;
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => {
                      setThemeMode(option.mode);
                      setThemeOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                      selected
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                        : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      {renderThemeIcon(option.mode)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {option.label}
                      </span>
                      <span className="block text-xs text-zinc-400">
                        {option.description}
                      </span>
                    </span>
                    {selected && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <button
            onClick={() => {
              route.push("/");
            }}
            className="hidden bg-gradient-to-r from-blue-500 to-cyan-400 cursor-pointer rounded-xl px-2 py-1.5 text-sm text-white transition-colors hover:from-blue-600 hover:to-cyan-500 sm:block"
          >
            View site
          </button>
        </div>
        <div className="relative cursor-pointer" ref={menuRef}>
          <button
            onClick={() => setOpen(!open)}
            className="cursor-pointer flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
          >
            {profileAvatar}
            <div className="hidden flex-col items-start sm:flex">
              <span className="text-[13px] font-semibold leading-tight text-zinc-800 dark:text-zinc-200">
                {user.firstName ?? "User"}
              </span>
              {user.username && (
                <span className="text-[11px] leading-tight text-zinc-400">
                  @{user.username}
                </span>
              )}
            </div>
            <svg
              className={`text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {open && (
            <div className="absolute right-0 top-full z-[60] mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl shadow-zinc-200/60 dark:border-zinc-700/60 dark:bg-zinc-900 dark:shadow-black/40">
              {/* Current user */}
              <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
                {profileAvatar}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {user.firstName} {user.lastName}
                  </p>
                  {user.username && (
                    <p className="truncate text-xs text-zinc-500">
                      @{user.username}
                    </p>
                  )}
                  {user.phone && (
                    <p className="truncate text-xs text-zinc-400">
                      +{user.phone}
                    </p>
                  )}
                </div>
              </div>

              {/* Accounts */}
              {accounts.length > 0 && (
                <div className="border-b border-zinc-100 p-1.5 dark:border-zinc-800">
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 cursor-pointer">
                    Switch Account
                  </p>
                  <div className="max-h-48 overflow-y-auto">
                    {accounts.map((account) => {
                      const isCurrent = account.id === currentAccountId;
                      return (
                        <div
                          key={account.id}
                          className={`group relative flex w-full min-w-0 items-center rounded-xl pr-1 transition-colors ${isCurrent ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              onSwitchAccount(account.id);
                            }}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left"
                          >
                            <AccountAvatar account={account} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium">
                                {getDisplayName(account.user)}
                              </p>
                              {account.user.username && (
                                <p className="truncate text-xs text-zinc-400">
                                  @{account.user.username}
                                </p>
                              )}
                            </div>
                            {isCurrent && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                            )}
                          </button>
                          {/* Unlink from access code — invalidates the
                              Telegram session AND removes the link row so
                              the slot is freed up for someone else.
                              Always rendered; the handler takes care of
                              the live-session case by either auto-switching
                              to another account (if any) or navigating to
                              the phone-login form (if this was the last
                              one) BEFORE the API call tears the session
                              down. */}
                          <button
                            type="button"
                            title="Remove from access code"
                            aria-label={`Remove ${getDisplayName(account.user)} from this access code`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpen(false);
                              onRemoveAccount(account.id);
                            }}
                            className="ml-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
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
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="p-1.5">
                <button
                  onClick={() => {
                    setOpen(false);
                    onAddAccount();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </div>
                  Add account
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    onSignOut();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-950/40">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </div>
                  Sign out
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    onLogoutAccessCode();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/60"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  Logout Access Code
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
