"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import {
  ChatNavProvider,
  telegramLinkTarget,
  type ChatNavUser,
} from "./ChatNavContext";
import { UnreadProvider, type UnreadHandle } from "./UnreadContext";
import GroupsGrid, {
  type ChatFolder,
  type Group,
  type GroupInfo,
} from "./GroupsGrid";
import GroupMedia, { type MediaCacheEntry } from "./GroupMedia";
import Breadcrumb, { type BreadcrumbItem } from "./Breadcrumb";
import ForwardQueueDashboard from "./ForwardQueueDashboard";
import MyContacts from "./MyContacts";
import RecentChats from "./RecentChats";
import GroupChatView, { type GroupChatTarget } from "./GroupChatView";

const ACTIVE_MENU_STORAGE_KEY = "telegram-active-menu";
const ACTIVE_FOLDER_STORAGE_KEY = "telegram-active-folder";
const PAGE_STORAGE_KEY = "telegram-page";
const SCROLL_STORAGE_KEY = "telegram-scroll";
const SELECTED_GROUP_STORAGE_KEY = "telegram-selected-group";
const GROUP_VIEW_STORAGE_KEY = "telegram-group-view";
const VALID_MENUS = [
  "home",
  "groups",
  "channels",
  "queue",
  "my-contacts",
  "recent-chats",
] as const;

function readStoredGroupView(): "chat" | "media" {
  if (typeof window === "undefined") return "chat";
  try {
    const v = window.localStorage.getItem(GROUP_VIEW_STORAGE_KEY);
    if (v === "chat" || v === "media") return v;
  } catch {
    // ignore
  }
  return "chat";
}

function readStoredSelectedGroup(): GroupInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SELECTED_GROUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.title === "string"
    ) {
      return { id: parsed.id, title: parsed.title };
    }
  } catch {
    // ignore
  }
  return null;
}

function readStoredActiveMenu(): string {
  if (typeof window === "undefined") return "home";
  try {
    const stored = window.localStorage.getItem(ACTIVE_MENU_STORAGE_KEY);
    if (stored && (VALID_MENUS as readonly string[]).includes(stored)) {
      return stored;
    }
  } catch {
    // localStorage may throw in privacy modes — fall through to default
  }
  return "home";
}

type FolderByType = { groups: string; channels: string };
type PageByType = { groups: number; channels: number };

function readStoredJSON<T>(
  key: string,
  fallback: T,
  validate: (v: unknown) => v is T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (validate(parsed)) return parsed;
  } catch {
    // malformed JSON or storage unavailable
  }
  return fallback;
}

function isFolderByType(v: unknown): v is FolderByType {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as FolderByType).groups === "string" &&
    typeof (v as FolderByType).channels === "string"
  );
}

function isPageByType(v: unknown): v is PageByType {
  return (
    typeof v === "object" &&
    v !== null &&
    Number.isFinite((v as PageByType).groups) &&
    Number.isFinite((v as PageByType).channels) &&
    (v as PageByType).groups >= 1 &&
    (v as PageByType).channels >= 1
  );
}

