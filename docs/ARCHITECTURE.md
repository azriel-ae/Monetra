# Monetra Architecture

Monetra is a local-first Angular 21 PWA. IndexedDB (Dexie) is the source of truth for financial records. Vercel Functions are used only for optional Gemini requests; the core finance workflow does not depend on a cloud database.

## Layers
- `src/app/app.component.ts` — single standalone component; owns page navigation via the `page` signal (no Angular Router), modals, forms, backup/restore, CSV export, AI chat, and print report.
- `src/app/finance.service.ts` — signals for transactions/goals/entries/budgets; all accounting helpers (`totals`, `mainBalance`, `savingsBalance`, `goalTotal`, `monthlyTransactions`) plus guarded mutations.
- `src/app/database.service.ts` — Dexie wrapper; DB `monetra-local` schema v1 + additive v2 (compound index `[month+category]` on budgets), attachment blobs, default settings seeding, notification persistence.
- `src/app/notification.service.ts` — permission checks, in-app + OS notifications via service worker, chime (Web Audio), daily/goal reminder checks while the app is open.
- `api/ai/chat.js` — Vercel serverless function; fixed `gemini-2.5-flash-lite`, validation, per-IP rate limit, 20 s timeout, server-only API key.
- `public/sw.js` — service worker: network-first navigations, cache-first hashed assets, push display handler, cache versioned (`monetra-shell-v2`), never touches `/api/`.

## State management
Angular 21 runs **zoneless change detection** by default in this build. Therefore every UI state that changes outside a template event handler must be a signal: `page`, `modal`, `toast`, `finance.*` data signals, `totals/goals/recent/currentBudget` computed signals, plus `aiLoading`, `aiError`, `aiAnswer`, `notifications`, `notificationPermission`, `online`, `goalImageUrls`. Plain properties are only safe for form fields (`ngModel`) and values read during event-driven flows. New async state must be added as a signal — see PROGRESS.md for the bug this prevented.

## Financial accounting
- Income increases main balance.
- Expense decreases main balance.
- Savings deposit decreases main balance and increases virtual savings balance.
- Savings withdrawal increases main balance and decreases virtual savings balance.
- Savings transfers are not income or consumption expenses.

Main balance = total income − total expense − deposits + withdrawals.
Savings balance = deposits − withdrawals.

Deposits are guarded inside one Dexie transaction: the goal must exist, the goal balance may not go negative, a deposit may not exceed the goal target, and the main balance must cover the deposit. This keeps the two ledgers consistent under concurrent writes.

## Data storage
IndexedDB tables: transactions, goals, entries, budgets, attachments, notifications, settings. Photos are stored as Blob attachments and referenced by ID. Backup format is versioned (`backupVersion: 1`) and validated before any write; REPLACE mode snapshots a backup before clearing tables so a failed restore never loses data.

## PWA
A same-origin service worker caches the app shell and static assets. Local finance features work offline after the first successful load. Navigations are network-first so deploys reach users immediately, with the cached shell as offline fallback (no blank screens after updates). Gemini requires internet. Browser scheduling is best-effort; this build checks daily reminders while the app is open/resumed. Guaranteed background scheduling is not claimed.

## AI privacy
The user must enable AI consent in settings before using the AI screen. The app sends a compact financial snapshot (summary, top categories, goals, budgets, last 25 transactions without notes) and the question to `/api/ai/chat`. The API key is only read by the Vercel server function. Consent is stored locally (`aiConsent`, `aiConsentAt`) and revocable from the UI.

## AI response contract (v1.1.0)
Both directions speak one strict JSON contract. Success: `{ "success": true, "data": { "reply": string } }`. Failure: `{ "success": false, "error": { "code": string, "message": string } }`. Every status path on the server (405/413/429/503/502/504/500) emits the failure shape; the frontend checks `res.ok` and `content-type`, parses defensively, and maps codes to Indonesian messages. Upstream (Google) error details are logged server-side only.

## Design tokens (v1.1.0)
`src/styles.css` `:root` is the single color/radius/spacing source: primary `#365C8D` (+hover `#294A75`, soft `#EAEFF6`), background `#F5F6F8`, surface `#FFFFFF`, text `#202938`, muted `#737D8D`, border `#E5E8ED`, accent `#D5A65A` (savings achieved / brand detail), danger `#D65B62`, warning `#D49A43`. Cards are flat surfaces with 1 px borders; shadows exist only for modal, toast, and the mobile more-sheet. Icons are an inline Lucide-style SVG sprite (`<symbol id="i-…">` + `<use>`); the brand mark is the `#logo-mark` symbol.

## Savings plan computation (v1.1.0)
`FinanceService.planFor(goal)` derives the plan from real calendar dates: `targetDate = startDate + durationValue` months (clamped to month length), `totalDays = actual day difference (UTC, leap-year correct)`, `perDay = ceil(target/totalDays)`, `perWeek = ceil(target/(totalDays/7))`, `perMonth = ceil(target/wholeCalendarMonths)`, `expectedByNow = ceil(target × elapsedDays/totalDays)` clamped to target. Pace status: `completed` when saved ≥ target (also stamped as `completedAt` on the reaching deposit), `not-started` when elapsed 0, `on-track` when saved ≥ expected, `slightly-behind` at ≥ 85% of expected, else `behind`. Deposits are free-amount; there is intentionally no over-target rejection anymore.
