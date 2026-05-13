import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-white text-zinc-900">
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[700px] w-[1100px] -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px]" />
        <div className="absolute top-1/3 -left-40 h-[500px] w-[500px] rounded-full bg-cyan-200/40 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-violet-200/30 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #0a0a0a 1px, transparent 1px), linear-gradient(to bottom, #0a0a0a 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.06) 30%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.06) 30%, transparent 75%)",
          }}
        />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-zinc-200/60 bg-white/80 shadow-sm shadow-zinc-900/5 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-blue-500/30">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.198 2.433a2.242 2.242 0 0 0-1.022.215l-16.5 7.5a2.25 2.25 0 0 0 .126 4.303l4.698 1.174v4.875a2.25 2.25 0 0 0 3.96 1.473l2.073-2.395 4.199 3.148A2.25 2.25 0 0 0 22.2 21.1l1.5-16.5A2.25 2.25 0 0 0 21.198 2.433z" />
              </svg>
            </div>
            <span className="text-base font-semibold tracking-tight">
              Tigram
            </span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-zinc-600 md:flex">
            <a
              href="#features"
              className="transition-colors hover:text-zinc-900"
            >
              Features
            </a>
            <a href="#how" className="transition-colors hover:text-zinc-900">
              How it works
            </a>
            <a
              href="#security"
              className="transition-colors hover:text-zinc-900"
            >
              Security
            </a>
            <a href="#faq" className="transition-colors hover:text-zinc-900">
              FAQ
            </a>
            <a
              href="#pricing"
              className="transition-colors hover:text-zinc-900"
            >
              Pricing
            </a>
          </nav>
          <Link
            href="/app"
            className="hidden rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-zinc-900/10 transition-all hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-zinc-900/20 sm:inline-flex"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center px-6 pb-24 pt-16 text-center sm:px-10 sm:pt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          New · Multi-account workspaces
        </div>

        <h1 className="mt-7 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight text-zinc-900 sm:text-6xl md:text-7xl">
          Your Telegram,{" "}
          <span className="bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 bg-clip-text text-transparent">
            organized beautifully.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
          Browse every group, channel and media file from one elegant dashboard.
          Search across thousands of messages, download in bulk, and switch
          between accounts in a single click — all secured with native MTProto
          encryption.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/app"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-7 text-sm font-semibold text-white shadow-xl shadow-blue-500/25 transition-all hover:-translate-y-0.5 hover:shadow-blue-500/40"
          >
            Get Started — Free
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-1"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <a
            href="#features"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-zinc-200 bg-white px-7 text-sm font-semibold text-zinc-800 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
          >
            See features
          </a>
          <Link
            href="https://t.me/+EWxkTzhS5jBkOWVl"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-7 text-sm font-semibold text-white shadow-xl shadow-blue-500/25 transition-all hover:-translate-y-0.5 hover:shadow-blue-500/40"
          >
            Join our community channel
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-1"
            >
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
          </Link>
        </div>

        <p className="mt-5 text-xs text-zinc-500">
          No credit card required · Set up in under 60 seconds
        </p>

        {/* Hero visual */}
        <div className="mt-16 w-full max-w-5xl">
          <div className="relative rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50 p-1.5 shadow-2xl shadow-blue-500/10">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {/* Window chrome */}
              <div className="flex items-center gap-1.5 border-b border-zinc-100 bg-zinc-50/50 px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="ml-3 hidden text-xs text-zinc-500 sm:block">
                  app.tigram.io / dashboard
                </div>
              </div>

              {/* Mock dashboard layout */}
              <div className="grid grid-cols-12 gap-0">
                {/* Sidebar */}
                <div className="col-span-3 border-r border-zinc-100 bg-zinc-50/40 p-3 sm:p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400" />
                    <div className="hidden h-3 w-16 rounded-full bg-zinc-200 sm:block" />
                  </div>
                  <div className="space-y-2">
                    {["Home", "Groups", "Channels"].map((item, i) => (
                      <div
                        key={item}
                        className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs ${
                          i === 1 ? "bg-blue-50 text-blue-700" : "text-zinc-500"
                        }`}
                      >
                        <div
                          className={`h-3 w-3 rounded ${i === 1 ? "bg-blue-500" : "bg-zinc-300"}`}
                        />
                        <span className="hidden sm:inline">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Main content */}
                <div className="col-span-9 p-4 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="mb-1.5 h-3 w-20 rounded-full bg-zinc-300 sm:w-24" />
                      <div className="h-2 w-16 rounded-full bg-zinc-200" />
                    </div>
                    <div className="h-7 w-16 rounded-lg bg-blue-100 sm:w-20" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="aspect-square rounded-lg border border-zinc-100"
                        style={{
                          background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 80% 75%), hsl(${(i * 47 + 60) % 360} 80% 88%))`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 sm:px-10">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 sm:grid-cols-4">
          {[
            { v: "10×", l: "Faster than scrolling" },
            { v: "∞", l: "Groups & channels" },
            { v: "256-bit", l: "MTProto encryption" },
            { v: "0", l: "Servers store your data" },
          ].map((s) => (
            <div key={s.l} className="bg-white px-6 py-7 text-center">
              <div className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {s.v}
              </div>
              <div className="mt-1 text-xs text-zinc-500 sm:text-sm">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="relative z-10 mx-auto w-full max-w-7xl px-6 py-24 sm:px-10 sm:py-32"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            Everything you need.{" "}
            <span className="text-zinc-400">Nothing you don&apos;t.</span>
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Auto-archive new media",
              desc: "Pick a chat, set it and forget it. New photos and videos save to your private archive the moment they arrive.",
              comingSoon: true,
              icon: (
                <>
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </>
              ),
            },
            {
              title: "Save from restricted groups",
              desc: "Download and forward media from groups and channels with content protection turned on — straight to your archive.",
              comingSoon: false,
              icon: (
                <>
                  <path d="M12 15V3" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </>
              ),
            },
            
            {
              title: "Unified dashboard",
              desc: "Every group, channel, and DM in one organized view. No more endless scrolling.",
              icon: (
                <>
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </>
              ),
            },
            {
              title: "Bulk media downloads",
              desc: "Export entire chats as a ZIP. Photos, videos, documents — all preserved.",
              icon: (
                <>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </>
              ),
            },
            {
              title: "Lightning search",
              desc: "Find any message across thousands of chats in milliseconds.",
              icon: (
                <>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </>
              ),
            },
            {
              title: "Multi-account",
              desc: "Switch between personal and work accounts without ever signing out.",
              icon: (
                <>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </>
              ),
            },
            {
              title: "Native encryption",
              desc: "Built on Telegram's MTProto. Your sessions stay on your device — never on ours.",
              icon: (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </>
              ),
            },
            {
              title: "Beautiful media viewer",
              desc: "Browse galleries with a polished, full-screen viewer that respects your eyes.",
              icon: (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </>
              ),
            },
            {
              title: "Smart folders",
              desc: "Your existing Telegram chat folders, respected. Filter by Work, Personal, or anything you've organized.",
              icon: (
                <>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </>
              ),
            },
            {
              title: "Link extractor",
              desc: "Pull every link out of a chat with one click — captions included. Export the whole list to your clipboard.",
              icon: (
                <>
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </>
              ),
            },
            {
              title: "Media filters",
              desc: "Photos, videos, files — pick exactly what you want to see. Clean tabs, instant switching.",
              icon: (
                <>
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </>
              ),
            },
          ].map((f) => (
            <div
              key={f.title}
              className={`group relative overflow-hidden rounded-2xl border p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl ${
                f.comingSoon
                  ? "border-amber-200 bg-gradient-to-b from-amber-50/60 to-white hover:border-amber-300 hover:shadow-amber-500/10"
                  : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-blue-500/10"
              }`}
            >
              <div
                className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-3xl transition-all duration-500 ${
                  f.comingSoon
                    ? "bg-amber-300/0 group-hover:bg-amber-300/40"
                    : "bg-blue-300/0 group-hover:bg-blue-300/40"
                }`}
              />
              {f.comingSoon && (
                <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
                  </span>
                  Coming soon
                </span>
              )}
              <div className="relative">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-md ${
                    f.comingSoon
                      ? "bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/20"
                      : "bg-gradient-to-br from-blue-500 to-cyan-400 shadow-blue-500/20"
                  }`}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {f.icon}
                  </svg>
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-zinc-900">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  {f.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section
        id="how"
        className="relative z-10 mx-auto w-full max-w-7xl px-6 py-20 sm:px-10 sm:py-28"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            Up and running in 60 seconds.
          </h2>
        </div>

        <div className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          <div
            aria-hidden
            className="absolute left-1/2 top-7 hidden h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-zinc-300 to-transparent md:block"
          />
          {[
            {
              step: "01",
              title: "Enter access code",
              desc: "Use your unique invite code to unlock the workspace.",
            },
            {
              step: "02",
              title: "Connect Telegram",
              desc: "Sign in once with your phone — same as the official app.",
            },
            {
              step: "03",
              title: "Browse & enjoy",
              desc: "Your chats, organized. Your media, accessible. All yours.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="relative flex flex-col items-center text-center"
            >
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-bold text-blue-600 shadow-md shadow-blue-500/10">
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-50 to-transparent" />
                <span className="relative">{s.step}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-zinc-900">
                {s.title}
              </h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-zinc-600">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Security / trust */}
      <section
        id="security"
        className="relative z-10 mx-auto w-full max-w-7xl px-6 py-20 sm:px-10 sm:py-28"
      >
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          {/* Left: copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Built for trust
            </div>
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
              Why signing in is{" "}
              <span className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                100% safe.
              </span>
            </h2>
            <p className="mt-5 text-base leading-relaxed text-zinc-600">
              We get it — handing over a verification code or 2FA password feels
              uncomfortable. That&apos;s exactly why Tigram is designed so we
              never have to see them, and so you stay in control at every step.
            </p>

            <div className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5">
              <p className="text-sm leading-relaxed text-zinc-700">
                <span className="font-semibold text-zinc-900">
                  Just like Telegram Web.
                </span>{" "}
                Tigram uses the official{" "}
                <a
                  href="https://core.telegram.org/mtproto"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-400"
                >
                  MTProto
                </a>{" "}
                protocol — the same encrypted login flow used by Telegram&apos;s
                own apps. You can revoke our access anytime from Telegram
                &rsaquo; Settings &rsaquo; Active Sessions.
              </p>
            </div>
          </div>

          {/* Right: trust grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                title: "Code never leaves Telegram",
                desc: "The verification code goes straight to Telegram's servers to issue a session token. We never store or log it.",
                icon: (
                  <>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </>
                ),
              },
              {
                title: "2FA password is single-use",
                desc: "Used once to unlock your account, then immediately discarded. Never written to disk, never sent to our servers.",
                icon: (
                  <>
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </>
                ),
              },
              {
                title: "Session lives on your device",
                desc: "Your encrypted session token is stored in your browser only — not on our servers. Clear your browser, it's gone.",
                icon: (
                  <>
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </>
                ),
              },
              {
                title: "Revoke anytime",
                desc: "One click ends the session here, and Telegram lets you kill it from their app too. You stay in full control.",
                icon: (
                  <>
                    <path d="M3 12a9 9 0 1 0 9-9" />
                    <polyline points="3 4 3 12 11 12" />
                  </>
                ),
              },
              {
                title: "MTProto encryption",
                desc: "Every byte between you, Telegram, and Tigram is encrypted end-to-end with Telegram's native 256-bit MTProto.",
                icon: (
                  <>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </>
                ),
              },
              {
                title: "We can't read your chats",
                desc: "Tigram is a window into your Telegram — it can't decrypt anything Telegram doesn't already let your own client read.",
                icon: (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <line x1="3" y1="3" x2="21" y2="21" />
                  </>
                ),
              },
            ].map((t) => (
              <div
                key={t.title}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {t.icon}
                  </svg>
                </div>
                <h3 className="mt-4 text-sm font-semibold tracking-tight text-zinc-900">
                  {t.title}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
                  {t.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Trust signals strip */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl border border-zinc-200 bg-white px-6 py-5 text-xs font-medium text-zinc-600 shadow-sm sm:text-sm">
          <span className="inline-flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            No password storage
          </span>
          <span className="hidden h-4 w-px bg-zinc-200 sm:block" />
          <span className="inline-flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            No code logging
          </span>
          <span className="hidden h-4 w-px bg-zinc-200 sm:block" />
          <span className="inline-flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Official MTProto
          </span>
          <span className="hidden h-4 w-px bg-zinc-200 sm:block" />
          <span className="inline-flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Revoke anytime
          </span>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        className="relative z-10 mx-auto w-full max-w-4xl px-6 py-20 sm:px-10 sm:py-28"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
            FAQ
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
            Everything you might be wondering.
          </h2>
          <p className="mt-4 text-base text-zinc-600">
            Short, honest answers. Email{" "}
            <a
              href="mailto:blaxkk.stone.68@gmail.com"
              className="font-semibold text-blue-600 hover:underline"
            >
              blaxkk.stone.68@gmail.com
            </a>{" "}
            for anything else.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {[
            {
              q: "How do I get an access code?",
              a: (
                <>
                  Email us at{" "}
                  <a
                    href="mailto:blaxkk.stone.68@gmail.com"
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    blaxkk.stone.68@gmail.com
                  </a>{" "}
                  with your Telegram phone number. Once payment is confirmed,
                  you&apos;ll receive your unique access code — usually within a
                  few hours. Paste it on the access page and you&apos;re in.
                </>
              ),
            },
            {
              q: "Is it safe to enter my Telegram verification code and 2FA password?",
              a: (
                <>
                  Yes. Tigram uses Telegram&apos;s official MTProto — the same
                  protocol Telegram&apos;s own apps use. The verification code
                  goes straight to Telegram, your 2FA password is used once and
                  discarded, and the resulting session token is stored in your
                  browser only — never on our servers. See the{" "}
                  <a
                    href="#security"
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    Security section
                  </a>{" "}
                  for the full breakdown.
                </>
              ),
            },
            {
              q: "Will Tigram show up as a logged-in device in my Telegram?",
              a: (
                <>
                  Yes — that&apos;s how Telegram works for any third-party
                  client (just like Telegram Web or Desktop). You&apos;ll see
                  Tigram listed under{" "}
                  <span className="font-semibold">
                    Telegram → Settings → Devices
                  </span>
                  , where you can terminate the session anytime with one tap.
                </>
              ),
            },
            {
              q: "Can I use this with multiple Telegram accounts?",
              a: (
                <>
                  Yes. Add as many accounts as you want from the header menu —
                  switching between them is instant, no re-login needed. Each
                  account&apos;s session lives separately on your device.
                </>
              ),
            },
            {
              q: "Do you store my messages, photos, or videos?",
              a: (
                <>
                  No. We don&apos;t store your content anywhere. Tigram is a
                  client — it fetches your data live from Telegram and renders
                  it in your browser. When you download a ZIP, the file is
                  streamed straight from Telegram to you.
                </>
              ),
            },
            {
              q: "What happens if I switch browsers or devices?",
              a: (
                <>
                  Just enter your access code again on the new device, then sign
                  in to Telegram with your phone. Your access code is reusable —
                  no need to buy a new one. Your Telegram sessions are
                  device-specific by design.
                </>
              ),
            },
            {
              q: "How do I cancel or delete my data?",
              a: (
                <>
                  Click <span className="font-semibold">Sign out</span> from the
                  header menu — that ends the session here. To be extra
                  thorough, also terminate the Tigram session from{" "}
                  <span className="font-semibold">
                    Telegram → Settings → Devices
                  </span>
                  . After that, we retain nothing about you. Your messages were
                  never on our servers to begin with.
                </>
              ),
            },
            {
              q: "When are the &ldquo;Coming soon&rdquo; features launching?",
              a: (
                <>
                  Saving from restricted groups and auto-archive are actively
                  being built. Email us to be notified the moment they ship —
                  early users get them at launch with no price increase.
                </>
              ),
            },
          ].map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all open:shadow-md hover:border-zinc-300"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left">
                <span className="text-sm font-semibold tracking-tight text-zinc-900 sm:text-base">
                  {item.q}
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 transition-all group-open:rotate-45 group-open:border-blue-200 group-open:bg-blue-50 group-open:text-blue-600">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
              </summary>
              <div className="border-t border-zinc-100 px-6 py-5 text-sm leading-relaxed text-zinc-600">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* Pricing / final CTA */}
      <section
        id="pricing"
        className="relative z-10 mx-auto w-full max-w-5xl px-6 py-20 sm:px-10 sm:py-28"
      >
        <div className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-10 text-center shadow-xl shadow-blue-500/5 sm:p-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-blue-300/50 blur-[100px]" />
            <div className="absolute bottom-0 left-1/4 h-40 w-40 rounded-full bg-cyan-300/40 blur-[80px]" />
          </div>

          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
              Ready to take control of <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                your Telegram?
              </span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-zinc-600">
              Join the people already using Tigram to bring order to their
              messages. Get instant access today.
            </p>

            <Link
              href="/app"
              className="group mt-9 inline-flex h-12 items-center gap-2 rounded-full bg-zinc-900 px-8 text-sm font-semibold text-white shadow-2xl shadow-blue-500/20 transition-all hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-blue-500/30"
            >
              Get Started Now
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform group-hover:translate-x-1"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-500"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                No credit card
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-500"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                End-to-end encrypted
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-500"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Cancel anytime
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-200">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:px-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.198 2.433a2.242 2.242 0 0 0-1.022.215l-16.5 7.5a2.25 2.25 0 0 0 .126 4.303l4.698 1.174v4.875a2.25 2.25 0 0 0 3.96 1.473l2.073-2.395 4.199 3.148A2.25 2.25 0 0 0 22.2 21.1l1.5-16.5A2.25 2.25 0 0 0 21.198 2.433z" />
              </svg>
            </div>
            <span className="font-semibold text-zinc-700">Tigram</span>
            <span className="hidden sm:inline">
              © {new Date().getFullYear()}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="mailto:blaxkk.stone.68@gmail.com"
              className="transition-colors hover:text-zinc-800"
            >
              Contact
            </a>
            <Link href="/app" className="transition-colors hover:text-zinc-800">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
