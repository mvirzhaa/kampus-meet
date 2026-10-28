// Room meeting: CRUD pemilik, alur join, aksi moderator, presentasi, webhook kehadiran.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError, json, readJson, readBody, parseCookies, setCookie, clientIp } from './http.js';
import { currentUser, requireUser, requireCsrf } from './auth.js';
import { lk, participantToken, publishSources, verifyWebhook } from './livekit.js';
import { roomCode, numericPassword, randomToken, safeEqual, limiters, clean, cleanMultiline, encrypt, decrypt, sha256 } from './security.js';
import { openPresence, closePresence, closeAllPresence, isOnline, presenceSessions, presenceReport } from './presence.js';
import { startServerRecording, stopServerRecording, onEgressWebhook, recordingActive, registerRecordingRoutes } from './recordings.js';

export const uploadsDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const DEFAULT_LOCKS = { webcam: false, mic: false, seeCams: false, publicChat: false, privateChat: false, notes: false, seeUsers: false };

// ---------- Status room (server = sumber kebenaran, dikirim ke klien lewat metadata LiveKit) ----------
function loadRoom(code) {
  const room = q('SELECT * FROM rooms WHERE id = ?').get(String(code).toLowerCase());
  if (!room) throw new HttpError(404, 'Room tidak ditemukan. Periksa kembali ID room.');
  return room;
}
function getState(room) {
  let s = {}; try { s = JSON.parse(room.state || '{}'); } catch { /* default */ }
  return { locks: { ...DEFAULT_LOCKS, ...(s.locks || {}) }, presenter: s.presenter || null, pres: s.pres || null, recording: !!s.recording, multiWb: !!s.multiWb, startedAt: s.startedAt || null, transcribe: !!s.transcribe };
}
function publicMeta(room, st) {
  return JSON.stringify({ ...st, name: room.name, welcome: room.welcome, muteOnJoin: !!room.mute_on_join, recMode: config.recording.mode });
}
const ensured = new Set();
async function saveState(room, st, { push = true } = {}) {
  q('UPDATE rooms SET state = ? WHERE id = ?').run(JSON.stringify(st), room.id);
  room.state = JSON.stringify(st);
  if (push && ensured.has(room.id)) {
    try { await lk.updateRoomMetadata(room.id, publicMeta(room, st)); }
    catch (e) { if (e.status === 404) ensured.delete(room.id); else console.warn(e.message); }
  }
}

// ---------- Kursi (seat): bukti keanggotaan peserta di room, disimpan (ter-hash) di SQLite ----------
const SEAT_TTL = 12 * 3600;
const seatRow = (r) => r && { roomId: r.room_id, identity: r.identity, uid: r.user_id, name: r.name, role: r.role, banKey: r.ban_key };
function getSeat(tok) {
  if (!tok || tok.length > 64) return null;
  return seatRow(q('SELECT * FROM seats WHERE id = ? AND exp > ?').get(sha256(tok), now()));
}
const seatByIdentity = (roomId, identity) => seatRow(q('SELECT * FROM seats WHERE room_id = ? AND identity = ? AND exp > ?').get(roomId, identity, now()));
function seatFor(req, code) {
  const s = getSeat(String(req.headers['x-seat'] || ''));
  if (!s || s.roomId !== String(code).toLowerCase()) throw new HttpError(401, 'Sesi meeting tidak valid. Silakan masuk ulang ke room.');
  return s;
}
const isBanned = (roomId, banKey) => !!q('SELECT 1 FROM bans WHERE room_id = ? AND ban_key = ? AND until > ?').get(roomId, banKey, now());
const requireMod = (s) => { if (s.role !== 'moderator') throw new HttpError(403, 'Hanya moderator yang dapat melakukan ini.'); };
const isConnected = isOnline;

