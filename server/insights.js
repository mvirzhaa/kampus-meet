// Panel admin bagian "wawasan": statistik penggunaan, daftar sertifikat/kehadiran seluruh event,
// serta masukan (dari chatbot halaman depan dan dari pengguna yang login).
import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError, json, readJson, clientIp } from './http.js';
import { currentUser, requireUser, requireAdmin, requireCsrf, tzOffsetStr } from './auth.js';
import { clean, cleanMultiline, limiters } from './security.js';
import { paging, paged, like } from './paging.js';

const minCertOf = (e) => Math.max(config.certMinMinutes, e.min_attend_min || 0);
/** Lindungi CSV dari formula injection (Excel menjalankan sel yang diawali = + - @). */
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const fmtLocal = (t) => t ? new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t * 1000)) : '';

// ==================== Statistik ====================
const PERIODS = { day: 30, week: 12, month: 12 };
function offsetSec() { const [hh, mm] = tzOffsetStr().split(':'); const sign = hh.startsWith('-') ? -1 : 1; return sign * (Math.abs(+hh) * 3600 + (+mm) * 60); }

/** Ember waktu (lokal kampus) untuk periode day/week/month: [{ start, end, label }] lama → baru. */
function buckets(period) {
  const off = offsetSec(); const t = now();
  const n = PERIODS[period];
  const dayIdx = Math.floor((t + off) / 86400);
  const fmt = (start, opt) => new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, ...opt }).format(new Date(start * 1000));
  const out = [];
  if (period === 'day') {
    for (let i = n - 1; i >= 0; i--) { const start = (dayIdx - i) * 86400 - off; out.push({ start, end: start + 86400, label: fmt(start, { day: 'numeric', month: 'short' }), full: fmt(start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }); }
  } else if (period === 'week') {
    const monday = dayIdx - ((dayIdx + 3) % 7); // 1 Jan 1970 = Kamis
    for (let i = n - 1; i >= 0; i--) {
      const start = (monday - i * 7) * 86400 - off;
      out.push({ start, end: start + 7 * 86400, label: fmt(start, { day: 'numeric', month: 'short' }), full: `Minggu ${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(start + 6 * 86400, { day: 'numeric', month: 'short', year: 'numeric' })}` });
    }
  } else {
    const d = new Date((t + off) * 1000); let y = d.getUTCFullYear(), m = d.getUTCMonth();
    const list = [];
    for (let i = 0; i < n; i++) { list.unshift([y, m]); m--; if (m < 0) { m = 11; y--; } }
    for (const [yy, mm] of list) {
      const start = Date.UTC(yy, mm, 1) / 1000 - off; const end = Date.UTC(yy, mm + 1, 1) / 1000 - off;
      out.push({ start, end, label: fmt(start, { month: 'short', year: '2-digit' }), full: fmt(start, { month: 'long', year: 'numeric' }) });
    }
  }
  return out;
}
const bucketOf = (bs, ts) => { for (let i = bs.length - 1; i >= 0; i--) if (ts >= bs[i].start) return ts < bs[i].end ? i : -1; return -1; };

