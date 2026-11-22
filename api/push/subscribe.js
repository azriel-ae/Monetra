'use strict';
const crypto = require('crypto');
const store = require('../_lib/store');

const HASH_KEY = 'monetra:push:subs';
const MAX_BODY = 8000;

function validSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 700 || !/^https:\/\//.test(sub.endpoint)) return false;
  const k = sub.keys;
  return Boolean(k && typeof k.p256dh === 'string' && typeof k.auth === 'string' && k.p256dh.length < 200 && k.auth.length < 100);
}
const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST' && req.method !== 'DELETE') { res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Gunakan POST atau DELETE.' } }); return; }
    if (!store.isConfigured()) { res.status(503).json({ success: false, error: { code: 'STORE_NOT_CONFIGURED', message: 'Penyimpanan Redis belum terhubung di Vercel.' } }); return; }

    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (raw.length > MAX_BODY) { res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Data terlalu besar.' } }); return; }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const sub = body.subscription;
    if (!validSubscription(sub)) { res.status(400).json({ success: false, error: { code: 'INVALID_SUBSCRIPTION', message: 'Data langganan tidak valid.' } }); return; }

    const id = idOf(sub.endpoint);
    if (req.method === 'DELETE') await store.cmd(['HDEL', HASH_KEY, id]);
    else await store.cmd(['HSET', HASH_KEY, id, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, savedAt: new Date().toISOString() })]);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('push/subscribe error:', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Gagal menyimpan langganan notifikasi.', detail: String(error && error.message || error).slice(0, 200) } });
  }
};
