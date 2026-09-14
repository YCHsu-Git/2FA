'use strict';

/**
 * TOTP (RFC 6238) 實作
 * 使用 Web Crypto API (HMAC-SHA1)，不依賴任何外部函式庫
 */

/**
 * Base32 解碼（RFC 4648）
 * @param {string} base32 - Base32 編碼字串（不含空格）
 * @returns {Uint8Array}
 */
function base32Decode(base32) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // 移除空格、padding，轉大寫
  const input = base32.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');

  if (input.length === 0) {
    throw new Error('Secret 不可為空');
  }

  for (const ch of input) {
    if (ALPHABET.indexOf(ch) === -1) {
      throw new Error(`Secret 包含無效字元: "${ch}"，請確認為 Base32 格式`);
    }
  }

  let bits = 0;
  let value = 0;
  const output = [];

  for (const ch of input) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}

/**
 * 將 64-bit 計數器轉為 8 bytes big-endian buffer
 * @param {number} counter
 * @returns {ArrayBuffer}
 */
function counterToBuffer(counter) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // JavaScript 的 number 最大安全整數為 2^53，
  // TOTP 計數器在可預見的未來不會超過 32-bit，
  // 高 4 bytes 設為 0 即可
  view.setUint32(0, 0, false);
  view.setUint32(4, counter >>> 0, false);
  return buffer;
}

/**
 * 產生 HOTP（RFC 4226）
 * @param {Uint8Array} keyBytes - 解碼後的 secret bytes
 * @param {number} counter - 計數器值
 * @param {number} digits - OTP 位數（6 或 8）
 * @returns {Promise<string>}
 */
async function generateHOTP(keyBytes, counter, digits) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign']
  );

  const counterBuffer = counterToBuffer(counter);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
  const hmac = new Uint8Array(signatureBuffer);

  // Dynamic truncation (RFC 4226 §5.3)
  const offset = hmac[hmac.length - 1] & 0x0F;
  const code =
    ((hmac[offset]     & 0x7F) << 24) |
    ((hmac[offset + 1] & 0xFF) << 16) |
    ((hmac[offset + 2] & 0xFF) <<  8) |
     (hmac[offset + 3] & 0xFF);

  const otp = code % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * 產生 TOTP（RFC 6238）
 * @param {string} secret - Base32 格式的 secret
 * @param {object} options
 * @param {number} [options.digits=6] - OTP 位數
 * @param {number} [options.period=30] - 時間步長（秒）
 * @param {number} [options.timestamp] - 指定時間戳（ms），預設為 Date.now()
 * @returns {Promise<string>} OTP 字串
 */
async function generateTOTP(secret, { digits = 6, period = 30, timestamp } = {}) {
  const keyBytes = base32Decode(secret);
  const now = timestamp !== undefined ? timestamp : Date.now();
  const counter = Math.floor(now / 1000 / period);
  return generateHOTP(keyBytes, counter, digits);
}

/**
 * 取得目前時間步長內的剩餘秒數
 * @param {number} [period=30]
 * @returns {number} 0 ~ period-1
 */
function getRemainingSeconds(period = 30) {
  const now = Math.floor(Date.now() / 1000);
  return period - (now % period);
}

/**
 * 驗證 Base32 secret 格式是否合法（不實際產生 OTP）
 * @param {string} secret
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSecret(secret) {
  try {
    const bytes = base32Decode(secret);
    if (bytes.length < 10) {
      return { valid: false, error: 'Secret 太短，至少需要 10 bytes（16 個 Base32 字元）' };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
