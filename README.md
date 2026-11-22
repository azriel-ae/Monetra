<p align="center">
  <img src="docs/angular-logo.svg" alt="Angular" width="96" height="96">
</p>

<h1 align="center">Monetra</h1>

<p align="center">
  Pengelola keuangan pribadi <i>local-first</i> berbasis <b>Angular</b> — PWA, offline, dengan asisten AI dan notifikasi harian.
</p>

<p align="center">
  <img alt="Angular 21" src="https://img.shields.io/badge/Angular-21-DD0031?logo=angular&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-installable-365C8D">
  <img alt="Vercel" src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white">
</p>

Monetra is a local-first personal finance PWA built with Angular 21 and Dexie/IndexedDB. It tracks income, expenses, duration-based savings goals (daily/weekly/monthly need computed from real calendar dates), budgets, analytics, local backups, and optional Gemini AI assistance through a Vercel server function.

Identity (v1.1.0): elegant-blue design system (`#365C8D` primary, `#D5A65A` accent, no green), flat surfaces with thin borders, Lucide-style SVG icons, and the "Diamond Progress" brand mark (solid lower half = collected funds, outlined upper half = plan). See `docs/PROGRESS.md` and `docs/ARCHITECTURE.md` for the token list and plan math.

## Requirements
- Node.js 22.12 or newer (Angular 21 compatibility; Vercel target: 22.x)
- npm

## Start
```bash
npm install
npm start
```

## Quality checks
```bash
npx tsc --noEmit   # strict TypeScript
npm run build      # Angular production build -> dist/monetra/browser
```

## Production build
```bash
npm run build
```
The build output is `dist/monetra/browser` (verified against `angular.json` `outputPath: dist/monetra` plus the `@angular/build:application` builder, which nests `browser/`). Static assets (`manifest.webmanifest`, `sw.js`, `icons/`) come from `public/` and are copied to the output root.

## Vercel
`vercel.json` pins: Framework preset `angular`, build command `npm run build`, output directory `dist/monetra/browser`, and an SPA rewrite that excludes `/api/` so frontend routing never shadows the Gemini function. Import the repository into Vercel and add `GOOGLE_GEMINI_API` in Project Settings → Environment Variables to enable the optional AI endpoint. The server-side endpoint uses the model list hardcoded in `api/ai/chat.js` (`gemini-3.5-flash-lite`, falling back to `gemini-3.5-flash`, then `gemini-2.5-flash-lite`); no model-selection environment variable exists. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Data and privacy
The finance database stays in the current browser profile's IndexedDB (`monetra-local`). It is not synchronized between devices. Create JSON backups regularly (Settings → Backup seluruh data). Gemini requests send a compact, app-generated financial snapshot (summary, top categories, goals, budgets, last 25 transactions) only after the user enables AI consent; consent is stored locally and revocable.

## Notification limitations
The app provides in-app notifications, foreground reminders, browser notifications, and a service worker push receiver. A production push sender (VAPID server + persisted subscriptions) is not included; browser timers are not guaranteed to run while the app is closed. This is stated honestly on the in-app notification page.

## Architecture & docs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, data flow, signals + zoneless change detection
- [docs/DECISIONS.md](docs/DECISIONS.md) — key technical decisions and rationale
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel settings, env vars, verification steps
- [docs/HANDOVER.md](docs/HANDOVER.md) — current state, known limitations, next steps
- [docs/PROGRESS.md](docs/PROGRESS.md) — delivery log incl. the 2026-11 audit & repair pass

## Notifikasi harian (wajib, pukul 09.00 WIB)

Setelah pengguna mengizinkan notifikasi, server mengirim satu push setiap pagi pukul 09.00 WIB meski aplikasi tertutup.
Tidak ada pengaturan di dalam aplikasi; mematikannya lewat Info aplikasi → Notifikasi di HP.

Komponen: `api/push/key.js` (kunci publik), `api/push/subscribe.js` (simpan langganan di Redis),
`api/push/send.js` (dipanggil cron; kirim ke semua langganan), `public/sw.js` (menampilkan notifikasi dan
mempersonalisasi isinya dari data lokal perangkat).

Environment variables di Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, serta Redis
(`KV_REST_API_URL` + `KV_REST_API_TOKEN`, otomatis dari Upstash Redis di Storage/Marketplace). Setelah mengisi, deploy ulang.

Jadwal: `vercel.json` memanggil `/api/push/send` pukul 02:00 UTC (= 09:00 WIB). Di paket Hobby, Vercel hanya menjamin
jam yang tepat (09:00–09:59). Untuk tepat 09:00, jadwalkan juga di layanan cron eksternal (mis. cron-job.org):
`GET https://DOMAIN/api/push/send` dengan header `Authorization: Bearer <CRON_SECRET>`; pengiriman dijaga agar hanya sekali per hari.
Uji manual: tambahkan `?force=1` untuk mengirim ulang hari ini.
