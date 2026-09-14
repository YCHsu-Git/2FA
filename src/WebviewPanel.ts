'use strict';

/**
 * WebviewPanel.ts
 * 管理 2FA Authenticator 以獨立編輯器分頁開啟時的生命週期
 */

import * as vscode from 'vscode';
import { AccountStorage } from './AccountStorage';
import { getWebviewHtml, WebviewHost } from './WebviewHost';

export class TwoFAPanel {
  public static currentPanel: TwoFAPanel | undefined;
  private static readonly viewType = '2fa.panel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _host: WebviewHost;
  private _disposables: vscode.Disposable[] = [];

  /** 開啟或顯示 Panel */
  public static createOrShow(extensionUri: vscode.Uri, storage: AccountStorage): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TwoFAPanel.currentPanel) {
      TwoFAPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TwoFAPanel.viewType,
      '2FA 驗證器',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true
      }
    );

    TwoFAPanel.currentPanel = new TwoFAPanel(panel, extensionUri, storage);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    storage: AccountStorage
  ) {
    this._panel = panel;
    this._panel.webview.html = getWebviewHtml(this._panel.webview, extensionUri);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._host = new WebviewHost(this._panel.webview, storage, () => this._panel.visible);
  }

  public dispose(): void {
    TwoFAPanel.currentPanel = undefined;
    this._host.dispose();
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}
