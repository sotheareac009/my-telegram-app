import { headers } from "next/headers";

export default async function AccessDenied() {
  const headersList = await headers();
  const blockedIp = headersList.get("x-blocked-ip") || "Unknown IP";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 py-12 sm:px-6 lg:px-8 dark:bg-zinc-950">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl shadow-red-500/5 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-red-500/10">
        
        {/* Header pattern area */}
        <div className="relative flex h-32 flex-col items-center justify-center rounded-[10px] bg-red-50 dark:bg-red-950/30">
          <div className="absolute inset-0 overflow-hidden">
            <svg className="absolute left-[50%] top-0 h-[48rem] w-[128rem] -translate-x-[50%] stroke-red-200/50 [mask-image:radial-gradient(64rem_34rem_at_center,white,transparent)] dark:stroke-red-900/30" aria-hidden="true">
              <defs>
                <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse" x="50%" y="-1">
                  <path d="M.5 40V.5H40" fill="none"></path>
                </pattern>
              </defs>
              <rect width="100%" height="100%" strokeWidth="0" fill="url(#grid-pattern)"></rect>
            </svg>
          </div>
          
          <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl shadow-red-500/20 ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/10">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-8 text-center sm:p-10">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Private Access Only
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            This application is private. If you need access, please contact the owner and provide them with your public IP address below so they can add you to the whitelist.
          </p>

          <div className="mt-8 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800/80 dark:bg-zinc-950/50">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Your Public IP Address
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <div className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              <p className="font-mono text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
                {blockedIp}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <a
              href="mailto:blaxkk.stone.68@gmail.com"
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-lg dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Email blaxkk.stone.68@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
