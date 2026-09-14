'use strict';

/**
 * webview.js - Webview 前端邏輯
 * 透過 VS Code postMessage API 與 extension host 通訊
 * 不可使用 Node.js API，只能用瀏覽器 API
 */

// VS Code Webview API
const vscode = acquireVsCodeApi();

// ===== 狀態 =====
let allAccounts = [];
let filteredAccounts = [];
let editingId = null;
let pendingDeleteId = null;

// ===== DOM 元素 =====
const accountListEl  = document.getElementById('account-list');
const emptyStateEl   = document.getElementById('empty-state');
const searchInput    = document.getElementById('search-input');
const timerBarEl     = document.getElementById('timer-bar');
const toastEl        = document.getElementById('toast');

const modalOverlay   = document.getElementById('modal-overlay');
const modalTitle     = document.getElementById('modal-title');
const inputIssuer    = document.getElementById('input-issuer');
const inputAccount   = document.getElementById('input-account');
const inputSecret    = document.getElementById('input-secret');
const inputDigits    = document.getElementById('input-digits');
const inputPeriod    = document.getElementById('input-period');
const formError      = document.getElementById('form-error');

const deleteOverlay      = document.getElementById('delete-overlay');
const deleteConfirmText  = document.getElementById('delete-confirm-text');

const qrFileInput      = document.getElementById('qr-file-input');
const qrCameraArea     = document.getElementById('qr-camera-area');
const qrVideo          = document.getElementById('qr-video');
const qrCanvas         = document.getElementById('qr-canvas');
const qrImportStatus   = document.getElementById('qr-import-status');
const inputOtpauth     = document.getElementById('input-otpauth');

let cameraStream = null;
let cameraRAF = null;

// ===== 接收 Extension 訊息 =====
window.addEventListener('message', (event) => {
  const { command, payload } = event.data;
  switch (command) {
    case 'accounts':
      allAccounts = payload;
      applyFilter();
      break;
    case 'tick':
      handleTick(payload);
      break;
    case 'accountSaved':
      closeModal();
      showToast(payload.message);
      break;
    case 'accountDeleted':
      closeDeleteModal();
      showToast(payload.message);
      break;
    case 'error':
      formError.textContent = payload.message;
      break;
  }
});

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  vscode.postMessage({ command: 'ready' });
});

// ===== 帳號渲染 =====

function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  filteredAccounts = query === ''
    ? [...allAccounts]
    : allAccounts.filter(a =>
        a.issuer.toLowerCase().includes(query) ||
        (a.account || '').toLowerCase().includes(query)
      );
  renderList();
  updateTimerBar();
}

function renderList() {
  const cards = accountListEl.querySelectorAll('.account-card');
  cards.forEach(c => c.remove());

  if (filteredAccounts.length === 0) {
    emptyStateEl.style.display = 'flex';
    return;
  }
  emptyStateEl.style.display = 'none';

  for (const account of filteredAccounts) {
    accountListEl.appendChild(buildCard(account));
  }
}

function buildCard(account) {
  const isExpiring = account.remaining <= 5;

  const card = document.createElement('div');
  card.className = 'account-card';
  card.dataset.id = account.id;

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'account-avatar';
  avatar.style.background = account.color;
  avatar.textContent = (account.issuer || '?').charAt(0).toUpperCase();

  // Info
  const info = document.createElement('div');
  info.className = 'account-info';
  const issuerEl = document.createElement('div');
  issuerEl.className = 'account-issuer';
  issuerEl.textContent = account.issuer;
  const nameEl = document.createElement('div');
  nameEl.className = 'account-name';
  nameEl.textContent = account.account || '';
  info.appendChild(issuerEl);
  info.appendChild(nameEl);

  // OTP
  const otpContainer = document.createElement('div');
  otpContainer.className = 'account-otp';
  const codeEl = document.createElement('div');
  codeEl.className = 'otp-code' + (isExpiring ? ' expiring' : '');
  codeEl.dataset.id = account.id;
  codeEl.textContent = formatOTP(account.otp, account.digits);
  const timerEl = document.createElement('div');
  timerEl.className = 'otp-timer';
  timerEl.dataset.id = account.id;
  timerEl.textContent = account.remaining + 's';
  otpContainer.appendChild(codeEl);
  otpContainer.appendChild(timerEl);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'account-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-action';
  editBtn.title = '編輯';
  editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>`;
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(account.id); });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-action btn-delete';
  deleteBtn.title = '刪除';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </svg>`;
  deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModal(account.id); });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(avatar);
  card.appendChild(info);
  card.appendChild(otpContainer);
  card.appendChild(actions);

  // 點擊複製 OTP（傳給 extension 處理剪貼簿）
  card.addEventListener('click', () => {
    const rawOtp = account.otp;
    if (!rawOtp || rawOtp === '------') { showToast('無法產生 OTP'); return; }
    vscode.postMessage({ command: 'copyOTP', payload: { otp: rawOtp } });
    card.classList.add('copied');
    setTimeout(() => card.classList.remove('copied'), 1500);
    showToast('已複製到剪貼簿！');
  });

  return card;
}

