# Tigram — End-to-End User Flow

A complete walkthrough of what a customer experiences from the moment they discover the product to daily use. Written so you can drop sections of it into marketing copy, support docs, or onboarding emails.

---

## TL;DR — The 4 phases

| Phase | What happens | Where it happens |
|---|---|---|
| 1. **Discover** | Visitor lands on the marketing page, decides to buy | `/` (public landing page) |
| 2. **Purchase** | Visitor contacts you, pays, receives an access code | Email / external |
| 3. **Activate** | Visitor enters the code and connects their Telegram | `/auth` → `/app` |
| 4. **Use** | Browse, search, download, manage accounts | `/app` (dashboard) |

---

## Phase 1 — Discover (Public)

**Entry point:** `/` — the landing page.

Visitor arrives via a link, ad, social share, or word of mouth. The page is fully public — **no login required to browse it**.

What they see, in order:
1. **Hero** — value proposition, live "Get Started" CTA
2. **Stats strip** — social proof at a glance
3. **Features grid** — 11 capabilities, including 2 "Coming soon" cards (restricted-group saving, auto-archive)
4. **How it works** — 3 numbered steps so the path feels short
5. **Security section** — addresses the "is it safe to give my Telegram code?" objection head-on
6. **Final CTA** — last push, with no-credit-card / encrypted / cancel-anytime checkmarks
7. **Footer** — contact link

**Decision moment:** the user clicks **Get Started** anywhere on the page → routed to `/app`.

But because `/app` is gated, the proxy redirects them to `/auth` — the access-code entry page. There, the page tells them how to **request a code** (the `Contact blaxkk.stone.68@gmail.com` link at the bottom of `/auth`).

> **Why this works:** the visitor already wants in. They click *Get Started*, hit the access wall, and the wall itself tells them how to buy. Zero friction between curiosity and purchase intent.

---

## Phase 2 — Purchase (Off-platform)

This is the part that lives outside the app today. The flow is intentionally manual so you control who gets in.

### 2.1 — Customer reaches out

The customer emails you (link from `/auth`: `blaxkk.stone.68@gmail.com`). They typically include:
- Their name (optional)
- Their Telegram phone number (so you can match the code to a person)

### 2.2 — You collect payment

Whatever channel works for you — Telegram Stars, crypto, USDT, bank transfer, PayPal. Outside the app's scope.

### 2.3 — You generate the access code

1. Open `/admin` in your browser
2. Enter the admin password
3. Click **Generate New Code**
4. Fill in:
   - First name (optional)
   - Last name (optional)
   - **Phone number** (required — this is how you remember who the code belongs to)
5. Click **Generate Code**

A new row appears at the top of the table with a fresh code (e.g. `K9F2-X4LM`). The system marks it `Active` automatically.

### 2.4 — You deliver the code

Send the code back to the customer however you like (email, Telegram DM). One sentence is enough:

> Your access code is **K9F2-X4LM**. Open https://your-domain.com and click *Get Started*. Paste the code when asked.

---

## Phase 3 — Activate (First-time login)

The customer now has a code and is ready to use the service. This whole phase typically takes **under 60 seconds**.

### 3.1 — Enter the access code

1. Customer clicks the link → lands on `/`
2. Clicks **Get Started** → browser navigates to `/app`
3. The proxy ([src/proxy.ts](src/proxy.ts)) sees no `app_access_code` cookie → rewrites the response to `/auth`
4. The customer sees a clean "Private Access" card and pastes the code
5. Backend (`/api/auth/login`) validates the code against Supabase:
   - Code must exist in `access_codes` table
   - `is_active` must be `true`
6. On success, an `httpOnly` cookie `app_access_code` is set (1-year max-age) and the browser is redirected to `/app`

If the code is invalid or revoked, the page shows the appropriate error and the customer stays on `/auth`.

### 3.2 — Connect Telegram

Once past the gate, `/app` runs the Telegram sign-in flow ([src/app/app/page.tsx](src/app/app/page.tsx)):

1. **Phone number** — customer enters their phone (the same one tied to their Telegram account)
2. Backend `/api/telegram/send-code` calls Telegram's MTProto, which sends a verification code through the Telegram app on the customer's other devices
3. **Verification code** — customer types the code from their Telegram messages
4. **2FA password** *(only if the account has Two-Step Verification enabled)* — entered once, used immediately, never stored
5. Backend `/api/telegram/sign-in` exchanges all of the above for an MTProto **session string**
6. The session string is saved in the **customer's browser localStorage** (key `telegram_accounts`) — never sent to or stored on Tigram's servers

