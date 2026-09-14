'use strict';

/**
 * WebviewViewProvider.ts
 * 管理 2FA Authenticator 在左側 Activity Bar 側邊欄中的 Webview View
 */

import * as vscode from 'vscode';
import { AccountStorage } from './AccountStorage';
import { getWebviewHtml, WebviewHost } from './WebviewHost';

export class TwoFAViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = '2fa.sidebarView';

  private _host: WebviewHost | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _storage: AccountStorage
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this._extensionUri);

    this._host = new WebviewHost(webviewView.webview, this._storage, () => webviewView.visible);
    webviewView.onDidDispose(() => {
      this._host?.dispose();
      this._host = undefined;
    });
  }
}
