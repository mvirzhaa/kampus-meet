import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError, json, readJson, setCookie, parseCookies, clientIp } from './http.js';
import { hashPassword, verifyPassword, dummyVerify, randomToken, sha256, safeEqual, limiters, clean, isEmail, passwordProblem } from './security.js';
import { userScope, createFlag } from './admin.js';
import { androidDownloadUrl } from './apk.js';

const COOKIE = config.isProd ? '__Host-km_sid' : 'km_sid';

export function getSession(req) {
  if (req._session !== undefined) return req._session;
  // Aplikasi mobile mengirim token sesi lewat header Authorization (tidak bergantung pada cookie jar Android
  // yang bisa hilang saat aplikasi ditutup paksa); browser memakai cookie httpOnly seperti biasa.
  const auth = String(req.headers.authorization || '');
  const tok = /^Bearer km_[\w-]{20,80}$/.test(auth) ? auth.slice(7) : parseCookies(req)[COOKIE];
  let s = null;
  if (tok && tok.length < 100) {
    // status = 'disabled' → sesi langsung tidak berlaku di semua perangkat
    s = q(`SELECT s.id, s.csrf, s.expires_at, s.days, u.id AS uid, u.email, u.name, u.role
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`).get(sha256(tok), now()) || null;
    if (s) logVisit(s.uid);
    // Perpanjang sesi (sliding) maksimal sekali per jam
    const life = (s?.days || config.sessionDays) * 86400;
    if (s && s.expires_at - now() < life - 3600) q('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now() + life, s.id);
  }
  req._session = s;
  return s;
}

export const currentUser = (req) => { const s = getSession(req); return s ? { id: s.uid, email: s.email, name: s.name, role: s.role } : null; };

export function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'Silakan login terlebih dahulu.');
  return u;
}

export function requireAdmin(req) {
  const u = requireUser(req);
  if (u.role !== 'admin') throw new HttpError(403, 'Khusus admin.');
  return u;
}

/** Super-admin dari .env: tidak bisa diturunkan atau dinonaktifkan oleh siapa pun. */
export const isSuperAdmin = (email) => !!config.adminEmail && String(email || '').toLowerCase() === config.adminEmail;

/** Wajib untuk semua aksi yang mengubah data oleh pengguna login. */
export function requireCsrf(req) {
  const s = getSession(req);
  if (!s || !safeEqual(req.headers['x-csrf-token'], s.csrf)) throw new HttpError(403, 'Token CSRF tidak valid. Muat ulang halaman.');
}

// ---------- Jejak akses (statistik "pengguna yang mengakses") ----------
// Login dicatat setiap kali; kunjungan dengan sesi yang masih aktif dicatat sekali per pengguna per hari.
const visited = new Set();
const dayKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
let visitDay = '';
function logVisit(uid) {
  const d = dayKey();
  if (d !== visitDay) { visitDay = d; visited.clear(); }
  if (visited.has(uid)) return;
  visited.add(uid);
  try {
    const from = Math.floor(new Date(d + 'T00:00:00' + tzOffsetStr()).getTime() / 1000);
    if (!q('SELECT 1 FROM access_log WHERE user_id = ? AND ts >= ? LIMIT 1').get(uid, from)) q("INSERT INTO access_log (user_id, kind, ts) VALUES (?, 'visit', ?)").run(uid, now());
  } catch { /* statistik bersifat tambahan */ }
}
/** Offset zona waktu aplikasi, mis. "+07:00". */
export function tzOffsetStr(at = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'longOffset' }).formatToParts(at).find(x => x.type === 'timeZoneName')?.value || 'GMT';
  const m = p.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

/** Permintaan dari aplikasi mobile UIKA Meet (header X-Client). */
export const isAppClient = (req) => String(req.headers['x-client'] || '').startsWith('uika-meet-app');

/**
 * Buat sesi baru. Browser: cookie httpOnly (SESSION_DAYS, diperpanjang otomatis saat dipakai).
 * Aplikasi mobile: token dikembalikan di respons untuk disimpan di penyimpanan aman perangkat (SESSION_DAYS_APP).
 */
export async function createSession(req, res, userId, { log = true } = {}) {
  if (log) try { q("INSERT INTO access_log (user_id, kind, ts) VALUES (?, 'login', ?)").run(userId, now()); visited.add(userId); } catch { /* abaikan */ }
  const app = isAppClient(req);
  const days = app ? config.sessionDaysApp : config.sessionDays;
  const token = (app ? 'km_' : '') + randomToken(32);
  const csrf = randomToken(24);
  q('INSERT INTO sessions (id, user_id, csrf, expires_at, created_at, ua, days) VALUES (?,?,?,?,?,?,?)')
    .run(sha256(token), userId, csrf, now() + days * 86400, now(), clean(req.headers['user-agent'], 200), app ? days : null);
  if (!app) setCookie(res, COOKIE, token, { maxAge: days * 86400 });
  return { csrf, token: app ? token : undefined };
}

