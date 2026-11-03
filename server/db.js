// SQLite bawaan Node (node:sqlite) — tanpa server database terpisah, tanpa modul native.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',       -- user | admin
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                     -- sha256(token); token asli hanya ada di cookie
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,                     -- kode room, mis. abc-defg-hij
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  welcome TEXT NOT NULL DEFAULT '',
  password_enc TEXT,                       -- terenkripsi AES-GCM; NULL = tanpa password
  attendee_key TEXT NOT NULL,
  moderator_key TEXT NOT NULL,
  allow_guests INTEGER NOT NULL DEFAULT 1,
  mute_on_join INTEGER NOT NULL DEFAULT 1,
  max_participants INTEGER NOT NULL DEFAULT 300,
  scheduled_at INTEGER,
  duration_min INTEGER,
  state TEXT NOT NULL DEFAULT '{}',        -- status live (lock, presenter, presentasi)
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  downloadable INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bans (
  room_id TEXT NOT NULL,
  ban_key TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (room_id, ban_key)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  speaker TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Seminar',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  quota INTEGER NOT NULL DEFAULT 0,        -- 0 = tanpa batas
  certificate INTEGER NOT NULL DEFAULT 1,
  min_attend_min INTEGER NOT NULL DEFAULT 30,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event_regs (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at INTEGER NOT NULL,
  attended_sec INTEGER NOT NULL DEFAULT 0,
  cert_code TEXT UNIQUE,
  UNIQUE (event_id, user_id)
);
-- Presensi: satu baris per kali masuk (interval). Laporan menggabungkan per orang:
-- masuk pertama, keluar terakhir, durasi = keluar terakhir − masuk pertama.
CREATE TABLE IF NOT EXISTS presence (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL,
  session INTEGER NOT NULL,                -- waktu mulai sesi meeting
  person TEXT NOT NULL,                    -- u:<id user> atau d:<id perangkat tamu>
  user_id INTEGER,
  identity TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_presence_room ON presence(room_id, session, person);
CREATE INDEX IF NOT EXISTS idx_presence_open ON presence(room_id, identity, left_at);
CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL,
  session INTEGER,
  egress_id TEXT UNIQUE,
  file_name TEXT NOT NULL,
  started_by TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_sec INTEGER,
  size INTEGER,
  status TEXT NOT NULL,                    -- recording | pending_upload | uploading | uploaded | failed
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try INTEGER NOT NULL DEFAULT 0,
  upload_session TEXT,
  drive_folder_id TEXT,
  drive_folder_link TEXT,
  drive_file_id TEXT,
  drive_file_link TEXT,
  seat_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_rec_room ON recordings(room_id, started_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY,                     -- sha256(token kursi); token asli hanya di browser peserta
  room_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  user_id INTEGER,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  ban_key TEXT NOT NULL,
  exp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seats_room ON seats(room_id, identity);
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  session INTEGER NOT NULL,                -- waktu mulai sesi meeting (mengelompokkan per pertemuan)
  identity TEXT NOT NULL,
  user_id INTEGER,
  name TEXT NOT NULL,                      -- nama dari kursi server, bukan dari klien
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tr_room ON transcripts(room_id, session, ts);
-- Logo sponsor event (ditampilkan di sertifikat & halaman event): kiri atas, kanan atas, kanan bawah
CREATE TABLE IF NOT EXISTS event_sponsors (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position TEXT NOT NULL,                  -- tl | tr | br
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sponsor_event ON event_sponsors(event_id, position, sort);
-- Kategori event, dikelola admin lewat panel (sebelumnya hardcode di kode).
-- events.category tetap menyimpan NAMA kategori supaya sertifikat lama tetap terbaca.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
-- Jejak akses untuk statistik: login (termasuk SSO) dan kunjungan harian pengguna yang sesinya masih aktif
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                      -- login | visit
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_ts ON access_log(ts);
CREATE INDEX IF NOT EXISTS idx_access_user ON access_log(user_id, ts);
-- Masukan: dari chatbot (rating 1–5 + teks, boleh tamu) dan dari pengguna login (teks)
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,                    -- chatbot | user
  user_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  rating INTEGER,                          -- 1..5 (chatbot), NULL untuk masukan teks
  text TEXT NOT NULL DEFAULT '',
  chat TEXT,                               -- ringkasan percakapan chatbot (JSON), opsional
  lang TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
-- Undangan event: daftar pengguna yang diundang penyelenggara (opsional: hanya mereka yang boleh bergabung)
CREATE TABLE IF NOT EXISTS event_invites (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_at INTEGER NOT NULL,
  invited_by INTEGER,
  notified_at INTEGER,                     -- email/push undangan terakhir dikirim
  reminded_at INTEGER,                     -- pengingat 30 menit sebelum mulai sudah dikirim
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_invites_user ON event_invites(user_id);
-- Token push (FCM) aplikasi Android per perangkat
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_tokens(user_id);
-- Antrean email keluar (dikirim berurutan, dicoba ulang bila gagal)
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY,
  to_addr TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  ics TEXT,
  kind TEXT NOT NULL DEFAULT '',           -- invite | reminder | test
  ref TEXT,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | sent | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status, next_try);
-- Rilis aplikasi Android (APK diunggah admin, diunduh dari halaman depan & dicek aplikasi untuk pembaruan)
CREATE TABLE IF NOT EXISTS app_releases (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,                    -- uploading | published | hidden
  version TEXT,                            -- versionName, mis. 1.2.0
  version_code INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  sha256 TEXT,
  package TEXT,
  min_sdk INTEGER,
  original_name TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_releases_status ON app_releases(status, version_code);
-- Sertifikat narasumber / pemateri / moderator event (diterbitkan penyelenggara, tidak bergantung kehadiran)
CREATE TABLE IF NOT EXISTS speaker_certs (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Narasumber',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- opsional: tampil di "Sertifikat saya" pengguna ini
  cert_code TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_speaker_event ON speaker_certs(event_id, sort);
CREATE INDEX IF NOT EXISTS idx_speaker_user ON speaker_certs(user_id);
-- Rating & komentar event dari peserta (opsional, setelah meeting selesai)
CREATE TABLE IF NOT EXISTS event_ratings (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,                 -- 1..5
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_time ON event_ratings(created_at);
-- Rating per narasumber (opsional, bagian dari formulir rating event)
CREATE TABLE IF NOT EXISTS event_speaker_ratings (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,                   -- nama narasumber seperti tertulis
  rating INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id, speaker)
);
`);

// Migrasi kolom (aman dijalankan berulang)
for (const sql of [
  'ALTER TABLE event_regs ADD COLUMN first_join INTEGER',
  'ALTER TABLE event_regs ADD COLUMN last_leave INTEGER',
  // active = bisa login; disabled = diblokir admin (sesi aktifnya ikut dicabut)
  "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
  // SSO E-Portal. sso_id = UUID stabil dari eportal (email & nama bisa berubah, ini tidak).
  // institutional_role menentukan gerbang "boleh membuat" (lihat server/admin.js).
  'ALTER TABLE users ADD COLUMN sso_id TEXT',
  'ALTER TABLE users ADD COLUMN institutional_role TEXT',
  'ALTER TABLE users ADD COLUMN sso_linked_at INTEGER',
  // Password event opsional (terenkripsi), penanda tangan sertifikat, dan sponsor
  'ALTER TABLE events ADD COLUMN password_enc TEXT',
  "ALTER TABLE events ADD COLUMN signer_name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE events ADD COLUMN signer_title TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE events ADD COLUMN sponsors_enabled INTEGER NOT NULL DEFAULT 0',
  // Transkrip: id kalimat di klien (identity + cid unik per sesi) dan terjemahannya (untuk rekaman & ekspor)
  'ALTER TABLE transcripts ADD COLUMN cid TEXT',
  'ALTER TABLE transcripts ADD COLUMN tr_lang TEXT',
  'ALTER TABLE transcripts ADD COLUMN tr_text TEXT',
  // Desain sertifikat per event: template + posisi/ukuran/warna tiap elemen (JSON) dan latar gambar opsional
  "ALTER TABLE events ADD COLUMN cert_design TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE events ADD COLUMN cert_bg_mime TEXT',
  'ALTER TABLE events ADD COLUMN cert_bg_ver INTEGER NOT NULL DEFAULT 0',
  // Breakout room: lokasi kursi saat ini (0 = ruang utama) dan asal kalimat transkrip
  'ALTER TABLE seats ADD COLUMN bo INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE transcripts ADD COLUMN bo INTEGER NOT NULL DEFAULT 0',
  // Undangan: hanya peserta yang diundang yang boleh bergabung; pengingat untuk penyelenggara
  'ALTER TABLE events ADD COLUMN invite_only INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE events ADD COLUMN reminded_at INTEGER',
  // Lama sesi (hari) per sesi: sesi aplikasi mobile jauh lebih panjang dari sesi browser
  'ALTER TABLE sessions ADD COLUMN days INTEGER',
  // Kalimat sertifikat narasumber yang bisa diubah penyelenggara (kosong = bawaan)
  "ALTER TABLE events ADD COLUMN speaker_text TEXT NOT NULL DEFAULT ''",
  // Rancangan poster event (JSON) + versi gambar poster yang sudah dirender
  "ALTER TABLE events ADD COLUMN poster TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE events ADD COLUMN poster_ver INTEGER',
]) { try { db.exec(sql); } catch { /* sudah ada */ } }
db.exec('CREATE INDEX IF NOT EXISTS idx_tr_cid ON transcripts(room_id, identity, cid)');

// Waktu pembuatan room/event dipakai statistik (sudah ada sejak awal); indeks agar rentang waktu cepat
for (const sql of ['CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)', 'CREATE INDEX IF NOT EXISTS idx_rooms_created ON rooms(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_presence_joined ON presence(joined_at)']) { try { db.exec(sql); } catch { /* abaikan */ } }

// Satu identitas SSO hanya boleh menempel ke satu akun lokal
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sso ON users(sso_id) WHERE sso_id IS NOT NULL'); } catch { /* sudah ada */ }

const cache = new Map();
/** Prepared statement yang di-cache. */
export const q = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
export const now = () => Math.floor(Date.now() / 1000);

export const getSetting = (key) => q('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
export const setSetting = (key, value) => value == null
  ? q('DELETE FROM settings WHERE key = ?').run(key)
  : q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

// Isi kategori bawaan sekali saja, sekaligus menyerap kategori yang sudah terpakai
// oleh event lama agar tidak ada event yang kategorinya hilang setelah pembaruan.
if (!q('SELECT 1 FROM categories LIMIT 1').get()) {
  const seed = ['Seminar', 'Kuliah Umum', 'Workshop', 'Webinar', 'Pelatihan', 'Rapat', 'Lainnya'];
  for (const r of q('SELECT DISTINCT category FROM events').all()) {
    if (r.category && !seed.some(c => c.toLowerCase() === r.category.toLowerCase())) seed.push(r.category);
  }
  const ins = q('INSERT OR IGNORE INTO categories (name, sort, active, created_at) VALUES (?,?,1,?)');
  seed.forEach((name, i) => ins.run(name, i * 10, Math.floor(Date.now() / 1000)));
}

// Super-admin dari .env: paksa perannya setiap kali server start, agar akses tidak
// bisa hilang karena salah klik di panel atau perubahan langsung di database.
if (config.adminEmail) {
  q("UPDATE users SET role = 'admin', status = 'active' WHERE email = ?").run(config.adminEmail);
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Pembersihan berkala (ringan): sesi kedaluwarsa & ban lama
setInterval(() => {
  const t = now();
  q('DELETE FROM sessions WHERE expires_at < ?').run(t);
  q('DELETE FROM bans WHERE until < ?').run(t);
  q('DELETE FROM seats WHERE exp < ?').run(t);
  if (config.transcriptRetentionDays > 0) q('DELETE FROM transcripts WHERE ts < ?').run(t - config.transcriptRetentionDays * 86400);
}, 60 * 60 * 1000).unref();
