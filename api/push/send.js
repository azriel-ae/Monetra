'use strict';
// Daily push sender. Triggered by Vercel Cron (and optionally an external scheduler) with
// "Authorization: Bearer <CRON_SECRET>". Sends one push to every saved subscription.
const webpush = require('web-push');
const store = require('../_lib/store');

const HASH_KEY = 'monetra:push:subs';
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Fallback copy (the service worker personalises it with the user's own on-device data).
const MESSAGES = [
  ['Selamat pagi ☀️', 'Mulai hari dengan catatan yang rapi. Yuk cek keuanganmu hari ini.'],
  ['Sudah catat pengeluaran? 📝', 'Satu menit mencatat hari ini = keuangan lebih tenang besok.'],
  ['Pagi yang produktif 💪', 'Tetap konsisten! Catat setiap transaksi agar laporanmu akurat.'],
  ['Cek tabunganmu 🎯', 'Sedikit demi sedikit, target tabunganmu makin dekat. Lanjutkan!'],
  ['Halo dari Monetra 👋', 'Jangan lupa catat pemasukan dan pengeluaranmu hari ini.'],
  ['Kendalikan uangmu 💰', 'Lihat ringkasan bulan ini dan pastikan pengeluaran tetap aman.'],
  ['Kebiasaan kecil, dampak besar ✨', 'Mencatat setiap hari membuat keputusan finansialmu lebih bijak.'],
];

function wibDateKey(now) {
  const d = new Date(now.getTime() + WIB_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== 'Bearer ' + secret) { res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Tidak diizinkan.' } }); return; }

    const pub = process.env.VAPID_PUBLIC_KEY && String(process.env.VAPID_PUBLIC_KEY).trim();
    const priv = process.env.VAPID_PRIVATE_KEY && String(process.env.VAPID_PRIVATE_KEY).trim();
    if (!pub || !priv) { res.status(503).json({ success: false, error: { code: 'VAPID_NOT_CONFIGURED', message: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum diatur.' } }); return; }
    if (!store.isConfigured()) { res.status(503).json({ success: false, error: { code: 'STORE_NOT_CONFIGURED', message: 'Redis belum terhubung.' } }); return; }

    const subject = process.env.VAPID_SUBJECT
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'mailto:noreply@example.com');
    webpush.setVapidDetails(subject, pub, priv);

    const now = new Date();
    const dayKey = wibDateKey(now);
    const force = (req.query && req.query.force === '1');
    // One send per WIB day, even if two schedulers (Vercel Cron + external) both fire.
    if (!force) {
      const first = await store.cmd(['SET', 'monetra:push:sent:' + dayKey, '1', 'NX', 'EX', '172800']);
      if (first === null) { res.status(200).json({ success: true, skipped: 'already-sent-today', day: dayKey }); return; }
    }

    const flat = (await store.cmd(['HGETALL', HASH_KEY])) || [];
    const entries = [];
    for (let i = 0; i + 1 < flat.length; i += 2) { try { entries.push({ id: flat[i], sub: JSON.parse(flat[i + 1]) }); } catch (e) { entries.push({ id: flat[i], sub: null }); } }

    const dayIndex = Math.floor(new Date(dayKey + 'T00:00:00Z').getTime() / 86400000);
    const [title, body] = MESSAGES[dayIndex % MESSAGES.length];
    const payload = JSON.stringify({ kind: 'daily', title: title, body: body, url: '/', day: dayKey });

    let sent = 0, removed = 0, failed = 0;
    for (let i = 0; i < entries.length; i += 25) {
      const batch = entries.slice(i, i + 25);
      const results = await Promise.allSettled(batch.map(async (e) => {
        if (!e.sub) throw Object.assign(new Error('bad record'), { statusCode: 410 });
        await webpush.sendNotification(e.sub, payload, { TTL: 4 * 3600, urgency: 'high', topic: 'monetra-daily' });
      }));
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled') { sent++; continue; }
        const code = r.reason && r.reason.statusCode;
        if (code === 404 || code === 410) { removed++; await store.cmd(['HDEL', HASH_KEY, batch[j].id]).catch(() => null); }
        else { failed++; console.error('push failed', code, r.reason && r.reason.body || r.reason && r.reason.message); }
      }
    }
    res.status(200).json({ success: true, day: dayKey, total: entries.length, sent: sent, removed: removed, failed: failed });
  } catch (error) {
    console.error('push/send error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Gagal mengirim notifikasi.', detail: String(error && error.message || error).slice(0, 200) } });
  }
};
