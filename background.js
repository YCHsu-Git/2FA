'use strict';

/**
 * background.js - Service Worker (Manifest V3)
 *
 * 職責：
 * 1. 擴充功能安裝/更新時的初始化
 * 2. 保持 Service Worker 存活（Manifest V3 限制）
 * 3. 未來可擴充：定時通知、跨分頁訊息傳遞
 */

// ===== 安裝 / 更新事件 =====

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[2FA] 擴充功能已安裝');
    // 初始化空帳號清單（若尚未存在）
    chrome.storage.local.get('accounts', (result) => {
      if (!Array.isArray(result.accounts)) {
        chrome.storage.local.set({ accounts: [] });
      }
    });
  } else if (details.reason === 'update') {
    console.log(`[2FA] 擴充功能已更新至 ${chrome.runtime.getManifest().version}`);
  }
});

// ===== 訊息處理（供未來擴充使用）=====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ type: 'pong' });
    return true;
  }
});
