// Rating & komentar event (web dan aplikasi). Tidak wajib: peserta yang hadir bisa memberi bintang 1–5,
// komentar, dan (opsional) bintang untuk tiap narasumber setelah meeting selesai (event berakhir atau peserta
// sudah keluar dari meeting). Penyelenggara melihat ulasan eventnya; admin mendapat dashboard per kategori
// dan per narasumber.
import { config } from './config.js';
import { q, now, tx } from './db.js';
import { HttpError, json, readJson } from './http.js';
import { currentUser, requireUser, requireAdmin, requireCsrf, tzOffsetStr } from './auth.js';
import { clean, cleanMultiline } from './security.js';
import { paging, paged, like } from './paging.js';
import { eventSpeakers } from './poster.js';

const WINDOW_DAYS = 30;
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
/** "Rina Kartika Sari" → "Rina K." (nama di ulasan publik) */
const masked = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Peserta'; };

/** Bolehkah pengguna memberi rating? { ok, reason, message } */
export function canRate(e, u) {
  if (!u) return { ok: false, reason: 'login', message: 'Masuk dulu untuk memberi rating.' };
  if (u.id === e.owner_id) return { ok: false, reason: 'owner', message: 'Penyelenggara tidak memberi rating untuk event sendiri.' };
  const reg = q('SELECT first_join, last_leave, attended_sec FROM event_regs WHERE event_id = ? AND user_id = ?').get(e.id, u.id);
  if (!reg) return { ok: false, reason: 'not_attended', message: 'Rating bisa diberikan oleh peserta yang mengikuti event ini.' };
  const t = now();
  const done = t >= e.ends_at || (!!reg.last_leave && reg.last_leave >= e.starts_at - 1800);
  if (!done) return { ok: false, reason: 'not_finished', message: 'Rating bisa diberikan setelah meeting selesai atau setelah Anda keluar dari meeting.' };
  if (t > e.ends_at + WINDOW_DAYS * 86400) return { ok: false, reason: 'closed', message: `Rating ditutup ${WINDOW_DAYS} hari setelah event.` };
  return { ok: true, reason: '', message: '' };
}

function summary(eventId) {
  const s = q('SELECT AVG(rating) AS a, COUNT(*) AS n FROM event_ratings WHERE event_id = ?').get(eventId);
  const dist = [0, 0, 0, 0, 0];
  for (const r of q('SELECT rating, COUNT(*) AS n FROM event_ratings WHERE event_id = ? GROUP BY rating').all(eventId)) dist[r.rating - 1] = r.n;
  const sp = q('SELECT speaker, AVG(rating) AS a, COUNT(*) AS n FROM event_speaker_ratings WHERE event_id = ? GROUP BY speaker').all(eventId).map(x => ({ name: x.speaker, avg: r1(x.a), count: x.n }));
  return { avg: r1(s.a), count: s.n, dist, speakers: sp };
}
export const ratingBrief = (eventId) => { const s = q('SELECT AVG(rating) AS a, COUNT(*) AS n FROM event_ratings WHERE event_id = ?').get(eventId); return { avg: r1(s.a), count: s.n }; };

