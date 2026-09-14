# 2FA Authenticator

在 VS Code 或瀏覽器中管理你的 TOTP 兩步驟驗證帳號，相容 Google Authenticator 格式。本專案包含兩個獨立元件：

| 元件 | 目錄/檔案 | 說明 |
|------|-----------|------|
| **VS Code 擴充功能**（主要） | `src/`、`media/` | 在 VS Code 側邊欄或獨立分頁管理 2FA 帳號，Secret 使用 OS 金鑰鏈加密儲存 |
| **瀏覽器擴充功能**（Chrome/Edge，Manifest V3） | `manifest.json`、`popup.*`、`background.js`、`crypto.js`、`storage.js` | 獨立的瀏覽器版本，資料存於 `chrome.storage.local` |

---

## VS Code 擴充功能

### 功能

- ✅ TOTP (RFC 6238) 標準實作，相容 Google Authenticator
- ✅ 新增 / 編輯 / 刪除帳號，支援搜尋
- ✅ 即時倒數計時，自動更新 OTP；點擊帳號卡片即複製 OTP 到剪貼簿
- ✅ **QR Code 匯入**：
  - 上傳 QR 圖片解碼（前端使用 [jsQR](https://github.com/cozmo/jsQR)）
  - 開啟相機即時掃描
  - 貼上 `otpauth://` 連結直接解析
  - 支援 Google Authenticator「轉移帳號」批次匯出格式（`otpauth-migration://`，一次匯入多筆帳號）
- ✅ 左側 **Activity Bar** 快捷圖示，也可開成獨立編輯器分頁
- ✅ Secret 使用 VS Code `SecretStorage` API 加密儲存（不存明文）
- ✅ 支援 6 位數 / 8 位數 OTP、30 秒 / 60 秒更新週期
- ✅ 自動套用 VS Code 主題色彩

### 專案結構

```
2FA/
├── src/
│   ├── extension.ts            # 擴充功能進入點
│   ├── TotpProvider.ts         # TOTP/HOTP 演算法（RFC 6238/4226）
│   ├── AccountStorage.ts       # 帳號儲存（SecretStorage + globalState）
│   ├── WebviewHost.ts          # Webview HTML 產生 + 訊息處理（Panel 與 Sidebar 共用）
│   ├── WebviewPanel.ts         # 獨立編輯器分頁
│   └── WebviewViewProvider.ts  # 左側 Activity Bar 側邊欄
├── media/
│   ├── webview.css             # Webview 樣式（VS Code 主題變數）
│   ├── webview.js              # Webview 前端邏輯（含 QR / migration 解析）
│   └── jsQR.min.js             # vendored QR Code 解碼函式庫（MIT）
├── icons/
│   ├── icon.svg                # 擴充功能圖示（來源，建置時轉出 16/48/128 png）
│   └── activitybar-icon.svg    # Activity Bar 單色圖示
├── package.json
├── tsconfig.json
├── .vscodeignore
├── build.bat                   # 一鍵 Docker 建置 + 安裝腳本
└── Dockerfile                  # 多階段建置（icons → builder → packager → output）
```

### 使用 Docker 建置 .vsix

> 需要安裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

最簡單的方式是直接執行打包好的腳本：

```powershell
.\build.bat
```

它會依序：建置 Docker image → 從暫存容器複製出 `.vsix` → 詢問是否要立即安裝到本機 VS Code。

也可以手動操作：

```bash
# 建置到 packager 階段並複製產物
docker build --target packager -t 2fa-packager .
$id = docker create 2fa-packager
docker cp "${id}:/output/vscode-2fa-authenticator.vsix" ./dist/
docker rm $id
```

### 安裝 .vsix 到 VS Code

```bash
code --install-extension dist\vscode-2fa-authenticator.vsix
```

或在擴充功能面板（`Ctrl+Shift+X`）右上角「...」→「從 VSIX 安裝...」。

### 使用方式

1. 點左側 Activity Bar 的盾牌圖示開啟側邊欄，或按 `Ctrl+Shift+Alt+T`（Mac: `Cmd+Shift+Alt+T`）/ 命令面板搜尋「開啟 2FA 驗證器」開成獨立分頁
2. 點右上角 **+** 新增帳號，可手動輸入，或用 QR 圖片上傳 / 相機掃描 / 貼上連結三種方式快速匯入
3. 點擊帳號卡片即可複製目前的 OTP

### 本機開發（不使用 Docker）

需要安裝 [Node.js 20+](https://nodejs.org/)：

```bash
npm install
npm run compile

# 在 VS Code 中按 F5 啟動擴充功能開發主機
```

### 安全說明

| 項目 | 說明 |
|------|------|
| Secret 儲存 | 使用 VS Code `SecretStorage` API（OS 金鑰鏈加密） |
| 帳號資訊 | 儲存於 `globalState`（不含 secret） |
| 剪貼簿 | OTP 複製後由 VS Code API 處理，不經 Webview |
| CSP | Webview 啟用 Content Security Policy，限制 script/img/media 來源 |
| 網路 | 完全離線，不傳送任何資料到外部 |

---

## 瀏覽器擴充功能（Chrome / Edge）

以 Manifest V3 實作的獨立版本，功能與 UI 概念與 VS Code 版相同（新增/編輯/刪除、搜尋、即時 OTP），但：

- 使用 `chrome.storage.local` 儲存，**secret 為明文儲存於本機**（無 OS 金鑰鏈加密），安全性低於 VS Code 版本
- 純瀏覽器 Web Crypto API 實作 TOTP，不依賴任何外部函式庫

### 載入方式（開發者模式）

1. 開啟 `chrome://extensions`（或 Edge 的 `edge://extensions`）
2. 開啟右上角「開發人員模式」
3. 「載入未封裝項目」，選擇本專案根目錄

### 相關檔案

| 檔案 | 說明 |
|------|------|
| `manifest.json` | Manifest V3 設定 |
| `popup.html` / `popup.css` / `popup.js` | 彈出視窗 UI 與邏輯 |
| `background.js` | Service Worker（安裝初始化、訊息處理） |
| `crypto.js` | TOTP/Base32 實作（Web Crypto API） |
| `storage.js` | `chrome.storage.local` 帳號存取封裝 |

---

## 授權

MIT License

