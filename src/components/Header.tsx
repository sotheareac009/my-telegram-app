"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

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
}

function getInitials(user: UserInfo) {
  return (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "") || "U";
}

function getDisplayName(user: UserInfo) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.username || user.phone || "User";
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPhoto() {
      setPhotoFailed(false);
      setPhotoUrl(null);
      try {
        const res = await fetch("/api/telegram/profile-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: account.session }),
        });
        if (!res.ok) {
          if (!cancelled) setPhotoFailed(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setPhotoUrl(objectUrl);
      } catch {
        if (!cancelled) setPhotoFailed(true);
      }
    }

    void loadPhoto();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
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
}: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const route = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    async function loadPhoto() {
      setPhotoFailed(false);
      setPhotoUrl(null);
      try {
        const res = await fetch("/api/telegram/profile-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session }),
        });
        if (!res.ok) {
          if (!cancelled) setPhotoFailed(true);
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setPhotoUrl(objectUrl);
      } catch {
        if (!cancelled) setPhotoFailed(true);
      }
    }
    void loadPhoto();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
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
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
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
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Switch Account
                  </p>
                  <div className="max-h-48 overflow-y-auto">
                    {accounts.map((account) => {
                      const isCurrent = account.id === currentAccountId;
                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            onSwitchAccount(account.id);
                          }}
                          className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${isCurrent ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"}`}
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
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
