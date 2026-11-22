const CACHE = 'monetra-shell-v7';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/favicon-32.png', '/icons/icon-192.svg', '/icons/icon-512.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-192-maskable.png', '/icons/icon-512-maskable.png', '/icons/badge-96.png', '/icons/notif-banner.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(CORE.map(url => cache.add(url).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin || new URL(req.url).pathname.startsWith('/api/')) return;
  // Navigations: network-first so users always get the newest deployed shell,
  // with the cached shell as offline fallback (prevents blank screens after updates).
  // Only cache real 200 bodies — a 304 revalidation must never be cached as the shell.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put('/index.html', copy));
        return response;
      }
      return caches.match('/index.html').then(cached => cached || response);
    }).catch(() => caches.match('/index.html').then(cached => cached || Response.error())));
    return;
  }
  // Static assets (hashed filenames): cache-first.
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy));
    }
    return response;
  })));
});

/* ---------------------------------------------------------------------------
 * Daily notification (Web Push). The server pushes once a day at 09:00 WIB; this
 * worker wakes up even when the app is closed, personalises the message from the
 * user's own on-device data (IndexedDB, never sent anywhere) and shows it.
 * ------------------------------------------------------------------------- */
const rupiah = n => 'Rp' + Math.round(n).toLocaleString('id-ID');
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('monetra-local');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbAll(db, store) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const q = db.transaction(store, 'readonly').objectStore(store).getAll();
    q.onsuccess = () => resolve(q.result || []);
    q.onerror = () => reject(q.error);
  });
}

/** Builds a personalised title/body, or returns null when there is no local data yet. */
async function personalise() {
  try {
    if (!indexedDB.databases || !(await indexedDB.databases()).some(d => d.name === 'monetra-local')) return null;
    const db = await idbOpen();
    let tx, goals, entries, settings;
    try { [tx, goals, entries, settings] = await Promise.all([idbAll(db, 'transactions'), idbAll(db, 'goals'), idbAll(db, 'entries'), idbAll(db, 'settings')]); }
    finally { db.close(); }
    if (!tx.length && !goals.length) return null;

    const now = new Date();
    const yesterday = ymd(new Date(now.getTime() - 86400000));
    const month = ymd(now).slice(0, 7);
    const name = ((settings.find(x => x.id === 'main') || {}).displayName || '').trim().split(/\s+/)[0];
    const yTx = tx.filter(t => t.date === yesterday);
    const yExpense = yTx.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    const mExpense = tx.filter(t => t.type === 'expense' && String(t.date).startsWith(month)).reduce((a, t) => a + t.amount, 0);
    const mIncome = tx.filter(t => t.type === 'income' && String(t.date).startsWith(month)).reduce((a, t) => a + t.amount, 0);

    const lines = [];
    if (yExpense > 0) lines.push('💸 Kemarin kamu mengeluarkan ' + rupiah(yExpense) + '. Total bulan ini ' + rupiah(mExpense) + '.');
    else if (!yTx.length) lines.push('📝 Kemarin belum ada catatan. Yuk lengkapi agar laporanmu akurat.');
    else lines.push('✅ Kemarin tidak ada pengeluaran. Hebat, pertahankan!');
    if (mIncome > 0 && mExpense / mIncome >= 0.75) lines.push('⚠️ Pengeluaran bulan ini sudah ' + Math.round(mExpense / mIncome * 100) + '% dari pemasukan.');

    const active = goals.filter(g => !g.archived && !g.completedAt && g.target > 0).map(g => {
      const saved = entries.filter(e => e.goalId === g.id).reduce((a, e) => a + (e.type === 'deposit' ? e.amount : -e.amount), 0);
      return { title: g.title, pct: Math.max(0, Math.min(99, Math.floor(saved / g.target * 100))) };
    }).sort((a, b) => b.pct - a.pct);
    if (active.length) lines.push('🎯 Target "' + active[0].title + '" sudah ' + active[0].pct + '%.');

    return { title: name ? 'Selamat pagi, ' + name + ' ☀️' : 'Selamat pagi ☀️', body: lines.join('\n') };
  } catch (e) { return null; }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
    const personal = data.kind === 'daily' ? await personalise() : null;
    const title = (personal && personal.title) || data.title || 'Monetra';
    const body = (personal && personal.body) || data.body || 'Ada pengingat untukmu.';
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      image: '/icons/notif-banner.png',
      tag: data.kind === 'daily' ? 'monetra-daily' : (data.tag || 'monetra-notification'),
      renotify: true,
      silent: false,
      requireInteraction: false,
      vibrate: [300, 120, 300, 120, 600],
      timestamp: Date.now(),
      lang: 'id',
      actions: [{ action: 'add', title: '➕ Catat transaksi' }, { action: 'open', title: 'Buka Monetra' }],
      data: { url: data.url || '/', kind: data.kind || 'general' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action === 'add' ? 'add' : 'open';
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = list.find(c => new URL(c.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'notification-click', action });
      return;
    }
    await clients.openWindow(action === 'add' ? '/?action=add#/dashboard' : '/#/dashboard');
  })());
});

// The browser may rotate the push subscription; renew it and tell the server.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const key = (await (await fetch('/api/push/key')).json()).publicKey;
      if (!key) return;
      const pad = '='.repeat((4 - key.length % 4) % 4);
      const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const applicationServerKey = Uint8Array.from(raw, c => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch (e) { /* the app re-syncs on next open */ }
  })());
});
