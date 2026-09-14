'use strict';

/**
 * popup.js - 主要 UI 邏輯
 * 依賴：crypto.js, storage.js
 */

// ===== 狀態 =====
let allAccounts = [];       // 完整帳號清單
let filteredAccounts = [];  // 搜尋過濾後的清單
let timerInterval = null;   // 全域計時器
let editingId = null;       // 目前編輯中的帳號 ID（null = 新增模式）
let pendingDeleteId = null; // 待刪除的帳號 ID

// ===== DOM 元素 =====
const accountListEl   = document.getElementById('account-list');
const emptyStateEl    = document.getElementById('empty-state');
const searchInput     = document.getElementById('search-input');
const timerBarEl      = document.getElementById('timer-bar');
const toastEl         = document.getElementById('toast');

// Modal - Add/Edit
const modalOverlay    = document.getElementById('modal-overlay');
const modalTitle      = document.getElementById('modal-title');
const inputIssuer     = document.getElementById('input-issuer');
const inputAccount    = document.getElementById('input-account');
const inputSecret     = document.getElementById('input-secret');
const inputDigits     = document.getElementById('input-digits');
const inputPeriod     = document.getElementById('input-period');
const formError       = document.getElementById('form-error');
const btnToggleSecret = document.getElementById('btn-toggle-secret');

// Modal - Delete
const deleteOverlay      = document.getElementById('delete-overlay');
const deleteConfirmText  = document.getElementById('delete-confirm-text');

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
  await refreshAccounts();
  startTimer();
  bindEvents();
});

// ===== 帳號載入與渲染 =====

async function refreshAccounts() {
  allAccounts = await loadAccounts();
  applyFilter();
}

function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  if (query === '') {
    filteredAccounts = [...allAccounts];
  } else {
    filteredAccounts = allAccounts.filter((a) =>
      a.issuer.toLowerCase().includes(query) ||
      a.account.toLowerCase().includes(query)
    );
  }
  renderList();
}

async function renderList() {
  // 移除舊的帳號卡片（保留 empty-state）
  const cards = accountListEl.querySelectorAll('.account-card');
  cards.forEach((c) => c.remove());

  if (filteredAccounts.length === 0) {
    emptyStateEl.style.display = 'flex';
    return;
  }
  emptyStateEl.style.display = 'none';

  for (const account of filteredAccounts) {
    const card = await buildCard(account);
    accountListEl.appendChild(card);
  }
}