function roomView(room, withSecrets) {
  const base = {
    id: room.id, name: room.name, welcome: room.welcome, allowGuests: !!room.allow_guests, muteOnJoin: !!room.mute_on_join,
    hasPassword: !!room.password_enc, scheduledAt: room.scheduled_at, durationMin: room.duration_min, createdAt: room.created_at, lastUsedAt: room.last_used_at,
    maxParticipants: room.max_participants,
  };
  if (withSecrets) {
    base.password = decrypt(room.password_enc);
    base.attendeeLink = `${config.publicUrl}/j/${room.id}?k=${room.attendee_key}`;
    base.moderatorLink = `${config.publicUrl}/j/${room.id}?k=${room.moderator_key}`;
  }
  return base;
}

function roomInput(b, existing) {
  const out = {};
  if (b.name !== undefined || !existing) { out.name = clean(b.name, 100) || 'Meeting'; }
  if (b.welcome !== undefined) out.welcome = cleanMultiline(b.welcome, 500);
  if (b.allowGuests !== undefined) out.allow_guests = b.allowGuests ? 1 : 0;
  if (b.muteOnJoin !== undefined) out.mute_on_join = b.muteOnJoin ? 1 : 0;
  if (b.maxParticipants !== undefined) out.max_participants = Math.max(2, Math.min(config.maxParticipantsDefault, parseInt(b.maxParticipants, 10) || config.maxParticipantsDefault));
  if (b.scheduledAt !== undefined) { const t = parseInt(b.scheduledAt, 10); out.scheduled_at = Number.isFinite(t) && t > 0 ? t : null; }
  if (b.durationMin !== undefined) { const d = parseInt(b.durationMin, 10); out.duration_min = d > 0 ? Math.min(d, 24 * 60) : null; }
  if (b.password !== undefined) {
    const pw = clean(b.password, 32);
    if (pw && pw.length < 4) throw new HttpError(400, 'Password room minimal 4 karakter.');
    out.password_enc = pw ? encrypt(pw) : null;
  }
  return out;
}

