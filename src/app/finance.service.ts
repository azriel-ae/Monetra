import { Injectable, signal } from '@angular/core';
import { DatabaseService } from './database.service';
import { Budget, SavingsEntry, SavingsGoal, SavingsPlan, Transaction } from './models';

const MS_PER_DAY = 86_400_000;

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseYmd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function ymdUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
/** Adds n calendar months, clamping the day-of-month to the target month length (e.g. 31 Aug + 1 month = 30 Sep). */
function addMonthsYmd(value: string, n: number): string {
  const d = parseYmd(value);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return ymdUtc(target);
}

@Injectable({ providedIn: 'root' })
export class FinanceService {
  transactions = signal<Transaction[]>([]);
  goals = signal<SavingsGoal[]>([]);
  entries = signal<SavingsEntry[]>([]);
  budgets = signal<Budget[]>([]);
  loading = signal(true);
  constructor(public store: DatabaseService) {}

  async refresh(): Promise<void> {
    await this.store.initialize();
    const [tx, goals, entries, budgets] = await Promise.all([
      this.store.db.transactions.orderBy('date').reverse().toArray(),
      this.store.db.goals.toArray(),
      this.store.db.entries.orderBy('date').reverse().toArray(),
      this.store.db.budgets.toArray(),
    ]);
    this.transactions.set(tx); this.goals.set(goals); this.entries.set(entries); this.budgets.set(budgets);
    this.loading.set(false);
  }

