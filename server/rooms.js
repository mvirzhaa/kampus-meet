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
import { normalizeEventPw } from './events.js';
import { startServerRecording, stopServerRecording, onEgressWebhook, recordingActive, registerRecordingRoutes } from './recordings.js';

export const uploadsDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const DEFAULT_LOCKS = { webcam: false, mic: false, seeCams: false, publicChat: false, privateChat: false, notes: false, seeUsers: false };

// ---------- Status room (server = sumber kebenaran, dikirim ke klien lewat metadata LiveKit) ----------
const eventOf = (roomId) => q('SELECT * FROM events WHERE room_id = ?').get(roomId);
const eventOpen = (ev) => { const t = now(); return t >= ev.starts_at - 1800 && t <= ev.ends_at + 3600; };

function loadRoom(code) {
  const room = q('SELECT * FROM rooms WHERE id = ?').get(String(code).toLowerCase());
  if (!room) throw new HttpError(404, 'Room tidak ditemukan. Periksa kembali ID room.');
  return room;
}
function getState(room) {
  let s = {}; try { s = JSON.parse(room.state || '{}'); } catch { /* default */ }
  return { locks: { ...DEFAULT_LOCKS, ...(s.locks || {}) }, presenter: s.presenter || null, pres: s.pres || null, recording: !!s.recording, multiWb: !!s.multiWb, startedAt: s.startedAt || null, transcribe: !!s.transcribe, spotlight: s.spotlight || null, breakout: s.breakout || null };
}
function publicMeta(room, st) {
  return JSON.stringify({ ...st, breakout: boPublic(room, st.breakout), name: room.name, welcome: room.welcome, muteOnJoin: !!room.mute_on_join, recMode: config.recording.mode, trServer: !!config.translate.url, app: config.appName, campus: config.campusName });
}
// ---------- Breakout room (ruang kelompok) ----------
// Setiap ruang kelompok = room LiveKit terpisah bernama "<id room>__b<n>". Kursi, presensi, sertifikat,
// dan transkrip tetap tercatat pada room utama, jadi kehadiran tidak terputus saat peserta pindah ruang.
const BO_SEP = '__b';
const boName = (roomId, n) => `${roomId}${BO_SEP}${n}`;
const mainIdOf = (lkName) => String(lkName || '').split(BO_SEP)[0];
const boNumOf = (lkName) => { const i = String(lkName || '').indexOf(BO_SEP); return i < 0 ? 0 : parseInt(lkName.slice(i + BO_SEP.length), 10) || 0; };
const boOpen = (bo) => !!bo && (bo.active || (bo.closingAt && bo.closingAt > now()));
const boValid = (bo, n) => boOpen(bo) && Number.isInteger(n) && n >= 1 && n <= bo.rooms.length;
/** Ringkasan breakout untuk metadata room utama: penugasan per identitas yang sedang punya kursi (bukan ban key). */
function boPublic(room, bo) {
  if (!bo) return null;
  const assign = {};
  if (bo.assign && Object.keys(bo.assign).length) {
    for (const r of q('SELECT identity, ban_key FROM seats WHERE room_id = ? AND exp > ?').all(room.id, now())) {
      const n = bo.assign[r.ban_key]; if (n) assign[r.identity] = n;
    }
  }
  return { id: bo.id, active: !!bo.active, rooms: bo.rooms, endsAt: bo.endsAt || null, closingAt: bo.closingAt || null, allowChoose: !!bo.allowChoose, assign };
}
/** Metadata room LiveKit milik satu ruang kelompok. */
function boMeta(room, st, n) {
  const bo = st.breakout; const r = bo.rooms[n - 1];
  return JSON.stringify({
    locks: { ...DEFAULT_LOCKS }, presenter: null, pres: null, recording: false, multiWb: true, spotlight: null,
    startedAt: st.startedAt || null, transcribe: !!st.transcribe,
    name: `${r.name} · ${room.name}`, welcome: '', muteOnJoin: false, recMode: 'off',
    trServer: !!config.translate.url, app: config.appName, campus: config.campusName,
    bo: { n, name: r.name, rooms: bo.rooms.length, endsAt: bo.endsAt || null, closingAt: bo.closingAt || null, main: room.id, mainName: room.name },
  });
}
async function pushBoMeta(room, st) {
  if (!st.breakout) return;
  await Promise.allSettled(st.breakout.rooms.map((_, i) => lk.updateRoomMetadata(boName(room.id, i + 1), boMeta(room, st, i + 1))));
}
const boTimers = new Map(); // id room -> timeout
const helpAt = new Map();   // identity -> waktu permintaan bantuan terakhir (jeda 30 detik)
function scheduleBo(roomId) {
  clearTimeout(boTimers.get(roomId)); boTimers.delete(roomId);
  const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId); if (!room) return;
  const bo = getState(room).breakout; if (!bo) return;
  const at = bo.active ? bo.endsAt : bo.closingAt;
  if (!at) return;
  const ms = Math.max(0, (at - now()) * 1000);
  boTimers.set(roomId, setTimeout(() => (bo.active ? closeBreakout(roomId) : finishBreakout(roomId)).catch(e => console.warn('[breakout]', e.message)), Math.min(ms, 2 ** 31 - 1)));
}
/** Tutup semua ruang kelompok: peserta mendapat hitung mundur 60 detik lalu kembali ke ruang utama. */
async function closeBreakout(roomId, delay = 60) {
  const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId); if (!room) return;
  const st = getState(room); if (!st.breakout?.active) return;
  st.breakout.active = false; st.breakout.closingAt = now() + delay;
  await saveState(room, st); await pushBoMeta(room, st);
  scheduleBo(roomId);
}
async function finishBreakout(roomId) {
  clearTimeout(boTimers.get(roomId)); boTimers.delete(roomId);
  const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId); if (!room) return;
  const st = getState(room); const bo = st.breakout; if (!bo) return;
  st.breakout = null;
  q('UPDATE seats SET bo = 0 WHERE room_id = ?').run(roomId);
  await saveState(room, st);
  // Peserta yang belum kembali akan terputus dari ruang kelompok lalu otomatis masuk ke ruang utama
  await Promise.allSettled(bo.rooms.map((_, i) => lk.deleteRoom(boName(roomId, i + 1))));
}
/** Saat aplikasi dinyalakan ulang: lanjutkan timer breakout yang masih berjalan. */
export function resumeBreakouts() {
  for (const r of q(`SELECT id FROM rooms WHERE state LIKE '%"breakout":{%'`).all()) scheduleBo(r.id);
}
/** Lokasi kursi yang masih berlaku (0 bila breakout sudah ditutup). */
function seatBo(s, st) { return s.bo && boValid(st.breakout, s.bo) ? s.bo : 0; }

