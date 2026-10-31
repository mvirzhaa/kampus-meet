// Perekaman di server (LiveKit Egress → MP4 H.264 720p) dan unggah otomatis ke Google Drive.
// File MP4 hanya singgah sementara di server: dihapus segera setelah berhasil diunggah.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q, now, getSetting, setSetting } from './db.js';
import { HttpError, json } from './http.js';
import { requireUser, requireCsrf, requireAdmin } from './auth.js';
import { lk } from './livekit.js';
import { randomToken, sha256, clean } from './security.js';
import * as drive from './gdrive.js';

const R = config.recording;
fs.mkdirSync(R.localDir, { recursive: true });
const progress = new Map(); // id rekaman -> { sent, total }

const fmtStamp = (sec) => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  .format(new Date(sec * 1000)).replace(':', '.');
const safeName = (s) => clean(s, 120).replace(/[\\/:*?"<>|]/g, '-');
const localPath = (fileName) => path.join(R.localDir, path.basename(fileName));

function view(r) {
  const p = progress.get(r.id);
  return {
    id: r.id, status: r.status, startedAt: r.started_at, endedAt: r.ended_at, durationSec: r.duration_sec, size: r.size,
    startedBy: r.started_by, error: r.error, attempts: r.attempts,
    folderLink: r.drive_folder_link, fileLink: r.drive_file_link,
    progress: p ? Math.round((p.sent / Math.max(1, p.total)) * 100) : null,
  };
}

// ==================== Mulai / berhenti (dipanggil dari rute moderator) ====================
export async function startServerRecording(room, st, startedBy) {
  if (R.mode !== 'egress') throw new HttpError(400, 'Perekaman server tidak aktif.');
  if (!drive.driveConfigured()) throw new HttpError(409, 'Google Drive belum dikonfigurasi admin (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GDRIVE_FOLDER_ID).');
  if (!drive.driveConnected()) throw new HttpError(409, 'Google Drive belum dihubungkan. Admin perlu membuka Dasbor → Integrasi → Hubungkan Google Drive.');
  if (q("SELECT 1 FROM recordings WHERE room_id = ? AND status = 'recording'").get(room.id)) throw new HttpError(409, 'Rekaman sedang berjalan.');

  // Kursi khusus perekam: hanya boleh membaca (presentasi, status), tidak bisa moderasi
  const seat = randomToken(24);
  q('INSERT INTO seats (id, room_id, identity, user_id, name, role, ban_key, exp) VALUES (?,?,?,?,?,?,?,?)')
    .run(sha256(seat), room.id, 'rec-' + randomToken(6), null, 'Perekam', 'recorder', 'rec', now() + 12 * 3600);
  const fileName = `${room.id}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.mp4`;
  let info;
  try {
    info = await lk.startRoomCompositeEgress({
      room: room.id, rec: R,
      customBaseUrl: `${R.templateBase}/rec/${room.id}?seat=${encodeURIComponent(seat)}`,
      filepath: path.posix.join(R.egressDir, fileName),
    });
  } catch (e) {
    q('DELETE FROM seats WHERE id = ?').run(sha256(seat));
    console.error('[egress]', e.message);
    throw new HttpError(503, 'Layanan perekaman (Egress) tidak tersedia. Hubungi admin.');
  }
  const egressId = info.egress_id || info.egressId;
  q(`INSERT INTO recordings (room_id, session, egress_id, file_name, started_by, started_at, status, seat_hash) VALUES (?,?,?,?,?,?,?,?)`)
    .run(room.id, st.startedAt || now(), egressId, fileName, startedBy, now(), 'recording', sha256(seat));
  return egressId;
}

export async function stopServerRecording(room) {
  const r = q("SELECT * FROM recordings WHERE room_id = ? AND status = 'recording' ORDER BY id DESC").get(room.id);
  if (!r) return;
  try { await lk.stopEgress(r.egress_id); } catch (e) { console.warn('[egress stop]', e.message); }
}

/** Webhook egress_* dari LiveKit. Mengembalikan room_id bila status rekaman room berubah. */
export function onEgressWebhook(ev) {
  const info = ev.egressInfo || ev.egress_info; if (!info) return null;
  const id = info.egressId || info.egress_id;
  const r = q('SELECT * FROM recordings WHERE egress_id = ?').get(id);
  if (!r || ev.event !== 'egress_ended') return null;
  const fr = (info.fileResults || info.file_results || [])[0] || info.file || {};
  const file = localPath(fr.filename || r.file_name);
  const exists = fs.existsSync(file) && fs.statSync(file).size > 1024;
  const durNs = Number(fr.duration || 0);
  const ok = /COMPLETE/.test(String(info.status));
  q('UPDATE recordings SET ended_at = ?, duration_sec = ?, size = ?, status = ?, error = ?, next_try = 0 WHERE id = ?').run(
    now(), durNs ? Math.round(durNs / 1e9) : null, exists ? fs.statSync(file).size : (Number(fr.size) || null),
    exists ? 'pending_upload' : 'failed',
    ok ? (exists ? null : 'File rekaman tidak ditemukan di folder bersama. Periksa volume EGRESS_OUTPUT_DIR/RECORDINGS_DIR.') : (info.error || 'Perekaman gagal.'),
    r.id);
  if (r.seat_hash) q('DELETE FROM seats WHERE id = ?').run(r.seat_hash);
  if (exists) setImmediate(processQueue);
  return r.room_id;
}

export const recordingActive = (roomId) => !!q("SELECT 1 FROM recordings WHERE room_id = ? AND status = 'recording'").get(roomId);

// ==================== Antrean unggah ke Google Drive ====================
let busy = false;
export async function processQueue() {
  if (busy || !drive.driveConnected()) return;
  busy = true;
  try {
    let r;
    while ((r = q("SELECT * FROM recordings WHERE status IN ('pending_upload','uploading') AND next_try <= ? ORDER BY id LIMIT 1").get(now()))) {
      await uploadOne(r);
    }
  } finally { busy = false; }
}

async function uploadOne(r) {
  const file = localPath(r.file_name);
  if (!fs.existsSync(file)) {
    q("UPDATE recordings SET status = 'failed', error = ? WHERE id = ?").run('File lokal sudah tidak ada.', r.id); return;
  }
  q("UPDATE recordings SET status = 'uploading' WHERE id = ?").run(r.id);
  const room = q('SELECT name FROM rooms WHERE id = ?').get(r.room_id);
  const title = `${fmtStamp(r.started_at)} - ${safeName(room?.name || r.room_id)}`;
  try {
    let folderId = r.drive_folder_id;
    if (!folderId) {
      // Satu folder baru untuk setiap rekaman
      const f = await drive.createFolder(`${title} (${r.room_id})`);
      folderId = f.id;
      q('UPDATE recordings SET drive_folder_id = ?, drive_folder_link = ? WHERE id = ?').run(f.id, f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`, r.id);
    }
    const res = await drive.uploadFile({
      filePath: file, name: `Rekaman ${title}.mp4`, parent: folderId, session: r.upload_session,
      onSession: (u) => q('UPDATE recordings SET upload_session = ? WHERE id = ?').run(u, r.id),
      onProgress: (sent, total) => progress.set(r.id, { sent, total }),
    });
    q("UPDATE recordings SET status = 'uploaded', error = NULL, drive_file_id = ?, drive_file_link = ?, upload_session = NULL WHERE id = ?")
      .run(res.id, res.webViewLink || `https://drive.google.com/file/d/${res.id}/view`, r.id);
    await fs.promises.rm(file, { force: true }); // tidak disimpan di server
    console.log(`[rekaman] ${r.file_name} terunggah ke Google Drive dan dihapus dari server`);
  } catch (e) {
    const attempts = r.attempts + 1;
    const giveUp = attempts >= 12;
    q('UPDATE recordings SET status = ?, attempts = ?, next_try = ?, error = ? WHERE id = ?')
      .run(giveUp ? 'failed' : 'pending_upload', attempts, now() + Math.min(6 * 3600, 60 * 2 ** attempts), String(e.message).slice(0, 300), r.id);
    console.warn(`[rekaman] unggah gagal (percobaan ${attempts}):`, e.message);
  } finally { progress.delete(r.id); }
}

/** Egress menulis manifes <egressID>.json di folder bersama; aplikasi tidak memakainya.
 *  Tanpa pembersihan, file-file kecil ini menumpuk tanpa batas. */
function sweepManifests() {
  let names;
  try { names = fs.readdirSync(R.localDir); } catch { return; }
  const cutoff = Date.now() - 3600_000; // beri jeda 1 jam agar tidak menyentuh rekaman yang baru selesai
  for (const f of names) {
    if (!/^EG_[A-Za-z0-9]+\.json$/.test(f)) continue;
    const p = path.join(R.localDir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); } catch { /* sudah hilang */ }
  }
}

// Pemeliharaan: lanjutkan antrean, hapus file gagal yang sudah lama, sapu manifes Egress
setInterval(() => {
  processQueue();
  const old = now() - R.keepFailedDays * 86400;
  for (const r of q("SELECT id, file_name FROM recordings WHERE status = 'failed' AND COALESCE(ended_at, started_at) < ?").all(old)) {
    fs.rmSync(localPath(r.file_name), { force: true });
  }
  sweepManifests();
}, 60 * 1000).unref();
setTimeout(() => {
  // Setelah restart: unggahan yang terputus dilanjutkan
  q("UPDATE recordings SET status = 'pending_upload' WHERE status = 'uploading'").run();
  processQueue();
}, 3000).unref();

// ==================== Rute ====================
export function registerRecordingRoutes(r, { ownedRoom }) {
  r.get('/api/rooms/:code/recordings', (req, res, { code }) => {
    const { room } = ownedRoom(req, code);
    json(res, 200, { mode: R.mode, recordings: q('SELECT * FROM recordings WHERE room_id = ? ORDER BY started_at DESC LIMIT 200').all(room.id).map(view) });
  });

  r.post('/api/rooms/:code/recordings/:id/retry', (req, res, { code, id }) => {
    const { room } = ownedRoom(req, code); requireCsrf(req);
    const rec = q('SELECT * FROM recordings WHERE id = ? AND room_id = ?').get(parseInt(id, 10), room.id);
    if (!rec) throw new HttpError(404, 'Rekaman tidak ditemukan.');
    if (!fs.existsSync(localPath(rec.file_name))) throw new HttpError(410, 'File rekaman sudah tidak ada di server.');
    q("UPDATE recordings SET status = 'pending_upload', attempts = 0, next_try = 0 WHERE id = ?").run(rec.id);
    setImmediate(processQueue);
    json(res, 200, { ok: true });
  });

  // ----- Admin: integrasi Google Drive -----
  r.get('/api/admin/integrations', async (req, res) => {
    requireAdmin(req);
    const out = {
      recordingMode: R.mode, egressApiUrl: R.mode === 'egress' ? config.egressApiUrl : null,
      encoding: `${R.width}×${R.height}, ${R.fps} fps, H.264 ${R.videoKbps} kbps + AAC ${R.audioKbps} kbps (MP4)`,
      gdrive: { configured: drive.driveConfigured(), connected: drive.driveConnected(), email: drive.driveAccount(), folderId: config.google.driveFolderId || null, error: getSetting('gdrive_error'), redirectUri: drive.redirectUri() },
      queue: q("SELECT status, COUNT(*) AS n FROM recordings GROUP BY status").all(),
    };
    // Server terjemahan (LibreTranslate): dipakai peserta Safari/Firefox/HP yang browsernya tidak punya penerjemah bawaan
    out.translate = { configured: !!config.translate.url, url: config.translate.url || null, ok: false, languages: [] };
    if (config.translate.url) {
      try {
        const r = await fetch(config.translate.url + '/languages', { signal: AbortSignal.timeout(4000) });
        const langs = r.ok ? await r.json() : [];
        out.translate.languages = Array.isArray(langs) ? langs.map(l => l.code).filter(Boolean) : [];
        out.translate.ok = out.translate.languages.includes('id') && out.translate.languages.includes('en');
        if (!out.translate.ok) out.translate.error = r.ok ? 'Model bahasa Indonesia/English belum tersedia (tunggu unduhan model selesai).' : `HTTP ${r.status}`;
      } catch (e) { out.translate.error = e.name === 'TimeoutError' ? 'Tidak merespons' : e.message; }
    }
    if (out.gdrive.connected) {
      try { const f = await drive.folderInfo(); out.gdrive.folder = { name: f.name, link: f.webViewLink, canAdd: f.capabilities?.canAddChildren !== false }; }
      catch (e) { out.gdrive.folderError = e.message; }
    }
    json(res, 200, out);
  });

  r.get('/api/admin/gdrive/connect', (req, res) => {
    const u = requireAdmin(req);
    if (!drive.driveConfigured()) throw new HttpError(409, 'Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GDRIVE_FOLDER_ID di .env terlebih dahulu.');
    const state = randomToken(24);
    setSetting('gdrive_oauth_state', JSON.stringify({ h: sha256(state), uid: u.id, exp: now() + 600 }));
    res.writeHead(302, { Location: drive.authUrl(state), 'Cache-Control': 'no-store' }); res.end();
  });

  r.get('/api/admin/gdrive/callback', async (req, res) => {
    const u = requireAdmin(req);
    const sp = new URL(req.url, 'http://x').searchParams;
    let saved = {}; try { saved = JSON.parse(getSetting('gdrive_oauth_state') || '{}'); } catch { /* abaikan */ }
    setSetting('gdrive_oauth_state', null);
    let result = 'ok';
    if (sp.get('error')) result = 'ditolak';
    else if (saved.uid !== u.id || saved.exp < now() || saved.h !== sha256(String(sp.get('state') || ''))) result = 'state';
    else {
      try { await drive.exchangeCode(String(sp.get('code') || '')); await drive.folderInfo(); setImmediate(processQueue); }
      catch (e) { console.warn('[gdrive]', e.message); result = 'gagal'; setSetting('gdrive_error', e.message); }
    }
    res.writeHead(302, { Location: `/dashboard?gdrive=${result}#integrasi`, 'Cache-Control': 'no-store' }); res.end();
  });

  r.post('/api/admin/gdrive/disconnect', (req, res) => {
    requireAdmin(req); requireCsrf(req);
    drive.disconnect();
    json(res, 200, { ok: true });
  });
}

