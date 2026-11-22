export type TxType = 'income' | 'expense';
export interface Transaction { id: string; type: TxType; title: string; amount: number; category: string; date: string; note?: string; attachmentId?: string; createdAt: string; }
export type DurationUnit = 'months' | 'years';
export interface SavingsGoal {
  id: string; title: string; target: number;
  targetDate?: string;
  /** Plan fields (new). A goal with these gets daily/weekly/monthly needs computed. */
  startDate?: string;
  durationValue?: number;
  durationUnit?: DurationUnit;
  /** Set when the saved total first reached the target. */
  completedAt?: string;
  imageId?: string; note?: string; createdAt: string; archived?: boolean;
}
export interface SavingsEntry { id: string; goalId: string; type: 'deposit' | 'withdrawal'; amount: number; date: string; note?: string; attachmentId?: string; createdAt: string; }
export interface Budget { id: string; category: string; amount: number; month: string; }
export interface Attachment { id: string; name: string; mime: string; blob: Blob; createdAt: string; }
export interface AppNotification { id: string; title: string; body: string; createdAt: string; read: boolean; kind: string; }
export interface AppSettings { id: 'main'; displayName: string; reminderEnabled?: boolean; dailyReminderEnabled?: boolean; goalReminderEnabled?: boolean; reminderTime?: string; soundEnabled?: boolean; soundVolume?: number; aiConsent: boolean; aiConsentAt?: string; lastReminderDate?: string; lastGoalReminderDate?: string; }

/** Computed savings plan for a goal, derived from real calendar dates. */
export interface SavingsPlan {
  startDate: string; targetDate: string;
  totalDays: number; elapsedDays: number;
  perDay: number; perWeek: number; perMonth: number;
  saved: number; remaining: number; progress: number;
  /** Amount the user should have saved by today to stay on plan. */
  expectedByNow: number;
  status: 'completed' | 'not-started' | 'on-track' | 'slightly-behind' | 'behind';
}
