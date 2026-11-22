import { CommonModule } from '@angular/common';
import { Component, OnInit, Signal, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { renderMarkdown } from './markdown';
import { DatabaseService } from './database.service';
import { FinanceService } from './finance.service';
import { NotificationService, NotifState } from './notification.service';
import { Budget, SavingsEntry, SavingsGoal, SavingsPlan, Transaction, AppSettings } from './models';

interface MonetraBackup {
  app: string; backupVersion: number; createdAt: string;
  data: {
    transactions: Transaction[]; goals: SavingsGoal[]; entries: SavingsEntry[]; budgets: Budget[];
    attachments: { id: string; name: string; mime: string; createdAt: string; data: string }[];
    settings?: AppSettings[];
  };
}

/** Server contract for /api/ai/chat — see api/ai/chat.js. */
interface AiContract { success?: boolean; data?: { reply?: unknown }; error?: { code?: unknown; message?: unknown; detail?: unknown } }

function friendlyAiError(status: number, serverMessage?: string): string {
  if (serverMessage) return serverMessage;
  const map: Record<number, string> = {
    400: 'Pertanyaan tidak dapat diproses. Coba rumuskan ulang.',
    401: 'Kunci API Gemini ditolak. Periksa GOOGLE_GEMINI_API di Vercel, lalu deploy ulang.',
    403: 'Akses ke layanan AI ditolak. Periksa pengaturan kunci API di Vercel.',
    404: 'Endpoint AI tidak ditemukan. Pastikan aplikasi di-deploy lewat Vercel agar fungsi /api/ai/chat aktif.',
    405: 'Permintaan AI salah metode. Muat ulang halaman.',
    413: 'Data keuangan terlalu besar untuk dikirim ke AI. Coba lagi nanti.',
    429: 'Terlalu banyak permintaan. Coba lagi beberapa saat.',
    500: 'Terjadi kesalahan di server AI. Coba lagi sebentar.',
    502: 'Layanan AI memberikan respons tidak valid. Coba lagi sebentar.',
    503: 'Fitur AI belum dikonfigurasi di server. Isi GOOGLE_GEMINI_API (atau GEMINI_API_KEY) di Vercel, lalu deploy ulang.',
    504: 'Layanan AI tidak merespons tepat waktu. Coba lagi sebentar.',
  };
  return map[status] || `Layanan AI tidak tersedia (HTTP ${status}). Periksa koneksi, lalu coba lagi.`;
}

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent implements OnInit {
  page = signal('dashboard');
  modal = signal<'transaction' | 'goal' | 'deposit' | 'budget' | null>(null);
  toast = signal(''); toastTimer: ReturnType<typeof setTimeout> | undefined;
  moreMenu = signal(false);

  // Liquid glass bottom nav indicator state (mobile)
  navX = signal(0); navW = signal(56); navReady = signal(false); navMoving = signal(false); navMoveCount = signal(0);
  private navTimer: ReturnType<typeof setTimeout> | undefined;
  navDragging = signal(false);
  private dragPointer = -1; private dragStartX = 0; private dragMoved = false;
  private static readonly PAGES = ['dashboard', 'transactions', 'savings', 'analytics', 'ai', 'settings'];

  // Transaction form
  txType: 'income' | 'expense' = 'expense'; txTitle = ''; txAmount: number | null = null; txCategory = 'Makanan'; txDate = this.today(); txNote = ''; txFile?: File; editingTx?: Transaction;
  // Goal form
  goalTitle = ''; goalTarget: number | null = null; goalDurationValue: number | null = null; goalDurationUnit: 'months' | 'years' = 'months'; goalStartDate = this.today(); goalNote = ''; goalFile?: File;
  // Deposit / withdrawal form
  selectedGoalId = ''; selectedGoalObj = signal<SavingsGoal | null>(null); depositMode: 'deposit' | 'withdraw' = 'deposit'; depositAmount: number | null = null; depositDate = this.today(); depositNote = ''; depositFile?: File;
  budgetCategory = 'Makanan'; budgetAmount: number | null = null;

  categories = ['Makanan', 'Transportasi', 'Belanja', 'Tagihan', 'Pendidikan', 'Kesehatan', 'Hiburan', 'Tempat tinggal', 'Gaji', 'Freelance', 'Bonus', 'Lainnya'];
  settings: AppSettings = { id: 'main' as const, displayName: '', aiConsent: false };
  goalImageUrls = signal<Record<string, string>>({});

  // AI assistant
  aiQuestion = ''; aiAnswer = signal(''); aiHtml = computed(() => renderMarkdown(this.aiAnswer())); aiLoading = signal(false); aiError = signal('');

  importFile?: File;
  notifState = signal<NotifState>('unsupported'); notifPromptOpen = signal(false); notifBannerOpen = signal(false);
  installPrompt: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null = null;
  installed = signal(false); standalone = signal(false); online = signal(navigator.onLine);

  /** Selected month ("YYYY-MM"). Backed by a signal so every computed() that reads it
   * (totals, budgets, month transactions) recalculates when the month changes. */
  private monthSignal = signal('');
  get month(): string { return this.monthSignal(); }
  set month(value: string) { this.monthSignal.set(value); }

  totals!: Signal<ReturnType<FinanceService['totals']>>; goals!: Signal<SavingsGoal[]>; recent!: Signal<Transaction[]>; currentBudget!: Signal<Budget[]>; monthTx!: Signal<Transaction[]>;

  constructor(public finance: FinanceService, private db: DatabaseService, public notices: NotificationService) {
    this.month = this.finance.monthKey();
    this.totals = computed(() => this.finance.totals(this.month));
    this.goals = computed(() => this.finance.goals().filter(g => !g.archived));
    this.recent = computed(() => this.finance.transactions().slice(0, 6));
    this.currentBudget = computed(() => this.finance.budgets().filter(b => b.month === this.month));
    this.monthTx = computed(() => this.finance.monthlyTransactions(this.month));
  }

  async ngOnInit() {
    this.standalone.set(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    // Register the service worker first: Chrome only offers a real install (WebAPK) once it is active.
    // Service worker & beforeinstallprompt sudah ditangani di index.html (lebih awal).
    // Ambil prompt yang sudah tertangkap, dan dengarkan kalau datang belakangan.
    const win = window as any;
    if (win.__monetraInstallPrompt) this.installPrompt = win.__monetraInstallPrompt;
    window.addEventListener('monetra-installprompt', () => { this.installPrompt = win.__monetraInstallPrompt; });
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    standaloneQuery.addEventListener?.('change', e => this.standalone.set(e.matches));
    window.addEventListener('appinstalled', () => {
      this.installed.set(true); this.installPrompt = null; (window as any).__monetraInstallPrompt = null;
      try { localStorage.setItem('monetra-installed', '1'); } catch {}
      // Chrome creates the WebAPK (real Android app) asynchronously: the toast fires
      // before the launcher icon exists. Set expectations instead of claiming instant,
      // and point out that a Chrome-badged icon is an old shortcut, not this install.
      this.toastMsg('Monetra terpasang! Ikon baru muncul di layar utama/laci dalam 1–2 menit. Jika ikonnya masih ada badge Chrome, itu shortcut bekas — hapus, lalu cek lagi nanti.', 8000);
    });

    await this.finance.refresh();
    this.settings = (await this.db.db.settings.get('main')) || this.settings;
    await this.loadGoalImages();
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => false);
    try { if (localStorage.getItem('monetra-installed') === '1') this.installed.set(true); } catch {}

    // URL hash <-> page sync: restores the active tab after reload and keeps
    // browser back/forward working (page signal is the single source of truth).
    const initialPage = this.pageFromHash();
    if (initialPage !== this.page()) this.page.set(initialPage);
    history.replaceState(null, '', '#/' + this.page());
    window.addEventListener('hashchange', () => {
      const p = this.pageFromHash();
      if (p !== this.page()) { this.page.set(p); this.moreMenu.set(false); }
      this.animateNavIndicator();
    });
    window.addEventListener('resize', () => this.updateNavIndicator());
    requestAnimationFrame(() => this.updateNavIndicator());

    this.initNotifications();
    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type !== 'notification-click') return;
      if (e.data.action === 'add') { this.go('dashboard'); this.openTransaction(); } else this.go('dashboard');
    });
    // Opened from the "Catat transaksi" action of a notification while the app was closed.
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      history.replaceState(null, '', location.pathname + location.hash);
      setTimeout(() => this.openTransaction(), 400);
    }
  }

  /** Daily notification is mandatory: ask once, then keep the push subscription alive. */
  private initNotifications() {
    const state = this.notices.state();
    this.notifState.set(state);
    if (state === 'granted') void this.notices.syncSubscription();
    else if (state === 'default') this.notifPromptOpen.set(true);
    else if (state === 'denied') this.notifBannerOpen.set(true);
  }
  async enableNotifications() {
    const result = await this.notices.enable();
    this.notifState.set(result);
    this.notifPromptOpen.set(false);
    if (result === 'granted') { this.notifBannerOpen.set(false); this.toastMsg('Notifikasi harian aktif — pengingat muncul setiap pukul 09.00.'); }
    else if (result === 'denied') { this.notifBannerOpen.set(true); this.toastMsg('Izin ditolak. Aktifkan lewat Info aplikasi → Notifikasi.'); }
    else if (result === 'unsupported') this.toastMsg('Perangkat atau browser ini belum mendukung notifikasi.');
  }

  today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  money(n: number) { return this.finance.format(n || 0); }
  toastMsg(s: string, ms = 2800) { this.toast.set(s); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toast.set(''), ms); }
  go(p: string) {
    this.page.set(p); this.moreMenu.set(false);
    const target = '#/' + p;
    if (location.hash !== target) location.hash = target; // hashchange animates the indicator
    else this.animateNavIndicator();
  }

  /* ---------- Liquid glass bottom nav indicator ---------- */

  pageFromHash(): string {
    const p = location.hash.replace(/^#\/?/, '');
    return AppComponent.PAGES.includes(p) ? p : 'dashboard';
  }

  /** Slot order inside .mobile-nav: 0 Beranda, 1 Transaksi, 2 (+) FAB, 3 Tabungan, 4 Lainnya.
   * The indicator follows the more-sheet when it is open, and otherwise the active page
   * (pages beyond the top three map to the Lainnya slot). */
  private navSlotIndex(page: string): number {
    if (this.moreMenu()) return 4;
    return page === 'dashboard' ? 0 : page === 'transactions' ? 1 : page === 'savings' ? 3 : 4;
  }

  /** Measures the active tab button and positions the capsule. Safe on desktop (nav hidden). */
  updateNavIndicator(): void {
    const nav = document.querySelector('.mobile-nav') as HTMLElement | null;
    if (!nav) return;
    // position:fixed elements always report offsetParent === null; check computed visibility instead.
    if (getComputedStyle(nav).display === 'none' || !nav.getBoundingClientRect().width) return;
    const el = nav.querySelectorAll(':scope > button')[this.navSlotIndex(this.page())] as HTMLElement | undefined;
    if (!el) return;
    const navRect = nav.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    this.navX.set(rect.left - navRect.left);
    this.navW.set(rect.width);
    this.navReady.set(true);
  }

  /** Moves the capsule with the liquid stretch animation (restart-safe on rapid taps). */
  animateNavIndicator(): void {
    this.updateNavIndicator();
    if (!this.navReady()) return;
    this.navMoving.set(true);
    this.navMoveCount.update(c => c + 1);
    clearTimeout(this.navTimer);
    this.navTimer = setTimeout(() => this.navMoving.set(false), 540);
  }

  /** Buttons the capsule can sit on (everything except the (+) action button). */
  private navTabs(nav: HTMLElement): HTMLElement[] {
    return Array.from(nav.querySelectorAll(':scope > button:not(.mobile-add)')) as HTMLElement[];
  }
  navPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('.mobile-add')) return;
    this.dragPointer = e.pointerId; this.dragStartX = e.clientX; this.dragMoved = false;
  }
  navPointerMove(e: PointerEvent) {
    if (e.pointerId !== this.dragPointer) return;
    const nav = e.currentTarget as HTMLElement;
    if (!this.dragMoved) {
      if (Math.abs(e.clientX - this.dragStartX) < 8) return;
      this.dragMoved = true; this.navDragging.set(true);
      try { nav.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const navRect = nav.getBoundingClientRect();
    const tabs = this.navTabs(nav);
    if (!tabs.length) return;
    const w = this.navW();
    const min = tabs[0].getBoundingClientRect().left - navRect.left;
    const max = tabs[tabs.length - 1].getBoundingClientRect().right - navRect.left - w;
    this.navX.set(Math.min(max, Math.max(min, e.clientX - navRect.left - w / 2)));
  }
  navPointerUp(e: PointerEvent) {
    if (e.pointerId !== this.dragPointer) return;
    this.dragPointer = -1;
    if (!this.dragMoved) return; // a plain tap is handled by the button's own click
    this.dragMoved = false; this.navDragging.set(false);
    const nav = e.currentTarget as HTMLElement;
    const navRect = nav.getBoundingClientRect();
    const center = this.navX() + this.navW() / 2;
    let best: HTMLElement | undefined; let bestDist = Infinity;
    for (const b of this.navTabs(nav)) {
      const r = b.getBoundingClientRect();
      const d = Math.abs(r.left - navRect.left + r.width / 2 - center);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    const before = this.page(); const moreBefore = this.moreMenu();
    best?.click();
    // Same tab chosen (no state change): glide the capsule back with the liquid animation.
    if (this.page() === before && this.moreMenu() === moreBefore) this.animateNavIndicator();
  }
  navPointerCancel(e: PointerEvent) {
    if (e.pointerId !== this.dragPointer) return;
    this.dragPointer = -1; this.dragMoved = false; this.navDragging.set(false); this.animateNavIndicator();
  }

  toggleMore() { this.moreMenu.set(!this.moreMenu()); this.animateNavIndicator(); }
  goalEntryCount(goalId: string) { return this.finance.entries().filter(e => e.goalId === goalId).length; }

  /* ---------- Transactions ---------- */

  openTransaction(type: 'income' | 'expense' = 'expense', tx?: Transaction) {
    this.txType = type; this.editingTx = tx;
    this.txTitle = tx?.title || ''; this.txAmount = tx?.amount || null;
    this.txCategory = tx?.category || (type === 'income' ? 'Gaji' : 'Makanan');
    this.txDate = tx?.date || this.today(); this.txNote = ''; this.txFile = undefined;
    this.modal.set('transaction');
  }

  async saveTransaction() {
    if (!this.txTitle.trim() || !this.txAmount || this.txAmount <= 0 || !Number.isSafeInteger(Number(this.txAmount))) { this.toastMsg('Periksa nama dan nominal transaksi.'); return; }
    const transactionMonth = this.txDate.slice(0, 7);
    const before = this.finance.totals(transactionMonth);
    let attachmentId = this.editingTx?.attachmentId;
    if (this.txFile) attachmentId = await this.db.saveAttachment(this.txFile);
    const data: Transaction = { id: this.editingTx?.id || crypto.randomUUID(), type: this.txType, title: this.txTitle.trim(), amount: Number(this.txAmount), category: this.txCategory, date: this.txDate, note: this.txNote.trim(), attachmentId, createdAt: this.editingTx?.createdAt || new Date().toISOString() };
    if (this.editingTx) await this.finance.updateTransaction(data); else await this.finance.addTransaction(data);
    this.modal.set(null); this.toastMsg('Transaksi tersimpan.');
    if (!this.editingTx && this.txType === 'expense') {
      const after = this.finance.totals(transactionMonth);
      if (after.income > 0 && before.expense / before.income < .75 && after.expense / after.income >= .75) await this.notices.notify('Pengeluaran mulai tinggi', 'Pengeluaran bulan ini mencapai 75% dari pemasukan.', 'budget-warning');
      if (after.income > 0 && before.expense <= before.income && after.expense > after.income) await this.notices.notify('Pengeluaran melebihi pemasukan', 'Tinjau kembali transaksi dan anggaran.', 'overspending');
      const budget = this.finance.budgets().find(b => b.month === transactionMonth && b.category === this.txCategory);
      if (budget) {
        const used = this.finance.monthlyTransactions(transactionMonth).filter(t => t.type === 'expense' && t.category === this.txCategory).reduce((sum, t) => sum + t.amount, 0);
        const previous = used - Number(this.txAmount);
        const ratio = used / budget.amount; const oldRatio = previous / budget.amount;
        const threshold = ratio >= 1 ? 1 : ratio >= .9 ? .9 : ratio >= .75 ? .75 : 0;
        if (threshold && oldRatio < threshold) await this.notices.notify('Peringatan anggaran', `${this.txCategory} telah menggunakan ${Math.round(ratio * 100)}% dari anggaran.`, 'budget-warning');
      }
    }
  }

  async removeTransaction(tx: Transaction) { if (!confirm(`Hapus transaksi "${tx.title}"?`)) return; await this.finance.deleteTransaction(tx.id); this.toastMsg('Transaksi dihapus.'); }

  /* ---------- Savings goals ---------- */

  openGoal() {
    this.goalTitle = ''; this.goalTarget = null; this.goalDurationValue = null; this.goalDurationUnit = 'months';
    this.goalStartDate = this.today(); this.goalNote = ''; this.goalFile = undefined;
    this.modal.set('goal');
  }

  /** Live plan preview while filling the goal form. */
  goalPreview() {
    const target = Number(this.goalTarget) || 0;
    const value = Number(this.goalDurationValue) || 0;
    if (target <= 0 || value <= 0) return null;
    const start = this.goalStartDate || this.today();
    const targetDate = this.finance.targetDateFor(start, value, this.goalDurationUnit);
    const plan = this.finance.planFor({ id: '', title: '', target, targetDate, startDate: start, durationValue: value, durationUnit: this.goalDurationUnit, createdAt: start }, start);
    return plan ? { targetDate, totalDays: plan.totalDays, perDay: plan.perDay, perWeek: plan.perWeek, perMonth: plan.perMonth } : null;
  }

  async saveGoal() {
    if (!this.goalTitle.trim() || !this.goalTarget || this.goalTarget <= 0 || !Number.isSafeInteger(Number(this.goalTarget))) { this.toastMsg('Isi nama dan harga target dengan benar.'); return; }
    const duration = Number(this.goalDurationValue);
    if (!duration || duration <= 0 || !Number.isInteger(duration) || duration > 600) { this.toastMsg('Isi durasi menabung (1–600).'); return; }
    if (!this.goalStartDate) { this.toastMsg('Tentukan tanggal mulai menabung.'); return; }
    const targetDate = this.finance.targetDateFor(this.goalStartDate, duration, this.goalDurationUnit);
    let imageId: string | undefined;
    if (this.goalFile) imageId = await this.db.saveAttachment(this.goalFile);
    await this.finance.addGoal({
      title: this.goalTitle.trim(), target: Number(this.goalTarget), targetDate,
      startDate: this.goalStartDate, durationValue: duration, durationUnit: this.goalDurationUnit,
      note: this.goalNote, imageId,
    });
    await this.loadGoalImages();
    this.modal.set(null); this.toastMsg('Target tabungan dibuat.');
  }

  async loadGoalImages() {
    const next: Record<string, string> = {};
    for (const goal of this.finance.goals()) { const url = await this.db.attachmentUrl(goal.imageId); if (url) next[goal.id] = url; }
    for (const url of Object.values(this.goalImageUrls())) URL.revokeObjectURL(url);
    this.goalImageUrls.set(next);
  }

  plan(goal: SavingsGoal): SavingsPlan | null { return this.finance.planFor(goal); }
  progress(goal: SavingsGoal) { return Math.min(100, goal.target ? this.finance.goalTotal(goal.id) / goal.target * 100 : 0); }
  planStatus(plan: SavingsPlan) {
    return ({
      completed: { label: 'Tercapai', cls: 'done' },
      'not-started': { label: 'Belum dimulai', cls: 'neutral' },
      'on-track': { label: 'Sesuai rencana', cls: 'ok' },
      'slightly-behind': { label: 'Sedikit tertinggal', cls: 'warn' },
      behind: { label: 'Di bawah rencana', cls: 'behind' },
    } as any)[plan.status];
  }

  openDeposit(goal: SavingsGoal, mode: 'deposit' | 'withdraw' = 'deposit') {
    this.selectedGoalId = goal.id; this.selectedGoalObj.set(goal); this.depositMode = mode;
    this.depositAmount = null; this.depositDate = this.today(); this.depositNote = ''; this.depositFile = undefined;
    this.modal.set('deposit');
  }

  async saveDeposit() {
    if (!this.depositAmount || this.depositAmount <= 0 || !Number.isSafeInteger(Number(this.depositAmount))) { this.toastMsg('Masukkan nominal yang valid.'); return; }
    let attachmentId: string | undefined;
    if (this.depositFile) attachmentId = await this.db.saveAttachment(this.depositFile);
    try {
      const goal = this.selectedGoalObj();
      if (this.depositMode === 'withdraw' && goal && Number(this.depositAmount) > this.finance.goalTotal(goal.id)) { this.toastMsg('Nominal penarikan melebihi saldo tabungan target ini.'); return; }
      await this.finance.addSavingsEntry({ goalId: this.selectedGoalId, type: this.depositMode === 'deposit' ? 'deposit' : 'withdrawal', amount: Number(this.depositAmount), date: this.depositDate, note: this.depositNote, attachmentId });
      this.modal.set(null);
      this.toastMsg(this.depositMode === 'deposit' ? 'Setoran tersimpan.' : 'Penarikan dicatat.');
      if (this.depositMode === 'deposit') this.notices.play();
      if (this.depositMode === 'deposit') await this.notices.notify('Setoran dicatat', `${this.money(Number(this.depositAmount))} masuk ke target "${goal?.title || 'tabungan'}".`, 'savings');
      if (goal && this.depositMode === 'deposit' && this.finance.goalTotal(goal.id) >= goal.target && !goal.completedAt) await this.notices.notify('Target tercapai', `Target "${goal.title}" telah terpenuhi.`, 'goal');
    } catch (e) { this.toastMsg(e instanceof Error ? e.message : 'Gagal menyimpan setoran.'); }
  }

  async archiveGoal(goal: SavingsGoal) {
    if (!confirm(`Arsipkan target "${goal.title}"? Target tidak lagi muncul di daftar utama.`)) return;
    await this.finance.store.db.goals.update(goal.id, { archived: true });
    await this.finance.refresh();
    this.toastMsg('Target diarsipkan.');
  }

  /* ---------- Budgets ---------- */

  openBudget() { this.budgetAmount = null; this.modal.set('budget'); }
  async saveBudget() {
    if (!this.budgetAmount || this.budgetAmount <= 0 || !Number.isSafeInteger(Number(this.budgetAmount))) { this.toastMsg('Masukkan nominal anggaran yang valid.'); return; }
    await this.finance.setBudget(this.budgetCategory, Number(this.budgetAmount), this.month);
    this.modal.set(null); this.toastMsg('Anggaran diperbarui.');
  }
  budgetUsed(category: string) { return this.finance.monthlyTransactions(this.month).filter(t => t.type === 'expense' && t.category === category).reduce((s, t) => s + t.amount, 0); }
  budgetPercent(b: Budget) { return Math.min(100, b.amount ? this.budgetUsed(b.category) / b.amount * 100 : 0); }

  /* ---------- Dashboard ---------- */

  health() { const t = this.totals(); if (t.income === 0) return t.expense > 0 ? 'critical' : 'neutral'; const ratio = t.expense / t.income; return ratio >= 1 ? 'critical' : ratio >= .75 ? 'warning' : 'healthy'; }
  healthLabel() { return ({ critical: 'Perlu perhatian', warning: 'Perlu dijaga', healthy: 'Terkendali', neutral: 'Belum ada data' } as any)[this.health()]; }
  monthLabel() { return new Date(this.month + '-02').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); }
  changeMonth(delta: number) { const d = new Date(this.month + '-02T00:00:00'); d.setMonth(d.getMonth() + delta); this.month = this.finance.monthKey(d); }
  expenseWidth() { const max = Math.max(this.totals().income, this.totals().expense, 1); return this.totals().expense / max * 100; }
  incomeWidth() { const max = Math.max(this.totals().income, this.totals().expense, 1); return this.totals().income / max * 100; }
  categoryBreakdown() {
    const map = new Map<string, number>();
    for (const t of this.finance.monthlyTransactions(this.month).filter(x => x.type === 'expense')) map.set(t.category, (map.get(t.category) || 0) + t.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }

  /* ---------- Report, backup, restore, CSV ---------- */

  async printReport() {
    const tx = this.finance.monthlyTransactions(this.month);
    const t = this.totals();
    const rows = tx.map(x => `<tr><td>${x.date}</td><td>${x.title.replace(/[<>]/g, '')}</td><td>${x.category}</td><td>${x.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</td><td>${this.money(x.amount)}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { this.toastMsg('Izinkan pop-up untuk mencetak laporan.'); return; }
    w.document.write(`<!doctype html><html lang="id"><head><title>Laporan Monetra</title><style>body{font:13px Arial;padding:35px;color:#202938}h1{color:#365C8D}p{color:#737D8D}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;border-bottom:1px solid #E5E8ED;padding:9px}th{background:#EAEFF6}.summary{display:flex;gap:30px;margin-top:25px}.summary b{display:block;font-size:18px;margin-top:5px}</style></head><body><h1>MONETRA</h1><p>Laporan keuangan · ${this.monthLabel()}</p><div class="summary"><div>Pemasukan<b>${this.money(t.income)}</b></div><div>Pengeluaran<b>${this.money(t.expense)}</b></div><div>Arus kas<b>${this.money(t.balance)}</b></div></div><table><thead><tr><th>Tanggal</th><th>Transaksi</th><th>Kategori</th><th>Jenis</th><th>Nominal</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  async backup() {
    const [transactions, goals, entries, budgets, attachments, settings] = await Promise.all([
      this.db.db.transactions.toArray(), this.db.db.goals.toArray(), this.db.db.entries.toArray(), this.db.db.budgets.toArray(),
      this.db.db.attachments.toArray(), this.db.db.settings.toArray(),
    ]);
    const attachmentData = [];
    for (const a of attachments) attachmentData.push({ id: a.id, name: a.name, mime: a.mime, createdAt: a.createdAt, data: await this.blobToData(a.blob) });
    const payload: MonetraBackup = { app: 'Monetra', backupVersion: 1, createdAt: new Date().toISOString(), data: { transactions, goals, entries, budgets, attachments: attachmentData, settings } };
    this.download(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `monetra-backup-${this.today()}.json`);
    this.toastMsg('Backup berhasil dibuat.');
  }

  blobToData(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  }

  unknownToJson(text: string): MonetraBackup {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('File backup bukan JSON yang valid.'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('File backup kosong atau tidak valid.');
    return parsed as MonetraBackup;
  }

  download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

  async restore(file?: File) {
    if (!file) return;
    try {
      const data = this.unknownToJson(await file.text());
      if (data.app !== 'Monetra' || data.backupVersion !== 1 || !data.data) throw new Error('Format backup tidak dikenali.');
      const d = data.data;
      if (!Array.isArray(d.transactions) || !Array.isArray(d.goals) || !Array.isArray(d.entries) || !Array.isArray(d.budgets) || !Array.isArray(d.attachments)) throw new Error('Struktur backup tidak lengkap.');
      const mode = (prompt('Pilih mode import dengan mengetik MERGE, REPLACE, atau CANCEL.', 'MERGE') || 'CANCEL').toUpperCase();
      if (mode === 'CANCEL') return;
      if (!['MERGE', 'REPLACE'].includes(mode)) throw new Error('Mode import tidak dikenali.');
      if (mode === 'REPLACE') { await this.backup(); await this.db.db.transaction('rw', this.db.db.tables, async () => { for (const t of this.db.db.tables) if (t.name !== 'notifications') await t.clear(); }); }
      await this.db.db.transaction('rw', this.db.db.tables, async () => {
        for (const x of d.transactions) await this.db.db.transactions.put(x);
        for (const x of d.goals) await this.db.db.goals.put(x);
        for (const x of d.entries) await this.db.db.entries.put(x);
        for (const x of d.budgets) await this.db.db.budgets.put(x);
        for (const x of d.settings || []) await this.db.db.settings.put(x);
        for (const x of d.attachments) { const bytes = Uint8Array.from(atob(x.data), c => c.charCodeAt(0)); await this.db.db.attachments.put({ id: x.id, name: x.name, mime: x.mime, createdAt: x.createdAt, blob: new Blob([bytes], { type: x.mime }) }); }
      });
      await this.finance.refresh();
      this.settings = (await this.db.db.settings.get('main')) || this.settings;
      this.toastMsg('Restore berhasil.');
    } catch (e) { this.toastMsg(e instanceof Error ? e.message : 'Import gagal.'); }
  }

  async exportCsv() {
    const rows = this.finance.transactions();
    const q = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = ['Tanggal,Jenis,Nama,Kategori,Nominal,Catatan', ...rows.map(t => [t.date, t.type, t.title, t.category, t.amount, t.note || ''].map(q).join(','))].join('\n');
    this.download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `monetra-transaksi-${this.today()}.csv`);
  }

  /* ---------- Gemini AI ---------- */

  async askGemini() {
    this.aiError.set(''); this.aiAnswer.set('');
    if (!this.settings.aiConsent) { this.aiError.set('Aktifkan persetujuan penggunaan data terlebih dahulu.'); return; }
    if (!this.aiQuestion.trim()) return;
    this.aiLoading.set(true);
    try {
      const snapshot = {
        summary: {
          month: this.month,
          mainBalance: this.finance.mainBalance(),
          savingsBalance: this.finance.savingsBalance(),
          income: this.totals().income, expense: this.totals().expense,
          spendingRate: Math.round(this.totals().spendingRate),
        },
        topExpenseCategories: this.categoryBreakdown().map(([category, amount]) => ({ category, amount })),
        goals: this.finance.goals().filter(g => !g.archived).map(g => ({ title: g.title, target: g.target, current: this.finance.goalTotal(g.id), targetDate: g.targetDate })),
        budgets: this.finance.budgets().map(b => ({ category: b.category, amount: b.amount, month: b.month })),
        recentTransactions: this.finance.transactions().slice(0, 25).map(({ title, type, amount, category, date }) => ({ title, type, amount, category, date })),
      };
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: this.aiQuestion, financialData: snapshot }) });
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      let json: AiContract | undefined;
      if (contentType.includes('json') || text.trim().startsWith('{')) { try { json = JSON.parse(text); } catch { json = undefined; } }
      if (json && json.success === true && typeof json.data?.reply === 'string' && json.data.reply.trim()) { this.aiAnswer.set(json.data.reply.trim()); return; }
      if (!res.ok) { const msg = friendlyAiError(res.status, typeof json?.error?.message === 'string' ? json.error.message : undefined); const detail = typeof json?.error?.detail === 'string' ? json.error.detail : ''; throw new Error(detail ? `${msg} [${detail}]` : msg); }
      // 200 but not our contract: the hosting returned an HTML page (SPA fallback)
      // instead of the serverless function — i.e. /api/ai/chat does not exist here.
      throw new Error('Endpoint /api/ai/chat tidak ditemukan di hosting ini. Fitur AI butuh fungsi backend — deploy aplikasi melalui Vercel (lihat README) agar AI aktif.');
    } catch (e) {
      if (e instanceof TypeError) this.aiError.set('Tidak dapat menghubungi server AI. Periksa koneksi internet.');
      else this.aiError.set(e instanceof Error ? e.message : 'Terjadi kesalahan.');
    } finally { this.aiLoading.set(false); }
  }

  async consentAI(accepted: boolean) {
    this.settings.aiConsent = accepted;
    this.settings.aiConsentAt = accepted ? new Date().toISOString() : undefined;
    await this.db.db.settings.put({ ...this.settings, id: 'main' });
    this.toastMsg(accepted ? 'Persetujuan AI aktif.' : 'Persetujuan AI dicabut.');
  }

  /* ---------- Notifications & settings ---------- */

  async saveSettings() { await this.db.db.settings.put({ ...this.settings, id: 'main' as const }); this.toastMsg('Pengaturan disimpan.'); }
  async resetData() {
    if (!confirm('Hapus seluruh data Monetra dari perangkat ini?')) return;
    if (!confirm('Tindakan ini tidak dapat dibatalkan. Pastikan sudah membuat backup. Lanjutkan?')) return;
    await this.db.db.delete(); location.reload();
  }

  /* ---------- PWA install ---------- */

  async install() {
    if (this.standalone() || this.installed()) { this.toastMsg('Monetra sudah terpasang sebagai aplikasi.'); return; }
    const ua = navigator.userAgent || '';
    // iPadOS 13+ reports itself as Mac with touch support.
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafariOrFirefox = /Firefox|FxiOS/.test(ua) || /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
    // WebViews and in-app browsers (WhatsApp/Instagram/FB/Line/TikTok/...) cannot add home-screen icons.
    const inAppBrowser = /FB_IAB|FBAN|FBAV|Instagram|WhatsApp|;wv\)|\bwv\b|Line\/|Snapchat|TikTok/i.test(ua);
    if (inAppBrowser) { this.toastMsg('Monetra dibuka dari dalam aplikasi lain, jadi ikon tidak bisa dipasang dari sini. Salin tautan, buka di Chrome (Android) atau Safari (iPhone), lalu install dari sana.', 8000); return; }
    if (isIOS) { this.toastMsg('iPhone/iPad: di Safari, ketuk ikon Share (kotak dengan panah ke atas) lalu pilih "Add to Home Screen" — ikon akan muncul di layar utama.', 8000); return; }
    if (isSafariOrFirefox) { this.toastMsg('Browser ini belum mendukung install otomatis. Buka menu browser, lalu cari opsi "Add to Home Screen" / "Install".', 8000); return; }
    if (!this.installPrompt) this.installPrompt = (window as any).__monetraInstallPrompt || null;
    if (!this.installPrompt) {
      // Chrome only exposes the real install dialog (beforeinstallprompt) while the
      // page is installable. IMPORTANT: the ⋮ menu's "Add to Home screen" on a page
      // that is NOT installable creates a mere shortcut — it opens inside Chrome,
      // shows the Chrome badge, and App info points to Chrome. Never suggest it.
      const swReady = await navigator.serviceWorker?.ready.then(() => true).catch(() => false);
      if (!swReady) { this.toastMsg('Service worker belum aktif, jadi install belum bisa. Muat ulang halaman, tunggu 3–5 detik, lalu coba lagi.', 8000); return; }
      this.toastMsg('Install otomatis belum siap di halaman ini. Muat ulang halaman, tunggu 3–5 detik, lalu tekan tombol "Install aplikasi" lagi. Jangan gunakan menu "Add to Home screen" — itu membuat shortcut Chrome, bukan aplikasi.', 8000);
      return;
    }
    try {
      this.installPrompt.prompt();
      const choice = await this.installPrompt.userChoice;
      if (choice.outcome === 'accepted') this.installed.set(true);
    } catch {
      // Chrome rejects prompt() without a trusted user gesture (or when install
      // criteria changed). Never leave the tap without feedback.
      this.toastMsg('Dialog install tidak muncul. Muat ulang halaman lalu tekan tombol "Install aplikasi" lagi. Jangan gunakan "Add to Home screen" dari menu browser — itu membuat shortcut, bukan aplikasi.', 8000);
    }
    this.installPrompt = null; (window as any).__monetraInstallPrompt = null;
  }

  fileChanged(event: Event, which: 'tx' | 'goal' | 'deposit') {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (which === 'tx') this.txFile = file; else if (which === 'goal') this.goalFile = file; else this.depositFile = file;
  }
}
