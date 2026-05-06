"use client";

interface SidebarProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const menuItems = [
  {
    id: "home",
    label: "Home",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "groups",
    label: "Groups",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "channels",
    label: "Channels",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 20h.01" />
        <path d="M7 20v-4" />
        <path d="M12 20v-8" />
        <path d="M17 20V8" />
        <path d="M22 4v16" />
      </svg>
    ),
  },
];

export default function Sidebar({
  activeMenu,
  onMenuChange,
  collapsed,
  onToggle,
}: SidebarProps) {
  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-40 flex h-16 flex-row border-t border-zinc-200 bg-white transition-all duration-300 md:static md:h-auto md:flex-col md:border-r md:border-t-0 dark:border-zinc-800 dark:bg-zinc-950 ${
        collapsed ? "w-[72px]" : "w-60"
      } max-md:w-full`}
    >
      {/* Toggle */}
      <div className="hidden h-16 items-center border-b border-zinc-200 px-4 md:flex dark:border-zinc-800">
        <button
          onClick={onToggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {!collapsed && (
          <span className="ml-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Menu
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="grid flex-1 grid-cols-3 gap-1 p-2 md:block md:space-y-1 md:p-3">
        {menuItems.map((item) => {
          const isActive = activeMenu === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              className={`group flex w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition-all md:flex-row md:justify-start md:gap-3 md:px-3 md:py-2.5 md:text-left ${
                isActive
                  ? "bg-blue-50 text-blue-600 shadow-sm dark:bg-blue-950/40 dark:text-blue-400"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
              } ${collapsed ? "md:justify-center" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className={isActive ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}>
                {item.icon}
              </span>
              <span
                className={`text-[11px] font-medium leading-none md:text-sm ${
                  collapsed ? "md:hidden" : ""
                }`}
              >
                {item.label}
              </span>
              {isActive && !collapsed && (
                <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-blue-500 md:block" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="hidden border-t border-zinc-200 px-4 py-3 md:block dark:border-zinc-800">
          <p className="text-[11px] text-zinc-400">Telegram Client v1.0</p>
        </div>
      )}
    </aside>
  );
}
