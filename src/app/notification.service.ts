import { Injectable } from '@angular/core';

export type NotifState = 'granted' | 'default' | 'denied' | 'unsupported';

const SYNC_KEY = 'monetra-push-synced';

function keyToBytes(base64Url: string): Uint8Array {
  const padded = base64Url + '='.repeat((4 - base64Url.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Notifications are mandatory in Monetra: once the device permission is granted the app
 * subscribes to Web Push and the server sends a daily reminder at 09:00 WIB, even when the
 * app is closed. There are no in-app switches — turning it off is done in the phone's
 * app info / site settings.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  supported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  state(): NotifState {
    return this.supported() ? (Notification.permission as NotifState) : 'unsupported';
  }

  /** Asks for permission (needs a user gesture) and, when granted, subscribes to push. */
  async enable(): Promise<NotifState> {
    if (!this.supported()) return 'unsupported';
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') await this.syncSubscription(true);
    return this.state();
  }

  /** Makes sure this device has a push subscription saved on the server (at most once a day). */
  async syncSubscription(force = false): Promise<boolean> {
    try {
      if (this.state() !== 'granted') return false;
      const today = new Date().toISOString().slice(0, 10);
      if (!force && localStorage.getItem(SYNC_KEY) === today) return true;

      const keyRes = await fetch('/api/push/key', { cache: 'no-store' });
      if (!keyRes.ok) return false;
      const publicKey: string | undefined = (await keyRes.json())?.publicKey;
      if (!publicKey) return false;

      const wanted = keyToBytes(publicKey);
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      const current = sub?.options?.applicationServerKey;
      if (sub && current && !sameBytes(new Uint8Array(current), wanted)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted as BufferSource });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (res.ok) localStorage.setItem(SYNC_KEY, today);
      return res.ok;
    } catch { return false; }
  }

  /** Immediate local alert (budget warnings, savings) — loud vibration, branded icon. */
  async notify(title: string, body: string, tag = 'monetra'): Promise<void> {
    if (this.state() !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body, tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
        renotify: true, silent: false, vibrate: [300, 120, 300, 120, 600], timestamp: Date.now(), lang: 'id',
        data: { url: '/', kind: 'local' },
      } as NotificationOptions);
    } catch { /* OS notification unavailable */ }
  }

  /** In-app chime (e.g. after a savings deposit) at full volume. */
  play(): void {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      ctx.resume?.().catch?.(() => {});
      const now = ctx.currentTime;
      [659.25, 880, 1174.66].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * .09);
        gain.gain.linearRampToValueAtTime(.5, now + i * .09 + .025);
        gain.gain.exponentialRampToValueAtTime(.001, now + i * .09 + .32);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * .09); osc.stop(now + i * .09 + .34);
      });
      setTimeout(() => { ctx.close().catch?.(() => {}); }, 800);
    } catch { /* audio unavailable */ }
  }
}