async function buildCard(account) {
  const otp = await safeGenerateOTP(account);
  const remaining = getRemainingSeconds(account.period);
  const isExpiring = remaining <= 5;

  const card = document.createElement('div');
  card.className = 'account-card';
  card.dataset.id = account.id;

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'account-avatar';
  avatar.style.background = account.color;
  avatar.textContent = getAvatarText(account);

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
  codeEl.textContent = formatOTP(otp, account.digits);

  const timerEl = document.createElement('div');
  timerEl.className = 'otp-timer';
  timerEl.dataset.id = account.id;
  timerEl.textContent = `${remaining}s`;

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
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(account.id);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-action btn-delete';
  deleteBtn.title = '刪除';
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
  </svg>`;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteModal(account.id);
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(avatar);
  card.appendChild(info);
  card.appendChild(otpContainer);
  card.appendChild(actions);

  // 點擊卡片複製 OTP
  card.addEventListener('click', () => copyOTP(account.id, otp));

  return card;
}

// ===== OTP 格式化 =====

function formatOTP(otp, digits) {
  if (!otp) return '------';
  // 6位：XXX XXX，8位：XXXX XXXX
  const half = Math.floor(digits / 2);
  return otp.slice(0, half) + ' ' + otp.slice(half);
}

async function safeGenerateOTP(account) {
  try {
    return await generateTOTP(account.secret, {
      digits: account.digits,
      period: account.period
    });
  } catch {
    return null;
  }
}

// ===== 計時器 =====

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimerBar();
  timerInterval = setInterval(onTick, 1000);
}

async function onTick() {
  updateTimerBar();
  await updateOTPCodes();
}

function updateTimerBar() {
  // 使用 period=30 作為全域進度條基準
  const remaining = getRemainingSeconds(30);
  const pct = (remaining / 30) * 100;
  timerBarEl.style.width = pct + '%';
  if (remaining <= 5) {
    timerBarEl.classList.add('expiring');
  } else {
    timerBarEl.classList.remove('expiring');
  }
}

async function updateOTPCodes() {
  for (const account of filteredAccounts) {
    const remaining = getRemainingSeconds(account.period);
    const isExpiring = remaining <= 5;

    // 更新計時文字
    const timerEl = accountListEl.querySelector(`.otp-timer[data-id="${account.id}"]`);
    if (timerEl) timerEl.textContent = `${remaining}s`;

    // 每個週期開始時重新產生 OTP（remaining === period 表示剛換）
    if (remaining === account.period) {
      const otp = await safeGenerateOTP(account);
      const codeEl = accountListEl.querySelector(`.otp-code[data-id="${account.id}"]`);
      if (codeEl) {
        codeEl.textContent = formatOTP(otp, account.digits);
        // 更新卡片上的 click handler 用的 otp 值
        const card = accountListEl.querySelector(`.account-card[data-id="${account.id}"]`);
        if (card) {
          // 重新綁定 click（移除舊的，加新的）
          const newCard = card.cloneNode(true);
          // 重新綁定所有事件
          rebindCardEvents(newCard, account, otp);
          card.replaceWith(newCard);
        }
      }
    }

    // 更新過期樣式
    const codeEl = accountListEl.querySelector(`.otp-code[data-id="${account.id}"]`);
    if (codeEl) {
      if (isExpiring) {
        codeEl.classList.add('expiring');
      } else {
        codeEl.classList.remove('expiring');
      }
    }
  }
}

function rebindCardEvents(card, account, otp) {
  card.addEventListener('click', () => copyOTP(account.id, otp));

  const editBtn = card.querySelector('.btn-action:not(.btn-delete)');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(account.id);
    });
  }

  const deleteBtn = card.querySelector('.btn-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(account.id);
    });
  }
}

// ===== 複製 OTP =====

async function copyOTP(accountId, otp) {
  if (!otp) {
    showToast('無法產生 OTP，請檢查 Secret');
    return;
  }

  try {
    await navigator.clipboard.writeText(otp);
    const card = accountListEl.querySelector(`.account-card[data-id="${accountId}"]`);
    if (card) {
      card.classList.add('copied');
      setTimeout(() => card.classList.remove('copied'), 1500);
    }
    showToast('已複製到剪貼簿！');

    // 安全：30 秒後清除剪貼簿
    setTimeout(async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === otp) {
          await navigator.clipboard.writeText('');
        }
      } catch {
        // 忽略剪貼簿讀取失敗（使用者可能已切換焦點）
      }
    }, 30000);
  } catch {
    showToast('複製失敗，請手動複製');
  }
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
  modalOverlay.classList.add('active');
  inputIssuer.focus();
}

async function openEditModal(id) {
  const account = allAccounts.find((a) => a.id === id);
  if (!account) return;

  editingId = id;
  modalTitle.textContent = '編輯帳號';
  inputIssuer.value = account.issuer;
  inputAccount.value = account.account;
  inputSecret.value = account.secret;
  inputDigits.value = String(account.digits);
  inputPeriod.value = String(account.period);
  formError.textContent = '';
  inputSecret.type = 'password';
  modalOverlay.classList.add('active');
  inputIssuer.focus();
}

function closeModal() {
  modalOverlay.classList.remove('active');
  editingId = null;
}

async function saveModal() {
  const issuer = inputIssuer.value.trim();
  const account = inputAccount.value.trim();
  const secret = inputSecret.value.trim();
  const digits = inputDigits.value;
  const period = inputPeriod.value;

  // 驗證
  if (!issuer) {
    formError.textContent = '請輸入服務名稱';
    inputIssuer.focus();
    return;
  }

  if (!secret) {
    formError.textContent = '請輸入 Secret Key';
    inputSecret.focus();
    return;
  }

  const validation = validateSecret(secret);
  if (!validation.valid) {
    formError.textContent = validation.error;
    inputSecret.focus();
    return;
  }

  formError.textContent = '';

  try {
    if (editingId) {
      await updateAccount(editingId, { issuer, account, secret, digits, period });
      showToast('帳號已更新');
    } else {
      await addAccount({ issuer, account, secret, digits, period });
      showToast('帳號已新增');
    }
    closeModal();
    await refreshAccounts();
  } catch (e) {
    formError.textContent = e.message || '儲存失敗';
  }
}

// ===== Modal - 刪除 =====

function openDeleteModal(id) {
  const account = allAccounts.find((a) => a.id === id);
  if (!account) return;
  pendingDeleteId = id;
  deleteConfirmText.textContent = `確定要刪除「${account.issuer}」${account.account ? `（${account.account}）` : ''}嗎？此操作無法復原。`;
  deleteOverlay.classList.add('active');
}

function closeDeleteModal() {
  deleteOverlay.classList.remove('active');
  pendingDeleteId = null;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  try {
    await deleteAccount(pendingDeleteId);
    showToast('帳號已刪除');
    closeDeleteModal();
    await refreshAccounts();
  } catch (e) {
    showToast(e.message || '刪除失敗');
    closeDeleteModal();
  }
}

// ===== Toast =====

let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2000);
}

// ===== 事件綁定 =====

function bindEvents() {
  // Header 新增按鈕
  document.getElementById('btn-add').addEventListener('click', openAddModal);

  // 搜尋
  searchInput.addEventListener('input', applyFilter);

  // Modal 關閉
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Modal 儲存
  document.getElementById('btn-save').addEventListener('click', saveModal);

  // Enter 鍵儲存
  [inputIssuer, inputAccount, inputSecret].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveModal();
    });
  });

  // Secret 顯示/隱藏
  btnToggleSecret.addEventListener('click', () => {
    const isPassword = inputSecret.type === 'password';
    inputSecret.type = isPassword ? 'text' : 'password';
    const eyeIcon = document.getElementById('eye-icon');
    if (isPassword) {
      // 顯示「眼睛劃線」圖示
      eyeIcon.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      `;
    } else {
      eyeIcon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      `;
    }
  });

  // 刪除 Modal
  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('btn-delete-confirm').addEventListener('click', confirmDelete);
  deleteOverlay.addEventListener('click', (e) => {
    if (e.target === deleteOverlay) closeDeleteModal();
  });

  // ESC 關閉 Modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalOverlay.classList.contains('active')) closeModal();
      if (deleteOverlay.classList.contains('active')) closeDeleteModal();
    }
  });
}