function stats(period) {
  const bs = buckets(period); const from = bs[0].start; const t = now();
  const n = bs.length;
  const count = (rows) => { const a = Array(n).fill(0); for (const r of rows) { const i = bucketOf(bs, r.ts); if (i >= 0) a[i]++; } return a; };
  const distinct = (rows) => { const sets = Array.from({ length: n }, () => new Set()); const all = new Set(); for (const r of rows) { const i = bucketOf(bs, r.ts); if (i >= 0) { sets[i].add(r.k); all.add(r.k); } } return { series: sets.map(x => x.size), total: all.size }; };

  const events = count(q('SELECT created_at AS ts FROM events WHERE created_at >= ?').all(from));
  // Meeting biasa (room milik event tidak dihitung dua kali)
  const rooms = count(q('SELECT created_at AS ts FROM rooms WHERE created_at >= ? AND id NOT IN (SELECT room_id FROM events)').all(from));
  const users = distinct([
    ...q('SELECT user_id AS k, ts FROM access_log WHERE ts >= ?').all(from),
    ...q('SELECT user_id AS k, joined_at AS ts FROM presence WHERE joined_at >= ? AND user_id IS NOT NULL').all(from),
  ]);
  const people = distinct(q('SELECT person AS k, joined_at AS ts FROM presence WHERE joined_at >= ?').all(from));
  const guests = distinct(q("SELECT person AS k, joined_at AS ts FROM presence WHERE joined_at >= ? AND person LIKE 'd:%'").all(from));

  // Pengguna paling aktif: total waktu di meeting dalam rentang ini
  const top = q(`SELECT p.user_id AS id, u.name, u.email, u.institutional_role AS irole,
                   SUM(MAX(0, MIN(COALESCE(p.left_at, ?), ?) - MAX(p.joined_at, ?))) AS secs,
                   COUNT(DISTINCT p.room_id || ':' || p.session) AS sessions,
                   SUM(p.role = 'moderator') AS hosted
                 FROM presence p JOIN users u ON u.id = p.user_id
                 WHERE p.user_id IS NOT NULL AND COALESCE(p.left_at, ?) > ?
                 GROUP BY p.user_id ORDER BY secs DESC, sessions DESC LIMIT 10`).all(t, t, from, t, from)
    .map(r => ({
      ...r, minutes: Math.round((r.secs || 0) / 60),
      events: q('SELECT COUNT(*) AS n FROM events WHERE owner_id = ? AND created_at >= ?').get(r.id, from).n,
      rooms: q('SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ? AND created_at >= ? AND id NOT IN (SELECT room_id FROM events)').get(r.id, from).n,
      logins: q("SELECT COUNT(*) AS n FROM access_log WHERE user_id = ? AND kind = 'login' AND ts >= ?").get(r.id, from).n,
    }));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  return {
    period, timezone: config.timezone,
    buckets: bs.map(b => ({ start: b.start, label: b.label, full: b.full })),
    series: { events, rooms, users: users.series, people: people.series, guests: guests.series },
    totals: { events: sum(events), rooms: sum(rooms), users: users.total, people: people.total, guests: guests.total },
    top,
  };
}

// ==================== Masukan ====================
const fbView = (r) => ({ id: r.id, source: r.source, userId: r.user_id, name: r.name, email: r.email, rating: r.rating, text: r.text, lang: r.lang, createdAt: r.created_at, read: !!r.read_at, hasChat: !!r.chat });

