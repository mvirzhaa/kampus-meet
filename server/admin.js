// Panel admin: kategori event, pengelolaan pengguna, serta seluruh meeting & event di sistem.
// Semua rute di sini wajib admin; akun ADMIN_EMAIL (super-admin) kebal dari perubahan peran/status.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q, now, tx, getSetting, setSetting } from './db.js';
import { HttpError, json, readJson, readBody } from './http.js';
import { requireUser, requireCsrf, requireAdmin, isSuperAdmin } from './auth.js';
import { clean, hashPassword, passwordProblem } from './security.js';
import { lk } from './livekit.js';
import { removeSponsorFiles } from './events.js';

// ===== Kategori =====
// events.category menyimpan NAMA kategori (bukan id) agar sertifikat yang sudah terbit
// tetap terbaca walau kategorinya kemudian dihapus admin.
export const activeCategories = () => q('SELECT name FROM categories WHERE active = 1 ORDER BY sort, name').all().map(r => r.name);

/** Nama kategori yang sah (perbandingan tanpa peduli huruf besar/kecil), atau null. */
export const validCategory = (name) =>
  q('SELECT name FROM categories WHERE name = ? AND active = 1').get(clean(name, 60))?.name || null;

/** Kategori cadangan bila input tidak dikenali — 'Lainnya' bila ada, selain itu kategori pertama. */
export const fallbackCategory = () =>
  q("SELECT name FROM categories WHERE active = 1 ORDER BY (name = 'Lainnya') DESC, sort, name").get()?.name || 'Lainnya';

const categoryView = (c) => ({
  id: c.id, name: c.name, sort: c.sort, active: !!c.active,
  used: q('SELECT COUNT(*) AS n FROM events WHERE category = ?').get(c.name).n,
});

const userView = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  createdAt: u.created_at, lockedUntil: u.locked_until,
  superAdmin: isSuperAdmin(u.email),
  ssoLinked: !!u.sso_id,
  institutionalRole: u.institutional_role || null,
  // Password lokal + tautan SSO sekaligus: perlu terlihat admin, lihat catatan di README
  hasLocalPassword: !!u.password_hash && u.password_hash.startsWith('scrypt$'),
  rooms: q('SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ?').get(u.id).n,
  events: q('SELECT COUNT(*) AS n FROM events WHERE owner_id = ?').get(u.id).n,
});

/** Pencarian sederhana: ubah teks bebas menjadi pola LIKE yang aman. */
const like = (term) => `%${term.replace(/[%_\\]/g, '')}%`;


// ===== Gerbang "boleh membuat" =====
// Peran institusional datang dari E-Portal; akun tanpa sso_id berarti pendaftar luar.
// "user" (peran bawaan E-Portal untuk akun yang belum dikategorikan) sengaja disamakan
// dengan mahasiswa: yang perannya belum diisi tidak otomatis mendapat hak penuh.
const STAFF_ROLES = ['dosen', 'staff', 'admin'];

export const CREATE_FLAGS = {
  allow_student_meeting: 'Mahasiswa & peran belum ditentukan boleh membuat meeting',
  allow_student_event: 'Mahasiswa & peran belum ditentukan boleh membuat event',
  allow_external_meeting: 'Pendaftar luar boleh membuat meeting',
  allow_external_event: 'Pendaftar luar boleh membuat event',
};

/** Bawaannya menyala, supaya mengaktifkan SSO tidak diam-diam mencabut hak siapa pun. */
export const createFlag = (key) => getSetting(key) !== '0';

/** 'staff' (selalu boleh) | 'student' (ikut toggle) | 'external' (ikut toggle) */
export function userScope(userId) {
  const row = q('SELECT sso_id, institutional_role FROM users WHERE id = ?').get(userId);
  if (!row?.sso_id) return 'external';
  return STAFF_ROLES.includes(String(row.institutional_role || '').toLowerCase()) ? 'staff' : 'student';
}

/** Lempar 403 bila kategori pengguna ini sedang tidak boleh membuat `kind` ('meeting' | 'event'). */
export function assertCanCreate(req, kind) {
  const u = requireUser(req);
  if (u.role === 'admin') return u;                  // admin Meet selalu boleh
  const scope = userScope(u.id);
  if (scope === 'staff') return u;
  if (createFlag(`allow_${scope}_${kind}`)) return u;
  const siapa = scope === 'student' ? 'mahasiswa' : 'akun non-kampus';
  const apa = kind === 'event' ? 'event' : 'meeting';
  throw new HttpError(403, `Pembuatan ${apa} oleh ${siapa} sedang dinonaktifkan oleh admin.`);
}