> **Critical detail to highlight in support replies:** the verification code never touches our servers in plain log form, the 2FA password is single-use, and the resulting session lives on the customer's machine. Customers can revoke us at any time from **Telegram → Settings → Devices**.

### 3.3 — First view of the dashboard

The session is validated by `/api/telegram/check-session`, which returns the user's Telegram profile. The customer now sees:
- Their name in the header
- The sidebar (Home, Groups, Channels)
- A welcome screen on the home tab with quick-action cards

That's it — they're activated.

---

## Phase 4 — Use (Day-to-day)

After activation, the experience is "open the URL and go." The session sticks around in the browser, so subsequent visits skip phase 3 entirely.

### 4.1 — Returning to the app

1. Customer opens the URL
2. Lands on `/` (still public)
3. Clicks **Get Started** or **Sign in** in the footer
4. Proxy sees their `app_access_code` cookie → lets `/app` through
5. `/app` reads `telegram_accounts` from localStorage → calls `check-session` → goes straight to the dashboard

No code re-entry. No phone re-entry. **Zero friction.**

### 4.2 — Core actions inside the dashboard

| Action | How they do it |
|---|---|
| **Browse groups** | Sidebar → Groups → grid of every group, filterable by your real Telegram folders |
| **Browse channels** | Sidebar → Channels → same grid, scoped to channels |
| **Open a chat's media** | Click any group/channel card → grid of all photos, videos, and files |
| **Filter by media type** | Tabs: All / Photos / Videos / Files |
| **Search inside a chat** | Search button → type a query *or paste a Telegram link* — debounced 400ms |
| **Open a media item** | Click thumbnail → full-screen viewer with album navigation |
| **Bulk select** | Multi-select mode → choose any number of items |
| **Bulk download as ZIP** | After selecting → Download → backend streams a ZIP from `/api/telegram/download-zip` |
| **Extract all links** | Bulk select → Extract Links → modal lists every URL with its caption, copy-to-clipboard |
| **Add another account** | Header avatar menu → Add account → repeat phase 3.2 with a different phone |
| **Switch accounts** | Header avatar menu → click any saved account |
| **Sign out** | Header avatar menu → Sign out (clears session for this account only) |

### 4.3 — Multi-account behavior

A customer can connect multiple Telegram accounts on the same browser. Sessions are stored as a list keyed by Telegram user ID. Switching is instant — no re-login needed because each session is already valid.

### 4.4 — Caching

Three caches kick in to make navigation feel snappy:
- `groupsCache` — the groups list, kept for the session
- `foldersCache` — the customer's Telegram chat folders
- `mediaCache` — per-group media, so re-opening a chat is instant

Caches are in-memory (React state). Closing the tab clears them.

---

## Edge cases & support scenarios

### "My code stopped working"

→ You revoked it in `/admin`, or it was never generated. Confirm in `/admin` that the code exists and `is_active` is true.

### "Telegram says I'm logged in somewhere else"

→ Normal. Tigram appears as a session in **Telegram → Settings → Devices**. The customer can leave it active or terminate it from there.

### "I want to delete my data"

→ Two steps:
1. Tell them to **Sign out** from the header menu (clears the session locally and on Telegram's side)
2. Optionally revoke their access code in `/admin` so they can't re-enter

After that, Tigram retains nothing about them — sessions live on their device, and we never had their messages.

### "I changed phones / browser"

→ They just enter their access code again on the new device, then re-do the Telegram phone-code login. The access code is re-usable.

### "I shared my code with a friend"

→ It will work for them — that's by design unless you explicitly revoke + re-issue. The phone number you saved with the code helps you spot misuse.

---

## Where each step lives in code

| Step | File |
|---|---|
| Public landing page | [src/app/page.tsx](src/app/page.tsx) |
| Access-code entry | [src/app/auth/page.tsx](src/app/auth/page.tsx) |
| Access-code validation | [src/app/api/auth/login/route.ts](src/app/api/auth/login/route.ts) |
| Cookie gate | [src/proxy.ts](src/proxy.ts) |
| Telegram login + dashboard host | [src/app/app/page.tsx](src/app/app/page.tsx) |
| Telegram phone send | [src/app/api/telegram/send-code/route.ts](src/app/api/telegram/send-code/route.ts) |
| Telegram sign-in (code + 2FA) | [src/app/api/telegram/sign-in/route.ts](src/app/api/telegram/sign-in/route.ts) |
| Session validation | [src/app/api/telegram/check-session/route.ts](src/app/api/telegram/check-session/route.ts) |
| Dashboard UI | [src/components/Dashboard.tsx](src/components/Dashboard.tsx) |
| Admin code management | [src/app/admin/page.tsx](src/app/admin/page.tsx) |
