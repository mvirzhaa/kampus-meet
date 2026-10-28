import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
// N=2^15 cukup kuat namun tetap ringan (~30–60 ms/hash, 32 MB)
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [alg, n, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: +n });
  return crypto.timingSafeEqual(key, expected);
}

// Hash palsu untuk menyamakan waktu respons saat email tidak terdaftar
let dummyHash;
export async function dummyVerify(pw) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(String(pw || ''), dummyHash);
  return false;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const LETTERS = 'abcdefghijkmnopqrstuvwxyz';
/** Kode room seperti "kmp-qwer-xyz" (≈ 25^10 kombinasi, sulit ditebak). */
export function roomCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n), b => LETTERS[b % LETTERS.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}
export const numericPassword = (len = 6) => Array.from(crypto.randomBytes(len), b => b % 10).join('');

/** Rate limiter token-bucket di memori (tanpa Redis). */
export class RateLimiter {
  constructor({ capacity, refillPerMin }) {
    this.capacity = capacity; this.rate = refillPerMin / 60000; this.buckets = new Map();
    setInterval(() => {
      const t = Date.now();
      for (const [k, b] of this.buckets) if (t - b.t > 15 * 60000) this.buckets.delete(k);
    }, 5 * 60000).unref();
  }
  /** true bila bucket kosong (tanpa mengurangi token). */
  empty(key) {
    const b = this.buckets.get(key); if (!b) return false;
    return Math.min(this.capacity, b.tokens + (Date.now() - b.t) * this.rate) < 1;
  }
  take(key, cost = 1) {
    const t = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, t }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.t) * this.rate); b.t = t;
    if (b.tokens < cost) return Math.ceil((cost - b.tokens) / this.rate / 1000) || 1; // detik tunggu
    b.tokens -= cost; return 0;
  }
}

export const limiters = {
  login: new RateLimiter({ capacity: 8, refillPerMin: 4 }),
  register: new RateLimiter({ capacity: 5, refillPerMin: 1 }),
  join: new RateLimiter({ capacity: 12, refillPerMin: 6 }),
  api: new RateLimiter({ capacity: 120, refillPerMin: 240 }),
  upload: new RateLimiter({ capacity: 10, refillPerMin: 5 }),
  // Password room salah, dihitung per ROOM (semua IP) → menahan tebakan dari banyak IP/botnet
  roomPw: new RateLimiter({ capacity: 100, refillPerMin: 2 }),
  transcript: new RateLimiter({ capacity: 30, refillPerMin: 40 }),
  translate: new RateLimiter({ capacity: 60, refillPerMin: 90 }),
};

// ---------- Validasi input ----------
export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
export const cleanMultiline = (s, max = 2000) => String(s ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max);
export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password minimal 8 karakter.';
  if (pw.length > 128) return 'Password terlalu panjang.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Password harus mengandung huruf dan angka.';
  return null;
}

// ---------- Enkripsi simetris (AES-256-GCM) untuk password room ----------
// Password room harus bisa ditampilkan lagi ke pemilik (seperti passcode Zoom), jadi dienkripsi, bukan di-hash.
import { config as _cfg } from './config.js';
const ENC_KEY = crypto.createHash('sha256').update('room-pw:' + (process.env.APP_SECRET || _cfg.livekit.apiSecret)).digest();
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
export function decrypt(blob) {
  if (!blob) return null;
  try {
    const [, iv, tag, enc] = blob.split('.');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
