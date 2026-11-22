# Monetra Progress

## Initial source delivery
- [x] Angular standalone application scaffold
- [x] IndexedDB/Dexie data layer
- [x] Income and expense transactions
- [x] Virtual savings ledger and goal deposits
- [x] Budget setup and spending health indicators
- [x] Dashboard, analytics and responsive navigation
- [x] Local JSON backup/restore and CSV export
- [x] Notification center, sound preview and foreground daily reminder check
- [x] Gemini server function and explicit consent
- [x] Basic PWA manifest and service worker shell caching
- [x] Vercel configuration
- [x] Set the server-side Gemini model to `gemini-2.5-flash-lite` and remove the model environment override

## Audit & repair pass (2026-11-21)
Full code audit, repair, and verification. All items below were executed against the real repository, not estimated.

### Fixed
- **TS2345 build blocker** (`src/app/app.component.ts`, `exportCsv`): the CSV quoting callback `(s: string) => string` was mapped over an array containing `t.amount: number`. Widened the callback to `(value: string | number | null | undefined) => string`. This was the exact Vercel build failure.
- **TS4111** (`api/ai/chat.js`): `process.env.GOOGLE_GEMINI_API` violated `noPropertyAccessFromIndexSignature`; now `process.env['GOOGLE_GEMINI_API']`.
- **`Math.min` used in a template expression** (budget progress bar): `Math` is not available in Angular templates under `strictTemplates`. Replaced with the typed component method `budgetPercent(b: Budget)` (was `budgetPercent(b: any)`).
- **Zoneless change detection bug** (high impact): Angular 21 runs zoneless by default; the app only updates the UI through signals. `aiLoading`, `aiError`, `aiAnswer`, `notifications`, `notificationPermission`, `online`, `goalImageUrls` were plain properties updated from async code, so the AI chat spinner stuck on "Menganalisis..." forever and the offline indicator never updated. All seven converted to `signal()` and template bindings updated (`aiLoading()`, `online()`, etc.). Verified in a real headless browser: spinner now clears and error renders without user interaction.
- **PWA stale-shell risk** (`public/sw.js`): the old service worker cached `index.html` cache-first with an unversioned cache, so a redeploy could serve an old shell referencing deleted hashed bundles (blank screen). Now: network-first for navigations, cache-first for hashed assets, cache bumped to `monetra-shell-v2`, `clients.claim()` after activation.
- **Gemini upstream timeout** (`api/ai/chat.js`): added `AbortSignal.timeout(20_000)` and a 504 response with a clear message on `TimeoutError`.
- **AI token efficiency** (`askGemini`): the request previously sent *every* stored transaction including notes. Now sends a compact snapshot: monthly summary (balances, income, expense, spending rate), top expense categories, goals, budgets, and at most the 25 most recent transactions without notes.
- **Type safety cleanup**: `settings: any` → typed `AppSettings` with safe fallback if the row is missing; `notifications: any[]` → `AppNotification[]`; `toastTimer: any` → `ReturnType<typeof setTimeout>`; `installPrompt: any` → minimal structural type; `catch(e: any)` → `catch(e: unknown)` with `instanceof Error` handling; backup JSON parsing goes through explicit validation helpers (`unknownToJson`, `unknownToJsonGeneric`).
- **Dexie compound index**: added schema `version(2)` with `[month+category]` on budgets (additive migration, old data compatible) to remove the "query would benefit from a compound index" warning for the budget lookup `{category, month}`.
- **AudioContext resume** in `NotificationService.play()` for autoplay-policy-restricted contexts.
- **vercel.json**: `framework: null` → `"angular"` (matches the Angular preset target); rewrite narrowed to `/((?!api/).*)` so the API route is never shadowed by the SPA fallback.

### Verified (real execution)
- `npm install` — OK (Node v24 local; Vercel target 22.x per `engines`).
- `npx tsc --noEmit` — PASS (0 errors).
- `npm run build` — PASS (initial bundle ≈ 473 kB raw / 129 kB transfer).
- API handler smoke test with mocked Vercel req/res: 405 (wrong method), 503 (missing key), 400 (invalid payload), 413 (oversized body), 502 (upstream rejection with clear error), rate limiting → 429 on the 13th request in one minute. The upstream call actually reached `generativelanguage.googleapis.com` and surfaced Google's own "API key not valid" error through the 502 path.
- Headless browser E2E against the production build: app boots with zero console/page errors; income 5,000,000 → balance correct; expense 500,000 → balance 4,500,000; goal created (1,000,000 target); deposit 200,000 → main balance 4,300,000, savings 200,000, expense metric unchanged (deposit is a balance transfer, not an expense); budget 400,000 on Makanan shows "Melebihi anggaran" at 500,000 usage; deposit notification recorded; balances survive a full page reload (IndexedDB persistence); offline indicator flips reactively.