function readStoredScroll(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(SCROLL_STORAGE_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    // ignore
  }
  return 0;
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

interface DashboardProps {
  user: UserInfo;
  session: string;
  accounts: TelegramAccount[];
  currentAccountId: string;
  onSwitchAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onSignOut: () => void;
  onLogoutAccessCode: () => void;
}

export default function Dashboard({
  user,
  session,
  accounts,
  currentAccountId,
  onSwitchAccount,
  onAddAccount,
  onSignOut,
  onLogoutAccessCode,
}: DashboardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string>(readStoredActiveMenu);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_MENU_STORAGE_KEY, activeMenu);
    } catch {
      // localStorage may throw in privacy modes — ignore
    }
  }, [activeMenu]);
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(
    readStoredSelectedGroup,
  );

  useEffect(() => {
    try {
      if (selectedGroup) {
        window.localStorage.setItem(
          SELECTED_GROUP_STORAGE_KEY,
          JSON.stringify(selectedGroup),
        );
      } else {
        window.localStorage.removeItem(SELECTED_GROUP_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [selectedGroup]);
  // Which sub-view a selected group/channel opens in. Defaults to the chat —
  // the media grid is reached via a header button, like the Telegram app.
  // Persisted so a refresh restores chat-vs-media along with the open group.
  const [groupView, setGroupView] = useState<"chat" | "media">(
    readStoredGroupView,
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_VIEW_STORAGE_KEY, groupView);
    } catch {
      // ignore
    }
  }, [groupView]);
  const [activeFolderByType, setActiveFolderByType] = useState<FolderByType>(
    () =>
      readStoredJSON<FolderByType>(
        ACTIVE_FOLDER_STORAGE_KEY,
        { groups: "all", channels: "all" },
        isFolderByType,
      ),
  );
  const [pageByType, setPageByType] = useState<PageByType>(() =>
    readStoredJSON<PageByType>(
      PAGE_STORAGE_KEY,
      { groups: 1, channels: 1 },
      isPageByType,
    ),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ACTIVE_FOLDER_STORAGE_KEY,
        JSON.stringify(activeFolderByType),
      );
    } catch {
      // ignore storage failures
    }
  }, [activeFolderByType]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_STORAGE_KEY, JSON.stringify(pageByType));
    } catch {
      // ignore storage failures
    }
  }, [pageByType]);

  const [groupsCache, setGroupsCache] = useState<Group[] | null>(null);
  const [foldersCache, setFoldersCache] = useState<ChatFolder[] | null>(null);
  const [mediaCache, setMediaCache] = useState<Record<string, MediaCacheEntry>>(
    {},
  );

  // Scroll restoration for the main content area. Saves the inner scroll
  // container's scrollTop on every scroll (frame-throttled), and restores it
  // once the relevant view has rendered enough content to scroll to.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoredRef = useRef(false);
  const targetScrollRef = useRef<number>(readStoredScroll());

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let queued = false;
    function onScroll() {
      // Skip writes until the initial restore has happened — otherwise the
      // first browser-driven scroll (often 0) clobbers the saved position.
      if (!scrollRestoredRef.current) return;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!el) return;
        try {
          window.localStorage.setItem(SCROLL_STORAGE_KEY, String(el.scrollTop));
        } catch {
          // ignore
        }
      });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Proactively load groups + folders on mount. Without this, refreshing
  // directly into a group view leaves groupsCache=null forever (because
  // GroupsGrid — the component that normally fetches dialogs — is never
  // rendered while selectedGroup is set), which leaves the forward
  // destination list empty and disables the Forward button.
  useEffect(() => {
    if (!session) return;
    if (groupsCache !== null && foldersCache !== null) return;
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/telegram/dialogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionString: session }),
        });
        const data = await res.json();
        if (cancelled) return;
        setGroupsCache(data.groups ?? []);
        setFoldersCache(data.folders ?? []);
      } catch {
        if (cancelled) return;
        setGroupsCache([]);
        setFoldersCache([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [session, groupsCache, foldersCache]);

  // Restore scroll once: on Home, immediately; on a list view, after data
  // loads so the document is tall enough to actually scroll to the target.
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    if (selectedGroup) return; // inside a specific group — different scope
    const ready =
      activeMenu === "home" ||
      ((activeMenu === "groups" || activeMenu === "channels") &&
        groupsCache !== null &&
        foldersCache !== null);
    if (!ready) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    // Wait one frame so the new layout is committed before we scroll.
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTop = targetScrollRef.current;
      scrollRestoredRef.current = true;
    });
  }, [activeMenu, selectedGroup, groupsCache, foldersCache]);

  const handleGroupsLoaded = useCallback((groups: Group[]) => {
    setGroupsCache(groups);
  }, []);
  const handleFoldersLoaded = useCallback((folders: ChatFolder[]) => {
    setFoldersCache(folders);
  }, []);
  const handleMediaCacheUpdate = useCallback(
    (cacheKey: string, entry: MediaCacheEntry) => {
      setMediaCache((prev) => ({ ...prev, [cacheKey]: entry }));
    },
    [],
  );

  // ── In-app navigation for chat links / contact shares ──────────────────
  // A user chat requested from a link or contact share; handed to MyContacts
  // (via the my-contacts menu) which opens the conversation.
  const [pendingUserChat, setPendingUserChat] = useState<ChatNavUser | null>(
    null,
  );
  // Group/channel chats shown as a full-screen overlay, kept as a stack: a
  // chat opened from a link inside another chat pushes a new level, so pressing
  // back pops one level (the parent chat) instead of closing the whole layer.
  const [chatStack, setChatStack] = useState<GroupChatTarget[]>([]);
  // Mirror of "is a chat overlay open" — lets stable callbacks below decide
  // without depending on (and churning with) chatStack.
  const chatOpenRef = useRef(false);
  useEffect(() => {
    chatOpenRef.current = chatStack.length > 0;
  }, [chatStack]);

  // Imperative handle the UnreadProvider writes into so we can clear a chat's
  // bucket optimistically when the user opens it — Dashboard sits outside the
  // provider and can't use the useUnread() hook directly.
  const unreadApi = useRef<UnreadHandle | null>(null);

  const openChat = useCallback((target: GroupChatTarget) => {
    setChatStack((prev) => [...prev, target]);
    if (target.id) unreadApi.current?.markRead(target.id);
  }, []);
  const closeTopChat = useCallback(() => {
    setChatStack((prev) => prev.slice(0, -1));
  }, []);

  const openUserChat = useCallback(
    (user: ChatNavUser) => {
      // Always push DMs onto the chat stack as an overlay layer — the source
      // chat (whether it's a group rendered in the main content area or an
      // already-stacked chat) stays mounted underneath with its scroll intact.
      // Back from this user chat pops one level, revealing the source chat at
      // exactly the message the user was reading when they clicked the @mention
      // / contact / link.
      openChat({
        kind: "user",
        id: user.id,
        accessHash: user.accessHash,
        title:
          [user.firstName, user.lastName].filter(Boolean).join(" ") || "Chat",
      });
    },
    [openChat],
  );

  /** Resolve a t.me link and open the channel/group/chat inside the app. */
  const openTelegramLink = useCallback(
    async (url: string) => {
      const fallback = () =>
        window.open(
          url.startsWith("http") ? url : `https://${url}`,
          "_blank",
          "noopener",
        );
      const target = telegramLinkTarget(url);
      if (!target) {
        fallback();
        return;
      }
      try {
        const res = await fetch("/api/telegram/resolve-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionString: session,
            ...(target.kind === "username"
              ? { username: target.value }
              : { inviteHash: target.value }),
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          fallback();
          return;
        }
        if (data.kind === "channel" || data.kind === "group") {
          // Open the group/channel as a chat stream (not the media grid).
          openChat({
            kind: data.kind,
            id: data.id,
            title: data.title,
            isMember: data.isMember,
            // Thread the accessHash through — required for join + conversation
            // calls on a cold gramjs client (every API route gets a fresh one).
            accessHash: data.accessHash,
          });
        } else if (data.kind === "invite-preview") {
          openChat({
            kind: "invite-preview",
            title: data.title,
            about: data.about,
            participants: data.participants,
            isChannel: data.isChannel,
            inviteHash: data.inviteHash,
          });
        } else if (data.kind === "user") {
          openUserChat({
            id: data.id,
            accessHash: data.accessHash,
            firstName: data.firstName || data.title || "Chat",
            lastName: data.lastName,
          });
        } else {
          fallback();
        }
      } catch {
        fallback();
      }
    },
    [session, openUserChat, openChat],
  );

  const chatNav = useMemo(
    () => ({ openTelegramLink, openUserChat, openChat }),
    [openTelegramLink, openUserChat, openChat],
  );

  function handleMenuChange(menu: string) {
    // Manual nav clears the saved scroll so the next refresh starts at the
    // top of whichever view the user lands on, not at a stale position.
    try {
      window.localStorage.removeItem(SCROLL_STORAGE_KEY);
    } catch {
      // ignore
    }
    setActiveMenu(menu);
    setSelectedGroup(null);
  }

  function handleGroupSelect(group: GroupInfo) {
    setSelectedGroup(group);
    // A group/channel opens in its chat by default.
    setGroupView("chat");
    // Viewing it counts as reading it — clear the unread badge in the list and
    // mark the chat read on Telegram. Also clear the sidebar's bucket count
    // optimistically so the badge updates without waiting for the SSE delta.
    unreadApi.current?.markRead(group.id);
    const cached = groupsCache?.find((g) => g.id === group.id);
    if (cached && cached.unreadCount > 0) {
      setGroupsCache((prev) =>
        prev
          ? prev.map((g) =>
              g.id === group.id ? { ...g, unreadCount: 0 } : g,
            )
          : prev,
      );
      void fetch("/api/telegram/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session, chatId: group.id }),
      });
    }
  }

  // GroupMedia's "View chat" button — switch the open group back to its chat.
  function handleViewChat() {
    setGroupView("chat");
  }

  function handleBackToList() {
    setSelectedGroup(null);
  }

  function handleLeaveGroup(groupId: string) {
    // Remove the left chat from the cached list so it disappears instantly
    setGroupsCache((prev) =>
      prev ? prev.filter((g) => g.id !== groupId) : prev,
    );
    // Also evict its media cache — entries are keyed by `${groupId}::${tab}`
    // so we need to drop every tab variant for this chat.
    setMediaCache((prev) => {
      const next: Record<string, MediaCacheEntry> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(`${groupId}::`) && k !== groupId) next[k] = v;
      }
      return next;
    });
    // Navigate back to the groups/channels list
    setSelectedGroup(null);
  }

  function handleSwitchAccount(accountId: string) {
    setSelectedGroup(null);
    setActiveMenu("home");
    setActiveFolderByType({ groups: "all", channels: "all" });
    setPageByType({ groups: 1, channels: 1 });
    setGroupsCache(null);
    setFoldersCache(null);
    setMediaCache({});
    try {
      window.localStorage.removeItem(SCROLL_STORAGE_KEY);
    } catch {
      // ignore
    }
    onSwitchAccount(accountId);
  }

  function getBreadcrumbs() {
    const items: BreadcrumbItem[] = [
      { label: "Home", onClick: () => handleMenuChange("home") },
    ];
    if (activeMenu === "groups" || activeMenu === "channels") {
      const label = activeMenu === "groups" ? "Groups" : "Channels";
      if (selectedGroup) {
        items.push({ label, onClick: handleBackToList });
        items.push({ label: selectedGroup.title });
      } else {
        items.push({ label });
      }
    }
    if (activeMenu === "queue") {
      items.push({ label: "Queue" });
    }
    return items;
  }

  return (
    <ChatNavProvider value={chatNav}>
      <UnreadProvider
        sessionString={session}
        apiRef={unreadApi}
        loadingFallback={
          <div className="flex h-dvh items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="flex flex-col items-center gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500 dark:border-zinc-700 dark:border-t-blue-400" />
              <span className="text-[12px] text-zinc-500 dark:text-zinc-400">
                Loading…
              </span>
            </div>
          </div>
        }
      >
      <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
        <Header
          user={user}
          session={session}
          accounts={accounts}
          currentAccountId={currentAccountId}
          onSwitchAccount={handleSwitchAccount}
          onAddAccount={onAddAccount}
          onSignOut={onSignOut}
          onLogoutAccessCode={onLogoutAccessCode}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            activeMenu={activeMenu}
            sessionString={session}
            onMenuChange={handleMenuChange}
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
          />

          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden pb-16 md:pb-0">
            {/* Breadcrumb */}
            {activeMenu !== "home" && (
              <div className="flex h-11 shrink-0 items-center border-b border-zinc-200/80 bg-white/60 px-4 backdrop-blur-sm sm:px-6 dark:border-zinc-800/80 dark:bg-zinc-900/40">
                <Breadcrumb items={getBreadcrumbs()} />
              </div>
            )}

            {/* Content */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
              {/* Home */}
              {activeMenu === "home" && (
                <div className="flex min-h-full flex-col items-center justify-center p-6">
                  <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
                    {/* Hero icon */}
                    <div className="relative">
                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-xl shadow-blue-500/30">
                        <svg
                          width="38"
                          height="38"
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
                      {/* Glow */}
                      <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-blue-500 to-cyan-400 opacity-20 blur-xl" />
                    </div>

                    <div>
                      <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                        Welcome back, {user.firstName} 👋
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                        Browse your Telegram groups and channels,
                        <br />
                        manage media and search messages.
                      </p>
                    </div>

                    {/* Quick nav cards */}
                    <div className="grid w-full grid-cols-2 gap-3">
                      <button
                        onClick={() => handleMenuChange("groups")}
                        className="group flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/10 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 transition-colors group-hover:bg-blue-100 dark:bg-blue-950/40">
                          <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-blue-600 dark:text-blue-400"
                          >
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            Groups
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            Browse media
                          </p>
                        </div>
                      </button>

                      <button
                        onClick={() => handleMenuChange("channels")}
                        className="group flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-500/10 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-800"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 transition-colors group-hover:bg-violet-100 dark:bg-violet-950/40">
                          <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-violet-600 dark:text-violet-400"
                          >
                            <path d="M2 20h.01" />
                            <path d="M7 20v-4" />
                            <path d="M12 20v-8" />
                            <path d="M17 20V8" />
                            <path d="M22 4v16" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            Channels
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            Browse media
                          </p>
                        </div>
                      </button>
                    </div>

                    {/* More destinations */}
                    <div className="w-full">
                      <p className="mb-2 px-1 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        More
                      </p>
                      <div className="grid w-full grid-cols-3 gap-3">
                        <button
                          onClick={() => handleMenuChange("queue")}
                          className="group flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-lg hover:shadow-amber-500/10 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-amber-800"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 transition-colors group-hover:bg-amber-100 dark:bg-amber-950/40">
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="text-amber-600 dark:text-amber-400"
                            >
                              <line x1="8" y1="6" x2="21" y2="6" />
                              <line x1="8" y1="12" x2="21" y2="12" />
                              <line x1="8" y1="18" x2="21" y2="18" />
                              <line x1="3" y1="6" x2="3.01" y2="6" />
                              <line x1="3" y1="12" x2="3.01" y2="12" />
                              <line x1="3" y1="18" x2="3.01" y2="18" />
                            </svg>
                          </div>
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            Queue
                          </p>
                        </button>

                        <button
                          onClick={() => handleMenuChange("my-contacts")}
                          className="group flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-500/10 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-800"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 transition-colors group-hover:bg-emerald-100 dark:bg-emerald-950/40">
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="text-emerald-600 dark:text-emerald-400"
                            >
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                            </svg>
                          </div>
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            My Contacts
                          </p>
                        </button>

                        <button
                          onClick={() => handleMenuChange("recent-chats")}
                          className="group flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-lg hover:shadow-sky-500/10 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-sky-800"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 transition-colors group-hover:bg-sky-100 dark:bg-sky-950/40">
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="text-sky-600 dark:text-sky-400"
                            >
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                          </div>
                          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                            Recent Chats
                          </p>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(activeMenu === "groups" || activeMenu === "channels") &&
                !selectedGroup && (
                  <GroupsGrid
                    session={session}
                    type={activeMenu === "channels" ? "channels" : "groups"}
                    activeFolderId={
                      activeMenu === "channels"
                        ? activeFolderByType.channels
                        : activeFolderByType.groups
                    }
                    onActiveFolderChange={(folderId) => {
                      setActiveFolderByType((prev) =>
                        activeMenu === "channels"
                          ? { ...prev, channels: folderId }
                          : { ...prev, groups: folderId },
                      );
                    }}
                    onGroupSelect={handleGroupSelect}
                    groups={groupsCache}
                    folders={foldersCache}
                    onGroupsLoaded={handleGroupsLoaded}
                    onFoldersLoaded={handleFoldersLoaded}
                    page={pageByType[activeMenu as "groups" | "channels"]}
                    onPageChange={(page) =>
                      setPageByType((prev) => ({ ...prev, [activeMenu]: page }))
                    }
                  />
                )}

              {(activeMenu === "groups" || activeMenu === "channels") &&
                selectedGroup && (
                  // Both views stay mounted (the inactive one is hidden with
                  // `visibility`, which keeps its layout) so switching between
                  // the chat and the media grid preserves each one's scroll
                  // position and loaded state.
                  <div key={selectedGroup.id} className="relative h-full">
                    <div
                      className={`absolute inset-0 ${
                        groupView === "media" ? "" : "invisible"
                      }`}
                    >
                      <GroupMedia
                        session={session}
                        groupId={selectedGroup.id}
                        groupTitle={selectedGroup.title}
                        onViewChat={handleViewChat}
                        mediaCache={mediaCache}
                        onCacheUpdate={handleMediaCacheUpdate}
                        destinationChats={groupsCache ?? []}
                        onLeave={() => handleLeaveGroup(selectedGroup.id)}
                      />
                    </div>
                    <div
                      className={`absolute inset-0 ${
                        groupView === "chat" ? "" : "invisible"
                      }`}
                    >
                      <GroupChatView
                        sessionString={session}
                        target={{
                          kind:
                            activeMenu === "channels" ? "channel" : "group",
                          id: selectedGroup.id,
                          title: selectedGroup.title,
                          isMember: true,
                        }}
                        onClose={handleBackToList}
                        onViewMedia={() => setGroupView("media")}
                      />
                    </div>
                  </div>
                )}

              {activeMenu === "queue" && <ForwardQueueDashboard />}
              {activeMenu === "recent-chats" && (
                <RecentChats sessionString={session} />
              )}
              {activeMenu === "my-contacts" && (
                <MyContacts
                  sessionString={session}
                  initialChat={pendingUserChat}
                  onInitialChatConsumed={() => setPendingUserChat(null)}
                />
              )}
            </div>

            {/* Open group/channel chats — a stacked layer over the main
                content area (header + sidebar stay visible). Every level stays
                mounted so a parent chat keeps its scroll position while you're
                deeper in; the top level renders opaque over the rest. Back
                pops one level down to the parent chat. */}
            {chatStack.length > 0 && (
              <div className="absolute inset-0 z-30">
                {chatStack.map((chat, i) => {
                  const isTop = i === chatStack.length - 1;
                  return (
                    <div
                      key={`${i}:${chat.id ?? chat.inviteHash ?? chat.title}`}
                      inert={!isTop}
                      className="absolute inset-0 bg-white dark:bg-zinc-950"
                    >
                      <GroupChatView
                        sessionString={session}
                        target={chat}
                        onClose={closeTopChat}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
      </UnreadProvider>
    </ChatNavProvider>
  );
}