export function registerInsightRoutes(r) {
  r.get('/api/admin/stats', (req, res) => {
    requireAdmin(req);
    const period = new URL(req.url, 'http://x').searchParams.get('period');
    json(res, 200, stats(PERIODS[period] ? period : 'day'));
  });

  // ---------- Sertifikat & kehadiran seluruh event ----------
  r.get('/api/admin/certificates', (req, res) => {
    requireAdmin(req);
    const p = paging(req);
    const from = 'FROM event_regs r JOIN users u ON u.id = r.user_id JOIN events e ON e.id = r.event_id';
    const conds = ['r.attended_sec > 0']; const args = [];
    if (p.term) { conds.push('(u.name LIKE ? OR u.email LIKE ? OR e.title LIKE ? OR r.cert_code LIKE ?)'); args.push(...Array(4).fill(like(p.term))); }
    const ev = parseInt(p.sp.get('event'), 10); if (ev) { conds.push('e.id = ?'); args.push(ev); }
    const base = 'WHERE ' + conds.join(' AND ');
    const summary = q(`SELECT COUNT(*) AS attendees, SUM(r.cert_code IS NOT NULL) AS certs ${from} ${base}`).get(...args);
    const st = p.sp.get('status');
    const where = base + (st === 'cert' ? ' AND r.cert_code IS NOT NULL' : st === 'nocert' ? ' AND r.cert_code IS NULL' : '');
    const total = q(`SELECT COUNT(*) AS n ${from} ${where}`).get(...args).n;
    const csv = p.sp.get('format') === 'csv';
    const rows = q(`SELECT r.id, u.name, u.email, e.id AS event_id, e.title, e.slug, e.starts_at, e.certificate, e.min_attend_min,
                      r.attended_sec, r.first_join, r.last_leave, r.cert_code
                    ${from} ${where} ORDER BY e.starts_at DESC, u.name LIMIT ? OFFSET ?`).all(...args, csv ? 20000 : p.per, csv ? 0 : p.offset)
      .map(x => ({ id: x.id, name: x.name, email: x.email, eventId: x.event_id, eventTitle: x.title, eventSlug: x.slug, startsAt: x.starts_at,
        certificateEnabled: !!x.certificate, minMinutes: minCertOf(x), attendedMin: Math.floor(x.attended_sec / 60), firstJoin: x.first_join, lastLeave: x.last_leave, certCode: x.cert_code }));
    if (csv) {
      const head = ['Nama', 'Email', 'Event', 'Tanggal event', 'Masuk pertama', 'Keluar terakhir', 'Durasi (menit)', 'Minimal (menit)', 'Kode sertifikat', 'Link verifikasi'];
      const lines = rows.map(x => [x.name, x.email, x.eventTitle, fmtLocal(x.startsAt), fmtLocal(x.firstJoin), fmtLocal(x.lastLeave), x.attendedMin, x.minMinutes,
        x.certCode || (x.certificateEnabled ? 'Belum memenuhi durasi' : 'Event tanpa sertifikat'), x.certCode ? `${config.publicUrl}/verifikasi/${x.certCode}` : ''].map(csvCell).join(','));
      const body = '﻿' + [head.join(','), ...lines].join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sertifikat-peserta.csv"`, 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    json(res, 200, { ...paged(rows, total, p), summary: { attendees: summary.attendees || 0, certs: summary.certs || 0 } });
  });
  // Daftar event untuk filter (hanya yang punya peserta hadir)
  r.get('/api/admin/certificates/events', (req, res) => {
    requireAdmin(req);
    json(res, 200, { events: q(`SELECT e.id, e.title, e.starts_at AS startsAt FROM events e WHERE EXISTS (SELECT 1 FROM event_regs r WHERE r.event_id = e.id AND r.attended_sec > 0)
                                ORDER BY e.starts_at DESC LIMIT 500`).all() });
  });

  // ---------- Masukan dari pengguna login (teks) ----------
  r.post('/api/feedback', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    if (limiters.feedback.take('u:' + u.id)) throw new HttpError(429, 'Terlalu sering mengirim masukan. Coba lagi beberapa menit lagi.');
    const text = cleanMultiline((await readJson(req)).text, 2000);
    if (text.length < 5) throw new HttpError(400, 'Masukan minimal 5 karakter.');
    q("INSERT INTO feedback (source, user_id, name, email, text, created_at) VALUES ('user', ?, ?, ?, ?, ?)").run(u.id, u.name, u.email, text, now());
    json(res, 201, { ok: true });
  });
  r.get('/api/my/feedback', (req, res) => {
    const u = requireUser(req);
    json(res, 200, { feedback: q("SELECT * FROM feedback WHERE user_id = ? AND source = 'user' ORDER BY created_at DESC LIMIT 20").all(u.id).map(fbView) });
  });

  // ---------- Rating & masukan di akhir percakapan chatbot (boleh tamu) ----------
  r.post('/api/chatbot/feedback', async (req, res) => {
    if (limiters.feedback.take('ip:' + clientIp(req))) throw new HttpError(429, 'Terlalu sering mengirim penilaian. Coba lagi nanti.');
    const b = await readJson(req, 64 * 1024);
    const rating = parseInt(b.rating, 10);
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Pilih rating 1 sampai 5 bintang.');
    const u = currentUser(req);
    const chat = Array.isArray(b.chat) ? b.chat.slice(-40).map(m => ({ r: m?.r === 'u' ? 'u' : 'b', t: clean(m?.t, 600) })).filter(m => m.t) : [];
    q("INSERT INTO feedback (source, user_id, name, email, rating, text, chat, lang, created_at) VALUES ('chatbot', ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(u?.id || null, u?.name || clean(b.name, 80), u?.email || '', rating, cleanMultiline(b.text, 2000), chat.length ? JSON.stringify(chat) : null, b.lang === 'en' ? 'en' : 'id', now());
    json(res, 201, { ok: true });
  });

  // ---------- Admin: menu Masukan ----------
  r.get('/api/admin/feedback', (req, res) => {
    requireAdmin(req);
    const p = paging(req);
    const conds = []; const args = [];
    const src = p.sp.get('source'); if (src === 'chatbot' || src === 'user') { conds.push('source = ?'); args.push(src); }
    const rt = parseInt(p.sp.get('rating'), 10); if (rt >= 1 && rt <= 5) { conds.push('rating = ?'); args.push(rt); }
    if (p.sp.get('unread') === '1') conds.push('read_at IS NULL');
    if (p.term) { conds.push('(text LIKE ? OR name LIKE ? OR email LIKE ?)'); args.push(like(p.term), like(p.term), like(p.term)); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = q(`SELECT COUNT(*) AS n FROM feedback ${where}`).get(...args).n;
    const rows = q(`SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, p.per, p.offset).map(fbView);
    const dist = [1, 2, 3, 4, 5].map(k => q("SELECT COUNT(*) AS n FROM feedback WHERE source = 'chatbot' AND rating = ?").get(k).n);
    const rated = dist.reduce((a, b) => a + b, 0);
    json(res, 200, {
      ...paged(rows, total, p),
      summary: {
        chatbot: q("SELECT COUNT(*) AS n FROM feedback WHERE source = 'chatbot'").get().n,
        user: q("SELECT COUNT(*) AS n FROM feedback WHERE source = 'user'").get().n,
        unread: q('SELECT COUNT(*) AS n FROM feedback WHERE read_at IS NULL').get().n,
        avg: rated ? Math.round((dist.reduce((a, n, i) => a + n * (i + 1), 0) / rated) * 10) / 10 : null,
        dist,
      },
    });
  });
  r.get('/api/admin/feedback/:id', (req, res, { id }) => {
    requireAdmin(req);
    const row = q('SELECT * FROM feedback WHERE id = ?').get(parseInt(id, 10));
    if (!row) throw new HttpError(404, 'Masukan tidak ditemukan.');
    if (!row.read_at) q('UPDATE feedback SET read_at = ? WHERE id = ?').run(now(), row.id);
    let chat = []; try { chat = row.chat ? JSON.parse(row.chat) : []; } catch { /* abaikan */ }
    json(res, 200, { feedback: { ...fbView(row), read: true, chat } });
  });
  r.patch('/api/admin/feedback/:id', async (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const b = await readJson(req);
    q('UPDATE feedback SET read_at = ? WHERE id = ?').run(b.read ? now() : null, parseInt(id, 10));
    json(res, 200, { ok: true });
  });
  r.post('/api/admin/feedback-read-all', (req, res) => {
    requireAdmin(req); requireCsrf(req);
    q('UPDATE feedback SET read_at = ? WHERE read_at IS NULL').run(now());
    json(res, 200, { ok: true });
  });
  r.delete('/api/admin/feedback/:id', (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    q('DELETE FROM feedback WHERE id = ?').run(parseInt(id, 10));
    json(res, 200, { ok: true });
  });
}
