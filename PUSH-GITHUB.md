# Push Monetra ke GitHub

Folder ini berisi source code murni **tanpa folder `.git`** — kamu memulai
riwayat git sendiri, jadi repo di GitHub sepenuhnya atas nama akunmu.

## 1. Buat repo kosong di GitHub

Buat repository baru di github.com **tanpa** README/license (biar tidak konflik
dengan file yang sudah ada di sini), misal `monetra`.

## 2. Init git, commit pertama, dan push

```bash
git init -b main
git add -A
git commit -m "Monetra: initial commit"
git remote add origin https://github.com/<username>/monetra.git
git push -u origin main
```

(`.gitignore` sudah ada — `node_modules/`, `dist/`, `.angular/`, `.vercel/`,
`.env` tidak akan ikut ter-push.)

## 3. Deploy ke Vercel (opsional, untuk PWA + fitur AI)

1. Push ke GitHub dulu (langkah 2), lalu di vercel.com pilih **Add New Project** dan import repo-nya.
2. Vercel otomatis membaca `vercel.json` (build + rewrite + header sudah dikonfigurasi).
3. Sebelum deploy pertama, tambahkan **Environment Variable**:
   - Name: `GOOGLE_GEMINI_API` (alias `GEMINI_API_KEY` / `GOOGLE_API_KEY` juga diterima)
   - Value: kunci API Gemini dari https://aistudio.google.com/apikey
   - Environments: Production, Preview, Development
4. Deploy. Setiap push berikutnya ke `main` otomatis di-deploy ulang oleh Vercel.

## Catatan

- `node_modules/`, `dist/`, `.angular/`, `.vercel/`, `.env` diabaikan git (lihat `.gitignore`).
- Fitur AI butuh fungsi backend `/api/ai/chat` — hanya aktif saat di-deploy via Vercel.
- Lokal: `npm install` lalu `npm run build` (hasil di `dist/monetra/browser`).
