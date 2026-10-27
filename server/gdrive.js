// Google Drive tanpa SDK: OAuth (refresh token akun Google yang punya akses Editor ke folder),
// pembuatan folder, dan unggahan "resumable" bertahap (tahan putus, bisa dilanjutkan).
//
// Catatan: Google TIDAK mengizinkan unggahan anonim, walaupun folder dibagikan publik.
// Admin harus menghubungkan satu akun Google sekali; file tersimpan atas nama (dan kuota) akun tersebut.
import fs from 'node:fs';
import { config } from './config.js';
import { getSetting, setSetting, now } from './db.js';
import { encrypt, decrypt } from './security.js';

const G = config.google;
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive'];
const CHUNK = 16 * 1024 * 1024; // kelipatan 256 KiB, sesuai aturan Google
export const redirectUri = () => `${config.publicUrl}/api/admin/gdrive/callback`;

export const driveConfigured = () => !!(G.clientId && G.clientSecret && G.driveFolderId);
export const driveConnected = () => !!getSetting('gdrive_refresh');
export const driveAccount = () => getSetting('gdrive_email');

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: G.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${G.authUrl}?${p}`;
}

async function tokenRequest(params) {
  const res = await fetch(G.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: G.clientId, client_secret: G.clientSecret, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`Google OAuth: ${data.error_description || data.error || res.status}`); e.oauth = data.error; throw e; }
  return data;
}

export async function exchangeCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error('Google tidak mengirim refresh token. Cabut akses aplikasi di myaccount.google.com/permissions lalu hubungkan lagi.');
  let email = '';
  try { email = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url')).email || ''; } catch { /* abaikan */ }
  setSetting('gdrive_refresh', encrypt(t.refresh_token));
  setSetting('gdrive_email', email);
  setSetting('gdrive_connected_at', now());
  cached = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return { email };
}

export function disconnect() { setSetting('gdrive_refresh', null); setSetting('gdrive_email', null); cached = null; }

let cached = null;
async function accessToken(force) {
  if (!force && cached && cached.exp > Date.now()) return cached.token;
  const refresh = decrypt(getSetting('gdrive_refresh'));
  if (!refresh) throw new Error('Google Drive belum dihubungkan oleh admin.');
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
    cached = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return cached.token;
  } catch (e) {
    if (e.oauth === 'invalid_grant') setSetting('gdrive_error', 'Akses Google Drive dicabut atau kedaluwarsa. Admin perlu menghubungkan ulang.');
    throw e;
  }
}

async function api(path, { method = 'GET', body, headers = {}, raw } = {}, retry = true) {
  const res = await fetch(`${G.apiBase}${path}`, {
    method, body, headers: { Authorization: `Bearer ${await accessToken()}`, ...headers }, signal: AbortSignal.timeout(60000),
  });
  if (res.status === 401 && retry) { cached = null; return api(path, { method, body, headers, raw }, false); }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${data.error?.message || 'gagal'}`);
  return data;
}

export async function folderInfo(id = G.driveFolderId) {
  const d = await api(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink,capabilities(canAddChildren)&supportsAllDrives=true`);
  setSetting('gdrive_error', null);
  return d;
}

export async function createFolder(name, parent = G.driveFolderId) {
  return api('/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  });
}

/**
 * Unggah file besar secara bertahap. `session` = URL sesi sebelumnya (untuk melanjutkan setelah gagal/restart).
 * onSession(url) dipanggil saat sesi baru dibuat agar bisa disimpan.
 */
export async function uploadFile({ filePath, name, parent, mime = 'video/mp4', session, onSession, onProgress }) {
  const size = (await fs.promises.stat(filePath)).size;
  let offset = 0;
  if (session) {
    const st = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (st && (st.status === 200 || st.status === 201)) return st.json();
    if (st && st.status === 308) offset = nextOffset(st);
    else session = null; // sesi kedaluwarsa → mulai baru
  }
  if (!session) {
    const res = await api('/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink,size', {
      method: 'POST', raw: true,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name, parents: [parent] }),
    });
    if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
    session = res.headers.get('location');
    if (!session) throw new Error('Google Drive tidak mengembalikan URL sesi unggah.');
    onSession?.(session);
  }
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, size)));
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      await fh.read(buf, 0, len, offset);
      const res = await fetch(session, {
        method: 'PUT', body: buf.subarray(0, len),
        headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
        signal: AbortSignal.timeout(10 * 60000),
      });
      if (res.status === 200 || res.status === 201) { onProgress?.(size, size); return res.json(); }
      if (res.status === 308) { offset = nextOffset(res); onProgress?.(offset, size); continue; }
      const err = new Error(`Unggah ke Google Drive gagal (${res.status}): ${(await res.text()).slice(0, 200)}`);
      err.status = res.status; throw err;
    }
    // Ukuran 0 atau semua sudah terkirim: tanyakan status akhir
    const fin = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
    if (fin.status === 200 || fin.status === 201) return fin.json();
    throw new Error(`Unggah belum selesai (${fin.status}).`);
  } finally { await fh.close(); }
}
const nextOffset = (res) => { const r = res.headers.get('range'); return r ? Number(r.split('-')[1]) + 1 : 0; };