// ---------- Terjemahan lewat server (opsional, TRANSLATE_URL) ----------
const trCache = new Map(); const trInflight = new Map();
function serverTranslate(text, from, to) {
  const key = `${from}|${to}|${text}`;
  if (trCache.has(key)) return Promise.resolve(trCache.get(key));
  let p = trInflight.get(key);
  if (!p) {
    p = fetch(config.translate.url + '/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ q: text, source: from, target: to, format: 'text', ...(config.translate.apiKey ? { api_key: config.translate.apiKey } : {}) }),
    }).then(async (r2) => {
      if (!r2.ok) throw new Error('HTTP ' + r2.status);
      const out = clean((await r2.json()).translatedText, 2000);
      trCache.set(key, out); if (trCache.size > 3000) trCache.delete(trCache.keys().next().value);
      return out;
    }).finally(() => trInflight.delete(key));
    trInflight.set(key, p);
  }
  return p;
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
const seatRow = (r) => r && { roomId: r.room_id, identity: r.identity, uid: r.user_id, name: r.name, role: r.role, banKey: r.ban_key, bo: r.bo || 0 };
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
    return lk.updateParticipant(room.id, p.identity, { sources: publishSources({ role, isPresenter: st.presenter === p.identity, locks: st.locks, isSpotlight: st.spotlight === p.identity }) });
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
    const ev = eventOf(room.id);
    // Event: tanpa pendaftaran — cukup login; password event ditanya sekali (bila diset penyelenggara)
    const joinedBefore = ev && u ? !!q('SELECT 1 FROM event_regs WHERE event_id = ? AND user_id = ?').get(ev.id, u.id) : false;
    json(res, 200, {
      room: { id: room.id, name: room.name, owner: owner?.name || '', scheduledAt: ev ? ev.starts_at : room.scheduled_at, durationMin: room.duration_min, allowGuests: !!room.allow_guests },
      role: isMod ? 'moderator' : 'viewer',
      event: ev ? { title: ev.title, slug: ev.slug, startsAt: ev.starts_at, endsAt: ev.ends_at, opensAt: ev.starts_at - 1800, open: eventOpen(ev) } : null,
      needPassword: ev ? (!isMod && !!ev.password_enc && !joinedBefore) : (!viaLink && !!room.password_enc),
      needLogin: !u && (ev ? !isMod : !room.allow_guests && !isMod),
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
    const ev = eventOf(room.id);
    if (ev && role !== 'moderator') {
      // Event: peserta login + punya link langsung gabung; tanpa tombol daftar.
      if (!u) throw new HttpError(401, 'Silakan login terlebih dahulu untuk mengikuti event ini.');
      if (now() < ev.starts_at - 1800) throw new HttpError(403, 'Room event belum dibuka. Room dibuka 30 menit sebelum acara dimulai.');
      if (now() > ev.ends_at + 3600) throw new HttpError(403, 'Event sudah berakhir.');
      if (!q('SELECT 1 FROM event_regs WHERE event_id = ? AND user_id = ?').get(ev.id, u.id)) {
        if (ev.password_enc) {
          if (limiters.roomPw.empty('ev:' + ev.id)) throw new HttpError(429, 'Terlalu banyak percobaan password salah di event ini. Coba lagi beberapa menit lagi.');
          if (!safeEqual(normalizeEventPw(b.password), decrypt(ev.password_enc))) { limiters.roomPw.take('ev:' + ev.id); throw new HttpError(401, 'Password event salah.'); }
        }
        if (ev.quota && q('SELECT COUNT(*) AS n FROM event_regs WHERE event_id = ?').get(ev.id).n >= ev.quota) throw new HttpError(409, 'Kuota peserta event sudah penuh.');
        // Tercatat otomatis sebagai peserta (dipakai untuk presensi & sertifikat)
        q('INSERT OR IGNORE INTO event_regs (event_id, user_id, registered_at) VALUES (?,?,?)').run(ev.id, u.id, now());
      }
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

    const sources = publishSources({ role, isPresenter: st.presenter === identity, locks: st.locks, isSpotlight: st.spotlight === identity });
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
    const n = seatBo(s, st);
    if (s.bo && !n) q('UPDATE seats SET bo = 0 WHERE room_id = ? AND identity = ?').run(room.id, s.identity);
    if (n) {
      // Ruang kelompok: semua anggota boleh kamera, mikrofon, dan berbagi layar
      const lkName = boName(room.id, n);
      try { await lk.createRoom(lkName, { maxParticipants: room.max_participants, metadata: boMeta(room, st, n) }); }
      catch (e) { console.error('[livekit]', e.message); throw new HttpError(503, 'Server media sedang tidak tersedia. Coba beberapa saat lagi.'); }
      openPresence({ roomId: room.id, session: st.startedAt || now(), identity: s.identity, person: s.banKey, userId: s.uid, name: s.name, role: s.role });
      return json(res, 200, { url: config.livekit.publicUrl, breakout: n, token: participantToken({ room: lkName, identity: s.identity, name: s.name, role: s.role, sources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'], uid: s.uid }) });
    }
    if (s.role === 'moderator' && !st.presenter) { st.presenter = s.identity; }
    st.startedAt ??= now();
    try { await lk.createRoom(room.id, { maxParticipants: room.max_participants, metadata: publicMeta(room, st) }); ensured.add(room.id); }
    catch (e) { console.error('[livekit]', e.message); throw new HttpError(503, 'Server media sedang tidak tersedia. Coba beberapa saat lagi.'); }
    await saveState(room, st);
    const sources = publishSources({ role: s.role, isPresenter: st.presenter === s.identity, locks: st.locks, isSpotlight: st.spotlight === s.identity });
    openPresence({ roomId: room.id, session: st.startedAt, identity: s.identity, person: s.banKey, userId: s.uid, name: s.name, role: s.role });
    json(res, 200, { url: config.livekit.publicUrl, breakout: 0, token: participantToken({ room: room.id, identity: s.identity, name: s.name, role: s.role, sources, uid: s.uid }) });
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

  // inBreakout: aksi yang juga berlaku di dalam ruang kelompok (dijalankan pada room LiveKit tempat moderator berada)
  const modRoute = (p, fn, { inBreakout = false } = {}) => r.post(`/api/meet/:code/mod/${p}`, async (req, res, params) => {
    const s = seatFor(req, params.code); requireMod(s);
    if (limiters.api.take('mod:' + s.identity)) throw new HttpError(429, 'Terlalu cepat.');
    const room = loadRoom(params.code);
    const st = getState(room);
    const n = seatBo(s, st);
    if (n && !inBreakout) throw new HttpError(403, 'Tidak tersedia di ruang kelompok. Kembali ke ruang utama terlebih dahulu.');
    const b = await readJson(req);
    json(res, 200, (await fn({ s, room, b, st, lkRoom: n ? boName(room.id, n) : room.id })) || { ok: true });
  });

  modRoute('mute', async ({ b, st, lkRoom }) => {
    const parts = await lk.listParticipants(lkRoom);
    const targets = b.all
      ? parts.filter(p => (p.attributes?.role || 'viewer') !== 'moderator' && !(b.exceptPresenter && p.identity === st.presenter))
      : parts.filter(p => p.identity === b.identity);
    await Promise.allSettled(targets.flatMap(p => (p.tracks || [])
      .filter(t => (t.source === 'MICROPHONE' || t.source === 2) && !t.muted)
      .map(t => lk.muteTrack(lkRoom, p.identity, t.sid))));
    return { ok: true, count: targets.length };
  }, { inBreakout: true });

  modRoute('kick', async ({ s, room, b, st }) => {
    if (b.identity === s.identity) throw new HttpError(400, 'Tidak bisa mengeluarkan diri sendiri.');
    const target = seatByIdentity(room.id, b.identity);
    if (b.ban && target) q('INSERT OR REPLACE INTO bans (room_id, ban_key, until) VALUES (?,?,?)').run(room.id, target.banKey, now() + 24 * 3600);
    q('DELETE FROM seats WHERE room_id = ? AND identity = ?').run(room.id, b.identity); // token kursi lama tidak berlaku lagi
    // Peserta bisa sedang berada di ruang utama atau di salah satu ruang kelompok
    const rooms = [room.id, ...(st.breakout ? st.breakout.rooms.map((_, i) => boName(room.id, i + 1)) : [])];
    const results = await Promise.allSettled(rooms.map(nm => lk.removeParticipant(nm, b.identity)));
    const fatal = results.find(x => x.status === 'rejected' && x.reason?.status !== 404);
    if (fatal) throw fatal.reason;
    closePresence(room.id, b.identity, now());
  }, { inBreakout: true });

  modRoute('role', async ({ s, room, b, st }) => {
    const role = b.role === 'moderator' ? 'moderator' : 'viewer';
    if (b.identity === s.identity && role === 'viewer') throw new HttpError(400, 'Tidak bisa menurunkan peran diri sendiri.');
    const parts = await lk.listParticipants(room.id);
    const p = parts.find(x => x.identity === b.identity);
    if (!p) throw new HttpError(404, 'Peserta tidak ditemukan.');
    const attrs = { ...(p.attributes || {}), role };
    await lk.updateParticipant(room.id, b.identity, { attributes: attrs, sources: publishSources({ role, isPresenter: st.presenter === b.identity, locks: st.locks, isSpotlight: st.spotlight === b.identity }) });
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
        await lk.updateParticipant(room.id, p.identity, { sources: publishSources({ role: 'viewer', isPresenter: p.identity === b.identity, locks: st.locks, isSpotlight: st.spotlight === p.identity }) }).catch(() => {});
      }
    }
  });

  // ===== Breakout room =====
  const nonModSeats = async (room) => {
    const parts = await lk.listParticipants(room.id);
    return parts.map(p => ({ p, seat: seatByIdentity(room.id, p.identity) }))
      .filter(x => x.seat && x.seat.role !== 'moderator' && x.seat.role !== 'recorder');
  };
  modRoute('breakout/open', async ({ s, room, b, st }) => {
    if (boOpen(st.breakout)) throw new HttpError(409, 'Ruang kelompok sedang berjalan. Tutup dulu sebelum membuat yang baru.');
    const count = Math.min(50, Math.max(1, parseInt(b.count, 10) || 0));
    const minutes = Math.min(480, Math.max(0, parseInt(b.minutes, 10) || 0));
    const mode = ['auto', 'manual', 'choose'].includes(b.mode) ? b.mode : 'auto';
    const names = Array.isArray(b.names) ? b.names : [];
    const rooms = Array.from({ length: count }, (_, i) => ({ n: i + 1, name: clean(names[i], 40) || `Ruang ${i + 1}` }));
    const assign = {};
    if (mode === 'auto') {
      const list = await nonModSeats(room);
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      list.forEach((x, i) => { assign[x.seat.banKey] = (i % count) + 1; });
    } else if (mode === 'manual') {
      for (const [identity, n] of Object.entries(b.assign || {})) {
        const seat = seatByIdentity(room.id, clean(identity, 80)); const k = parseInt(n, 10);
        if (seat && k >= 1 && k <= count) assign[seat.banKey] = k;
      }
    }
    st.breakout = { id: randomToken(6), active: true, rooms, assign, allowChoose: mode === 'choose' || !!b.allowChoose, startedAt: now(),
      endsAt: minutes ? now() + minutes * 60 : null, closingAt: null, by: s.name };
    st.startedAt ??= now();
    await saveState(room, st);
    scheduleBo(room.id);
    return { ok: true, breakout: boPublic(room, st.breakout) };
  });
  // Pindah ruang: n = 0 kembali ke ruang utama
  r.post('/api/meet/:code/breakout/go', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    if (limiters.api.take('bo:' + s.identity)) throw new HttpError(429, 'Terlalu cepat.');
    const b = await readJson(req);
    const n = parseInt(b.n, 10) || 0;
    if (n) {
      const bo = st.breakout;
      if (!bo?.active || !boValid(bo, n)) throw new HttpError(409, 'Ruang kelompok tidak tersedia.');
      if (s.role !== 'moderator' && !bo.allowChoose && bo.assign[s.banKey] !== n) throw new HttpError(403, 'Anda tidak ditempatkan di ruang ini.');
      if (s.role === 'recorder') throw new HttpError(403, 'Tidak diizinkan.');
    }
    q('UPDATE seats SET bo = ? WHERE room_id = ? AND identity = ?').run(n, room.id, s.identity);
    json(res, 200, { ok: true, n });
  });
  // Status ruang kelompok: anggota yang sedang berada di tiap ruang (moderator) / jumlah orang (peserta)
  r.get('/api/meet/:code/breakout', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room); const bo = st.breakout;
    if (limiters.api.take('bos:' + s.identity)) throw new HttpError(429, 'Terlalu cepat.');
    if (!bo) return json(res, 200, { breakout: null });
    const lists = await Promise.all([room.id, ...bo.rooms.map((_, i) => boName(room.id, i + 1))].map(nm => lk.listParticipants(nm).catch(() => [])));
    const isMod = s.role === 'moderator';
    const people = (parts) => parts.filter(p => !(p.permission?.hidden || p.kind === 'EGRESS' || p.kind === 2))
      .map(p => { const seat = seatByIdentity(room.id, p.identity); return { identity: p.identity, name: p.name, role: seat?.role || 'viewer', assigned: seat ? bo.assign[seat.banKey] || 0 : 0 }; });
    const main = people(lists[0]);
    const roomsOut = bo.rooms.map((r2, i) => { const ppl = people(lists[i + 1]); return { ...r2, count: ppl.length, ...(isMod ? { people: ppl } : {}) }; });
    json(res, 200, { breakout: { ...boPublic(room, bo), rooms: roomsOut, ...(isMod ? { main } : {}) } });
  });
  // Pindahkan / tugaskan ulang peserta (moderator). Bila sedang di ruang lain, peserta diberi tahu & dipindahkan otomatis.
  modRoute('breakout/move', async ({ room, b, st }) => {
    const bo = st.breakout; if (!bo?.active) throw new HttpError(409, 'Ruang kelompok tidak aktif.');
    const identity = clean(b.identity, 80); const n = parseInt(b.n, 10) || 0;
    const seat = seatByIdentity(room.id, identity); if (!seat) throw new HttpError(404, 'Peserta tidak ditemukan.');
    if (n && !boValid(bo, n)) throw new HttpError(400, 'Ruang tidak valid.');
    if (n) bo.assign[seat.banKey] = n; else delete bo.assign[seat.banKey];
    await saveState(room, st);
    const where = seat.bo && boValid(bo, seat.bo) ? boName(room.id, seat.bo) : room.id;
    await lk.sendData(where, { t: 'bo-move', identity, n }).catch(() => {});
  }, { inBreakout: true });
  modRoute('breakout/close', async ({ room, b, st }) => {
    if (!st.breakout) throw new HttpError(409, 'Tidak ada ruang kelompok.');
    if (b.now || !st.breakout.active) { await finishBreakout(room.id); return; }
    await closeBreakout(room.id, 60);
  }, { inBreakout: true });
  modRoute('breakout/broadcast', async ({ s, room, b, st }) => {
    const text = clean(b.text, 300); if (!text) throw new HttpError(400, 'Pesan kosong.');
    if (!st.breakout) throw new HttpError(409, 'Tidak ada ruang kelompok.');
    await Promise.allSettled(st.breakout.rooms.map((_, i) => lk.sendData(boName(room.id, i + 1), { t: 'bo-msg', text, from: s.name })));
  }, { inBreakout: true });
  // Peserta di ruang kelompok meminta bantuan → moderator di ruang utama mendapat notifikasi
  r.post('/api/meet/:code/breakout/help', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    const n = seatBo(s, st); if (!n) throw new HttpError(400, 'Anda tidak sedang di ruang kelompok.');
    const last = helpAt.get(s.identity) || 0;
    if (Date.now() - last < 30000) throw new HttpError(429, 'Permintaan bantuan sudah terkirim. Tunggu sebentar.');
    helpAt.set(s.identity, Date.now()); if (helpAt.size > 5000) helpAt.clear();
    await lk.sendData(room.id, { t: 'bo-help', n, room: st.breakout.rooms[n - 1].name, name: s.name }).catch(() => {});
    json(res, 200, { ok: true });
  });

  // Sorot (spotlight): kamera satu peserta ditayangkan besar/layar penuh untuk semua orang.
  modRoute('spotlight', async ({ room, b, st }) => {
    const id = b.identity ? clean(b.identity, 80) : null;
    const parts = await lk.listParticipants(room.id);
    if (id && !parts.some(p => p.identity === id)) throw new HttpError(404, 'Peserta tidak ditemukan.');
    const prev = st.spotlight;
    st.spotlight = id;
    await saveState(room, st);
    for (const p of parts) {
      const role = p.attributes?.role || 'viewer';
      if (role === 'moderator' || (p.identity !== prev && p.identity !== id)) continue;
      await lk.updateParticipant(room.id, p.identity, { sources: publishSources({ role, isPresenter: st.presenter === p.identity, locks: st.locks, isSpotlight: st.spotlight === p.identity }) }).catch(() => {});
    }
    return { ok: true, spotlight: st.spotlight };
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
    const cid = clean(b.id, 20) || null;
    const session = st.startedAt || now();
    const n = seatBo(s, st);
    const speaker = n ? `${s.name} [${st.breakout.rooms[n - 1].name}]` : s.name;
    const info = q('INSERT INTO transcripts (room_id, session, identity, user_id, name, lang, text, ts, cid, bo) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(room.id, session, s.identity, s.uid, speaker, lang, text, now(), cid, n);
    const rowId = Number(info.lastInsertRowid);
    json(res, 201, { id: rowId });
    // Bila server terjemahan aktif: terjemahkan sekali ke bahasa lainnya lalu bagikan ke semua peserta & perekam
    if (config.translate.url && cid) {
      const from = lang === 'en-US' ? 'en' : 'id', to = from === 'en' ? 'id' : 'en';
      serverTranslate(text, from, to).then((out) => {
        if (!out) return;
        q('UPDATE transcripts SET tr_lang = ?, tr_text = ? WHERE id = ? AND tr_text IS NULL').run(to === 'en' ? 'en-US' : 'id-ID', out, rowId);
        return lk.sendData(n ? boName(room.id, n) : room.id, { t: 'cap-tr', who: s.identity, id: cid, to, text: out.slice(0, 1500) });
      }).catch(e => console.warn('[translate]', e.message));
    }
  });

  // Terjemahan cadangan (opsional) lewat LibreTranslate yang di-host sendiri.
  // Hasil di-cache & permintaan yang sama digabung, jadi 1 kalimat cukup diterjemahkan sekali walau ditonton ratusan peserta.
  r.post('/api/meet/:code/translate', async (req, res, { code }) => {
    const s = seatFor(req, code);
    if (!config.translate.url) throw new HttpError(404, 'Terjemahan lewat server tidak diaktifkan.');
    if (limiters.translate.take(s.identity)) throw new HttpError(429, 'Terlalu banyak permintaan terjemahan.');
    const b = await readJson(req);
    const from = b.from === 'en' ? 'en' : 'id', to = b.to === 'en' ? 'en' : 'id';
    const text = clean(b.text, 1000);
    if (!text || from === to) return json(res, 200, { text });
    const room = loadRoom(code);
    if (!getState(room).transcribe) throw new HttpError(403, 'Transkripsi tidak aktif.');
    try { json(res, 200, { text: await serverTranslate(text, from, to) }); }
    catch (e) { console.warn('[translate]', e.message); throw new HttpError(502, 'Layanan terjemahan sedang tidak tersedia.'); }
  });

  // Terjemahan satu kalimat transkrip dibagikan (oleh pembicaranya sendiri / moderator) → disimpan untuk ekspor.
  r.post('/api/meet/:code/transcript/tr', async (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    if (limiters.translate.take('trs:' + s.identity)) throw new HttpError(429, 'Terlalu cepat.');
    const b = await readJson(req, 8 * 1024);
    const who = clean(b.who, 80), cid = clean(b.id, 20), text = clean(b.text, 2000);
    if (!who || !cid || !text) throw new HttpError(400, 'Data tidak lengkap.');
    if (who !== s.identity && s.role !== 'moderator') throw new HttpError(403, 'Tidak diizinkan.');
    const trLang = b.to === 'en' ? 'en-US' : 'id-ID';
    q('UPDATE transcripts SET tr_lang = ?, tr_text = ? WHERE room_id = ? AND session = ? AND identity = ? AND cid = ? AND tr_text IS NULL AND lang != ?')
      .run(trLang, text, room.id, st.startedAt || 0, who, cid, trLang);
    json(res, 200, { ok: true });
  });

  // Riwayat sesi berjalan (untuk peserta yang baru masuk / muat ulang)
  r.get('/api/meet/:code/transcript', (req, res, { code }) => {
    const s = seatFor(req, code); const room = loadRoom(code); const st = getState(room);
    const limit = new URL(req.url, 'http://x').searchParams.get('all') ? 20000 : 300;   // all=1 untuk ekspor PDF/Word
    const rows = st.startedAt ? q(`SELECT * FROM (SELECT id, identity, name, lang, text, ts, cid, tr_lang, tr_text FROM transcripts WHERE room_id = ? AND session = ? AND bo = ? ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts, id`).all(room.id, st.startedAt, seatBo(s, st), limit) : [];
    json(res, 200, { lines: rows });
  });

  // Pemilik room: semua transkrip per sesi
  r.get('/api/rooms/:code/transcripts', (req, res, { code }) => {
    const { room } = ownedRoom(req, code);
    const sessions = q('SELECT session, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM transcripts WHERE room_id = ? GROUP BY session ORDER BY session DESC LIMIT 100').all(room.id);
    const sp = new URL(req.url, 'http://x').searchParams;
    const session = parseInt(sp.get('session'), 10);
    const lines = Number.isFinite(session) ? q('SELECT name, lang, text, ts, user_id, tr_lang, tr_text FROM transcripts WHERE room_id = ? AND session = ? ORDER BY ts, id LIMIT 20000').all(room.id, session) : [];
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
    if (st.breakout) {
      const bo = st.breakout; st.breakout = null; clearTimeout(boTimers.get(room.id)); boTimers.delete(room.id);
      q('UPDATE seats SET bo = 0 WHERE room_id = ?').run(room.id);
      await Promise.allSettled(bo.rooms.map((_, i) => lk.deleteRoom(boName(room.id, i + 1))));
    }
    st.presenter = null; st.spotlight = null; st.recording = false; st.pres = st.pres ? { ...st.pres, page: 1 } : null; st.startedAt = null;
    await saveState(room, st, { push: false });
    try { await lk.deleteRoom(room.id); } catch { /* sudah berakhir */ }
    ensured.delete(room.id);
    const t = now();
    closeAllPresence(room.id, t);
    q("DELETE FROM seats WHERE room_id = ? AND role != 'recorder'").run(room.id);
  });

  // ===== Presentasi (PDF) =====
  // Presentasi/whiteboard bersama milik ruang utama; di ruang kelompok whiteboard berjalan lewat data channel saja
  const canPresent = (s, st) => !seatBo(s, st) && (s.role === 'moderator' || st.presenter === s.identity);

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
    // Ruang kelompok ("<id>__b<n>") dicatat pada room utamanya
    const lkName = ev.room?.name; const roomId = lkName ? mainIdOf(lkName) : undefined; const lkN = boNumOf(lkName);
    const identity = ev.participant?.identity;
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
    if (ev.event === 'participant_left' && roomId && identity) {
      // Pindah antar-ruang (utama <-> kelompok) bukan "keluar": presensi tetap tersambung
      const seat = seatByIdentity(roomId, identity);
      if (!seat || (seat.bo || 0) === lkN) closePresence(roomId, identity, t);
      // Peserta yang disorot keluar → sorotan dilepas
      const room = !lkN && q('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (room) { const st = getState(room); if (st.spotlight === identity) { st.spotlight = null; await saveState(room, st); } }
    }
    if (ev.event === 'participant_joined' && roomId && identity) {
      const seat = seatByIdentity(roomId, identity);
      const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (!seat || !room || isBanned(roomId, seat.banKey)) {
        // Token lama milik peserta yang sudah dikeluarkan/kedaluwarsa → keluarkan lagi
        lk.removeParticipant(lkName, identity).catch(() => {});
      } else {
        const st0 = getState(room);
        openPresence({ roomId, session: st0.startedAt || t, identity, person: seat.banKey, userId: seat.uid, name: seat.name, role: seat.role, t });
        // Samakan peran & izin dengan keadaan server (mencegah token lama membawa hak yang sudah dicabut)
        const st = getState(room);
        const attrs = { ...(ev.participant.attributes || {}), role: seat.role };
        const sources = lkN ? ['camera', 'microphone', 'screen_share', 'screen_share_audio']
          : publishSources({ role: seat.role, isPresenter: st.presenter === identity, locks: st.locks, isSpotlight: st.spotlight === identity });
        lk.updateParticipant(lkName, identity, { attributes: attrs, sources }).catch(() => {});
      }
    }
    if (ev.event === 'room_finished' && lkN) return json(res, 200, { ok: true }); // ruang kelompok ditutup: room utama tetap berjalan
    if (ev.event === 'room_finished' && roomId) {
      ensured.delete(roomId);
      closeAllPresence(roomId, t);
      const room = q('SELECT * FROM rooms WHERE id = ?').get(roomId);
      if (room) { const st = getState(room); st.recording = false; st.presenter = null; st.spotlight = null; st.startedAt = null; await saveState(room, st, { push: false }); }
    }
    json(res, 200, { ok: true });
  });
}