  async addTransaction(input: Omit<Transaction, 'id' | 'createdAt'>): Promise<void> {
    await this.store.db.transactions.add({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    await this.refresh();
  }
  async updateTransaction(tx: Transaction): Promise<void> { await this.store.db.transactions.put(tx); await this.refresh(); }
  async deleteTransaction(id: string): Promise<void> { await this.store.db.transactions.delete(id); await this.refresh(); }
  async addGoal(input: Omit<SavingsGoal, 'id' | 'createdAt'>): Promise<void> {
    await this.store.db.goals.add({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    await this.refresh();
  }

  /**
   * Deposits and withdrawals always move money between the main balance and
   * savings — a deposit is never counted as an expense.
   */
  async addSavingsEntry(input: Omit<SavingsEntry, 'id' | 'createdAt'>): Promise<void> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Nominal harus lebih dari nol.');
    await this.store.db.transaction('rw', this.store.db.entries, this.store.db.goals, this.store.db.transactions, async () => {
      const goal = await this.store.db.goals.get(input.goalId);
      if (!goal) throw new Error('Target tabungan tidak ditemukan.');
      const rows = await this.store.db.entries.where('goalId').equals(input.goalId).toArray();
      const current = rows.reduce((sum, row) => sum + (row.type === 'deposit' ? row.amount : -row.amount), 0);
      const next = current + (input.type === 'deposit' ? input.amount : -input.amount);
      if (next < 0) throw new Error('Saldo tabungan tidak mencukupi.');
      if (input.type === 'deposit') {
        const [income, expense, depositRows] = await Promise.all([
          this.store.db.transactions.where('type').equals('income').toArray(),
          this.store.db.transactions.where('type').equals('expense').toArray(),
          this.store.db.entries.toArray(),
        ]);
        const mainBalance = income.reduce((sum, row) => sum + row.amount, 0)
          - expense.reduce((sum, row) => sum + row.amount, 0)
          - depositRows.filter(row => row.type === 'deposit').reduce((sum, row) => sum + row.amount, 0)
          + depositRows.filter(row => row.type === 'withdrawal').reduce((sum, row) => sum + row.amount, 0);
        if (input.amount > mainBalance) throw new Error('Saldo utama tidak mencukupi untuk setoran ini.');
      }
      await this.store.db.entries.add({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      // Mark the goal as reached on the first deposit that meets the target.
      if (input.type === 'deposit' && !goal.completedAt && next >= goal.target) {
        await this.store.db.goals.update(goal.id, { completedAt: input.date || ymd(new Date()) });
      }
    });
    await this.refresh();
  }

  async goalBalance(goalId: string): Promise<number> {
    const rows = await this.store.db.entries.where('goalId').equals(goalId).toArray();
    return rows.reduce((s, e) => s + (e.type === 'deposit' ? e.amount : -e.amount), 0);
  }
  goalTotal(goalId: string): number {
    return this.entries().filter(e => e.goalId === goalId).reduce((s, e) => s + (e.type === 'deposit' ? e.amount : -e.amount), 0);
  }
  async setBudget(category: string, amount: number, month: string): Promise<void> {
    const old = await this.store.db.budgets.where({ category, month }).first();
    await this.store.db.budgets.put({ id: old?.id || crypto.randomUUID(), category, amount, month });
    await this.refresh();
  }

  monthKey(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
  monthlyTransactions(month = this.monthKey()): Transaction[] { return this.transactions().filter(t => t.date.startsWith(month)); }

  totals(month = this.monthKey()): { income: number; expense: number; balance: number; savings: number; spendingRate: number } {
    const tx = this.monthlyTransactions(month);
    const income = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const savings = this.entries().filter(e => e.date.startsWith(month) && e.type === 'deposit').reduce((s, e) => s + e.amount, 0);
    return { income, expense, balance: income - expense, savings, spendingRate: income ? expense / income * 100 : expense ? 100 : 0 };
  }

  mainBalance(): number {
    const income = this.transactions().filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = this.transactions().filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const deposits = this.entries().filter(e => e.type === 'deposit').reduce((s, e) => s + e.amount, 0);
    const withdrawals = this.entries().filter(e => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0);
    return income - expense - deposits + withdrawals;
  }
  savingsBalance(): number { return this.entries().reduce((s, e) => s + (e.type === 'deposit' ? e.amount : -e.amount), 0); }

  /** `Rp6.000.000` — always grouped, no decimals. */
  format(value: number): string {
    const rounded = Math.round(value || 0);
    return (rounded < 0 ? '-Rp' : 'Rp') + Math.abs(rounded).toLocaleString('id-ID');
  }

  /** Savings plan from real calendar dates. Returns null for goals without a duration plan. */
  planFor(goal: SavingsGoal, today = ymd(new Date())): SavingsPlan | null {
    if (!goal.targetDate || !goal.durationValue || goal.durationValue <= 0) return null;
    const start = goal.startDate || goal.createdAt.slice(0, 10);
    const end = goal.targetDate;
    const totalDays = Math.max(1, Math.round((parseYmd(end).getTime() - parseYmd(start).getTime()) / MS_PER_DAY));
    const saved = this.goalTotal(goal.id);
    const remaining = Math.max(0, goal.target - saved);
    const elapsed = Math.round((parseYmd(today).getTime() - parseYmd(start).getTime()) / MS_PER_DAY);
    const elapsedDays = Math.min(Math.max(elapsed, 0), totalDays);
    const expectedByNow = Math.min(goal.target, Math.ceil(goal.target * elapsedDays / totalDays));
    let status: SavingsPlan['status'];
    if (saved >= goal.target) status = 'completed';
    else if (elapsedDays === 0) status = 'not-started';
    else if (saved >= expectedByNow) status = 'on-track';
    else if (saved >= expectedByNow * 0.85) status = 'slightly-behind';
    else status = 'behind';
    return {
      startDate: start, targetDate: end, totalDays, elapsedDays,
      perDay: Math.ceil(goal.target / totalDays),
      perWeek: Math.ceil(goal.target / (totalDays / 7)),
      perMonth: Math.ceil(goal.target / this.monthsBetweenYmd(start, end)),
      saved, remaining, progress: goal.target ? Math.min(100, saved / goal.target * 100) : 0,
      expectedByNow, status,
    };
  }

  /** Whole calendar months between two YMD dates (min 1). */
  monthsBetweenYmd(start: string, end: string): number {
    const s = parseYmd(start); const e = parseYmd(end);
    let months = (e.getUTCFullYear() - s.getFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
    if (e.getUTCDate() < s.getUTCDate()) months -= 1;
    return Math.max(1, months);
  }

  /** Target date for the goal form: start date plus duration in months/years. */
  targetDateFor(start: string, value: number, unit: 'months' | 'years'): string {
    return addMonthsYmd(start, unit === 'years' ? value * 12 : value);
  }
}