export function registerAdminRoutes(r, { uploadsDir }) {
  // Dipakai form event oleh pengguna biasa (bukan rute admin).
  r.get('/api/categories', (req, res) => {
    requireUser(req);
    json(res, 200, { categories: activeCategories() });
  });

  // ---------- Suara azan (takbir pembuka) — diunggah admin, diputar saat masuk waktu salat ----------
  const azanFile = path.join(config.dataDir, 'uploads', 'azan-audio');
  const sniffAudio = (b) => {
    if (b.length < 12) return null;
    if (b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
    if (b.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
    if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
    return null;
  };
  r.get('/api/azan-audio', (req, res) => {
    const mime = getSetting('azan_audio_mime');
    let size; try { size = mime && fs.statSync(azanFile).size; } catch { size = 0; }
    if (!mime || !size) throw new HttpError(404, 'Suara azan belum diunggah admin.');
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    fs.createReadStream(azanFile).on('error', () => res.destroy()).pipe(res);
  });
  r.get('/api/admin/azan-audio', (req, res) => {
    requireAdmin(req);
    let size = 0; try { size = fs.statSync(azanFile).size; } catch { /* belum ada */ }
    json(res, 200, { exists: !!(getSetting('azan_audio_mime') && size), size, name: getSetting('azan_audio_name') || '' });
  });
  r.post('/api/admin/azan-audio', async (req, res) => {
    requireAdmin(req); requireCsrf(req);
    const buf = await readBody(req, 3 * 1024 * 1024);
    const mime = sniffAudio(buf);
    if (!mime) throw new HttpError(415, 'Gunakan file audio MP3, M4A, OGG, atau WAV (maks. 3 MB).');
    await fs.promises.mkdir(path.dirname(azanFile), { recursive: true });
    await fs.promises.writeFile(azanFile, buf, { mode: 0o644 });
    let name = ''; try { name = clean(decodeURIComponent(String(req.headers['x-filename'] || '')), 120); } catch { /* abaikan */ }
    setSetting('azan_audio_mime', mime); setSetting('azan_audio_name', name);
    json(res, 201, { ok: true, size: buf.length });
  });
  r.delete('/api/admin/azan-audio', (req, res) => {
    requireAdmin(req); requireCsrf(req);
    fs.rmSync(azanFile, { force: true }); setSetting('azan_audio_mime', null);
    json(res, 200, { ok: true });
  });

  // ---------- Pengaturan (4 toggle "boleh membuat") ----------
  r.get('/api/admin/settings', (req, res) => {
    requireAdmin(req);
    const flags = {};
    for (const k of Object.keys(CREATE_FLAGS)) flags[k] = createFlag(k);
    json(res, 200, { flags, labels: CREATE_FLAGS });
  });

  r.patch('/api/admin/settings', async (req, res) => {
    requireAdmin(req); requireCsrf(req);
    const b = await readJson(req);
    const changed = {};
    for (const k of Object.keys(CREATE_FLAGS)) {
      if (b[k] === undefined) continue;
      setSetting(k, b[k] ? '1' : '0');
      changed[k] = !!b[k];
    }
    if (!Object.keys(changed).length) throw new HttpError(400, 'Tidak ada perubahan.');
    json(res, 200, { flags: changed });
  });

  // ---------- Kategori ----------
  r.get('/api/admin/categories', (req, res) => {
    requireAdmin(req);
    json(res, 200, { categories: q('SELECT * FROM categories ORDER BY sort, name').all().map(categoryView) });
  });

  r.post('/api/admin/categories', async (req, res) => {
    requireAdmin(req); requireCsrf(req);
    const name = clean((await readJson(req)).name, 60);
    if (name.length < 2) throw new HttpError(400, 'Nama kategori minimal 2 karakter.');
    if (q('SELECT 1 FROM categories WHERE name = ?').get(name)) throw new HttpError(409, 'Kategori dengan nama itu sudah ada.');
    const max = q('SELECT MAX(sort) AS m FROM categories').get().m ?? 0;
    const info = q('INSERT INTO categories (name, sort, active, created_at) VALUES (?,?,1,?)').run(name, max + 10, now());
    json(res, 201, { category: categoryView(q('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid))) });
  });

  r.patch('/api/admin/categories/:id', async (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const cat = q('SELECT * FROM categories WHERE id = ?').get(parseInt(id, 10));
    if (!cat) throw new HttpError(404, 'Kategori tidak ditemukan.');
    const b = await readJson(req);
    const data = {};
    if (b.name !== undefined) {
      const name = clean(b.name, 60);
      if (name.length < 2) throw new HttpError(400, 'Nama kategori minimal 2 karakter.');
      const dup = q('SELECT id FROM categories WHERE name = ?').get(name);
      if (dup && dup.id !== cat.id) throw new HttpError(409, 'Kategori dengan nama itu sudah ada.');
      data.name = name;
    }
    if (b.active !== undefined) data.active = b.active ? 1 : 0;
    if (b.sort !== undefined) data.sort = Math.max(0, Math.min(10000, parseInt(b.sort, 10) || 0));
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Tidak ada perubahan.');
    tx(() => {
      q(`UPDATE categories SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => data[k]), cat.id);
      // Ganti nama harus ikut memperbarui event lama, karena event menyimpan nama kategori
      if (data.name && data.name !== cat.name) q('UPDATE events SET category = ? WHERE category = ?').run(data.name, cat.name);
    });
    json(res, 200, { category: categoryView(q('SELECT * FROM categories WHERE id = ?').get(cat.id)) });
  });

  r.delete('/api/admin/categories/:id', (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const cat = q('SELECT * FROM categories WHERE id = ?').get(parseInt(id, 10));
    if (!cat) throw new HttpError(404, 'Kategori tidak ditemukan.');
    const used = q('SELECT COUNT(*) AS n FROM events WHERE category = ?').get(cat.name).n;
    if (used) throw new HttpError(400, `Kategori "${cat.name}" masih dipakai ${used} event. Nonaktifkan saja agar tidak muncul di form event baru.`);
    if (q('SELECT COUNT(*) AS n FROM categories').get().n <= 1) throw new HttpError(400, 'Minimal harus ada satu kategori.');
    q('DELETE FROM categories WHERE id = ?').run(cat.id);
    json(res, 200, { ok: true });
  });

  // ---------- Pengguna ----------
  r.get('/api/admin/users', (req, res) => {
    requireAdmin(req);
    const term = clean(new URL(req.url, 'http://x').searchParams.get('q'), 80);
    const rows = term
      ? q('SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 500').all(like(term), like(term))
      : q('SELECT * FROM users ORDER BY created_at DESC LIMIT 500').all();
    json(res, 200, { users: rows.map(userView), total: q('SELECT COUNT(*) AS n FROM users').get().n });
  });

  /** Ambil pengguna target sekaligus tolak aksi yang bisa mengunci admin dari sistemnya sendiri. */
  function target(req, id) {
    const me = requireAdmin(req);
    const u = q('SELECT * FROM users WHERE id = ?').get(parseInt(id, 10));
    if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan.');
    return { me, u };
  }

  r.patch('/api/admin/users/:id', async (req, res, { id }) => {
    const { me, u } = target(req, id); requireCsrf(req);
    const b = await readJson(req);
    const data = {};
    if (b.role !== undefined) {
      if (!['user', 'admin'].includes(b.role)) throw new HttpError(400, 'Peran tidak valid.');
      data.role = b.role;
    }
    if (b.status !== undefined) {
      if (!['active', 'disabled'].includes(b.status)) throw new HttpError(400, 'Status tidak valid.');
      data.status = b.status;
    }
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Tidak ada perubahan.');
    const turunkan = (data.role && data.role !== u.role) || (data.status && data.status !== u.status);
    if (turunkan && isSuperAdmin(u.email)) throw new HttpError(403, 'Super-admin (ADMIN_EMAIL) tidak bisa diubah. Ganti lewat .env lalu restart aplikasi.');
    if (turunkan && u.id === me.id) throw new HttpError(400, 'Anda tidak bisa mengubah peran atau status akun Anda sendiri.');
    tx(() => {
      q(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => data[k]), u.id);
      // Nonaktif = keluarkan dari semua perangkat sekarang juga
      if (data.status === 'disabled') q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    });
    json(res, 200, { user: userView(q('SELECT * FROM users WHERE id = ?').get(u.id)) });
  });

  r.post('/api/admin/users/:id/password', async (req, res, { id }) => {
    const { u } = target(req, id); requireCsrf(req);
    if (isSuperAdmin(u.email)) throw new HttpError(403, 'Password super-admin hanya bisa diganti oleh pemiliknya lewat menu Akun.');
    const b = await readJson(req);
    const prob = passwordProblem(b.password); if (prob) throw new HttpError(400, prob);
    q('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?').run(await hashPassword(b.password), u.id);
    q('DELETE FROM sessions WHERE user_id = ?').run(u.id); // paksa login ulang dengan password baru
    json(res, 200, { ok: true });
  });

  /** Buka kunci akun yang terkunci 15 menit akibat salah password berkali-kali. */
  r.post('/api/admin/users/:id/unlock', (req, res, { id }) => {
    const { u } = target(req, id); requireCsrf(req);
    q('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(u.id);
    json(res, 200, { ok: true });
  });

  // ---------- Semua meeting ----------
  r.get('/api/admin/rooms', async (req, res) => {
    requireAdmin(req);
    const term = clean(new URL(req.url, 'http://x').searchParams.get('q'), 80);
    const sql = `SELECT r.*, u.name AS owner_name, u.email AS owner_email,
                        (SELECT COUNT(*) FROM events e WHERE e.room_id = r.id) AS event_count
                 FROM rooms r JOIN users u ON u.id = r.owner_id`;
    const rows = term
      ? q(`${sql} WHERE r.name LIKE ? OR r.id LIKE ? OR u.name LIKE ? OR u.email LIKE ?
           ORDER BY COALESCE(r.last_used_at, r.created_at) DESC LIMIT 300`).all(like(term), like(term), like(term), like(term))
      : q(`${sql} ORDER BY COALESCE(r.last_used_at, r.created_at) DESC LIMIT 300`).all();
    const live = {};
    if (rows.length) {
      try { for (const lr of (await lk.listRooms(rows.map(x => x.id))).rooms || []) live[lr.name] = lr.num_participants ?? lr.numParticipants ?? 0; }
      catch { /* LiveKit tidak tersedia: tampilkan tanpa status live */ }
    }
    json(res, 200, {
      total: q('SELECT COUNT(*) AS n FROM rooms').get().n,
      rooms: rows.map(x => ({
        id: x.id, name: x.name, owner: x.owner_name, ownerEmail: x.owner_email,
        createdAt: x.created_at, lastUsedAt: x.last_used_at, scheduledAt: x.scheduled_at,
        maxParticipants: x.max_participants, hasEvent: !!x.event_count, live: live[x.id] ?? null,
      })),
    });
  });

  // Penghapusan room milik orang lain sengaja dipisah dari /api/rooms/:code agar jelas di log
  // dan tidak ikut aturan "bukan pemilik" pada rute pemilik.
  r.delete('/api/admin/rooms/:code', async (req, res, { code }) => {
    requireAdmin(req); requireCsrf(req);
    const room = q('SELECT * FROM rooms WHERE id = ?').get(String(code));
    if (!room) throw new HttpError(404, 'Room tidak ditemukan.');
    if (q('SELECT 1 FROM events WHERE room_id = ?').get(room.id)) throw new HttpError(400, 'Room dipakai oleh sebuah event. Hapus event tersebut terlebih dahulu.');
    try { await lk.deleteRoom(room.id); } catch { /* tidak aktif */ }
    q('DELETE FROM rooms WHERE id = ?').run(room.id);
    fs.rmSync(path.join(uploadsDir, room.id), { recursive: true, force: true });
    json(res, 200, { ok: true });
  });

  // ---------- Semua event ----------
  r.get('/api/admin/events', (req, res) => {
    requireAdmin(req);
    const term = clean(new URL(req.url, 'http://x').searchParams.get('q'), 80);
    const sql = `SELECT e.*, u.name AS owner_name, u.email AS owner_email,
                        (SELECT COUNT(*) FROM event_regs g WHERE g.event_id = e.id) AS regs
                 FROM events e JOIN users u ON u.id = e.owner_id`;
    const rows = term
      ? q(`${sql} WHERE e.title LIKE ? OR e.category LIKE ? OR e.speaker LIKE ? OR u.name LIKE ? OR u.email LIKE ?
           ORDER BY e.starts_at DESC LIMIT 300`).all(like(term), like(term), like(term), like(term), like(term))
      : q(`${sql} ORDER BY e.starts_at DESC LIMIT 300`).all();
    json(res, 200, {
      total: q('SELECT COUNT(*) AS n FROM events').get().n,
      events: rows.map(e => ({
        id: e.id, slug: e.slug, title: e.title, category: e.category, speaker: e.speaker,
        startsAt: e.starts_at, endsAt: e.ends_at, quota: e.quota, published: !!e.published,
        certificate: !!e.certificate, registered: e.regs, owner: e.owner_name, ownerEmail: e.owner_email,
        roomId: e.room_id,
      })),
    });
  });

  r.delete('/api/admin/events/:id', (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    removeSponsorFiles(e.id);
    tx(() => { q('DELETE FROM events WHERE id = ?').run(e.id); q('DELETE FROM rooms WHERE id = ?').run(e.room_id); });
    json(res, 200, { ok: true });
  });

  // Ringkasan kecil untuk kepala halaman panel
  r.get('/api/admin/overview', (req, res) => {
    requireAdmin(req);
    json(res, 200, {
      users: q('SELECT COUNT(*) AS n FROM users').get().n,
      admins: q("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n,
      disabled: q("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'").get().n,
      rooms: q('SELECT COUNT(*) AS n FROM rooms').get().n,
      events: q('SELECT COUNT(*) AS n FROM events').get().n,
      categories: q('SELECT COUNT(*) AS n FROM categories WHERE active = 1').get().n,
      superAdmin: config.adminEmail || null,
    });
  });
}
