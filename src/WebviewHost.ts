'use strict';

/**
 * WebviewHost.ts
 * TwoFAPanel（編輯器分頁）與 TwoFAViewProvider（側邊欄）共用的
 * HTML 產生邏輯與 Webview <-> Extension 訊息處理邏輯
 */

import * as vscode from 'vscode';
import { AccountStorage } from './AccountStorage';
import { generateTOTP, getRemainingSeconds, validateSecret } from './TotpProvider';

/** Webview → Extension 的訊息型別 */
interface WebviewMessage {
  command: string;
  payload?: unknown;
}

/** Extension → Webview 的訊息型別 */
interface ExtensionMessage {
  command: string;
  payload?: unknown;
}

/** 處理單一 Webview 的訊息收發與定時 OTP 更新 */
export class WebviewHost {
  private _disposables: vscode.Disposable[] = [];
  private _refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly _webview: vscode.Webview,
    private readonly _storage: AccountStorage,
    private readonly _isVisible: () => boolean
  ) {
    this._disposables.push(
      this._webview.onDidReceiveMessage((message: WebviewMessage) => this._handleMessage(message))
    );
    this._sendAccounts();
    this._refreshTimer = setInterval(() => this._tickOTP(), 1000);
  }

  dispose(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
    }
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  /** 處理來自 Webview 的訊息 */
  private async _handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.command) {
      case 'ready':
        await this._sendAccounts();
        break;

      case 'addAccount': {
        const data = message.payload as { issuer: string; account?: string; secret: string; digits?: number; period?: number };
        const validation = validateSecret(data.secret);
        if (!validation.valid) {
          this._post({ command: 'error', payload: { message: validation.error } });
          return;
        }
        try {
          await this._storage.addAccount(data);
          await this._sendAccounts();
          this._post({ command: 'accountSaved', payload: { message: '帳號已新增' } });
        } catch (e: unknown) {
          this._post({ command: 'error', payload: { message: e instanceof Error ? e.message : '新增失敗' } });
        }
        break;
      }

      case 'updateAccount': {
        const data = message.payload as { id: string; issuer?: string; account?: string; secret?: string; digits?: number; period?: number };
        if (data.secret) {
          const validation = validateSecret(data.secret);
          if (!validation.valid) {
            this._post({ command: 'error', payload: { message: validation.error } });
            return;
          }
        }
        try {
          await this._storage.updateAccount(data.id, data);
          await this._sendAccounts();
          this._post({ command: 'accountSaved', payload: { message: '帳號已更新' } });
        } catch (e: unknown) {
          this._post({ command: 'error', payload: { message: e instanceof Error ? e.message : '更新失敗' } });
        }
        break;
      }

      case 'deleteAccount': {
        const { id } = message.payload as { id: string };
        try {
          await this._storage.deleteAccount(id);
          await this._sendAccounts();
          this._post({ command: 'accountDeleted', payload: { message: '帳號已刪除' } });
        } catch (e: unknown) {
          this._post({ command: 'error', payload: { message: e instanceof Error ? e.message : '刪除失敗' } });
        }
        break;
      }

      case 'importAccounts': {
        const items = message.payload as Array<{ issuer: string; account?: string; secret: string; digits?: number; period?: number }>;
        let success = 0;
        const errors: string[] = [];
        for (const item of items) {
          const validation = validateSecret(item.secret);
          if (!validation.valid) {
            errors.push(`${item.issuer}：${validation.error}`);
            continue;
          }
          try {
            await this._storage.addAccount(item);
            success++;
          } catch (e: unknown) {
            errors.push(`${item.issuer}：${e instanceof Error ? e.message : '新增失敗'}`);
          }
        }
        await this._sendAccounts();
        if (success > 0) {
          this._post({
            command: 'accountSaved',
            payload: { message: `已匯入 ${success} 個帳號` + (errors.length ? `，${errors.length} 個失敗` : '') }
          });
        } else {
          this._post({ command: 'error', payload: { message: errors[0] || '匯入失敗' } });
        }
        break;
      }

      case 'copyOTP': {
        const { otp } = message.payload as { otp: string };
        await vscode.env.clipboard.writeText(otp);
        vscode.window.setStatusBarMessage('$(check) OTP 已複製到剪貼簿', 2000);
        break;
      }

      case 'copySecretForAccount': {
        const { id } = message.payload as { id: string };
        const account = await this._storage.loadAccountWithSecret(id);
        if (!account) {
          this._post({ command: 'error', payload: { message: '找不到帳號' } });
          return;
        }
        await vscode.env.clipboard.writeText(account.secret);
        vscode.window.setStatusBarMessage('$(key) Secret Key 已複製到剪貼簿', 2000);
        break;
      }
    }
  }

  /** 傳送帳號清單（含即時 OTP）到 Webview */
  private async _sendAccounts(): Promise<void> {
    const accounts = await this._storage.loadAllWithSecrets();
    const accountsWithOTP = accounts.map(a => {
      let otp = '------';
      try {
        otp = generateTOTP(a.secret, { digits: a.digits, period: a.period });
      } catch {
        // secret 無效時顯示佔位符
      }
      return {
        id: a.id,
        issuer: a.issuer,
        account: a.account,
        digits: a.digits,
        period: a.period,
        color: a.color,
        otp,
        remaining: getRemainingSeconds(a.period)
      };
    });
    this._post({ command: 'accounts', payload: accountsWithOTP });
  }

  /** 每秒 tick：更新剩餘時間，週期切換時重新產生 OTP */
  private async _tickOTP(): Promise<void> {
    if (!this._isVisible()) { return; }
    const accounts = await this._storage.loadAllWithSecrets();
    const ticks = accounts.map(a => {
      const remaining = getRemainingSeconds(a.period);
      let otp: string | undefined;
      // 剛換週期時重新產生
      if (remaining === a.period) {
        try { otp = generateTOTP(a.secret, { digits: a.digits, period: a.period }); } catch { /* ignore */ }
      }
      return { id: a.id, remaining, otp };
    });
    this._post({ command: 'tick', payload: ticks });
  }

  /** 傳送訊息到 Webview */
  private _post(message: ExtensionMessage): void {
    this._webview.postMessage(message);
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** 產生 Webview HTML（Panel 與 Sidebar View 共用） */
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const mediaUri = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));

  const cssUri = mediaUri('webview.css');
  const jsUri = mediaUri('webview.js');
  const jsQrUri = mediaUri('jsQR.min.js');

  // Content Security Policy：只允許本地資源與 nonce（img/media 需 data:/blob: 供 QR 解碼與相機預覽使用）
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             img-src ${webview.cspSource} data: blob:;
             media-src ${webview.cspSource} blob:;
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>2FA 驗證器</title>
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <svg class="logo" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="var(--vscode-button-background)"/>
          <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 class="title">2FA 驗證器</h1>
      </div>
      <button id="btn-add" class="btn-icon" title="新增帳號">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </header>

    <div class="search-bar">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input type="text" id="search-input" placeholder="搜尋帳號..." autocomplete="off">
    </div>

    <main class="account-list" id="account-list">
      <div class="empty-state" id="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="5" y="2" width="14" height="20" rx="2"></rect>
          <line x1="12" y1="18" x2="12" y2="18"></line>
        </svg>
        <p>尚無帳號</p>
        <span>點擊右上角 + 新增</span>
      </div>
    </main>

    <div class="timer-bar-container">
      <div class="timer-bar" id="timer-bar"></div>
    </div>
  </div>

  <!-- Add/Edit Modal -->
  <div class="modal-overlay" id="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-title">新增帳號</h2>
        <button class="btn-icon" id="modal-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="qr-import" id="qr-import">
          <div class="qr-import-actions">
            <button type="button" class="btn btn-secondary" id="btn-qr-upload">上傳 QR 圖片</button>
            <button type="button" class="btn btn-secondary" id="btn-qr-camera">開啟相機掃描</button>
          </div>
          <input type="file" id="qr-file-input" accept="image/*" hidden>
          <div class="qr-camera-area" id="qr-camera-area">
            <video id="qr-video" playsinline muted></video>
            <canvas id="qr-canvas" hidden></canvas>
            <button type="button" class="btn btn-secondary" id="btn-qr-camera-stop">停止掃描</button>
          </div>
          <div class="form-group">
            <label for="input-otpauth">或貼上 otpauth:// 連結</label>
            <div class="input-with-toggle">
              <input type="text" id="input-otpauth" placeholder="otpauth://totp/..." autocomplete="off">
              <button type="button" class="btn-toggle-secret" id="btn-parse-otpauth" title="解析連結">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
            </div>
          </div>
          <div class="qr-import-status" id="qr-import-status"></div>
        </div>
        <div class="form-group">
          <label for="input-issuer">服務名稱 <span class="required">*</span></label>
          <input type="text" id="input-issuer" placeholder="例：Google、GitHub" maxlength="64" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="input-account">帳號 / Email</label>
          <input type="text" id="input-account" placeholder="例：user@example.com" maxlength="128" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="input-secret">Secret Key <span class="required">*</span></label>
          <div class="input-with-toggle">
            <input type="password" id="input-secret" placeholder="Base32 格式的金鑰" maxlength="256" autocomplete="off">
            <button class="btn-toggle-secret" id="btn-toggle-secret" type="button">
              <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
          <div class="secret-hint-row">
            <span class="hint">掃描 QR Code 後取得的金鑰</span>
            <button type="button" class="btn-link" id="btn-copy-secret">複製 Secret Key</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="input-digits">OTP 位數</label>
            <select id="input-digits">
              <option value="6" selected>6 位數</option>
              <option value="8">8 位數</option>
            </select>
          </div>
          <div class="form-group">
            <label for="input-period">更新週期</label>
            <select id="input-period">
              <option value="30" selected>30 秒</option>
              <option value="60">60 秒</option>
            </select>
          </div>
        </div>
        <div class="form-error" id="form-error"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="btn-cancel">取消</button>
        <button class="btn btn-primary" id="btn-save">儲存</button>
      </div>
    </div>
  </div>

  <!-- Delete Confirm Modal -->
  <div class="modal-overlay" id="delete-overlay">
    <div class="modal modal-sm">
      <div class="modal-header">
        <h2>刪除帳號</h2>
      </div>
      <div class="modal-body">
        <p id="delete-confirm-text"></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="btn-delete-cancel">取消</button>
        <button class="btn btn-danger" id="btn-delete-confirm">刪除</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script nonce="${nonce}" src="${jsQrUri}"></script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
