// Push notification ke aplikasi Android lewat Firebase Cloud Messaging (FCM HTTP v1), tanpa dependensi.
// Kredensial: akun layanan Firebase (Project settings → Service accounts → Generate new private key).
//   FCM_SERVICE_ACCOUNT_FILE=/rahasia/firebase-sa.json   (atau FCM_SERVICE_ACCOUNT_JSON berisi isi file-nya)
// Token perangkat didaftarkan aplikasi lewat POST /api/push/register setelah login.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { q, now } from './db.js';

let sa = null;
function account() {
  if (sa !== null) return sa;
  sa = false;
  try {
    const raw = config.push.saJson || (config.push.saFile ? fs.readFileSync(config.push.saFile, 'utf8') : '');
    if (raw) {
      const j = JSON.parse(raw);
      if (j.client_email && j.private_key && j.project_id) sa = j;
      else console.warn('[push] akun layanan FCM tidak lengkap (butuh client_email, private_key, project_id).');
    }
  } catch (e) { console.warn('[push] gagal membaca akun layanan FCM:', e.message); }
  return sa;
}
export const pushConfigured = () => !!account();

// ---------- Token akses OAuth (JWT RS256 ditandatangani sendiri) ----------
let tok = { value: '', exp: 0 };
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function accessToken() {
  if (tok.value && tok.exp > now() + 60) return tok.value;
  const a = account(); const t = now();
  const unsigned = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: a.token_uri || 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(a.private_key).toString('base64url');
  const r = await fetch(config.push.tokenUrl || a.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token FCM ditolak (${r.status}): ${j.error_description || j.error || ''}`);
  tok = { value: j.access_token, exp: t + (j.expires_in || 3600) };
  return tok.value;
}

/** Kirim ke satu token. Mengembalikan 'ok' | 'gone' (token tidak berlaku, dihapus) | 'error'. */
async function sendOne(token, { title, body, data = {} }) {
  const a = account();
  const url = `${config.push.apiBase}/v1/projects/${a.project_id}/messages:send`;
  const strData = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  const r = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title, body }, data: strData,
      android: { priority: 'HIGH', notification: { channel_id: 'meetings', sound: 'default', tag: strData.tag || undefined } } } }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.ok) return 'ok';
  const j = await r.json().catch(() => ({}));
  const code = j.error?.details?.find?.(d => d.errorCode)?.errorCode || j.error?.status || '';
  if (r.status === 404 || code === 'UNREGISTERED' || (r.status === 400 && /registration token/i.test(j.error?.message || ''))) {
    q('DELETE FROM push_tokens WHERE token = ?').run(token);
    return 'gone';
  }
  console.warn(`[push] gagal (${r.status} ${code}):`, j.error?.message || '');
  return 'error';
}

/** Kirim notifikasi ke semua perangkat milik pengguna-pengguna tersebut. Mengembalikan jumlah perangkat yang menerima. */
export async function pushToUsers(userIds, msg) {
  if (!pushConfigured() || !userIds.length) return 0;
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  const tokens = q(`SELECT token FROM push_tokens WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(r => r.token);
  let ok = 0;
  for (const t of tokens) {
    try { if (await sendOne(t, msg) === 'ok') ok++; }
    catch (e) { console.warn('[push]', e.message); }
  }
  return ok;
}

export function registerToken(userId, token, platform = 'android') {
  q(`INSERT INTO push_tokens (token, user_id, platform, created_at, last_seen) VALUES (?,?,?,?,?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = excluded.last_seen`)
    .run(token, userId, platform, now(), now());
  // Batasi jumlah perangkat per pengguna (yang paling lama tidak aktif dibuang)
  q(`DELETE FROM push_tokens WHERE user_id = ? AND token NOT IN (SELECT token FROM push_tokens WHERE user_id = ? ORDER BY last_seen DESC LIMIT 10)`).run(userId, userId);
}
export const removeToken = (token) => q('DELETE FROM push_tokens WHERE token = ?').run(token);
export const tokenCount = () => q('SELECT COUNT(*) AS n FROM push_tokens').get().n;
