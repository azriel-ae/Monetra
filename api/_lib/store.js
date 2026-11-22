'use strict';
// Minimal Upstash Redis (REST) client — no extra dependency.
// Works with the Vercel Marketplace integration (KV_REST_API_*) and Upstash's own names.

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: String(url).replace(/\/+$/, ''), token: String(token) } : null;
}

function isConfigured() { return config() !== null; }

async function cmd(args) {
  const c = config();
  if (!c) throw new Error('REDIS_NOT_CONFIGURED');
  const res = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error('REDIS_ERROR: ' + (json.error || res.status));
  return json.result;
}

module.exports = { isConfigured, cmd };
