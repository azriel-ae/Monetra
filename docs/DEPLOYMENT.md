# Local development & Vercel deployment

## Requirements
- Node.js 22.12+ locally; Vercel runtime Node 22.x
- npm

## Run locally
```bash
npm install
npm start
```
Open the local URL printed by Angular CLI.

## Production build
```bash
npm run build
```
Output directory: `dist/monetra/browser` (verified from the actual build output).

## Vercel project settings (verified against this repository)

| Pengaturan | Nilai |
|---|---|
| Framework Preset | Angular (`vercel.json`: `"framework": "angular"`) |
| Root Directory | `./` (repo root — `package.json`, `angular.json`, `api/` semua di root) |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `dist/monetra/browser` |
| Node.js Version | 22.x (`package.json` `engines.node >= 22.12.0`) |

These match the actual Angular output: `angular.json` sets `outputPath: dist/monetra`, and the `@angular/build:application` builder writes the browser bundle to `dist/monetra/browser` — confirmed by running the real build (`dist/monetra/browser/index.html`, hashed bundles, `manifest.webmanifest`, `sw.js`, `icons/`).

`vercel.json` rewrites `/((?!api/).*)` → `/index.html`. The negative lookahead keeps `/api/ai/chat` pointed at the serverless function so the SPA fallback never shadows it. API routes are auto-detected by Vercel from the `api/` directory (`@vercel/node` is in devDependencies for local typing).

## Deploy steps
1. Push this project to a Git repository.
2. Import the repository in Vercel (Framework preset is picked up from `vercel.json`).
3. Keep the project root as Root Directory.
4. Add `GOOGLE_GEMINI_API` in Project Settings → Environment Variables (Production + Preview + Development as needed).
5. Redeploy after changing environment variables.

## Environment variables

| Variable | Wajib/Opsional | Dipakai di | Keterangan |
|---|---|---|---|
| `GOOGLE_GEMINI_API` | Wajib untuk fitur AI; opsional untuk aplikasi lainnya | `api/ai/chat.js` (serverless, server-only) | Google Gemini API key. Tanpa ini endpoint menjawab 503 dengan pesan jelas. |
| `GEMINI_MODEL` | Tidak ada — sengaja tidak dipakai | — | Model dikunci di kode server: `gemini-3.5-flash-lite` → fallback `gemini-3.5-flash` → `gemini-2.5-flash-lite`. |

No other environment variables are used. Never place the Gemini key in Angular code or Angular environment files.

## AI endpoint contract
`POST /api/ai/chat` with JSON `{ question, financialData }`. Guardrails: method check (405), body size ≤ ~120 KB (413), question ≤ 2000 chars (400), per-IP rate limit 12 requests/minute (429), upstream timeout 20 s (504), and 502/503 with clear Indonesian error messages otherwise.

## Post-deploy checks
1. Open the deployment URL — dashboard renders, no console errors.
2. Refresh on any URL — SPA rewrite serves `index.html` (no 404).
3. `GET /manifest.webmanifest`, `/sw.js`, `/icons/icon-512.png` return 200.
4. DevTools → Application → Service Workers: `sw.js` activates; offline reload still renders the shell.
5. AI page with consent → question → works when `GOOGLE_GEMINI_API` is set; shows a clear error when it is not.
6. **First run with a real key (v1.1.0)**: ask one AI question and confirm a text reply renders. If `GOOGLE_GEMINI_API` was added/changed, a **new deployment is required** before the function picks it up — environment variable changes are not applied to already-deployed functions. Expected error shapes when misconfigured: no key → 503 `GEMINI_NOT_CONFIGURED`; invalid key → 502 `GEMINI_REQUEST_FAILED` with a friendly message (raw Google error text stays in the function logs).

## AI endpoint contract (v1.1.0)
Success: `200 { "success": true, "data": { "reply": "..." } }`. Failure: `{ "success": false, "error": { "code": "GEMINI_REQUEST_FAILED" | "GEMINI_NOT_CONFIGURED" | "RATE_LIMITED" | "GEMINI_TIMEOUT" | "GEMINI_BLOCKED" | "GEMINI_EMPTY_RESPONSE" | "INVALID_JSON" | "INVALID_PAYLOAD" | "PAYLOAD_TOO_LARGE" | "METHOD_NOT_ALLOWED" | "INTERNAL_ERROR", "message": "..." } }`. The Angular client maps codes/statuses to Indonesian messages; it never shows raw upstream text.

## Important
The Gemini API key lives only in the Vercel function. The notification system provides foreground reminders and service-worker display for push events; a production push sender/subscription store is a separate optional deployment task (not included, and honestly labeled in-app).
