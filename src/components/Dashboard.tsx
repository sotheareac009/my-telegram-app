"use client";

import { useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import GroupsGrid, { type GroupInfo } from "./GroupsGrid";
import GroupMedia from "./GroupMedia";
import Breadcrumb, { type BreadcrumbItem } from "./Breadcrumb";

interface UserInfo {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

interface DashboardProps {
  user: UserInfo;
  session: string;
  onSignOut: () => void;
}

export default function Dashboard({ user, session, onSignOut }: DashboardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeMenu, setActiveMenu] = useState("home");
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);

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

  // Build breadcrumb items
  function getBreadcrumbs() {
    const items: BreadcrumbItem[] = [{ label: "Home", onClick: () => handleMenuChange("home") }];

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
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Header user={user} onSignOut={onSignOut} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeMenu={activeMenu}
          onMenuChange={handleMenuChange}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
        <main className="flex flex-1 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900/50">
          {/* Breadcrumb bar */}
          {activeMenu !== "home" && (
            <div className="flex h-12 shrink-0 items-center border-b border-zinc-200 px-6 dark:border-zinc-800">
              <Breadcrumb items={getBreadcrumbs()} />
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-y-auto">
            {activeMenu === "home" && (
              <div className="flex h-full flex-col items-center justify-center p-6">
                <div className="flex flex-col items-center gap-5 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/10 to-violet-500/10 dark:from-blue-500/20 dark:to-violet-500/20">
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-blue-600 dark:text-blue-400"
                    >
                      <path d="M21.198 2.433a2.242 2.242 0 0 0-1.022.215l-16.5 7.5a2.25 2.25 0 0 0 .126 4.303l4.698 1.174v4.875a2.25 2.25 0 0 0 3.96 1.473l2.073-2.395 4.199 3.148A2.25 2.25 0 0 0 22.2 21.1l1.5-16.5A2.25 2.25 0 0 0 21.198 2.433z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                      Welcome back, {user.firstName}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Select Groups or Channels from the sidebar to browse
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <button
                      onClick={() => handleMenuChange("groups")}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-8 py-6 shadow-sm transition-all hover:border-blue-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Groups</span>
                      <span className="text-xs text-zinc-500">Browse your groups</span>
                    </button>
                    <button
                      onClick={() => handleMenuChange("channels")}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-8 py-6 shadow-sm transition-all hover:border-blue-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-600">
                        <path d="M2 20h.01" />
                        <path d="M7 20v-4" />
                        <path d="M12 20v-8" />
                        <path d="M17 20V8" />
                        <path d="M22 4v16" />
                      </svg>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Channels</span>
                      <span className="text-xs text-zinc-500">Browse your channels</span>
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
                  onGroupSelect={handleGroupSelect}
                />
              )}

            {(activeMenu === "groups" || activeMenu === "channels") &&
              selectedGroup && (
                <GroupMedia
                  session={session}
                  groupId={selectedGroup.id}
                  groupTitle={selectedGroup.title}
                />
              )}
          </div>
        </main>
      </div>
    </div>
  );
}
