// Login lewat SSO E-Portal UIKA.
//
// Alur (hanya eportal yang memulai — tidak ada tombol "login dengan eportal" dari sisi kita):
//   1. Pengguna klik modul "Meet" di dasbor eportal
//   2. Eportal menerbitkan token ber-scope berumur pendek lalu mengarahkan ke
//      /sso/callback?token=...&appModule_id=19&role_id=...
//   3. Kita tukar token itu lewat POST {SSO_BASE_URL}/api/sso/introspect
//   4. Identitas disinkronkan ke tabel users lokal, lalu sesi kita sendiri dibuat
//
// Token memakai HS256 dengan rahasia milik eportal. Memverifikasinya lokal berarti
// kita harus memegang rahasia itu — dan siapa pun yang memegangnya bisa menerbitkan
// token untuk pengguna mana pun di SELURUH aplikasi SSO. Karena itu selalu introspect.
import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError, json } from './http.js';
import { createSession } from './auth.js';
import { clean, isEmail } from './security.js';

const S = config.sso;

/** Akun yang hanya bisa masuk lewat SSO: hash sentinel yang tidak pernah cocok (verifyPassword menolak non-scrypt). */
const NO_LOCAL_PASSWORD = 'sso$tidak-ada-password-lokal';

/** HttpError yang membawa kode singkat, supaya callback bisa mengembalikannya lewat URL dengan aman. */
function ssoError(status, code, message) {
  const e = new HttpError(status, message);
  e.ssoCode = code;
  return e;
}