function rate(limiter, key) {
  const wait = limiter.take(key);
  if (wait) throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.`, { retryAfter: wait });
}

export function registerAuthRoutes(r) {
  r.get('/api/me', (req, res) => {
    const s = getSession(req);
    // Browser: umur cookie ikut diperpanjang (sesi di server sudah diperpanjang di getSession)
    const ck = parseCookies(req)[COOKIE];
    if (s && !s.days && ck) setCookie(res, COOKIE, ck, { maxAge: config.sessionDays * 86400 });
    // Hak "boleh membuat" ikut dikirim agar tombol Buat Meeting/Event bisa disembunyikan,
    // bukan ditampilkan lalu ditolak server. Penegakan sebenarnya tetap di server.
    let can = null;
    if (s) {
      const scope = s.role === 'admin' ? 'staff' : userScope(s.uid);
      can = scope === 'staff'
        ? { meeting: true, event: true }
        : { meeting: createFlag(`allow_${scope}_meeting`), event: createFlag(`allow_${scope}_event`) };
    }
    json(res, 200, {
      user: s ? { id: s.uid, email: s.email, name: s.name, role: s.role, superAdmin: isSuperAdmin(s.email) } : null,
      can,
      csrf: s?.csrf || null,
      app: {
        name: config.appName, campus: config.campusName, allowRegistration: config.allowRegistration, domains: config.allowedEmailDomains,
        sso: config.sso.enabled,
        android: config.android.openApp ? { package: config.android.package, downloadUrl: androidDownloadUrl() } : null,
      },
    });
  });

  r.post('/api/auth/register', async (req, res) => {
    if (!config.allowRegistration) throw new HttpError(403, 'Pendaftaran ditutup. Hubungi admin.');
    rate(limiters.register, clientIp(req));
    const b = await readJson(req);
    const email = clean(b.email, 254).toLowerCase();
    const name = clean(b.name, 80);
    if (!isEmail(email)) throw new HttpError(400, 'Email tidak valid.');
    if (config.allowedEmailDomains.length && !config.allowedEmailDomains.some(d => email.endsWith('@' + d))) {
      throw new HttpError(400, `Gunakan email kampus (${config.allowedEmailDomains.map(d => '@' + d).join(', ')}).`);
    }
    if (name.length < 2) throw new HttpError(400, 'Nama minimal 2 karakter.');
    const prob = passwordProblem(b.password); if (prob) throw new HttpError(400, prob);
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email sudah terdaftar. Silakan login.');
    const first = !q('SELECT 1 FROM users LIMIT 1').get();
    const info = q('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run(email, name, await hashPassword(b.password), (first || isSuperAdmin(email)) ? 'admin' : 'user', now());
    const { csrf, token } = await createSession(req, res, Number(info.lastInsertRowid));
    json(res, 201, { ok: true, csrf, token });
  });

  r.post('/api/auth/login', async (req, res) => {
    const ip = clientIp(req);
    rate(limiters.login, ip);
    const b = await readJson(req);
    const email = clean(b.email, 254).toLowerCase();
    rate(limiters.login, 'e:' + email);
    const u = q('SELECT id, password_hash, locked_until, failed_logins, status FROM users WHERE email = ?').get(email);
    const fail = () => new HttpError(401, 'Email atau password salah.');
    if (!u) { await dummyVerify(b.password); throw fail(); }
    // Password tetap diverifikasi dulu agar pesan ini tidak membocorkan email mana yang terdaftar
    if (u.status !== 'active' && !(await verifyPassword(String(b.password || ''), u.password_hash))) throw fail();
    if (u.status !== 'active') throw new HttpError(403, 'Akun Anda dinonaktifkan oleh admin.');
    if (u.locked_until > now()) throw new HttpError(423, 'Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.');
    if (!(await verifyPassword(String(b.password || ''), u.password_hash))) {
      const f = u.failed_logins + 1;
      q('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(f >= 10 ? 0 : f, f >= 10 ? now() + 900 : 0, u.id);
      throw fail();
    }
    q('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(u.id);
    const { csrf, token } = await createSession(req, res, u.id);
    json(res, 200, { ok: true, csrf, token });
  });

  // Aplikasi versi lama login lewat cookie: tukar sesi cookie itu dengan token sesi aplikasi yang tahan lama,
  // sehingga pengguna yang sudah login tidak perlu login ulang setelah memperbarui aplikasi.
  r.post('/api/auth/app-token', async (req, res) => {
    const s = getSession(req);
    if (!s) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    requireCsrf(req);
    if (!isAppClient(req)) throw new HttpError(400, 'Khusus aplikasi mobile.');
    const out = await createSession(req, res, s.uid, { log: false });
    if (!s.days) q('DELETE FROM sessions WHERE id = ?').run(s.id);   // sesi cookie lama tidak diperlukan lagi
    json(res, 200, { ok: true, ...out });
  });

  r.post('/api/auth/logout', (req, res) => {
    const s = getSession(req);
    if (s) { requireCsrf(req); q('DELETE FROM sessions WHERE id = ?').run(s.id); }
    setCookie(res, COOKIE, '', { maxAge: 0 });
    json(res, 200, { ok: true });
  });

  r.post('/api/auth/password', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    const b = await readJson(req);
    const row = q('SELECT password_hash FROM users WHERE id = ?').get(u.id);
    if (!(await verifyPassword(String(b.current || ''), row.password_hash))) throw new HttpError(400, 'Password lama salah.');
    const prob = passwordProblem(b.password); if (prob) throw new HttpError(400, prob);
    q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.password), u.id);
    // Cabut semua sesi lain
    q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(u.id, getSession(req).id);
    json(res, 200, { ok: true });
  });

  r.patch('/api/me', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    const b = await readJson(req);
    const name = clean(b.name, 80);
    if (name.length < 2) throw new HttpError(400, 'Nama minimal 2 karakter.');
    q('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
    json(res, 200, { ok: true });
  });
}
