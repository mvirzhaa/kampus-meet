// Event (seminar/kuliah umum/workshop): gabung langsung (opsional berpassword), kehadiran otomatis,
// sertifikat bertanda tangan + QR verifikasi, logo sponsor.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q, now, tx } from './db.js';
import { HttpError, json, readJson, readBody } from './http.js';
import { currentUser, requireUser, requireCsrf } from './auth.js';
import { clean, cleanMultiline, randomToken, encrypt, decrypt, limiters } from './security.js';
import { validCategory, fallbackCategory } from './admin.js';

function slugify(title) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 50) || 'event';
  return `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
}

const certCode = () => 'CERT-' + Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/(.{4})(?=.)/g, '$1-');

// ---------- Password event: 6 karakter acak (huruf besar/angka, tanpa yang mirip: 0/O, 1/I) ----------
const PW_RE = /^[A-Z0-9]{6}$/;
export const normalizeEventPw = (v) => String(v ?? '').trim().toUpperCase();

// ---------- Sponsor ----------
export const SPONSOR_POS = { tl: 'Kiri atas', tr: 'Kanan atas', br: 'Kanan bawah (Didukung oleh)' };
const sponsorDir = path.join(config.dataDir, 'uploads', 'sponsors');
fs.mkdirSync(sponsorDir, { recursive: true });
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const sponsorFile = (s) => path.join(sponsorDir, `${s.id.replace(/[^\w-]/g, '')}.${MIME_EXT[s.mime] || 'img'}`);
export function sponsorsOf(e) {
  if (!e.sponsors_enabled) return [];
  return q('SELECT id, position, name FROM event_sponsors WHERE event_id = ? ORDER BY position, sort, created_at').all(e.id)
    .map(s => ({ id: s.id, position: s.position, name: s.name, url: `/api/sponsors/${s.id}` }));
}
/** Hapus file logo sponsor milik event (baris DB ikut terhapus lewat ON DELETE CASCADE). */
export function removeSponsorFiles(eventId) {
  for (const s of q('SELECT id, mime FROM event_sponsors WHERE event_id = ?').all(eventId)) fs.rmSync(sponsorFile(s), { force: true });
}

function eventView(e, extra = {}) {
  const regs = q('SELECT COUNT(*) AS n FROM event_regs WHERE event_id = ?').get(e.id).n;
  const organizer = q('SELECT name FROM users WHERE id = ?').get(e.owner_id)?.name || '';
  return {
    id: e.id, slug: e.slug, title: e.title, description: e.description, speaker: e.speaker, category: e.category,
    startsAt: e.starts_at, endsAt: e.ends_at, quota: e.quota, certificate: !!e.certificate, minAttendMin: minCert(e),
    published: !!e.published, registered: regs, organizer, hasPassword: !!e.password_enc,
    signerName: e.signer_name || '', signerTitle: e.signer_title || '',
    sponsorsEnabled: !!e.sponsors_enabled, sponsors: sponsorsOf(e), ...extra,
  };
}
/** Untuk penyelenggara: sertakan password event (bisa dilihat ulang seperti passcode Zoom). */
const ownerView = (e, extra = {}) => eventView(e, { password: decrypt(e.password_enc), roomId: e.room_id, ...extra });

function eventInput(b, partial) {
  const o = {};
  if (!partial || b.title !== undefined) { o.title = clean(b.title, 140); if (o.title.length < 4) throw new HttpError(400, 'Judul event minimal 4 karakter.'); }
  if (b.description !== undefined) o.description = cleanMultiline(b.description, 4000);
  if (b.speaker !== undefined) o.speaker = clean(b.speaker, 200);
  if (b.category !== undefined) o.category = validCategory(b.category) || fallbackCategory();
  if (!partial || b.startsAt !== undefined) o.starts_at = parseInt(b.startsAt, 10);
  if (!partial || b.endsAt !== undefined) o.ends_at = parseInt(b.endsAt, 10);
  if (o.starts_at !== undefined && !(o.starts_at > 0)) throw new HttpError(400, 'Waktu mulai tidak valid.');
  if (o.ends_at !== undefined && !(o.ends_at > (o.starts_at ?? 0))) throw new HttpError(400, 'Waktu selesai harus setelah waktu mulai.');
  if (b.quota !== undefined) o.quota = Math.max(0, Math.min(100000, parseInt(b.quota, 10) || 0));
  if (b.certificate !== undefined) o.certificate = b.certificate ? 1 : 0;
  if (b.minAttendMin !== undefined) o.min_attend_min = Math.max(config.certMinMinutes, Math.min(600, parseInt(b.minAttendMin, 10) || config.certMinMinutes));
  if (b.published !== undefined) o.published = b.published ? 1 : 0;
  if (b.password !== undefined) {
    const pw = normalizeEventPw(b.password);
    if (pw && !PW_RE.test(pw)) throw new HttpError(400, 'Password event harus 6 karakter huruf/angka.');
    o.password_enc = pw ? encrypt(pw) : null;
  }
  if (b.signerName !== undefined) o.signer_name = clean(b.signerName, 100);
  if (b.signerTitle !== undefined) o.signer_title = clean(b.signerTitle, 120);
  if (b.sponsorsEnabled !== undefined) o.sponsors_enabled = b.sponsorsEnabled ? 1 : 0;
  return o;
}

const minCert = (e) => Math.max(config.certMinMinutes, e.min_attend_min || 0);

/**
 * Hitung ulang kehadiran event untuk satu pengguna dari tabel presensi.
 * Durasi = keluar terakhir − masuk pertama (dalam jendela event: 30 menit sebelum mulai s.d. 60 menit setelah selesai).
 * Sertifikat terbit bila durasi ≥ minimal menit (bawaan 15).
 */
export function recomputeEventAttendance(roomId, userId) {
  for (const e of q('SELECT * FROM events WHERE room_id = ?').all(roomId)) {
    const reg = q('SELECT * FROM event_regs WHERE event_id = ? AND user_id = ?').get(e.id, userId);
    if (!reg) continue;
    const lo = e.starts_at - 1800, hi = e.ends_at + 3600;
    const r = q(`SELECT MIN(MAX(joined_at, ?)) AS f, MAX(MIN(left_at, ?)) AS l FROM presence
                 WHERE room_id = ? AND user_id = ? AND left_at IS NOT NULL AND left_at > ? AND joined_at < ?`).get(lo, hi, roomId, userId, lo, hi);
    if (!r?.f || !r?.l || r.l <= r.f) continue;
    const dur = r.l - r.f;
    const code = !reg.cert_code && e.certificate && dur >= minCert(e) * 60 ? certCode() : reg.cert_code;
    q('UPDATE event_regs SET attended_sec = ?, first_join = ?, last_leave = ?, cert_code = ? WHERE id = ?').run(dur, r.f, r.l, code, reg.id);
  }
}

export function registerEventRoutes(r, { createRoomRecord }) {
  r.get('/api/events', (req, res) => {
    const sp = new URL(req.url, 'http://x').searchParams;
    const term = clean(sp.get('q'), 80);
    const when = sp.get('when'); // upcoming | past | all
    const t = now();
    let where = 'published = 1';
    const args = [];
    if (when === 'past') { where += ' AND ends_at < ?'; args.push(t); }
    else if (when !== 'all') { where += ' AND ends_at >= ?'; args.push(t); }
    if (term) { where += ' AND (title LIKE ? OR speaker LIKE ? OR category LIKE ?)'; const l = `%${term.replace(/[%_]/g, '')}%`; args.push(l, l, l); }
    const rows = q(`SELECT * FROM events WHERE ${where} ORDER BY starts_at ${when === 'past' ? 'DESC' : 'ASC'} LIMIT 60`).all(...args);
    json(res, 200, { events: rows.map(e => eventView(e)) });
  });

  r.get('/api/events/:slug', (req, res, { slug }) => {
    const e = q('SELECT * FROM events WHERE slug = ?').get(slug);
    const u = currentUser(req);
    if (!e || (!e.published && (!u || (u.id !== e.owner_id && u.role !== 'admin')))) throw new HttpError(404, 'Event tidak ditemukan.');
    const reg = u ? q('SELECT attended_sec, cert_code FROM event_regs WHERE event_id = ? AND user_id = ?').get(e.id, u.id) : null;
    const isOwner = !!u && (u.id === e.owner_id || u.role === 'admin');
    const t = now();
    const open = t >= e.starts_at - 1800 && t <= e.ends_at + 3600;
    // Tanpa pendaftaran: pengguna login langsung diarahkan ke halaman gabung (password ditanya di sana bila ada)
    const room = q('SELECT id, moderator_key FROM rooms WHERE id = ?').get(e.room_id);
    const extra = {
      isOwner, joined: !!reg, attendedMin: reg ? Math.floor(reg.attended_sec / 60) : 0, certCode: reg?.cert_code || null,
      joinOpen: open, opensAt: e.starts_at - 1800,
      joinLink: !u || !room ? null : isOwner ? `/j/${room.id}?k=${room.moderator_key}` : (open ? `/j/${room.id}` : null),
    };
    json(res, 200, { event: isOwner ? ownerView(e, extra) : eventView(e, extra) });
  });

  r.post('/api/events', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    const data = eventInput(await readJson(req));
    const ev = tx(() => {
      const room = createRoomRecord(u.id, { name: data.title, allowGuests: false, muteOnJoin: true, password: '', welcome: `Selamat datang di ${data.title}.` });
      const slug = slugify(data.title);
      const info = q(`INSERT INTO events (slug, owner_id, room_id, title, description, speaker, category, starts_at, ends_at, quota, certificate, min_attend_min, published, created_at,
          password_enc, signer_name, signer_title, sponsors_enabled)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, u.id, room.id, data.title, data.description ?? '', data.speaker ?? '', data.category ?? fallbackCategory(),
        data.starts_at, data.ends_at, data.quota ?? 0, data.certificate ?? 1, data.min_attend_min ?? config.certMinMinutes, data.published ?? 1, now(),
        data.password_enc ?? null, data.signer_name ?? '', data.signer_title ?? '', data.sponsors_enabled ?? 0);
      return q('SELECT * FROM events WHERE id = ?').get(Number(info.lastInsertRowid));
    });
    json(res, 201, { event: ownerView(ev) });
  });

  const owned = (req, id) => {
    const u = requireUser(req);
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    if (e.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Anda bukan penyelenggara event ini.');
    return e;
  };

  r.patch('/api/events/:id', async (req, res, { id }) => {
    const e = owned(req, id); requireCsrf(req);
    const data = eventInput(await readJson(req), true);
    if (data.starts_at && !data.ends_at && e.ends_at <= data.starts_at) throw new HttpError(400, 'Waktu selesai harus setelah waktu mulai.');
    const keys = Object.keys(data);
    if (keys.length) q(`UPDATE events SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => data[k]), e.id);
    if (data.title) q('UPDATE rooms SET name = ? WHERE id = ?').run(data.title, e.room_id);
    json(res, 200, { event: ownerView(q('SELECT * FROM events WHERE id = ?').get(e.id)) });
  });

  r.delete('/api/events/:id', (req, res, { id }) => {
    const e = owned(req, id); requireCsrf(req);
    removeSponsorFiles(e.id);
    tx(() => { q('DELETE FROM events WHERE id = ?').run(e.id); q('DELETE FROM rooms WHERE id = ?').run(e.room_id); });
    json(res, 200, { ok: true });
  });

  r.get('/api/events/:id/participants', (req, res, { id }) => {
    const e = owned(req, id);
    const rows = q(`SELECT u.name, u.email, r.registered_at, r.attended_sec, r.first_join, r.last_leave, r.cert_code FROM event_regs r JOIN users u ON u.id = r.user_id
                    WHERE r.event_id = ? ORDER BY r.registered_at`).all(e.id);
    json(res, 200, { participants: rows });
  });

  // ----- Logo sponsor (pemilik event) -----
  r.post('/api/events/:id/sponsors', async (req, res, { id }) => {
    const e = owned(req, id); requireCsrf(req);
    if (limiters.upload.take('sp:' + e.id)) throw new HttpError(429, 'Terlalu banyak unggahan. Tunggu sebentar.');
    const pos = String(req.headers['x-position'] || '');
    if (!SPONSOR_POS[pos]) throw new HttpError(400, 'Posisi sponsor tidak valid.');
    if (q('SELECT COUNT(*) AS n FROM event_sponsors WHERE event_id = ? AND position = ?').get(e.id, pos).n >= 8) throw new HttpError(400, 'Maksimal 8 logo per posisi.');
    const buf = await readBody(req, 2 * 1024 * 1024);
    const mime = sniffImage(buf); // periksa isi file, bukan hanya ekstensi
    if (!mime) throw new HttpError(415, 'Logo harus berupa gambar PNG, JPG, atau WebP (maks. 2 MB).');
    let name = ''; try { name = clean(decodeURIComponent(String(req.headers['x-filename'] || '')), 100).replace(/\.[a-z0-9]+$/i, ''); } catch { /* abaikan */ }
    const sp = { id: randomToken(12), mime };
    await fs.promises.writeFile(sponsorFile(sp), buf, { mode: 0o644 });
    const sort = (q('SELECT MAX(sort) AS m FROM event_sponsors WHERE event_id = ? AND position = ?').get(e.id, pos).m ?? 0) + 10;
    q('INSERT INTO event_sponsors (id, event_id, position, name, mime, size, sort, created_at) VALUES (?,?,?,?,?,?,?,?)').run(sp.id, e.id, pos, name, mime, buf.length, sort, now());
    json(res, 201, { sponsor: { id: sp.id, position: pos, name, url: `/api/sponsors/${sp.id}` } });
  });

  r.delete('/api/events/:id/sponsors/:sid', (req, res, { id, sid }) => {
    const e = owned(req, id); requireCsrf(req);
    const sp = q('SELECT id, mime FROM event_sponsors WHERE id = ? AND event_id = ?').get(sid, e.id);
    if (sp) { fs.rmSync(sponsorFile(sp), { force: true }); q('DELETE FROM event_sponsors WHERE id = ?').run(sp.id); }
    json(res, 200, { ok: true });
  });

  // Logo bersifat publik (tampil di sertifikat yang bisa dibuka siapa pun)
  r.get('/api/sponsors/:sid', (req, res, { sid }) => {
    const sp = q('SELECT id, mime, size FROM event_sponsors WHERE id = ?').get(sid);
    if (!sp) throw new HttpError(404, 'Logo tidak ditemukan.');
    res.writeHead(200, { 'Content-Type': sp.mime, 'Content-Length': sp.size, 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    fs.createReadStream(sponsorFile(sp)).on('error', () => res.destroy()).pipe(res);
  });

  r.get('/api/my/events', (req, res) => {
    const u = requireUser(req);
    const reg = q(`SELECT e.*, r.attended_sec, r.cert_code FROM event_regs r JOIN events e ON e.id = r.event_id WHERE r.user_id = ? ORDER BY e.starts_at DESC LIMIT 200`).all(u.id);
    const own = q('SELECT * FROM events WHERE owner_id = ? ORDER BY starts_at DESC LIMIT 200').all(u.id);
    json(res, 200, {
      registered: reg.map(e => eventView(e, { attendedMin: Math.floor(e.attended_sec / 60), certCode: e.cert_code })),
      organized: own.map(e => ownerView(e)),
    });
  });

  // Data sertifikat & halaman verifikasi (publik: siapa pun yang memegang kode/QR)
  r.get('/api/certificates/:code', (req, res, { code }) => {
    const row = q(`SELECT r.cert_code, r.attended_sec, r.first_join, r.last_leave, u.name, e.*
                   FROM event_regs r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id WHERE r.cert_code = ?`).get(clean(code, 40).toUpperCase());
    if (!row) throw new HttpError(404, 'Sertifikat tidak ditemukan atau tidak valid.');
    json(res, 200, { certificate: {
      code: row.cert_code, name: row.name, title: row.title, speaker: row.speaker, category: row.category,
      startsAt: row.starts_at, endsAt: row.ends_at, attendedMin: Math.floor(row.attended_sec / 60),
      firstJoin: row.first_join, lastLeave: row.last_leave,
      signerName: row.signer_name || 'Panitia Penyelenggara', signerTitle: row.signer_title || config.campusName,
      sponsors: sponsorsOf(row), verifyUrl: `${config.publicUrl}/verifikasi/${row.cert_code}`,
      campus: config.campusName, app: config.appName, timezone: config.timezone,
    } });
  });
}
