'use strict';

/**
 * TotpProvider.ts
 * TOTP (RFC 6238) / HOTP (RFC 4226) 實作
 * 使用 Node.js 內建 crypto 模組（HMAC-SHA1）
 */

import * as crypto from 'crypto';

/** Base32 字母表（RFC 4648） */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32 解碼
 * @throws {Error} 若包含無效字元或長度不足
 */
export function base32Decode(base32: string): Buffer {
  const input = base32.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');

  if (input.length === 0) {
    throw new Error('Secret 不可為空');
  }

  for (const ch of input) {
    if (BASE32_ALPHABET.indexOf(ch) === -1) {
      throw new Error(`Secret 包含無效字元: "${ch}"，請確認為 Base32 格式`);
    }
  }

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const ch of input) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

/**
 * 將計數器轉為 8 bytes big-endian Buffer
 */
function counterToBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8, 0);
  // counter 在可預見未來不超過 32-bit
  buf.writeUInt32BE(counter >>> 0, 4);
  return buf;
}

/**
 * 產生 HOTP（RFC 4226）
 */
function generateHOTP(keyBuffer: Buffer, counter: number, digits: number): string {
  const counterBuf = counterToBuffer(counter);
  const hmac = crypto.createHmac('sha1', keyBuffer).update(counterBuf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

export interface TotpOptions {
  digits?: number;   // 6 或 8，預設 6
  period?: number;   // 時間步長秒數，預設 30
  timestamp?: number; // 指定時間戳（ms），預設 Date.now()
}

/**
 * 產生 TOTP（RFC 6238）
 */
export function generateTOTP(secret: string, options: TotpOptions = {}): string {
  const { digits = 6, period = 30, timestamp } = options;
  const keyBuffer = base32Decode(secret);
  const now = timestamp !== undefined ? timestamp : Date.now();
  const counter = Math.floor(now / 1000 / period);
  return generateHOTP(keyBuffer, counter, digits);
}

/**
 * 取得目前時間步長內的剩餘秒數
 */
export function getRemainingSeconds(period = 30): number {
  const now = Math.floor(Date.now() / 1000);
  return period - (now % period);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 驗證 Base32 secret 格式
 */
export function validateSecret(secret: string): ValidationResult {
  try {
    const bytes = base32Decode(secret);
    if (bytes.length < 10) {
      return { valid: false, error: 'Secret 太短，至少需要 10 bytes（16 個 Base32 字元）' };
    }
    return { valid: true };
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : '無效的 Secret' };
  }
}
