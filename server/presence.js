// Presensi otomatis: mencatat setiap kali peserta masuk & keluar (interval).
// Laporan per orang per sesi: masuk pertama, keluar terakhir, durasi (= keluar terakhir − masuk pertama),
// waktu aktif (jumlah interval), dan berapa kali masuk.
import { q, now } from './db.js';
import { recomputeEventAttendance } from './events.js';

export const isOnline = (roomId, identity) => !!identity && !!q('SELECT 1 FROM presence WHERE room_id = ? AND identity = ? AND left_at IS NULL').get(roomId, identity);
export const anyOnline = (roomId) => !!q('SELECT 1 FROM presence WHERE room_id = ? AND left_at IS NULL LIMIT 1').get(roomId);

/** Catat masuk (tidak menggandakan bila interval untuk identity ini masih terbuka). */
export function openPresence({ roomId, session, identity, person, userId, name, role, t = now() }) {
  if (isOnline(roomId, identity)) return;
  q('INSERT INTO presence (room_id, session, person, user_id, identity, name, role, joined_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(roomId, session || t, person, userId || null, identity, name, role, t);
}

/** Catat keluar. */
export function closePresence(roomId, identity, t = now()) {
  const row = q('SELECT * FROM presence WHERE room_id = ? AND identity = ? AND left_at IS NULL').get(roomId, identity);
  if (!row) return;
  q('UPDATE presence SET left_at = ? WHERE id = ?').run(Math.max(t, row.joined_at), row.id);
  if (row.user_id) recomputeEventAttendance(roomId, row.user_id);
}

export function closeAllPresence(roomId, t = now()) {
  for (const r of q('SELECT identity FROM presence WHERE room_id = ? AND left_at IS NULL').all(roomId)) closePresence(roomId, r.identity, t);
}

export function presenceSessions(roomId) {
  return q(`SELECT session, COUNT(DISTINCT person) AS people, MIN(joined_at) AS first, MAX(COALESCE(left_at, ?)) AS last
            FROM presence WHERE room_id = ? GROUP BY session ORDER BY session DESC LIMIT 200`).all(now(), roomId);
}

export function presenceReport(roomId, session) {
  const t = now();
  return q(`SELECT person, MAX(user_id) AS user_id,
              (SELECT name FROM presence p2 WHERE p2.room_id = p.room_id AND p2.session = p.session AND p2.person = p.person ORDER BY joined_at DESC LIMIT 1) AS name,
              MAX(role = 'moderator') AS moderator,
              MIN(joined_at) AS first_in,
              MAX(COALESCE(left_at, ?)) AS last_out,
              SUM(COALESCE(left_at, ?) - joined_at) AS active_sec,
              COUNT(*) AS entries,
              SUM(left_at IS NULL) AS online
            FROM presence p WHERE room_id = ? AND session = ?
            GROUP BY person ORDER BY first_in`).all(t, t, roomId, session)
    .map(r => ({ ...r, duration_sec: r.last_out - r.first_in, moderator: !!r.moderator, online: r.online > 0 }));
}
