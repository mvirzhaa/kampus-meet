// Sertifikat narasumber / pemateri / moderator event. Diterbitkan penyelenggara (atau admin), tidak bergantung
// pada durasi kehadiran, memakai desain sertifikat event yang sama dengan kalimat khusus narasumber, dan
// terverifikasi lewat kode + QR seperti sertifikat peserta. Juga: cetak massal & "Sertifikat saya".
import { q, now, tx } from './db.js';
import { HttpError, json, readJson } from './http.js';
import { requireUser, requireCsrf } from './auth.js';
import { clean } from './security.js';
import { certCode, certPayload } from './events.js';

export const SPEAKER_ROLES = ['Narasumber', 'Pemateri', 'Keynote Speaker', 'Moderator', 'Pembicara', 'Panelis', 'Fasilitator', 'Host / MC'];
const view = (s) => ({ id: s.id, name: s.name, role: s.role, code: s.cert_code, userId: s.user_id, email: s.email || null, createdAt: s.created_at });
const list = (eventId) => q(`SELECT s.*, u.email FROM speaker_certs s LEFT JOIN users u ON u.id = s.user_id WHERE s.event_id = ? ORDER BY s.sort, s.id`).all(eventId);

export function registerSpeakerRoutes(r) {
  const managed = (req, id) => {
    const u = requireUser(req);
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    if (e.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Hanya penyelenggara event atau admin yang dapat mengelola sertifikat narasumber.');
    return { u, e };
  };
  const out = (e) => ({ speakers: list(e.id).map(view), speakerText: e.speaker_text || '', roles: SPEAKER_ROLES, eventSpeaker: e.speaker || '' });

  r.get('/api/events/:id/speaker-certs', (req, res, { id }) => {
    const { e } = managed(req, id);
    json(res, 200, out(e));
  });

  // Tambah satu atau beberapa narasumber sekaligus: { items: [{ name, role, userId? }] }
  r.post('/api/events/:id/speaker-certs', async (req, res, { id }) => {
    const { u, e } = managed(req, id); requireCsrf(req);
    const b = await readJson(req, 32 * 1024);
    const items = (Array.isArray(b.items) ? b.items : [b]).slice(0, 50);
    if (q('SELECT COUNT(*) AS n FROM speaker_certs WHERE event_id = ?').get(e.id).n + items.length > 100) throw new HttpError(400, 'Maksimal 100 sertifikat narasumber per event.');
    const rows = items.map((it) => {
      const name = clean(it?.name, 120);
      if (name.length < 2) throw new HttpError(400, 'Nama narasumber minimal 2 karakter.');
      const role = clean(it?.role, 40) || 'Narasumber';
      const uid = parseInt(it?.userId, 10);
      const userId = uid > 0 && q("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(uid) ? uid : null;
      return { name, role, userId };
    });
    tx(() => {
      let sort = (q('SELECT MAX(sort) AS m FROM speaker_certs WHERE event_id = ?').get(e.id).m ?? 0);
      for (const it of rows) {
        let code; do { code = certCode(); } while (q('SELECT 1 FROM speaker_certs WHERE cert_code = ?').get(code) || q('SELECT 1 FROM event_regs WHERE cert_code = ?').get(code));
        q('INSERT INTO speaker_certs (event_id, name, role, user_id, cert_code, sort, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(e.id, it.name, it.role, it.userId, code, sort += 10, u.id, now());
      }
    });
    json(res, 201, out(e));
  });

  r.patch('/api/events/:id/speaker-certs/:sid', async (req, res, { id, sid }) => {
    const { e } = managed(req, id); requireCsrf(req);
    const s = q('SELECT * FROM speaker_certs WHERE id = ? AND event_id = ?').get(parseInt(sid, 10), e.id);
    if (!s) throw new HttpError(404, 'Data narasumber tidak ditemukan.');
    const b = await readJson(req);
    if (b.name !== undefined) { const n = clean(b.name, 120); if (n.length < 2) throw new HttpError(400, 'Nama minimal 2 karakter.'); q('UPDATE speaker_certs SET name = ? WHERE id = ?').run(n, s.id); }
    if (b.role !== undefined) q('UPDATE speaker_certs SET role = ? WHERE id = ?').run(clean(b.role, 40) || 'Narasumber', s.id);
    if (b.userId !== undefined) { const uid = parseInt(b.userId, 10); q('UPDATE speaker_certs SET user_id = ? WHERE id = ?').run(uid > 0 && q('SELECT 1 FROM users WHERE id = ?').get(uid) ? uid : null, s.id); }
    json(res, 200, out(e));
  });

  r.delete('/api/events/:id/speaker-certs/:sid', (req, res, { id, sid }) => {
    const { e } = managed(req, id); requireCsrf(req);
    q('DELETE FROM speaker_certs WHERE id = ? AND event_id = ?').run(parseInt(sid, 10), e.id);
    json(res, 200, out(e));
  });

  // Kalimat sertifikat narasumber, mis. "atas kontribusinya sebagai {peran} dalam {kategori}"
  r.patch('/api/events/:id/speaker-text', async (req, res, { id }) => {
    const { e } = managed(req, id); requireCsrf(req);
    const b = await readJson(req);
    q('UPDATE events SET speaker_text = ? WHERE id = ?').run(clean(b.text, 220), e.id);
    json(res, 200, out(q('SELECT * FROM events WHERE id = ?').get(e.id)));
  });

  // Cari pengguna terdaftar untuk ditautkan (agar sertifikat muncul di akun narasumber)
  r.get('/api/events/:id/speaker-candidates', (req, res, { id }) => {
    managed(req, id);
    const term = clean(new URL(req.url, 'http://x').searchParams.get('q'), 80).replace(/[%_]/g, '');
    if (term.length < 2) return json(res, 200, { users: [] });
    const l = `%${term}%`;
    json(res, 200, { users: q("SELECT id, name, email FROM users WHERE status = 'active' AND (name LIKE ? OR email LIKE ?) ORDER BY name COLLATE NOCASE LIMIT 10").all(l, l) });
  });

  // Data cetak massal: ?kind=speaker (bawaan) | participant
  r.get('/api/events/:id/cert-batch', (req, res, { id }) => {
    const { e } = managed(req, id);
    const kind = new URL(req.url, 'http://x').searchParams.get('kind') === 'participant' ? 'participant' : 'speaker';
    const certs = kind === 'speaker'
      ? list(e.id).map(s => certPayload(e, { code: s.cert_code, name: s.name, role: s.role }))
      : q(`SELECT r.cert_code, r.attended_sec, r.first_join, r.last_leave, u.name FROM event_regs r JOIN users u ON u.id = r.user_id
           WHERE r.event_id = ? AND r.cert_code IS NOT NULL ORDER BY u.name COLLATE NOCASE`).all(e.id)
          .map(x => certPayload(e, { code: x.cert_code, name: x.name, attendedSec: x.attended_sec, firstJoin: x.first_join, lastLeave: x.last_leave }));
    json(res, 200, { event: { id: e.id, title: e.title }, kind, certificates: certs });
  });

  // Semua sertifikat milik pengguna login: sebagai peserta + sebagai narasumber (web & aplikasi)
  r.get('/api/my/certificates', (req, res) => {
    const u = requireUser(req);
    const part = q(`SELECT e.id, e.slug, e.title, e.category, e.starts_at, r.cert_code, r.attended_sec FROM event_regs r JOIN events e ON e.id = r.event_id
                    WHERE r.user_id = ? AND r.cert_code IS NOT NULL ORDER BY e.starts_at DESC LIMIT 200`).all(u.id)
      .map(x => ({ code: x.cert_code, eventId: x.id, slug: x.slug, title: x.title, category: x.category, startsAt: x.starts_at, kind: 'participant', role: 'Peserta', attendedMin: Math.floor(x.attended_sec / 60) }));
    const sp = q(`SELECT e.id, e.slug, e.title, e.category, e.starts_at, s.cert_code, s.role FROM speaker_certs s JOIN events e ON e.id = s.event_id
                  WHERE s.user_id = ? ORDER BY e.starts_at DESC LIMIT 200`).all(u.id)
      .map(x => ({ code: x.cert_code, eventId: x.id, slug: x.slug, title: x.title, category: x.category, startsAt: x.starts_at, kind: 'speaker', role: x.role, attendedMin: null }));
    json(res, 200, { certificates: [...sp, ...part].sort((a, b) => b.startsAt - a.startsAt) });
  });
}
