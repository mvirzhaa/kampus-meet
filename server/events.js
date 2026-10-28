// Event (seminar/kuliah umum/workshop): pendaftaran, kehadiran otomatis, sertifikat.
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, now, tx } from './db.js';
import { HttpError, json, readJson } from './http.js';
import { currentUser, requireUser, requireCsrf } from './auth.js';
import { clean, cleanMultiline, randomToken } from './security.js';
import { validCategory, fallbackCategory } from './admin.js';

function slugify(title) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 50) || 'event';
  return `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
}

const certCode = () => 'CERT-' + Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/(.{4})(?=.)/g, '$1-');

function eventView(e, extra = {}) {
  const regs = q('SELECT COUNT(*) AS n FROM event_regs WHERE event_id = ?').get(e.id).n;
  const organizer = q('SELECT name FROM users WHERE id = ?').get(e.owner_id)?.name || '';
  return {
    id: e.id, slug: e.slug, title: e.title, description: e.description, speaker: e.speaker, category: e.category,
    startsAt: e.starts_at, endsAt: e.ends_at, quota: e.quota, certificate: !!e.certificate, minAttendMin: minCert(e),
    published: !!e.published, registered: regs, organizer, ...extra,
  };
}

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
    const room = (reg || isOwner) ? q('SELECT id, attendee_key, moderator_key FROM rooms WHERE id = ?').get(e.room_id) : null;
    json(res, 200, {
      event: eventView(e, {
        isOwner, isRegistered: !!reg, attendedMin: reg ? Math.floor(reg.attended_sec / 60) : 0, certCode: reg?.cert_code || null,
        joinOpen: open,
        joinLink: room && (isOwner || open) ? `/j/${room.id}?k=${isOwner ? room.moderator_key : room.attendee_key}` : null,
      }),
    });
  });

  r.post('/api/events', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    const data = eventInput(await readJson(req));
    const ev = tx(() => {
      const room = createRoomRecord(u.id, { name: data.title, allowGuests: false, muteOnJoin: true, password: '', welcome: `Selamat datang di ${data.title}.` });
      const slug = slugify(data.title);
      const info = q(`INSERT INTO events (slug, owner_id, room_id, title, description, speaker, category, starts_at, ends_at, quota, certificate, min_attend_min, published, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, u.id, room.id, data.title, data.description ?? '', data.speaker ?? '', data.category ?? fallbackCategory(),
        data.starts_at, data.ends_at, data.quota ?? 0, data.certificate ?? 1, data.min_attend_min ?? config.certMinMinutes, data.published ?? 1, now());
      return q('SELECT * FROM events WHERE id = ?').get(Number(info.lastInsertRowid));
    });
    json(res, 201, { event: eventView(ev) });
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
    json(res, 200, { event: eventView(q('SELECT * FROM events WHERE id = ?').get(e.id)) });
  });

  r.delete('/api/events/:id', (req, res, { id }) => {
    const e = owned(req, id); requireCsrf(req);
    tx(() => { q('DELETE FROM events WHERE id = ?').run(e.id); q('DELETE FROM rooms WHERE id = ?').run(e.room_id); });
    json(res, 200, { ok: true });
  });

  r.get('/api/events/:id/participants', (req, res, { id }) => {
    const e = owned(req, id);
    const rows = q(`SELECT u.name, u.email, r.registered_at, r.attended_sec, r.first_join, r.last_leave, r.cert_code FROM event_regs r JOIN users u ON u.id = r.user_id
                    WHERE r.event_id = ? ORDER BY r.registered_at`).all(e.id);
    json(res, 200, { participants: rows });
  });

  r.post('/api/events/:slug/register', (req, res, { slug }) => {
    const u = requireUser(req); requireCsrf(req);
    const e = q('SELECT * FROM events WHERE slug = ? AND published = 1').get(slug);
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    if (e.ends_at < now()) throw new HttpError(400, 'Event sudah berakhir.');
    tx(() => {
      if (e.quota && q('SELECT COUNT(*) AS n FROM event_regs WHERE event_id = ?').get(e.id).n >= e.quota) throw new HttpError(409, 'Kuota event sudah penuh.');
      q('INSERT OR IGNORE INTO event_regs (event_id, user_id, registered_at) VALUES (?,?,?)').run(e.id, u.id, now());
    });
    json(res, 200, { ok: true });
  });

  r.delete('/api/events/:slug/register', (req, res, { slug }) => {
    const u = requireUser(req); requireCsrf(req);
    const e = q('SELECT id FROM events WHERE slug = ?').get(slug);
    if (e) q('DELETE FROM event_regs WHERE event_id = ? AND user_id = ? AND attended_sec = 0').run(e.id, u.id);
    json(res, 200, { ok: true });
  });

  r.get('/api/my/events', (req, res) => {
    const u = requireUser(req);
    const reg = q(`SELECT e.*, r.attended_sec, r.cert_code FROM event_regs r JOIN events e ON e.id = r.event_id WHERE r.user_id = ? ORDER BY e.starts_at DESC LIMIT 200`).all(u.id);
    const own = q('SELECT * FROM events WHERE owner_id = ? ORDER BY starts_at DESC LIMIT 200').all(u.id);
    json(res, 200, {
      registered: reg.map(e => eventView(e, { attendedMin: Math.floor(e.attended_sec / 60), certCode: e.cert_code })),
      organized: own.map(e => eventView(e)),
    });
  });

  r.get('/api/certificates/:code', (req, res, { code }) => {
    const row = q(`SELECT r.cert_code, r.attended_sec, u.name, e.title, e.speaker, e.starts_at, e.ends_at, e.category
                   FROM event_regs r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id WHERE r.cert_code = ?`).get(clean(code, 40).toUpperCase());
    if (!row) throw new HttpError(404, 'Sertifikat tidak ditemukan atau tidak valid.');
    json(res, 200, { certificate: { code: row.cert_code, name: row.name, title: row.title, speaker: row.speaker, category: row.category, startsAt: row.starts_at, endsAt: row.ends_at, attendedMin: Math.floor(row.attended_sec / 60), campus: config.campusName, app: config.appName } });
  });
}