export function createRoomRecord(ownerId, b) {
  const data = roomInput({ password: numericPassword(6), ...b });
  let id; do { id = roomCode(); } while (q('SELECT 1 FROM rooms WHERE id = ?').get(id));
  q(`INSERT INTO rooms (id, owner_id, name, welcome, password_enc, attendee_key, moderator_key, allow_guests, mute_on_join, max_participants, scheduled_at, duration_min, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, ownerId, data.name, data.welcome ?? '', data.password_enc ?? null, randomToken(12), randomToken(12),
    data.allow_guests ?? 1, data.mute_on_join ?? 1, data.max_participants ?? config.maxParticipantsDefault,
    data.scheduled_at ?? null, data.duration_min ?? null, now());
  return q('SELECT * FROM rooms WHERE id = ?').get(id);
}

function ownedRoom(req, code) {
  const u = requireUser(req);
  const room = loadRoom(code);
  if (room.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Anda bukan pemilik room ini.');
  return { u, room };
}

/** Perbarui izin publish semua peserta non-moderator sesuai lock & presenter. */
async function syncPermissions(room, st) {
  let parts = [];
  try { parts = await lk.listParticipants(room.id); } catch (e) { if (e.status !== 404) console.warn(e.message); return; }
  await Promise.allSettled(parts.map(p => {
    const role = p.attributes?.role || 'viewer';
    if (role === 'moderator') return null;
    return lk.updateParticipant(room.id, p.identity, { sources: publishSources({ role, isPresenter: st.presenter === p.identity, locks: st.locks }) });
  }));
}

export function registerRoomRoutes(r) {
  registerRecordingRoutes(r, { ownedRoom });
  // ===== Pemilik =====
  r.get('/api/rooms', async (req, res) => {
    const u = requireUser(req);
    const rows = q('SELECT * FROM rooms WHERE owner_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 200').all(u.id);
    let live = {};
    if (rows.length) {
      try { for (const lr of (await lk.listRooms(rows.map(x => x.id))).rooms || []) live[lr.name] = lr.num_participants ?? lr.numParticipants ?? 0; }
      catch { /* LiveKit tidak tersedia: tampilkan tanpa status live */ }
    }
    json(res, 200, { rooms: rows.map(x => ({ ...roomView(x, true), live: live[x.id] ?? null })) });
  });

  r.post('/api/rooms', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    const count = q('SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ?').get(u.id).n;
    if (count >= 200) throw new HttpError(400, 'Batas 200 room per akun tercapai. Hapus room lama.');
    const room = createRoomRecord(u.id, await readJson(req));
    json(res, 201, { room: roomView(room, true) });
  });

  r.patch('/api/rooms/:code', async (req, res, { code }) => {
    const { room } = ownedRoom(req, code); requireCsrf(req);
    const b = await readJson(req);
    const data = roomInput(b, room);
    if (b.regenerateLinks) { data.attendee_key = randomToken(12); data.moderator_key = randomToken(12); }
    const keys = Object.keys(data);
    if (keys.length) q(`UPDATE rooms SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => data[k]), room.id);
    const updated = loadRoom(room.id);
    await saveState(updated, getState(updated));
    json(res, 200, { room: roomView(updated, true) });
  });

  r.delete('/api/rooms/:code', async (req, res, { code }) => {
    const { room } = ownedRoom(req, code); requireCsrf(req);
    if (q('SELECT 1 FROM events WHERE room_id = ?').get(room.id)) throw new HttpError(400, 'Room dipakai oleh sebuah event. Hapus event terlebih dahulu.');
    try { await lk.deleteRoom(room.id); } catch { /* tidak aktif */ }
    q('DELETE FROM rooms WHERE id = ?').run(room.id);
    fs.rmSync(path.join(uploadsDir, room.id), { recursive: true, force: true });
    json(res, 200, { ok: true });
  });

  // Presensi otomatis per sesi: masuk pertama, keluar terakhir, durasi
  r.get('/api/rooms/:code/attendance', (req, res, { code }) => {
    const { room } = ownedRoom(req, code);
    const sessions = presenceSessions(room.id);
    const sp = new URL(req.url, 'http://x').searchParams;
    const session = parseInt(sp.get('session'), 10) || sessions[0]?.session;
    json(res, 200, { room: { id: room.id, name: room.name }, sessions, session: session || null, rows: session ? presenceReport(room.id, session) : [], certMinMinutes: config.certMinMinutes, timezone: config.timezone });
  });

  // ===== Alur join =====
  r.get('/api/join/:code', (req, res, { code }) => {
    const room = loadRoom(code);
    const u = currentUser(req);
    const k = String(new URL(req.url, 'http://x').searchParams.get('k') || '');
    const owner = q('SELECT name FROM users WHERE id = ?').get(room.owner_id);
    const isMod = (u && u.id === room.owner_id) || (k && safeEqual(k, room.moderator_key));
    const viaLink = isMod || (k && safeEqual(k, room.attendee_key));
    json(res, 200, {
      room: { id: room.id, name: room.name, owner: owner?.name || '', scheduledAt: room.scheduled_at, durationMin: room.duration_min, allowGuests: !!room.allow_guests },
      role: isMod ? 'moderator' : 'viewer',
      needPassword: !viaLink && !!room.password_enc,
      needLogin: !u && !room.allow_guests && !isMod,
      user: u ? { name: u.name } : null,
    });
  });

  r.post('/api/join/:code', async (req, res, { code }) => {
    const ip = clientIp(req);
    const wait = limiters.join.take(ip + ':' + code);
    if (wait) throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.`);
    const room = loadRoom(code);
    const b = await readJson(req);
    const u = currentUser(req);
    const k = clean(b.key, 64);
    let role = 'viewer';
    if ((u && (u.id === room.owner_id)) || (k && safeEqual(k, room.moderator_key))) role = 'moderator';
    else if (k && safeEqual(k, room.attendee_key)) role = 'viewer';
    else if (room.password_enc) {
      if (limiters.roomPw.empty(room.id)) throw new HttpError(429, 'Terlalu banyak percobaan password salah di room ini. Gunakan link undangan dari dosen, atau coba lagi beberapa menit lagi.');
      if (!safeEqual(clean(b.password, 32), decrypt(room.password_enc))) { limiters.roomPw.take(room.id); throw new HttpError(401, 'Password room salah.'); }
    }
    if (!u && !room.allow_guests && role !== 'moderator') throw new HttpError(401, 'Room ini hanya untuk pengguna yang sudah login.');
    const ev = q('SELECT id FROM events WHERE room_id = ?').get(room.id);
    if (ev && role !== 'moderator' && !(u && q('SELECT 1 FROM event_regs WHERE event_id = ? AND user_id = ?').get(ev.id, u.id))) {
      throw new HttpError(403, 'Room ini khusus peserta terdaftar. Daftar event terlebih dahulu.');
    }

    const name = clean(b.name, 50) || u?.name || '';
    if (name.length < 2) throw new HttpError(400, 'Nama tampilan minimal 2 karakter.');

    // Identitas perangkat untuk fitur ban (tamu)
    let dev = parseCookies(req).km_dev;
    if (!dev || dev.length > 40) { dev = randomToken(16); setCookie(res, 'km_dev', dev, { maxAge: 365 * 86400 }); }
    const banKey = u ? `u:${u.id}` : `d:${dev}`;
    if (isBanned(room.id, banKey)) {
      throw new HttpError(403, 'Anda telah dikeluarkan dari room ini oleh moderator.');
    }

    const st = getState(room);
    const identity = (u ? `u${u.id}-` : 'g-') + randomToken(6);
    if (role === 'moderator' && (!st.presenter || !isConnected(room.id, st.presenter))) st.presenter = identity;
    st.startedAt ??= now();

    // Pastikan room ada di LiveKit dengan metadata terbaru
    try {
      await lk.createRoom(room.id, { maxParticipants: room.max_participants, metadata: publicMeta(room, st) });
      ensured.add(room.id);
    } catch (e) {
      console.error('[livekit]', e.message);
      throw new HttpError(503, 'Server media sedang tidak tersedia. Coba beberapa saat lagi.');
    }
    await saveState(room, st);

    const sources = publishSources({ role, isPresenter: st.presenter === identity, locks: st.locks });
    const token = participantToken({ room: room.id, identity, name, role, sources, uid: u?.id });
    const seat = randomToken(24);
    q('INSERT INTO seats (id, room_id, identity, user_id, name, role, ban_key, exp) VALUES (?,?,?,?,?,?,?,?)')
      .run(sha256(seat), room.id, identity, u?.id || null, name, role, banKey, now() + SEAT_TTL);
    openPresence({ roomId: room.id, session: st.startedAt, identity, person: banKey, userId: u?.id, name, role });
    q('UPDATE rooms SET last_used_at = ? WHERE id = ?').run(now(), room.id);

    json(res, 200, {
      url: config.livekit.publicUrl, token, seat, identity, role, name,
      room: { id: room.id, name: room.name, isOwner: !!u && u.id === room.owner_id },
      segmenterModelUrl: config.segmenterModelUrl,
    });
  });

  // ===== Dalam meeting (autentikasi dengan header X-Seat) =====
  // Token LiveKit baru dari kursi yang masih sah (dipakai saat halaman dimuat ulang / koneksi pulih).
  // Peran & izin selalu dihitung ulang dari server, jadi token lama tidak bisa dipakai untuk menaikkan hak.
  r.post('/api/meet/:code/token', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code);
    if (s.role === 'recorder') throw new HttpError(403, 'Tidak diizinkan.');
    if (isBanned(room.id, s.banKey)) throw new HttpError(403, 'Anda telah dikeluarkan dari room ini oleh moderator.');
    const st = getState(room);
    if (s.role === 'moderator' && !st.presenter) { st.presenter = s.identity; }
    st.startedAt ??= now();
    try { await lk.createRoom(room.id, { maxParticipants: room.max_participants, metadata: publicMeta(room, st) }); ensured.add(room.id); }
    catch (e) { console.error('[livekit]', e.message); throw new HttpError(503, 'Server media sedang tidak tersedia. Coba beberapa saat lagi.'); }
    await saveState(room, st);
    const sources = publishSources({ role: s.role, isPresenter: st.presenter === s.identity, locks: st.locks });
    openPresence({ roomId: room.id, session: st.startedAt, identity: s.identity, person: s.banKey, userId: s.uid, name: s.name, role: s.role });
    json(res, 200, { url: config.livekit.publicUrl, token: participantToken({ room: room.id, identity: s.identity, name: s.name, role: s.role, sources, uid: s.uid }) });
  });

  r.get('/api/meet/:code/state', (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code);
    json(res, 200, { state: JSON.parse(publicMeta(room, getState(room))), me: { identity: s.identity, role: s.role, name: s.name } });
  });

  r.post('/api/meet/:code/leave', async (req, res, { code }) => {
    // Dipanggil via sendBeacon (body JSON berisi seat) — cadangan bila webhook tidak aktif
    let b = {}; try { b = JSON.parse((await readBody(req, 1024)).toString() || '{}'); } catch { /* abaikan */ }
    const s = getSeat(String(b.seat || ''));
    if (s && s.roomId === String(code).toLowerCase()) closePresence(s.roomId, s.identity, now());
    json(res, 200, { ok: true });
  });

  const modRoute = (p, fn) => r.post(`/api/meet/:code/mod/${p}`, async (req, res, params) => {
    const s = seatFor(req, params.code); requireMod(s);
    if (limiters.api.take('mod:' + s.identity)) throw new HttpError(429, 'Terlalu cepat.');
    const room = loadRoom(params.code);
    const b = await readJson(req);
    json(res, 200, (await fn({ s, room, b, st: getState(room) })) || { ok: true });
  });

  modRoute('mute', async ({ room, b, st }) => {
    const parts = await lk.listParticipants(room.id);
    const targets = b.all
      ? parts.filter(p => (p.attributes?.role || 'viewer') !== 'moderator' && !(b.exceptPresenter && p.identity === st.presenter))
      : parts.filter(p => p.identity === b.identity);
    await Promise.allSettled(targets.flatMap(p => (p.tracks || [])
      .filter(t => (t.source === 'MICROPHONE' || t.source === 2) && !t.muted)
      .map(t => lk.muteTrack(room.id, p.identity, t.sid))));
    return { ok: true, count: targets.length };
  });

  modRoute('kick', async ({ s, room, b }) => {
    if (b.identity === s.identity) throw new HttpError(400, 'Tidak bisa mengeluarkan diri sendiri.');
    const target = seatByIdentity(room.id, b.identity);
    if (b.ban && target) q('INSERT OR REPLACE INTO bans (room_id, ban_key, until) VALUES (?,?,?)').run(room.id, target.banKey, now() + 24 * 3600);
    q('DELETE FROM seats WHERE room_id = ? AND identity = ?').run(room.id, b.identity); // token kursi lama tidak berlaku lagi
    try { await lk.removeParticipant(room.id, b.identity); } catch (e) { if (e.status !== 404) throw e; }
    closePresence(room.id, b.identity, now());
  });

  modRoute('role', async ({ s, room, b, st }) => {
    const role = b.role === 'moderator' ? 'moderator' : 'viewer';
    if (b.identity === s.identity && role === 'viewer') throw new HttpError(400, 'Tidak bisa menurunkan peran diri sendiri.');
    const parts = await lk.listParticipants(room.id);
    const p = parts.find(x => x.identity === b.identity);
    if (!p) throw new HttpError(404, 'Peserta tidak ditemukan.');
    const attrs = { ...(p.attributes || {}), role };
    await lk.updateParticipant(room.id, b.identity, { attributes: attrs, sources: publishSources({ role, isPresenter: st.presenter === b.identity, locks: st.locks }) });
    q('UPDATE seats SET role = ? WHERE room_id = ? AND identity = ?').run(role, room.id, b.identity);
  });

  modRoute('presenter', async ({ room, b, st }) => {
    const parts = await lk.listParticipants(room.id);
    if (!parts.some(p => p.identity === b.identity)) throw new HttpError(404, 'Peserta tidak ditemukan.');
    const prev = st.presenter;
    st.presenter = b.identity;
    await saveState(room, st);
    for (const p of parts) {
      if ((p.attributes?.role || 'viewer') === 'moderator') continue;
      if (p.identity === prev || p.identity === b.identity) {
        await lk.updateParticipant(room.id, p.identity, { sources: publishSources({ role: 'viewer', isPresenter: p.identity === b.identity, locks: st.locks }) }).catch(() => {});
      }
    }
  });

  modRoute('locks', async ({ room, b, st }) => {
    for (const k of Object.keys(DEFAULT_LOCKS)) if (k in (b.locks || {})) st.locks[k] = !!b.locks[k];
    if ('multiWb' in b) st.multiWb = !!b.multiWb;
    await saveState(room, st);
    await syncPermissions(room, st);
    return { ok: true, locks: st.locks };
  });

  modRoute('recording', async ({ s, room, b, st }) => {
    if (config.recording.mode === 'off') throw new HttpError(400, 'Perekaman dinonaktifkan admin.');
    if (config.recording.mode === 'egress') {
      // Direkam di server (MP4 720p) lalu diunggah otomatis ke Google Drive
      if (b.on) await startServerRecording(room, st, s.name); else await stopServerRecording(room);
    }
    st.recording = !!b.on; await saveState(room, st);
  });

  // ===== Transkripsi otomatis =====
  // Pengenalan suara berjalan di browser tiap pembicara; server hanya menyimpan teks final (ringan).
  modRoute('transcribe', async ({ room, b, st }) => { st.transcribe = !!b.on; st.startedAt ??= now(); await saveState(room, st); });

  r.post('/api/meet/:code/transcript', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    if (s.role === 'recorder') throw new HttpError(403, 'Tidak diizinkan.');
    if (!st.transcribe) throw new HttpError(409, 'Transkripsi tidak aktif di room ini.');
    if (limiters.transcript.take(s.identity)) throw new HttpError(429, 'Terlalu cepat.');
    const b = await readJson(req, 8 * 1024);
    const text = clean(b.text, 1000);
    if (!text) throw new HttpError(400, 'Teks kosong.');
    const lang = b.lang === 'en-US' ? 'en-US' : 'id-ID';
    const info = q('INSERT INTO transcripts (room_id, session, identity, user_id, name, lang, text, ts) VALUES (?,?,?,?,?,?,?,?)')
      .run(room.id, st.startedAt || now(), s.identity, s.uid, s.name, lang, text, now());
    json(res, 201, { id: Number(info.lastInsertRowid) });
  });

  // Riwayat sesi berjalan (untuk peserta yang baru masuk / muat ulang)
  r.get('/api/meet/:code/transcript', (req, res, { code }) => {
    seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    const rows = st.startedAt ? q(`SELECT * FROM (SELECT id, identity, name, lang, text, ts FROM transcripts WHERE room_id = ? AND session = ? ORDER BY ts DESC, id DESC LIMIT 300) ORDER BY ts, id`).all(room.id, st.startedAt) : [];
    json(res, 200, { lines: rows });
  });

  // Pemilik room: semua transkrip per sesi
  r.get('/api/rooms/:code/transcripts', (req, res, { code }) => {
    const { room } = ownedRoom(req, code);
    const sessions = q('SELECT session, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM transcripts WHERE room_id = ? GROUP BY session ORDER BY session DESC LIMIT 100').all(room.id);
    const sp = new URL(req.url, 'http://x').searchParams;
    const session = parseInt(sp.get('session'), 10);
    const lines = Number.isFinite(session) ? q('SELECT name, lang, text, ts, user_id FROM transcripts WHERE room_id = ? AND session = ? ORDER BY ts, id LIMIT 20000').all(room.id, session) : [];
    json(res, 200, { sessions, lines, retentionDays: config.transcriptRetentionDays });
  });

  r.delete('/api/rooms/:code/transcripts', async (req, res, { code }) => {
    const { room } = ownedRoom(req, code); requireCsrf(req);
    const session = parseInt(new URL(req.url, 'http://x').searchParams.get('session'), 10);
    if (Number.isFinite(session)) q('DELETE FROM transcripts WHERE room_id = ? AND session = ?').run(room.id, session);
    else q('DELETE FROM transcripts WHERE room_id = ?').run(room.id);
    json(res, 200, { ok: true });
  });

  // Halaman perekam (Egress) siap: minta moderator mengirim isi whiteboard/catatan ke perekam
  r.post('/api/meet/:code/rec-ready', async (req, res, { code }) => {
    const s = seatFor(req, code); if (s.role !== 'recorder') throw new HttpError(403, 'Tidak diizinkan.');
    const b = await readJson(req);
    const id = clean(b.identity, 80);
    if (id) await lk.sendData(s.roomId, { t: 'sync-for', id }).catch(e => console.warn('[sendData]', e.message));
    json(res, 200, { ok: true });
  });

  modRoute('end', async ({ room, st }) => {
    if (recordingActive(room.id)) await stopServerRecording(room);
    st.presenter = null; st.recording = false; st.pres = st.pres ? { ...st.pres, page: 1 } : null; st.startedAt = null;
    await saveState(room, st, { push: false });
    try { await lk.deleteRoom(room.id); } catch { /* sudah berakhir */ }
    ensured.delete(room.id);
    const t = now();
    closeAllPresence(room.id, t);
    q("DELETE FROM seats WHERE room_id = ? AND role != 'recorder'").run(room.id);
  });

  // ===== Presentasi (PDF) =====
  const canPresent = (s, st) => s.role === 'moderator' || st.presenter === s.identity;

  r.post('/api/meet/:code/state/presentation', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    if (!canPresent(s, st)) throw new HttpError(403, 'Hanya presenter yang dapat mengatur presentasi.');
    const b = await readJson(req);
    if (b.id === null) st.pres = null;
    else {
      const p = q('SELECT id, name, downloadable FROM presentations WHERE id = ? AND room_id = ?').get(String(b.id || st.pres?.id || ''), room.id);
      if (!p) throw new HttpError(404, 'Presentasi tidak ditemukan.');
      const pages = Math.max(1, Math.min(2000, parseInt(b.pages, 10) || st.pres?.pages || 1));
      st.pres = { id: p.id, name: p.name, pages, page: Math.max(1, Math.min(pages, parseInt(b.page, 10) || 1)), downloadable: !!p.downloadable };
    }
    await saveState(room, st);
    json(res, 200, { ok: true, pres: st.pres });
  });

  r.get('/api/meet/:code/presentations', (req, res, { code }) => {
    const s = seatFor(req, code);
    const rows = q('SELECT id, name, size, downloadable, created_at FROM presentations WHERE room_id = ? ORDER BY created_at').all(s.roomId);
    json(res, 200, { presentations: rows });
  });

  r.post('/api/meet/:code/presentations', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    if (!canPresent(s, st)) throw new HttpError(403, 'Hanya presenter yang dapat mengunggah presentasi.');
    if (limiters.upload.take(s.identity)) throw new HttpError(429, 'Terlalu banyak unggahan. Tunggu sebentar.');
    if (!String(req.headers['content-type']).startsWith('application/pdf')) throw new HttpError(415, 'Hanya file PDF yang didukung. Ekspor dokumen Office ke PDF terlebih dahulu.');
    if (q('SELECT COUNT(*) AS n FROM presentations WHERE room_id = ?').get(room.id).n >= 30) throw new HttpError(400, 'Maksimal 30 presentasi per room.');
    const buf = await readBody(req, config.maxUploadMb * 1024 * 1024);
    // Validasi isi file (magic bytes), bukan hanya ekstensi
    if (buf.length < 100 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'File bukan PDF yang valid.');
    const id = randomToken(12);
    const name = clean(decodeURIComponent(String(req.headers['x-filename'] || 'presentasi.pdf')), 120).replace(/[\\/]/g, '_') || 'presentasi.pdf';
    const dir = path.join(uploadsDir, room.id);
    fs.mkdirSync(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, id + '.pdf'), buf, { mode: 0o600 });
    q('INSERT INTO presentations (id, room_id, name, size, created_at) VALUES (?,?,?,?,?)').run(id, room.id, name, buf.length, now());
    json(res, 201, { presentation: { id, name, size: buf.length } });
  });

  r.get('/api/meet/:code/presentations/:pid', (req, res, { code, pid }) => {
    const s = seatFor(req, code);
    const p = q('SELECT * FROM presentations WHERE id = ? AND room_id = ?').get(pid, s.roomId);
    if (!p) throw new HttpError(404, 'Presentasi tidak ditemukan.');
    const file = path.join(uploadsDir, s.roomId, p.id + '.pdf');
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': p.size, 'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(p.name)}"`, 'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    fs.createReadStream(file).pipe(res);
  });

  r.patch('/api/meet/:code/presentations/:pid', async (req, res, { code, pid }) => {
    const s = seatFor(req, code); const st = getState(loadRoom(code));
    if (!canPresent(s, st)) throw new HttpError(403, 'Hanya presenter.');
    const b = await readJson(req);
    q('UPDATE presentations SET downloadable = ? WHERE id = ? AND room_id = ?').run(b.downloadable ? 1 : 0, pid, s.roomId);
    if (st.pres?.id === pid) { const room = loadRoom(code); st.pres.downloadable = !!b.downloadable; await saveState(room, st); }
    json(res, 200, { ok: true });
  });

  r.delete('/api/meet/:code/presentations/:pid', async (req, res, { code, pid }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    if (!canPresent(s, st)) throw new HttpError(403, 'Hanya presenter.');
    if (st.pres?.id === pid) { st.pres = null; await saveState(room, st); }
    q('DELETE FROM presentations WHERE id = ? AND room_id = ?').run(pid, room.id);
    fs.rmSync(path.join(uploadsDir, room.id, pid.replace(/[^\w-]/g, '') + '.pdf'), { force: true });
    json(res, 200, { ok: true });
  });

  // ===== Webhook LiveKit (kehadiran yang akurat) =====
  r.post('/api/livekit/webhook', async (req, res) => {
    const raw = await readBody(req, 64 * 1024);
    if (!verifyWebhook(raw, req.headers.authorization)) throw new HttpError(401, 'Signature webhook tidak valid.');
    const ev = JSON.parse(raw.toString('utf8'));
    const roomId = ev.room?.name; const identity = ev.participant?.identity;
    const t = Number(ev.createdAt || ev.created_at) || now();
    if (String(ev.event).startsWith('egress_')) {
      const rid = onEgressWebhook(ev);
      if (rid && !recordingActive(rid)) {
        const room = q('SELECT * FROM rooms WHERE id = ?').get(rid);
        if (room) { const st = getState(room); if (st.recording) { st.recording = false; await saveState(room, st); } }
      }
      return json(res, 200, { ok: true });
    }
    // Peserta perekam (Egress) tersembunyi: tidak diperiksa kursinya dan tidak dicatat presensinya
    const p = ev.participant || {};
    const isRecorder = p.kind === 'EGRESS' || p.kind === 2 || p.permission?.recorder || p.permission?.hidden || /^EG_/.test(identity || '');
    if (isRecorder) return json(res, 200, { ok: true });
    if (ev.event === 'participant_left' && roomId && identity) closePresence(roomId, identity, t);
    if (ev.event === 'participant_joined' && roomId && identity) {
      const seat = seatByIdentity(roomId, identity);
      const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (!seat || !room || isBanned(roomId, seat.banKey)) {
        // Token lama milik peserta yang sudah dikeluarkan/kedaluwarsa → keluarkan lagi
        lk.removeParticipant(roomId, identity).catch(() => {});
      } else {
        const st0 = getState(room);
        openPresence({ roomId, session: st0.startedAt || t, identity, person: seat.banKey, userId: seat.uid, name: seat.name, role: seat.role, t });
        // Samakan peran & izin dengan keadaan server (mencegah token lama membawa hak yang sudah dicabut)
        const st = getState(room);
        const attrs = { ...(ev.participant.attributes || {}), role: seat.role };
        lk.updateParticipant(roomId, identity, { attributes: attrs, sources: publishSources({ role: seat.role, isPresenter: st.presenter === identity, locks: st.locks }) }).catch(() => {});
      }
    }
    if (ev.event === 'room_finished' && roomId) {
      ensured.delete(roomId);
      closeAllPresence(roomId, t);
      const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (room) { const st = getState(room); st.recording = false; st.presenter = null; st.startedAt = null; await saveState(room, st, { push: false }); }
    }
    json(res, 200, { ok: true });
  });
}
