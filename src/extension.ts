'use strict';

import * as vscode from 'vscode';
import { AccountStorage } from './AccountStorage';
import { TwoFAPanel } from './WebviewPanel';
import { TwoFAViewProvider } from './WebviewViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const storage = new AccountStorage(context);

  const openPanel = vscode.commands.registerCommand('2fa.openPanel', () => {
    TwoFAPanel.createOrShow(context.extensionUri, storage);
  });

  const viewProvider = new TwoFAViewProvider(context.extensionUri, storage);
  const viewRegistration = vscode.window.registerWebviewViewProvider(
    TwoFAViewProvider.viewType,
    viewProvider
  );

  context.subscriptions.push(openPanel, viewRegistration);
}

export function deactivate(): void {
  // 清理由 VS Code 自動處理
}