export function registerRatingRoutes(r) {
  const getEvent = (id) => {
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    return e;
  };

  // Ringkasan publik + status/isi rating milik pengguna
  r.get('/api/events/:id/rating', (req, res, { id }) => {
    const e = getEvent(id);
    const u = currentUser(req);
    if (!e.published && !(u && (u.id === e.owner_id || u.role === 'admin'))) throw new HttpError(404, 'Event tidak ditemukan.');
    const mine = u ? q('SELECT rating, comment, updated_at FROM event_ratings WHERE event_id = ? AND user_id = ?').get(e.id, u.id) : null;
    const mySp = u ? Object.fromEntries(q('SELECT speaker, rating FROM event_speaker_ratings WHERE event_id = ? AND user_id = ?').all(e.id, u.id).map(x => [x.speaker, x.rating])) : {};
    const recent = q(`SELECT r.rating, r.comment, r.updated_at, u.name FROM event_ratings r JOIN users u ON u.id = r.user_id
                      WHERE r.event_id = ? AND r.comment <> '' ORDER BY r.updated_at DESC LIMIT 6`).all(e.id)
      .map(x => ({ name: masked(x.name), rating: x.rating, comment: x.comment, at: x.updated_at }));
    json(res, 200, {
      summary: summary(e.id), recent, can: canRate(e, u), speakers: eventSpeakers(e),
      mine: mine ? { rating: mine.rating, comment: mine.comment, at: mine.updated_at, speakers: mySp } : null,
    });
  });

  r.post('/api/events/:id/rating', async (req, res, { id }) => {
    const u = requireUser(req); requireCsrf(req);
    const e = getEvent(id);
    const can = canRate(e, u);
    if (!can.ok) throw new HttpError(403, can.message);
    const b = await readJson(req, 16 * 1024);
    const rating = parseInt(b.rating, 10);
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Pilih bintang 1–5.');
    const comment = cleanMultiline(b.comment, 1500);
    const speakers = new Set(eventSpeakers(e));
    const sp = Object.entries(b.speakers && typeof b.speakers === 'object' ? b.speakers : {})
      .map(([k, v]) => [clean(k, 90), parseInt(v, 10)]).filter(([k, v]) => speakers.has(k) && v >= 1 && v <= 5).slice(0, 10);
    const t = now();
    tx(() => {
      q(`INSERT INTO event_ratings (event_id, user_id, rating, comment, created_at, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at`)
        .run(e.id, u.id, rating, comment, t, t);
      q('DELETE FROM event_speaker_ratings WHERE event_id = ? AND user_id = ?').run(e.id, u.id);
      for (const [k, v] of sp) q('INSERT INTO event_speaker_ratings (event_id, user_id, speaker, rating) VALUES (?,?,?,?)').run(e.id, u.id, k, v);
    });
    json(res, 200, { ok: true, summary: summary(e.id) });
  });

  r.delete('/api/events/:id/rating', (req, res, { id }) => {
    const u = requireUser(req); requireCsrf(req);
    const e = getEvent(id);
    tx(() => { q('DELETE FROM event_ratings WHERE event_id = ? AND user_id = ?').run(e.id, u.id); q('DELETE FROM event_speaker_ratings WHERE event_id = ? AND user_id = ?').run(e.id, u.id); });
    json(res, 200, { ok: true, summary: summary(e.id) });
  });

  // Semua ulasan satu event (penyelenggara & admin)
  r.get('/api/events/:id/ratings', (req, res, { id }) => {
    const u = requireUser(req);
    const e = getEvent(id);
    if (e.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Hanya penyelenggara event atau admin.');
    const rows = q(`SELECT r.rating, r.comment, r.updated_at, u.name, u.email,
                      (SELECT json_group_object(speaker, rating) FROM event_speaker_ratings s WHERE s.event_id = r.event_id AND s.user_id = r.user_id) AS sp
                    FROM event_ratings r JOIN users u ON u.id = r.user_id WHERE r.event_id = ? ORDER BY r.updated_at DESC`).all(e.id)
      .map(x => ({ name: x.name, email: x.email, rating: x.rating, comment: x.comment, at: x.updated_at, speakers: x.sp ? JSON.parse(x.sp) : {} }));
    const attended = q('SELECT COUNT(*) AS n FROM event_regs WHERE event_id = ?').get(e.id).n;
    json(res, 200, { event: { id: e.id, title: e.title }, summary: summary(e.id), attended, ratings: rows });
  });

  // Event yang sudah diikuti & selesai tetapi belum dirating (ajakan di dasbor/aplikasi)
  r.get('/api/my/pending-ratings', (req, res) => {
    const u = requireUser(req);
    const t = now();
    const rows = q(`SELECT e.* FROM event_regs g JOIN events e ON e.id = g.event_id
                    WHERE g.user_id = ? AND e.owner_id <> ? AND e.ends_at + ? > ?
                      AND (e.ends_at <= ? OR (g.last_leave IS NOT NULL AND g.last_leave >= e.starts_at - 1800))
                      AND NOT EXISTS (SELECT 1 FROM event_ratings r WHERE r.event_id = e.id AND r.user_id = g.user_id)
                    ORDER BY e.ends_at DESC LIMIT 5`).all(u.id, u.id, 14 * 86400, t, t);
    json(res, 200, { events: rows.map(e => ({ id: e.id, slug: e.slug, title: e.title, roomId: e.room_id, endsAt: e.ends_at })) });
  });

  // ---------- Dashboard admin ----------
  const filters = (sp) => {
    const conds = ['1 = 1']; const args = [];
    const period = parseInt(sp.get('period'), 10);
    if (period > 0) { conds.push('r.updated_at >= ?'); args.push(now() - period * 86400); }
    const cat = clean(sp.get('category'), 60);
    if (cat) { conds.push('e.category = ?'); args.push(cat); }
    return { where: conds.join(' AND '), args, cat, period: period > 0 ? period : 0 };
  };

  r.get('/api/admin/ratings/stats', (req, res) => {
    requireAdmin(req);
    const sp = new URL(req.url, 'http://x').searchParams;
    const f = filters(sp);
    const base = `FROM event_ratings r JOIN events e ON e.id = r.event_id WHERE ${f.where}`;
    const k = q(`SELECT COUNT(*) AS n, AVG(r.rating) AS a, COUNT(DISTINCT r.event_id) AS ev, SUM(r.rating >= 4) AS hi, SUM(r.comment <> '') AS cm ${base}`).get(...f.args);
    const dist = [0, 0, 0, 0, 0];
    for (const x of q(`SELECT r.rating, COUNT(*) AS n ${base} GROUP BY r.rating`).all(...f.args)) dist[x.rating - 1] = x.n;
    const byCategory = q(`SELECT e.category, AVG(r.rating) AS a, COUNT(*) AS n, COUNT(DISTINCT r.event_id) AS ev ${base} GROUP BY e.category ORDER BY a DESC, n DESC`).all(...f.args)
      .map(x => ({ category: x.category, avg: r1(x.a), count: x.n, events: x.ev }));

    // Per narasumber: bintang khusus narasumber bila diisi; bila tidak, rating event dihitung untuk narasumber event itu
    const rows = q(`SELECT r.event_id, r.user_id, r.rating, e.speaker, e.id AS eid ${base}`).all(...f.args);
    const spMap = new Map();
    const speakersOf = new Map();
    const explicit = new Map();
    for (const x of q(`SELECT s.event_id, s.user_id, s.speaker, s.rating FROM event_speaker_ratings s JOIN event_ratings r ON r.event_id = s.event_id AND r.user_id = s.user_id
                       JOIN events e ON e.id = s.event_id WHERE ${f.where}`).all(...f.args)) explicit.set(`${x.event_id}:${x.user_id}:${x.speaker}`, x.rating);
    for (const x of rows) {
      if (!speakersOf.has(x.event_id)) speakersOf.set(x.event_id, eventSpeakers({ id: x.event_id, speaker: x.speaker }));
      for (const name of speakersOf.get(x.event_id)) {
        const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
        const ex = explicit.get(`${x.event_id}:${x.user_id}:${name}`);
        const m = spMap.get(key) || { name, sum: 0, count: 0, events: new Set(), explicit: 0 };
        m.sum += ex ?? x.rating; m.count++; m.events.add(x.event_id); if (ex) m.explicit++;
        spMap.set(key, m);
      }
    }
    const bySpeaker = [...spMap.values()].map(m => ({ name: m.name, avg: r1(m.sum / m.count), count: m.count, events: m.events.size, explicit: m.explicit }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count).slice(0, 30);

    // Tren bulanan (zona waktu kampus)
    const off = tzOffsetStr();
    const sec = (parseInt(off, 10) * 3600) + (off[0] === '-' ? -1 : 1) * (parseInt(off.slice(4), 10) || 0) * 60;
    const trend = q(`SELECT strftime('%Y-%m', r.updated_at + ?, 'unixepoch') AS m, AVG(r.rating) AS a, COUNT(*) AS n ${base} GROUP BY m ORDER BY m DESC LIMIT 12`).all(sec, ...f.args)
      .reverse().map(x => ({ month: x.m, avg: r1(x.a), count: x.n }));
    const ev = (order) => q(`SELECT e.id, e.slug, e.title, e.category, e.starts_at, AVG(r.rating) AS a, COUNT(*) AS n ${base} GROUP BY e.id HAVING n >= 1 ORDER BY ${order} LIMIT 8`).all(...f.args)
      .map(x => ({ id: x.id, slug: x.slug, title: x.title, category: x.category, startsAt: x.starts_at, avg: r1(x.a), count: x.n }));
    json(res, 200, {
      kpi: { count: k.n, avg: r1(k.a), events: k.ev, pctHigh: k.n ? Math.round((k.hi / k.n) * 100) : 0, comments: k.cm || 0 },
      dist, byCategory, bySpeaker, trend, top: ev('a DESC, n DESC'), low: ev('a ASC, n DESC'),
      categories: q('SELECT DISTINCT category FROM events ORDER BY category').all().map(x => x.category),
      timezone: config.timezone,
    });
  });

  r.get('/api/admin/ratings', (req, res) => {
    requireAdmin(req);
    const p = paging(req, { per: 15 });
    const f = filters(p.sp);
    const conds = [f.where]; const args = [...f.args];
    if (p.term) { conds.push('(e.title LIKE ? OR u.name LIKE ? OR r.comment LIKE ?)'); const l = like(p.term); args.push(l, l, l); }
    const stars = parseInt(p.sp.get('stars'), 10); if (stars >= 1 && stars <= 5) { conds.push('r.rating = ?'); args.push(stars); }
    if (p.sp.get('comment') === '1') conds.push("r.comment <> ''");
    const ev = parseInt(p.sp.get('event'), 10); if (ev > 0) { conds.push('e.id = ?'); args.push(ev); }
    const from = `FROM event_ratings r JOIN events e ON e.id = r.event_id JOIN users u ON u.id = r.user_id WHERE ${conds.join(' AND ')}`;
    const total = q(`SELECT COUNT(*) AS n ${from}`).get(...args).n;
    const rows = q(`SELECT r.rating, r.comment, r.updated_at, u.name, u.email, e.id AS eid, e.slug, e.title, e.category,
                      (SELECT json_group_object(speaker, rating) FROM event_speaker_ratings s WHERE s.event_id = r.event_id AND s.user_id = r.user_id) AS sp
                    ${from} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`).all(...args, p.per, p.offset)
      .map(x => ({ rating: x.rating, comment: x.comment, at: x.updated_at, name: x.name, email: x.email, event: { id: x.eid, slug: x.slug, title: x.title, category: x.category }, speakers: x.sp ? JSON.parse(x.sp) : {} }));
    json(res, 200, paged(rows, total, p));
  });
}