function formatOTP(otp, digits) {
  if (!otp || otp === '------') { return '------'; }
  const half = Math.floor(digits / 2);
  return otp.slice(0, half) + ' ' + otp.slice(half);
}

// ===== Tick 更新 =====

function handleTick(ticks) {
  for (const tick of ticks) {
    // 更新計時文字
    const timerEl = accountListEl.querySelector(`.otp-timer[data-id="${tick.id}"]`);
    if (timerEl) { timerEl.textContent = tick.remaining + 's'; }

    // 更新 OTP（週期切換時）
    if (tick.otp) {
      const codeEl = accountListEl.querySelector(`.otp-code[data-id="${tick.id}"]`);
      if (codeEl) {
        const account = allAccounts.find(a => a.id === tick.id);
        if (account) {
          account.otp = tick.otp;
          account.remaining = tick.remaining;
          codeEl.textContent = formatOTP(tick.otp, account.digits);
        }
      }
    }

    // 更新剩餘時間到 allAccounts
    const acc = allAccounts.find(a => a.id === tick.id);
    if (acc) { acc.remaining = tick.remaining; }

    // 更新過期樣式
    const codeEl = accountListEl.querySelector(`.otp-code[data-id="${tick.id}"]`);
    if (codeEl) {
      if (tick.remaining <= 5) { codeEl.classList.add('expiring'); }
      else { codeEl.classList.remove('expiring'); }
    }
  }
  updateTimerBar();
}

function updateTimerBar() {
  // 以第一個帳號的 period 為基準，或預設 30
  const period = (allAccounts[0] && allAccounts[0].period) || 30;
  const remaining = (allAccounts[0] && allAccounts[0].remaining) || 30;
  const pct = (remaining / period) * 100;
  timerBarEl.style.width = pct + '%';
  if (remaining <= 5) { timerBarEl.classList.add('expiring'); }
  else { timerBarEl.classList.remove('expiring'); }
}

// ===== Modal - 新增/編輯 =====

function openAddModal() {
  editingId = null;
  modalTitle.textContent = '新增帳號';
  inputIssuer.value = '';
  inputAccount.value = '';
  inputSecret.value = '';
  inputDigits.value = '6';
  inputPeriod.value = '30';
  formError.textContent = '';
  inputSecret.type = 'password';
  updateEyeIcon(false);
  resetQrImport();
  modalOverlay.classList.add('active');
  setTimeout(() => inputIssuer.focus(), 50);
}

function openEditModal(id) {
  const account = allAccounts.find(a => a.id === id);
  if (!account) { return; }
  editingId = id;
  modalTitle.textContent = '編輯帳號';
  inputIssuer.value = account.issuer;
  inputAccount.value = account.account || '';
  inputSecret.value = '';  // 安全：編輯時不預填 secret
  inputDigits.value = String(account.digits);
  inputPeriod.value = String(account.period);
  formError.textContent = '';
  inputSecret.type = 'password';
  updateEyeIcon(false);
  resetQrImport();
  modalOverlay.classList.add('active');
  setTimeout(() => inputIssuer.focus(), 50);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  editingId = null;
  stopCamera();
  resetQrImport();
}

