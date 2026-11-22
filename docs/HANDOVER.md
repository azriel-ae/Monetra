# Monetra Handover

Repository state after the 2026-11 UI/UX redesign (v1.1.0): `npx tsc --noEmit` and `npm run build` pass; the Gemini endpoint passed a 14-case contract harness (mocked upstream); the production build was E2E-tested in a headless browser (transactions, savings planner, deposit/withdrawal, goal completion, budgets, notifications, IndexedDB persistence, AI error paths, 375 px responsive). Start by reading `PROGRESS.md` (what changed and how it was verified), `ARCHITECTURE.md` (tokens, plan math, AI contract), `DEPLOYMENT.md` (exact Vercel settings), and `DECISIONS.md`.

Do not change the savings ledger accounting rules. Main balance = income − expenses − deposits + withdrawals. Savings balance = deposits − withdrawals. Deposits are validated inside a Dexie transaction (`finance.service.addSavingsEntry`).

## Non-negotiables
- Keep TypeScript strict and `strictTemplates` on; do not use `any` to silence errors.
- All async-updated UI state must be a signal (Angular 21 zoneless CD) — plain properties silently freeze the UI.
- Model `gemini-2.5-flash-lite` stays hardcoded in `api/ai/chat.js`; only `GOOGLE_GEMINI_API` is read on the server.
- Never put the Gemini key in Angular code; the endpoint already validates, rate-limits, and times out.

## Remaining work (optional / needs external config)
- Real Web Push sender (VAPID + persisted subscriptions) if background notifications while the app is closed are required; the SW handler is ready. Until then, background delivery is not guaranteed and is labeled as such in-app.
- Global (cross-instance) rate limiting for `/api/ai/chat` if abuse becomes a concern; current limiter is per serverless instance.
- Automated E2E/unit test suite (current verification was manual + scripted smoke tests).
- Lighthouse/PWA audit on the deployed domain, and an install-prompt UX polish pass if desired.
- Optional: PDF export beyond the browser print dialog.

Gemini configuration: `api/ai/chat.js` uses the fixed `gemini-2.5-flash-lite` model. Only `GOOGLE_GEMINI_API` is required in Vercel Environment Variables; do not add `GEMINI_MODEL` or expose the API key in Angular client code. The Angular application remains the primary frontend and all finance data remains local in IndexedDB unless the user explicitly consents to send the generated snapshot to Gemini.
