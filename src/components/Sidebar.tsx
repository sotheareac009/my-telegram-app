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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "groups",
    label: "Groups",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 20h.01" />
        <path d="M7 20v-4" />
        <path d="M12 20v-8" />
        <path d="M17 20V8" />
        <path d="M22 4v16" />
      </svg>
    ),
  },
];

export default function Sidebar({ activeMenu, onMenuChange, collapsed, onToggle }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-col border-r border-zinc-200/80 bg-white transition-all duration-300 md:flex dark:border-zinc-800/80 dark:bg-zinc-950 ${
          collapsed ? "w-[64px]" : "w-52"
        }`}
      >
        {/* Toggle button */}
        <div className={`flex h-14 shrink-0 items-center border-b border-zinc-100 dark:border-zinc-800/80 ${collapsed ? "justify-center px-2" : "px-3"}`}>
          <button
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            {collapsed ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
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
            return (
              <button
                key={item.id}
                onClick={() => onMenuChange(item.id)}
                title={collapsed ? item.label : undefined}
                className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all duration-150 ${
                  isActive
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
                } ${collapsed ? "justify-center" : ""}`}
              >
                <span className={`shrink-0 transition-colors ${isActive ? "text-blue-500 dark:text-blue-400" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`}>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="text-[13px] font-medium">{item.label}</span>
                )}
                {isActive && !collapsed && (
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
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-zinc-200/80 bg-white/95 backdrop-blur-xl md:hidden dark:border-zinc-800/80 dark:bg-zinc-950/95">
        {menuItems.map((item) => {
          const isActive = activeMenu === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              className={`flex flex-1 flex-col items-center gap-1 py-2 transition-colors ${
                isActive ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              <span className={isActive ? "text-blue-500" : "text-zinc-400"}>{item.icon}</span>
              <span className="text-[10px] font-semibold">{item.label}</span>
              {isActive && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </nav>
    </>
  );
}