function saveModal() {
  const issuer = inputIssuer.value.trim();
  const account = inputAccount.value.trim();
  const secret = inputSecret.value.trim();
  const digits = parseInt(inputDigits.value, 10);
  const period = parseInt(inputPeriod.value, 10);

  if (!issuer) {
    formError.textContent = '請輸入服務名稱';
    inputIssuer.focus();
    return;
  }

  // 新增模式必填 secret；編輯模式若留空則不更新
  if (!editingId && !secret) {
    formError.textContent = '請輸入 Secret Key';
    inputSecret.focus();
    return;
  }

  formError.textContent = '';

  if (editingId) {
    const payload = { id: editingId, issuer, account, digits, period };
    if (secret) { payload.secret = secret; }
    vscode.postMessage({ command: 'updateAccount', payload });
  } else {
    vscode.postMessage({ command: 'addAccount', payload: { issuer, account, secret, digits, period } });
  }
}

// ===== Modal - 刪除 =====

function openDeleteModal(id) {
  const account = allAccounts.find(a => a.id === id);
  if (!account) { return; }
  pendingDeleteId = id;
  deleteConfirmText.textContent =
    `確定要刪除「${account.issuer}」${account.account ? `（${account.account}）` : ''}嗎？此操作無法復原。`;
  deleteOverlay.classList.add('active');
}

function closeDeleteModal() {
  deleteOverlay.classList.remove('active');
  pendingDeleteId = null;
}

function confirmDelete() {
  if (!pendingDeleteId) { return; }
  vscode.postMessage({ command: 'deleteAccount', payload: { id: pendingDeleteId } });
}

// ===== QR Code 匯入 =====

function resetQrImport() {
  inputOtpauth.value = '';
  setQrStatus('', false);
}

function setQrStatus(message, isError) {
  qrImportStatus.textContent = message;
  qrImportStatus.classList.toggle('error', !!isError);
  qrImportStatus.classList.toggle('success', !message ? false : !isError);
}

/** 解析 otpauth://totp/Issuer:account?secret=...&issuer=...&digits=...&period=... */
function parseOtpAuthUri(uri) {
  const match = /^otpauth:\/\/totp\/([^?]*)\?(.+)$/i.exec((uri || '').trim());
  if (!match) { return null; }
  const label = decodeURIComponent(match[1] || '');
  const params = new URLSearchParams(match[2]);
  const secret = (params.get('secret') || '').replace(/\s/g, '').toUpperCase();
  if (!secret) { return null; }

  let issuer = params.get('issuer') || '';
  let account = label;
  const colonIdx = label.indexOf(':');
  if (colonIdx !== -1) {
    if (!issuer) { issuer = label.slice(0, colonIdx).trim(); }
    account = label.slice(colonIdx + 1).trim();
  }

  const digits = parseInt(params.get('digits') || '6', 10);
  const period = parseInt(params.get('period') || '30', 10);

  return {
    issuer: issuer || account || 'Unknown',
    account,
    secret,
    digits: digits === 8 ? 8 : 6,
    period: period === 60 ? 60 : 30
  };
}

function applyParsedOtpAuth(parsed) {
  inputIssuer.value = parsed.issuer;
  inputAccount.value = parsed.account;
  inputSecret.value = parsed.secret;
  inputDigits.value = String(parsed.digits);
  inputPeriod.value = String(parsed.period);
  formError.textContent = '';
}

function handleDecodedText(text) {
  if (!text) {
    setQrStatus('掃描不到內容', true);
    return;
  }
  if (/^otpauth-migration:\/\//i.test(text)) {
    handleMigrationUri(text);
    return;
  }
  if (!/^otpauth:\/\//i.test(text)) {
    setQrStatus('掃描結果不是有效的 otpauth 連結', true);
    return;
  }
  const parsed = parseOtpAuthUri(text);
  if (!parsed) {
    setQrStatus('無法解析 otpauth 連結', true);
    return;
  }
  applyParsedOtpAuth(parsed);
  setQrStatus(`已匯入「${parsed.issuer}」，請確認後儲存`, false);
  stopCamera();
}

