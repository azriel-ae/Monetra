import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { AppNotification, AppSettings, Attachment, Budget, SavingsEntry, SavingsGoal, Transaction } from './models';

class MonetraDatabase extends Dexie {
  transactions!: Table<Transaction, string>; goals!: Table<SavingsGoal, string>; entries!: Table<SavingsEntry, string>; budgets!: Table<Budget, string>; attachments!: Table<Attachment, string>; notifications!: Table<AppNotification, string>; settings!: Table<AppSettings, string>;
  constructor() { super('monetra-local'); this.version(1).stores({ transactions:'id, type, date, category, createdAt', goals:'id, archived, createdAt', entries:'id, goalId, date, type', budgets:'id, month, category', attachments:'id, createdAt', notifications:'id, createdAt, read, kind', settings:'id' }); this.version(2).stores({ budgets:'id, month, category, [month+category]' }); }
}

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  readonly db = new MonetraDatabase();
  async initialize(): Promise<void> {
    const current = await this.db.settings.get('main');
    if (!current) await this.db.settings.put({ id:'main', displayName:'', aiConsent:false });
  }
  async saveAttachment(file: File): Promise<string> { const id = crypto.randomUUID(); await this.db.attachments.put({id, name:file.name, mime:file.type || 'application/octet-stream', blob:file, createdAt:new Date().toISOString()}); return id; }
  async attachmentUrl(id?: string): Promise<string | undefined> { if (!id) return; const item = await this.db.attachments.get(id); return item ? URL.createObjectURL(item.blob) : undefined; }
  async addNotification(title:string, body:string, kind:string): Promise<void> { await this.db.notifications.add({id:crypto.randomUUID(), title, body, kind, createdAt:new Date().toISOString(), read:false}); }
}
