"use client";

import { useForwardJobs } from "./ForwardJobsContext";
import { useUnread } from "./UnreadContext";

interface SidebarProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  sessionString: string;
}

const menuItems = [
  {
    id: "home",
    label: "Home",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "groups-channels",
    label: "Group and Channel",
    /** Used in the mobile bottom nav where labels are tight. */
    mobileLabel: "Groups",
    icon: (
      // People + broadcast bars combined glyph — signals both groups
      // (chats) and channels (broadcast feeds) in one mark.
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 17v-2a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v2" />
        <circle cx="8" cy="7" r="3" />
        <line x1="18" y1="14" x2="18" y2="20" />
        <line x1="21" y1="11" x2="21" y2="20" />
        <line x1="15" y1="17" x2="15" y2="20" />
      </svg>
    ),
  },

  {
    id: "my-contacts",
    label: "My Contacts",
    /** Used in the mobile bottom nav where six items share the screen width. */
    mobileLabel: "Contacts",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: "recent-chats",
    label: "Recent Chats",
    mobileLabel: "Chats",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "queue",
    label: "Queue",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
];

/** Desktop pill — has room for the full count. */
function formatBadge(n: number): string {
  return n > 9999 ? "9999+" : String(n);
}

/** Mobile bottom-nav pill — six items share the width, so the badge must
 * stay narrow or it overlaps the next item. */
function formatBadgeCompact(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export default function Sidebar({
  activeMenu,
  onMenuChange,
  collapsed,
  onToggle,
}: SidebarProps) {
  const { jobs } = useForwardJobs();
  const queueCount = jobs.length;
  // Live unread counts — fed by Telegram's update stream via UnreadProvider
  // in Dashboard. No polling here; the context handles reconnects.
  const unread = useUnread();

  // One source of truth for every menu's badge value. Returns 0 when no
  // badge should be shown (home and my-contacts are launchpads, not chat
  // lists — surfacing an unread tally there isn't actionable).
  function badgeFor(id: string): number {
    switch (id) {
      case "groups-channels":
        // Merged view — sum unread across both buckets so the badge
        // reflects the combined inbox.
        return unread.groups + unread.channels;
      case "recent-chats":
        return unread.users;
      case "queue":
        return queueCount;
      default:
        return 0;
    }
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-col border-r border-zinc-200/80 bg-white transition-all duration-300 md:flex dark:border-zinc-800/80 dark:bg-zinc-950 ${collapsed ? "w-[64px]" : "w-52"
          }`}
      >
        {/* Toggle button */}
        <div className={`flex h-14 shrink-0 items-center border-b border-zinc-100 dark:border-zinc-800/80 ${collapsed ? "justify-center px-2" : "px-3"}`}>
          <button
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {!collapsed && (
            <span className="ml-2 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
              Navigation
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {menuItems.map((item) => {
            const isActive = activeMenu === item.id;
            const count = badgeFor(item.id);
            const showBadge = count > 0;
            const badgeText = formatBadge(count);
            // Queue gets the amber accent (action item) — unread chats use the
            // Telegram-style blue.
            const badgeClass =
              item.id === "queue"
                ? "bg-amber-500 text-white"
                : "bg-blue-500 text-white";
            return (
              <button
                key={item.id}
                onClick={() => onMenuChange(item.id)}
                title={collapsed ? item.label : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all duration-150 ${isActive
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
                  } ${collapsed ? "justify-center" : ""}`}
              >
                <span className={`relative shrink-0 transition-colors ${isActive ? "text-blue-500 dark:text-blue-400" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`}>
                  {item.icon}
                  {showBadge && collapsed && (
                    <span className={`absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${badgeClass}`}>
                      {badgeText}
                    </span>
                  )}
                </span>
                {!collapsed && (
                  <span className="text-[13px] font-medium">{item.label}</span>
                )}
                {showBadge && !collapsed && (
                  <span className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${badgeClass}`}>
                    {badgeText}
                  </span>
                )}
                {isActive && !collapsed && !showBadge && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-300 dark:text-zinc-600">TeleMedia v1.0</p>
          </div>
        )}
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-zinc-200/80 bg-white/95 px-1 backdrop-blur-xl md:hidden dark:border-zinc-800/80 dark:bg-zinc-950/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {menuItems.map((item) => {
          const isActive = activeMenu === item.id;
          const count = badgeFor(item.id);
          const showBadge = count > 0;
          const badgeText = formatBadgeCompact(count);
          const badgeClass =
            item.id === "queue"
              ? "bg-amber-500 text-white"
              : "bg-blue-500 text-white";
          return (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-1.5 transition-colors ${isActive ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                }`}
            >
              <span className={`relative ${isActive ? "text-blue-500" : "text-zinc-400"}`}>
                {item.icon}
                {showBadge && (
                  <span
                    className={`pointer-events-none absolute -right-2 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none ${badgeClass}`}
                  >
                    {badgeText}
                  </span>
                )}
              </span>
              <span className="w-full truncate px-0.5 text-center text-[10px] font-semibold leading-tight">
                {item.label}
              </span>
              {isActive && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </nav>
    </>
  );
}