/** 解析 Google Authenticator「轉移帳號」QR（otpauth-migration://offline?data=<base64 protobuf>） */
function handleMigrationUri(uri) {
  try {
    const qIndex = uri.indexOf('?');
    const params = new URLSearchParams(qIndex !== -1 ? uri.slice(qIndex + 1) : '');
    const data = params.get('data');
    if (!data) { throw new Error('找不到 data 參數'); }

    const bytes = base64ToBytes(data);
    const entries = parseMigrationPayload(bytes).map(migrationEntryToAccount).filter(Boolean);
    const totpEntries = entries.filter(e => !e.isHotp);
    const hotpSkipped = entries.length - totpEntries.length;
    const skipHint = hotpSkipped ? `（另有 ${hotpSkipped} 筆 HOTP 帳號不支援，已略過）` : '';

    if (totpEntries.length === 0) {
      setQrStatus('QR Code 中沒有可匯入的 TOTP 帳號' + skipHint, true);
      return;
    }

    if (totpEntries.length === 1) {
      applyParsedOtpAuth(totpEntries[0]);
      setQrStatus(`已匯入「${totpEntries[0].issuer}」，請確認後儲存${skipHint}`, false);
    } else {
      vscode.postMessage({ command: 'importAccounts', payload: totpEntries });
      setQrStatus(`偵測到 ${totpEntries.length} 個帳號，匯入中…${skipHint}`, false);
    }
    stopCamera();
  } catch (err) {
    setQrStatus('無法解析 Google Authenticator 匯出 QR Code：' + (err instanceof Error ? err.message : String(err)), true);
  }
}

function base64ToBytes(base64) {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** 讀取 protobuf varint，回傳 { value, next } */
function readVarint(bytes, i) {
  let result = 0;
  let multiplier = 1;
  let b;
  do {
    b = bytes[i++];
    result += (b & 0x7f) * multiplier;
    multiplier *= 128;
  } while (b & 0x80);
  return { value: result, next: i };
}

/** 讀取一個 protobuf field，回傳 { fieldNumber, value, next } */
function readProtoField(bytes, i) {
  const tag = readVarint(bytes, i);
  const fieldNumber = tag.value >>> 3;
  const wireType = tag.value & 0x7;
  let value;
  let next = tag.next;
  if (wireType === 0) {
    const v = readVarint(bytes, next);
    value = v.value;
    next = v.next;
  } else if (wireType === 2) {
    const len = readVarint(bytes, next);
    value = bytes.slice(len.next, len.next + len.value);
    next = len.next + len.value;
  } else if (wireType === 1) {
    value = bytes.slice(next, next + 8);
    next += 8;
  } else if (wireType === 5) {
    value = bytes.slice(next, next + 4);
    next += 4;
  } else {
    throw new Error('不支援的 protobuf wire type: ' + wireType);
  }
  return { fieldNumber, value, next };
}

function parseMigrationPayload(bytes) {
  const otpList = [];
  let i = 0;
  while (i < bytes.length) {
    const field = readProtoField(bytes, i);
    if (field.fieldNumber === 1) { otpList.push(parseOtpParameters(field.value)); }
    i = field.next;
  }
  return otpList;
}

function parseOtpParameters(bytes) {
  const entry = { secretBytes: null, name: '', issuer: '', algorithm: 1, digits: 1, type: 2 };
  let i = 0;
  while (i < bytes.length) {
    const field = readProtoField(bytes, i);
    switch (field.fieldNumber) {
      case 1: entry.secretBytes = field.value; break;
      case 2: entry.name = new TextDecoder('utf-8').decode(field.value); break;
      case 3: entry.issuer = new TextDecoder('utf-8').decode(field.value); break;
      case 4: entry.algorithm = field.value; break;
      case 5: entry.digits = field.value; break;
      case 6: entry.type = field.value; break;
      default: break;
    }
    i = field.next;
  }
  return entry;
}

function migrationEntryToAccount(entry) {
  if (!entry.secretBytes || entry.secretBytes.length === 0) { return null; }
  const secret = base32Encode(entry.secretBytes);
  let issuer = entry.issuer || '';
  let account = entry.name || '';
  const colonIdx = account.indexOf(':');
  if (!issuer && colonIdx !== -1) {
    issuer = account.slice(0, colonIdx).trim();
    account = account.slice(colonIdx + 1).trim();
  }
  const digitsMap = { 1: 6, 2: 8 };
  return {
    issuer: issuer || account || 'Unknown',
    account,
    secret,
    digits: digitsMap[entry.digits] || 6,
    period: 30,
    isHotp: entry.type === 1
  };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

function decodeQRFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) { resolve(code.data); }
      else { reject(new Error('圖片中找不到 QR Code')); }
    };
    img.onerror = () => reject(new Error('圖片載入失敗'));
    img.src = dataUrl;
  });
}