## PWA install fix (2026-11-21, later pass)
Symptom reported by the user: installing from Android Chrome produced a home-screen shortcut with the Chrome badge — "App info" opened Chrome instead of a standalone Monetra app. Root causes fixed:
- **`purpose: "any maskable"` combined on one icon** (deprecated pattern Chrome warns about) → separated into dedicated `any` icons and new `maskable` variants (`icon-192-maskable.png`, `icon-512-maskable.png`) generated with proper safe-zone padding (glyph inside the centered 80% circle).
- **Install attempted before the service worker was active** on a first visit → Chrome only offers a real install (WebAPK) once the SW is registered/active; the app now registers `/sw.js` at the very start of `ngOnInit` (before any async data work).
- **Install guidance was wrong**: the fallback toast suggested "Add to Home screen" (which creates a shortcut). It now says to use browser menu ⋮ → "Install app". The settings card reacts to state via new signals `standalone()` / `installed()` (`display-mode: standalone` + iOS `navigator.standalone` + `appinstalled` event).
- Manifest hardened: `lang`/`dir`, `display_override`, `categories`, `prefer_related_applications: false`, four explicit icon entries.
- `vercel.json` headers: manifest served with `application/manifest+json`, `sw.js` must-revalidate, icons immutable.
- SW cache bumped to `monetra-shell-v3` so already-installed users pick up the new manifest/icons immediately.
- `index.html`: `apple-touch-icon`, `mobile-web-app-capable`, `apple-mobile-web-app-*` meta for iOS home-screen installs.

Note for users with the old shortcut installed: remove the old shortcut once, then open the site again and use ⋮ → "Install app" to get the real app.

## UI/UX redesign + savings planner + Gemini contract fix (2026-11-21, v1.1.0)

### Design system (full rewrite of `src/styles.css`)
- New token palette: primary `#365C8D`, hover `#294A75`, bg `#F5F6F8`, surface `#FFFFFF`, text `#202938`, muted `#737D8D`, border `#E5E8ED`, accent `#D5A65A`, danger `#D65B62`, warning `#D49A43`. **No green anywhere** — income/positive states use primary blue, expense/negative use danger red, chart categories use a harmonious blue ramp + accent.
- Shadow policy: cards are flat (1 px border + surface color); shadows only for modal, toast, and the mobile "Lainnya" sheet. No gradients, no glassmorphism, no glossy effects, no decorative orbs.
- Icons replaced: emoji/unicode glyphs (⌂ ⇄ ◈ ✳ ♧ ⚙ ⌁) → inline Lucide-style SVG sprite (18 symbols, `currentColor` stroke).
- Layout: 232 px desktop sidebar (narrower, flat), sticky 64 px topbar with bell/settings icon buttons, bottom nav on mobile with a FAB and a "Lainnya" sheet exposing Analisis/Asisten AI/Notifikasi/Pengaturan (previously unreachable on mobile).
- **Profile avatar "M" removed** everywhere (sidebar foot and topbar); settings access via gear icon button. No initial-avatar replacement.
- Typography: DM Sans body + Manrope numerals with `tabular-nums` for money; page max-width 1200 px; consistent spacing scale.

### Copywriting
- All headings/descriptions rewritten in natural Indonesian: "Dashboard", "Total Saldo", "Ringkasan Keuangan", "Progres Tabungan", "Belum ada transaksi" etc. Removed: "Ruang kerja keuanganmu", "Wujudkan tujuanmu", "Halo … bagaimana keuanganmu?", "Teman diskusi keuanganmu", "BUILT FOR YOUR FINANCIAL CLARITY", WORKSPACE/PREFERENCES eyebrows.
- Technical/internal labels removed from UI: "Local database", "● Lokal / Tersinkron lokal", "PERSONAL FINANCE" eyebrow, version tagline. The storage note in Settings is now one plain privacy sentence. IndexedDB/local-first architecture unchanged.

