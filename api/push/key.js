'use strict';
// Returns the public VAPID key so the app can subscribe to push. (The key is public by design.)
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const publicKey = process.env.VAPID_PUBLIC_KEY ? String(process.env.VAPID_PUBLIC_KEY).trim() : '';
  if (!publicKey) { res.status(503).json({ success: false, error: { code: 'PUSH_NOT_CONFIGURED', message: 'VAPID_PUBLIC_KEY belum diatur di Vercel.' } }); return; }
  res.status(200).json({ success: true, publicKey: publicKey });
};
