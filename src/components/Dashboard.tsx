"use client";

import { useCallback, useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import GroupsGrid, {
  type ChatFolder,
  type Group,
  type GroupInfo,
} from "./GroupsGrid";
import GroupMedia, { type MediaCacheEntry } from "./GroupMedia";
import Breadcrumb, { type BreadcrumbItem } from "./Breadcrumb";

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
}

export default function Dashboard({
  user,
  session,
  accounts,
  currentAccountId,
  onSwitchAccount,
  onAddAccount,
  onSignOut,
}: DashboardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeMenu, setActiveMenu] = useState("home");
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);
  const [activeFolderByType, setActiveFolderByType] = useState<{
    groups: string;
    channels: string;
  }>({ groups: "all", channels: "all" });
  const [groupsCache, setGroupsCache] = useState<Group[] | null>(null);
  const [foldersCache, setFoldersCache] = useState<ChatFolder[] | null>(null);
  const [mediaCache, setMediaCache] = useState<Record<string, MediaCacheEntry>>(
    {},
  );

  const handleGroupsLoaded = useCallback((groups: Group[]) => {
    setGroupsCache(groups);
  }, []);
  const handleFoldersLoaded = useCallback((folders: ChatFolder[]) => {
    setFoldersCache(folders);
  }, []);
  const handleMediaCacheUpdate = useCallback(
    (groupId: string, entry: MediaCacheEntry) => {
      setMediaCache((prev) => ({ ...prev, [groupId]: entry }));
    },
    [],
  );

  function handleMenuChange(menu: string) {
    setActiveMenu(menu);
    setSelectedGroup(null);
  }

  function handleGroupSelect(group: GroupInfo) {
    setSelectedGroup(group);
  }

  function handleBackToList() {
    setSelectedGroup(null);
  }

  function handleSwitchAccount(accountId: string) {
    setSelectedGroup(null);
    setActiveFolderByType({ groups: "all", channels: "all" });
    setGroupsCache(null);
    setFoldersCache(null);
    setMediaCache({});
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
    return items;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Header
        user={user}
        session={session}
        accounts={accounts}
        currentAccountId={currentAccountId}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={onAddAccount}
        onSignOut={onSignOut}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeMenu={activeMenu}
          onMenuChange={handleMenuChange}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-16 md:pb-0">
          {/* Breadcrumb */}
          {activeMenu !== "home" && (
            <div className="flex h-11 shrink-0 items-center border-b border-zinc-200/80 bg-white/60 px-4 backdrop-blur-sm sm:px-6 dark:border-zinc-800/80 dark:bg-zinc-900/40">
              <Breadcrumb items={getBreadcrumbs()} />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
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
                />
              )}

            {(activeMenu === "groups" || activeMenu === "channels") &&
              selectedGroup && (
                <GroupMedia
                  session={session}
                  groupId={selectedGroup.id}
                  groupTitle={selectedGroup.title}
                  cache={mediaCache[selectedGroup.id]}
                  onCacheUpdate={handleMediaCacheUpdate}
                />
              )}
          </div>
        </main>
      </div>
    </div>
  );
}
