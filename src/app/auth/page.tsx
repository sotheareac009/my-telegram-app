"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    
    if (!code.trim()) {
      setError("Please enter an access code");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        // Success, reload to get past the middleware
        window.location.href = "/";
      } else {
        const data = await res.json();
        setError(data.error || "Invalid access code");
      }
    } catch (err) {
      setError("Failed to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-4 py-12 sm:px-6 lg:px-8 dark:bg-zinc-950">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl shadow-blue-500/5 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-blue-500/10">
        
        {/* Header pattern area */}
        <div className="relative flex h-32 flex-col items-center justify-center rounded-[10px] bg-blue-50 dark:bg-blue-950/30">
          <div className="absolute inset-0 overflow-hidden">
            <svg className="absolute left-[50%] top-0 h-[48rem] w-[128rem] -translate-x-[50%] stroke-blue-200/50 [mask-image:radial-gradient(64rem_34rem_at_center,white,transparent)] dark:stroke-blue-900/30" aria-hidden="true">
              <defs>
                <pattern id="grid-pattern-auth" width="40" height="40" patternUnits="userSpaceOnUse" x="50%" y="-1">
                  <path d="M.5 40V.5H40" fill="none"></path>
                </pattern>
              </defs>
              <rect width="100%" height="100%" strokeWidth="0" fill="url(#grid-pattern-auth)"></rect>
            </svg>
          </div>
          
          <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl shadow-blue-500/20 ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/10">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-8 sm:p-10">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Private Access
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              Please enter your unique access code to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8">
            <div className="space-y-4">
              <div>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter access code..."
                  className="block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-white dark:focus:border-blue-500 dark:focus:bg-zinc-900"
                  autoFocus
                />
              </div>
              
              {error && (
                <p className="text-sm font-medium text-red-500">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20 disabled:pointer-events-none disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Unlock Access"}
                {!loading && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                )}
              </button>
            </div>
          </form>

          <div className="mt-8 text-center border-t border-zinc-100 pt-6 dark:border-zinc-800/80">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Need access?</p>
            <a
              href="mailto:blaxkk.stone.68@gmail.com"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 transition-colors hover:text-blue-500 dark:text-zinc-300 dark:hover:text-blue-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Contact blaxkk.stone.68@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
