'use strict';

/**
 * 帳號儲存管理
 * 使用 chrome.storage.local（資料不同步到雲端，僅存本機）
 *
 * 資料結構：
 * {
 *   accounts: [
 *     {
 *       id: string,        // UUID v4
 *       issuer: string,    // 服務名稱（必填）
 *       account: string,   // 帳號/Email（選填）
 *       secret: string,    // Base32 secret（必填，明文存本機）
 *       digits: number,    // 6 或 8
 *       period: number,    // 30 或 60
 *       color: string,     // avatar 背景色
 *       createdAt: number  // timestamp ms
 *     },
 *     ...
 *   ]
 * }
 */

const STORAGE_KEY = 'accounts';

/** 預設 avatar 顏色池 */
const AVATAR_COLORS = [
  '#4285F4', '#EA4335', '#34A853', '#FBBC04',
  '#FF6D00', '#9C27B0', '#00BCD4', '#795548',
  '#607D8B', '#E91E63', '#009688', '#3F51B5'
];

/**
 * 產生簡易 UUID v4
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 根據 issuer 首字母決定 avatar 顏色（確定性，相同 issuer 同色）
 * @param {string} issuer
 * @returns {string}
 */
function pickColor(issuer) {
  if (!issuer) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < issuer.length; i++) {
    hash = (hash * 31 + issuer.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * 讀取所有帳號
 * @returns {Promise<Array>}
 */
async function loadAccounts() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
  });
}

/**
 * 儲存帳號陣列（覆寫）
 * @param {Array} accounts
 * @returns {Promise<void>}
 */
async function saveAccounts(accounts) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: accounts }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 新增帳號
 * @param {{ issuer: string, account?: string, secret: string, digits?: number, period?: number }} data
 * @returns {Promise<object>} 新增的帳號物件
 */
async function addAccount(data) {
  const accounts = await loadAccounts();
  const newAccount = {
    id: generateId(),
    issuer: data.issuer.trim(),
    account: (data.account || '').trim(),
    secret: data.secret.trim().toUpperCase().replace(/\s/g, ''),
    digits: Number(data.digits) === 8 ? 8 : 6,
    period: Number(data.period) === 60 ? 60 : 30,
    color: pickColor(data.issuer.trim()),
    createdAt: Date.now()
  };
  accounts.push(newAccount);
  await saveAccounts(accounts);
  return newAccount;
}

/**
 * 更新帳號
 * @param {string} id
 * @param {{ issuer?: string, account?: string, secret?: string, digits?: number, period?: number }} data
 * @returns {Promise<object>} 更新後的帳號物件
 */
async function updateAccount(id, data) {
  const accounts = await loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('帳號不存在');

  const updated = { ...accounts[idx] };
  if (data.issuer !== undefined) {
    updated.issuer = data.issuer.trim();
    updated.color = pickColor(updated.issuer);
  }
  if (data.account !== undefined) updated.account = data.account.trim();
  if (data.secret !== undefined) {
    updated.secret = data.secret.trim().toUpperCase().replace(/\s/g, '');
  }
  if (data.digits !== undefined) updated.digits = Number(data.digits) === 8 ? 8 : 6;
  if (data.period !== undefined) updated.period = Number(data.period) === 60 ? 60 : 30;

  accounts[idx] = updated;
  await saveAccounts(accounts);
  return updated;
}

/**
 * 刪除帳號
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteAccount(id) {
  const accounts = await loadAccounts();
  const filtered = accounts.filter((a) => a.id !== id);
  if (filtered.length === accounts.length) throw new Error('帳號不存在');
  await saveAccounts(filtered);
}

/**
 * 取得帳號 avatar 顯示文字（issuer 首字）
 * @param {object} account
 * @returns {string}
 */
function getAvatarText(account) {
  return (account.issuer || '?').charAt(0).toUpperCase();
}