async function handleQrFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) { return; }
  setQrStatus('讀取圖片中…', false);
  try {
    const dataUrl = await readFileAsDataURL(file);
    const text = await decodeQRFromDataUrl(dataUrl);
    handleDecodedText(text);
  } catch (err) {
    setQrStatus(err instanceof Error ? err.message : '無法解析 QR Code', true);
  }
}

async function startCamera() {
  qrCameraArea.classList.add('active');
  setQrStatus('請求相機權限中…', false);
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    setQrStatus('無法存取相機：' + (err instanceof Error ? err.message : String(err)), true);
    qrCameraArea.classList.remove('active');
    return;
  }
  qrVideo.srcObject = cameraStream;
  await qrVideo.play();
  setQrStatus('掃描中，請將 QR Code 對準鏡頭', false);
  scanLoop();
}

function scanLoop() {
  if (!cameraStream) { return; }
  if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
    qrCanvas.width = qrVideo.videoWidth;
    qrCanvas.height = qrVideo.videoHeight;
    const ctx = qrCanvas.getContext('2d');
    ctx.drawImage(qrVideo, 0, 0, qrCanvas.width, qrCanvas.height);
    const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code && code.data) {
      handleDecodedText(code.data);
      return;
    }
  }
  cameraRAF = requestAnimationFrame(scanLoop);
}

function stopCamera() {
  if (cameraRAF) { cancelAnimationFrame(cameraRAF); cameraRAF = null; }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  qrVideo.srcObject = null;
  qrCameraArea.classList.remove('active');
}

// ===== Eye Icon =====

function updateEyeIcon(isVisible) {
  const eyeIcon = document.getElementById('eye-icon');
  if (!eyeIcon) { return; }
  if (isVisible) {
    eyeIcon.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>`;
  } else {
    eyeIcon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>`;
  }
}

// ===== Toast =====

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) { clearTimeout(toastTimer); }
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// ===== 事件綁定 =====

function bindEvents() {
  document.getElementById('btn-add').addEventListener('click', openAddModal);
  searchInput.addEventListener('input', applyFilter);

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) { closeModal(); } });
  document.getElementById('btn-save').addEventListener('click', saveModal);

  [inputIssuer, inputAccount, inputSecret].forEach(el => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { saveModal(); } });
  });

  document.getElementById('btn-toggle-secret').addEventListener('click', () => {
    const isPassword = inputSecret.type === 'password';
    inputSecret.type = isPassword ? 'text' : 'password';
    updateEyeIcon(isPassword);
  });

  document.getElementById('btn-qr-upload').addEventListener('click', () => qrFileInput.click());
  qrFileInput.addEventListener('change', handleQrFileSelected);
  document.getElementById('btn-qr-camera').addEventListener('click', startCamera);
  document.getElementById('btn-qr-camera-stop').addEventListener('click', stopCamera);
  document.getElementById('btn-parse-otpauth').addEventListener('click', () => handleDecodedText(inputOtpauth.value.trim()));
  inputOtpauth.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleDecodedText(inputOtpauth.value.trim()); }
  });

  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('btn-delete-confirm').addEventListener('click', confirmDelete);
  deleteOverlay.addEventListener('click', (e) => { if (e.target === deleteOverlay) { closeDeleteModal(); } });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalOverlay.classList.contains('active')) { closeModal(); }
      if (deleteOverlay.classList.contains('active')) { closeDeleteModal(); }
    }
  });
}