### Savings planner (target price × duration)
- Goal model extended: `startDate`, `durationValue`, `durationUnit` ('months'|'years'), `completedAt`. Target date = start + duration (calendar months, day-of-month clamped, e.g. 31 Aug + 6 mo = 28 Feb).
- `FinanceService.planFor(goal)` computes from **real calendar dates**: totalDays (actual days between start and target, leap-year correct), `perDay = ceil(target / totalDays)`, `perWeek`, `perMonth = ceil(target / wholeCalendarMonths)`, progress, remaining, `expectedByNow`, and pace status (completed / not-started / on-track / slightly-behind / behind at 85% threshold).
- Verified with Python replicating the TS logic: user example Rp6.000.000 over 6 months from 2026-11-21 → 181 days → **Rp33.150/day**; exact spec example 6.000.000/180 → Rp33.334 ✓; 1 year from 2024-01-01 → 366 days ✓; month-end clamping ✓; per-day × days ≥ target asserted for all cases.
- Goal modal shows a live plan preview (per day/week/month, target date, total days) recalculated on every input change.
- Deposits remain free-amount: the old "deposit exceeds target" error was removed; over-target deposits are accepted and progress caps at 100%. A goal reaching its target gets `completedAt` stamped (date of the reaching deposit), the card shows an elegant "Tercapai {tanggal}" state with total deposit count and an "Arsipkan" action.
- Withdrawal moved from `prompt()` into the deposit modal as a Setoran/Penarikan switch; the modal shows the plan guide (per-day need + remaining) as a hint. Balance math unchanged and re-verified by E2E (see below).

### Gemini AI repair
- Frontend cause of "Respons tidak dapat dibaca": `response.text()` was JSON-parsed with no status/content-type check, so any non-JSON response (function error page, dev-server fallback) produced that single opaque message. `askGemini` now checks `res.ok`, `content-type`, parses defensively, and maps the strict backend contract `{ success: true, data: { reply } } | { success: false, error: { code, message } }` to specific Indonesian error messages per HTTP status (400/401/403/404/429/503/504/generic), with `TypeError` from fetch mapped to an offline message. Raw upstream details never reach the UI.
- Backend (`api/ai/chat.js`) rewritten around the same contract: every response (including 405/413/429/timeout) is contract JSON; upstream non-JSON/empty bodies handled; prompt-block (`promptFeedback.blockReason`) handled; `finishReason` without text handled; thought-only parts filtered; upstream error details logged server-side only (verified by a leak test). Model stays hardcoded `gemini-2.5-flash-lite`; key from `GOOGLE_GEMINI_API` only.

### Logo
- New "Diamond Progress" mark: white solid lower diamond half (funds collected) + amber outlined upper half (the plan) on a blue tile — no coin, no bar chart, no wallet, no letter-M avatar. Applied to `icon-192/512.svg`, `icon-192/512.png`, `icon-192/512-maskable.png` (safe-zone scaled 0.76), `favicon.svg`, `favicon-32.png`, sidebar brand, manifest (`theme_color #365C8D`, `background_color #F5F6F8`), and `index.html` meta.
- Service worker cache bumped to `monetra-shell-v4`; notification icons point to PNG assets.

### Verified (real execution)
- `npx tsc --noEmit` — PASS (0 errors, strict + strictTemplates unchanged).
- `npm run build` — PASS (initial bundle ≈ 488 kB raw / 131 kB transfer).
- Gemini endpoint harness (esbuild-bundled handler, mocked Vercel req/res + upstream fetch): **14/14 PASS** — 405, 503 (no key), 413, 400 invalid JSON, 400 empty question, 429 rate limit on 13th request, upstream 400→502 with **no raw leak**, upstream 429 passthrough, success contract (thought parts filtered), blocked prompt, empty candidates, non-JSON upstream, timeout 504, model/key hardcode assertions.
- Headless browser E2E (production build): income → balance; goal creation with live preview matching the Python numbers exactly (Rp33.150/day, 181 days, 21 May 2027); deposit 1.000.000 → main 4.000.000 / savings 1.000.000 / monthly deposit metric 1.000.000 (transfer, not expense); withdrawal via modal → balances restored; income + deposit 5.500.000 → status "Tercapai 21 Nov 2026" with archive action; goal/deposit notifications recorded; AI error path shows friendly message on non-JSON response; balances survive reload (IndexedDB); AudioContext console error fixed (promise catch).
- Responsive: 375×812 viewport — no horizontal overflow on Dashboard/Tabungan/Analisis, bottom nav + FAB + "Lainnya" sheet functional; desktop screenshots reviewed for all pages and the transaction/goal modals.

### Honest gaps
- Real Gemini round-trip with a **valid** API key was NOT TESTED (no valid key in this sandbox). Everything up to and including the upstream request/contract is mock-tested; a real key test must be done after deployment (Deployment doc step 5).
- Live PWA install/WebAPK behavior needs a real Android device; verified structurally (manifest, icons, SW) only.

## Known limitations (honest, by design)
- Background notifications while the app is closed require a real Web Push sender (VAPID) and persisted subscriptions; the SW push handler exists but no sender is included. The in-app UI states this.
- PDF report uses the browser print dialog (Save as PDF); it is not a generated PDF download.
- No automatic cloud backup; users must export backup files.
- Gemini AI requires `GOOGLE_GEMINI_API` in Vercel; without it the endpoint returns a clear 503 message and the UI shows it.
- Rate limiting for the AI endpoint is per serverless instance (in-memory), not a global quota.