/** Tukar token SSO menjadi identitas. Melempar ssoError yang kodenya dipetakan di halaman login. */
async function introspect(token) {
  const url = `${S.baseUrl}/api/sso/introspect${S.moduleId ? `?appModule_id=${encodeURIComponent(S.moduleId)}` : ''}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-SSO-Client-ID': S.clientId,
        'X-SSO-Client-Secret': S.clientSecret,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    // Eportal tidak terjangkau — jangan membuat seluruh login kita ikut mati
    console.error('[sso] introspect tidak terjangkau:', e.message);
    throw ssoError(503, 'down', 'Layanan SSO E-Portal sedang tidak dapat dihubungi.');
  }

  let data = {};
  try { data = await res.json(); } catch { /* bukan JSON */ }

  // Kredensial client kita salah/dicabut: masalah konfigurasi, bukan kesalahan pengguna
  if (res.status === 401 && /client/i.test(String(data.message || ''))) {
    console.error('[sso] kredensial client ditolak eportal:', data.message);
    throw ssoError(503, 'config', 'Konfigurasi SSO aplikasi ini bermasalah.');
  }
  if (!data.valid) {
    const msg = String(data.message || '');
    if (/expired/i.test(msg)) throw ssoError(401, 'expired', 'Tautan masuk dari E-Portal sudah kedaluwarsa.');
    throw ssoError(401, 'invalid', 'Tautan masuk dari E-Portal tidak valid.');
  }
  if (!data.user?.sso_id) throw ssoError(502, 'invalid', 'E-Portal tidak mengirim identitas pengguna.');
  if (data.user.is_active === false) throw ssoError(403, 'inactive', 'Akun E-Portal Anda sedang nonaktif.');
  if (data.access && data.access.has_access === false) {
    throw ssoError(403, 'noaccess', 'Akun Anda belum diberi akses ke modul Meet di E-Portal.');
  }
  return data;
}

/**
 * Cocokkan identitas SSO dengan akun lokal, lalu kembalikan id akun.
 *
 * Urutan pencarian sengaja: sso_id dulu (stabil), baru email. Email bisa berubah di
 * eportal, sedangkan sso_id tidak — mencari lewat email lebih dulu akan membuat satu
 * orang punya dua akun ketika emailnya diganti.
 */
function syncUser(ssoUser) {
  const ssoId = clean(ssoUser.sso_id, 64);
  const email = clean(ssoUser.email, 254).toLowerCase();
  const name = clean(ssoUser.name, 80) || email.split('@')[0] || 'Pengguna';
  const role = clean(ssoUser.institutional_role, 32).toLowerCase() || 'user';
  const t = now();

  let row = q('SELECT * FROM users WHERE sso_id = ?').get(ssoId);
  let linkedNow = false;

  if (!row && isEmail(email)) {
    // Penautan otomatis ke akun lokal beremail sama. Password lokalnya SENGAJA dibiarkan
    // aktif (keputusan pemilik produk) — lihat catatan risiko di README.
    const byEmail = q('SELECT * FROM users WHERE email = ?').get(email);
    if (byEmail && !byEmail.sso_id) { row = byEmail; linkedNow = true; }
  }

  if (row) {
    q(`UPDATE users SET sso_id = ?, institutional_role = ?, name = ?, email = ?,
         sso_linked_at = COALESCE(sso_linked_at, ?), status = 'active' WHERE id = ?`)
      .run(ssoId, role, name, isEmail(email) ? email : row.email, t, row.id);
    if (linkedNow) console.log(`[sso] akun lokal ${row.email} ditautkan ke identitas E-Portal (password lokal tetap aktif)`);
    return row.id;
  }

  // Belum ada sama sekali: buat akun baru tanpa password lokal
  const info = q(`INSERT INTO users (email, name, password_hash, role, status, created_at, sso_id, institutional_role, sso_linked_at)
                  VALUES (?,?,?,?,'active',?,?,?,?)`)
    .run(isEmail(email) ? email : `${ssoId}@sso.local`, name, NO_LOCAL_PASSWORD, 'user', t, ssoId, role, t);
  return Number(info.lastInsertRowid);
}

/**
 * Peran admin Meet mengikuti peran institusional eportal (keputusan pemilik produk).
 * Dijalankan tiap login agar pencabutan di eportal langsung berlaku di sini juga.
 */
function syncAdminRole(userId, institutionalRole) {
  const shouldBeAdmin = institutionalRole === 'admin';
  const u = q('SELECT role, email FROM users WHERE id = ?').get(userId);
  if (!u) return;
  // ADMIN_EMAIL (super-admin) tidak pernah diturunkan oleh SSO
  const isSuper = !!config.adminEmail && u.email.toLowerCase() === config.adminEmail;
  const target = shouldBeAdmin || isSuper ? 'admin' : (u.role === 'admin' && !shouldBeAdmin ? 'user' : u.role);
  if (target !== u.role) {
    q('UPDATE users SET role = ? WHERE id = ?').run(target, userId);
    console.log(`[sso] peran ${u.email} disesuaikan dari E-Portal: ${u.role} -> ${target}`);
  }
}

export function registerSsoRoutes(r) {
  // Dipakai halaman login untuk tahu apakah SSO aktif (menampilkan petunjuk, bukan tombol:
  // alur ini hanya bisa dimulai dari dasbor eportal).
  r.get('/api/sso/status', (req, res) => json(res, 200, { enabled: S.enabled }));

  // Tujuan redirect dari eportal. GET karena dipanggil lewat navigasi browser.
  //
  // Kegagalan TIDAK dilempar sebagai HttpError: pengguna akan melihat teks mentah.
  // Sebagai gantinya kembali ke halaman login dengan KODE kesalahan, bukan pesan bebas —
  // pesan bebas di URL bisa dipakai memalsukan peringatan yang terlihat resmi.
  r.get('/sso/callback', async (req, res) => {
    const back = (code) => {
      res.writeHead(302, { Location: `/login?sso=${code}`, 'Cache-Control': 'no-store' });
      res.end();
    };
    if (!S.enabled) return back('off');
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    if (!token) return back('invalid');

    try {
      const data = await introspect(token);
      const userId = syncUser(data.user);
      syncAdminRole(userId, clean(data.user.institutional_role, 32).toLowerCase());
      await createSession(req, res, userId);
    } catch (e) {
      if (!(e instanceof HttpError)) { console.error('[sso] callback gagal:', e); return back('down'); }
      return back(e.ssoCode || 'invalid');
    }
    // Token ikut tercatat di riwayat browser bila dibiarkan di URL; alihkan ke alamat bersih.
    res.writeHead(302, { Location: '/dashboard', 'Cache-Control': 'no-store' });
    res.end();
  });
}
