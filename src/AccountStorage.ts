'use strict';

/**
 * AccountStorage.ts
 * 使用 VS Code SecretStorage（加密）儲存 secret，
 * 使用 VS Code globalState 儲存非敏感帳號資訊。
 *
 * 資料分離策略：
 *   globalState  → 帳號清單（id, issuer, account, digits, period, color, createdAt）
 *   SecretStorage → secret（key = "secret:<id>"）
 */

import * as vscode from 'vscode';

export interface Account {
  id: string;
  issuer: string;
  account: string;
  digits: 6 | 8;
  period: 30 | 60;
  color: string;
  createdAt: number;
}

export interface AccountWithSecret extends Account {
  secret: string;
}

export interface NewAccountData {
  issuer: string;
  account?: string;
  secret: string;
  digits?: number;
  period?: number;
}

const ACCOUNTS_KEY = '2fa.accounts';

const AVATAR_COLORS = [
  '#4285F4', '#EA4335', '#34A853', '#FBBC04',
  '#FF6D00', '#9C27B0', '#00BCD4', '#795548',
  '#607D8B', '#E91E63', '#009688', '#3F51B5'
];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function pickColor(issuer: string): string {
  if (!issuer) { return AVATAR_COLORS[0]; }
  let hash = 0;
  for (let i = 0; i < issuer.length; i++) {
    hash = ((hash * 31) + issuer.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export class AccountStorage {
  constructor(
    private readonly context: vscode.ExtensionContext
  ) {}

  /** 讀取所有帳號（不含 secret） */
  async loadAccounts(): Promise<Account[]> {
    const raw = this.context.globalState.get<Account[]>(ACCOUNTS_KEY, []);
    return Array.isArray(raw) ? raw : [];
  }

  /** 讀取單一帳號（含 secret） */
  async loadAccountWithSecret(id: string): Promise<AccountWithSecret | undefined> {
    const accounts = await this.loadAccounts();
    const account = accounts.find(a => a.id === id);
    if (!account) { return undefined; }
    const secret = await this.context.secrets.get(`secret:${id}`);
    if (!secret) { return undefined; }
    return { ...account, secret };
  }

  /** 讀取所有帳號（含 secret） */
  async loadAllWithSecrets(): Promise<AccountWithSecret[]> {
    const accounts = await this.loadAccounts();
    const results: AccountWithSecret[] = [];
    for (const account of accounts) {
      const secret = await this.context.secrets.get(`secret:${account.id}`);
      if (secret) {
        results.push({ ...account, secret });
      }
    }
    return results;
  }

  /** 新增帳號 */
  async addAccount(data: NewAccountData): Promise<Account> {
    const accounts = await this.loadAccounts();
    const id = generateId();
    const newAccount: Account = {
      id,
      issuer: data.issuer.trim(),
      account: (data.account ?? '').trim(),
      digits: data.digits === 8 ? 8 : 6,
      period: data.period === 60 ? 60 : 30,
      color: pickColor(data.issuer.trim()),
      createdAt: Date.now()
    };
    accounts.push(newAccount);
    await this.context.globalState.update(ACCOUNTS_KEY, accounts);
    await this.context.secrets.store(`secret:${id}`, data.secret.trim().toUpperCase().replace(/\s/g, ''));
    return newAccount;
  }

  /** 更新帳號 */
  async updateAccount(id: string, data: Partial<NewAccountData>): Promise<Account> {
    const accounts = await this.loadAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) { throw new Error('帳號不存在'); }

    const updated = { ...accounts[idx] };
    if (data.issuer !== undefined) {
      updated.issuer = data.issuer.trim();
      updated.color = pickColor(updated.issuer);
    }
    if (data.account !== undefined) { updated.account = data.account.trim(); }
    if (data.digits !== undefined) { updated.digits = data.digits === 8 ? 8 : 6; }
    if (data.period !== undefined) { updated.period = data.period === 60 ? 60 : 30; }

    accounts[idx] = updated;
    await this.context.globalState.update(ACCOUNTS_KEY, accounts);

    if (data.secret !== undefined) {
      await this.context.secrets.store(`secret:${id}`, data.secret.trim().toUpperCase().replace(/\s/g, ''));
    }
    return updated;
  }

  /** 刪除帳號 */
  async deleteAccount(id: string): Promise<void> {
    const accounts = await this.loadAccounts();
    const filtered = accounts.filter(a => a.id !== id);
    if (filtered.length === accounts.length) { throw new Error('帳號不存在'); }
    await this.context.globalState.update(ACCOUNTS_KEY, filtered);
    await this.context.secrets.delete(`secret:${id}`);
  }

  /** 取得 avatar 顯示文字 */
  static getAvatarText(account: Account): string {
    return (account.issuer || '?').charAt(0).toUpperCase();
  }
}
