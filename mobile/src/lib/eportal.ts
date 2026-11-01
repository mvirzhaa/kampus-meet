// Login lewat SSO E-Portal UIKA dari dalam aplikasi.
//
// Alur web dimulai dari dasbor E-Portal dan berakhir sebagai cookie. Aplikasi tidak punya
// cookie jar yang bisa diandalkan, jadi ia menempuh tiga langkah kontrak E-Portal sendiri:
//
//   1. POST {base}/api/auth/login                -> JWT E-Portal (uika_sso_token)
//   2. GET  {base}/api/my-modules/{id}/roles     -> jabatan pengguna pada modul Meet
//   3. GET  {base}/api/sso/redirect?target_url=… -> URL berisi token ber-scope (umur 2 menit)
//
// Token ber-scope itu lalu ditukar ke /api/sso/app-exchange milik UIKA Meet, yang
// mengintrospeksinya kembali ke E-Portal sebelum membuat sesi.
//
// Dua hal yang disengaja:
// • Password dikirim LANGSUNG ke E-Portal, tidak pernah melewati server UIKA Meet.
// • Password maupun JWT E-Portal tidak pernah disimpan di perangkat. JWT hanya hidup di
//   memori selama proses ini; yang tersimpan hanyalah token sesi UIKA Meet di akhir.
import { getServer } from './api';

export type EportalRole = { id: number; name: string };

/** Pesan dari E-Portal sering berupa kalimat siap tampil; pakai itu bila ada. */
function pesan(body: unknown, fallback: string): string {
  const m = (body as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : fallback;
}

async function ep<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${base}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers || {}) },
    });
  } catch {
    throw new Error('E-Portal tidak dapat dihubungi. Periksa koneksi Anda.');
  }
  let body: unknown = null;
  try { body = await r.json(); } catch { /* bukan JSON */ }
  if (!r.ok) {
    if (r.status === 401) throw new Error(pesan(body, 'Email atau password E-Portal salah.'));
    if (r.status === 403) throw new Error(pesan(body, 'Anda belum diberi akses ke modul Meet di E-Portal.'));
    if (r.status === 429) throw new Error(pesan(body, 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.'));
    throw new Error(pesan(body, `E-Portal menolak permintaan (${r.status}).`));
  }
  return body as T;
}

/** Langkah 1. Mengembalikan JWT E-Portal — simpan hanya di memori. */
async function masuk(base: string, email: string, password: string): Promise<string> {
  const b = await ep<{ data?: { uika_sso_token?: string }; uika_sso_token?: string }>(
    base, '/api/auth/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) },
  );
  const jwt = b.data?.uika_sso_token || b.uika_sso_token;
  if (!jwt) throw new Error('E-Portal tidak mengirim token sesi.');
  return jwt;
}

/** Langkah 2. Jabatan pengguna pada modul Meet. Kosong berarti belum diberi akses. */
async function jabatan(base: string, jwt: string, moduleId: string): Promise<EportalRole[]> {
  const b = await ep<{ data?: { roles?: { role_id: number; role_name: string }[] } }>(
    base, `/api/my-modules/${encodeURIComponent(moduleId)}/roles`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  return (b.data?.roles || []).map(r => ({ id: r.role_id, name: r.role_name }));
}

/** Langkah 3. Token ber-scope, diambil dari redirect_url yang dikembalikan E-Portal. */
async function tokenScoped(base: string, jwt: string, moduleId: string, roleId: number): Promise<string> {
  const target = `${getServer()}/sso/callback`;
  const qs = new URLSearchParams({ target_url: target, role_id: String(roleId), appModule_id: moduleId });
  const b = await ep<{ redirect_url?: string }>(
    base, `/api/sso/redirect?${qs}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!b.redirect_url) throw new Error('E-Portal tidak mengirim tautan masuk.');
  // redirect_url berbentuk {target}?token=…&role_id=…&appModule_id=…
  const tok = new URL(b.redirect_url).searchParams.get('token');
  if (!tok) throw new Error('Tautan masuk dari E-Portal tidak memuat token.');
  return tok;
}

/**
 * Hasil langkah pertama. Bila pengguna punya lebih dari satu jabatan, layar login
 * menampilkan pemilihnya lalu memanggil `tokenUntuk` dengan jabatan yang dipilih.
 *
 * Penyimpanan sesi sengaja TIDAK dilakukan di sini - itu urusan auth.tsx, sama seperti
 * login biasa, supaya hanya ada satu tempat yang menyentuh token sesi.
 */
export type SesiEportal = {
  roles: EportalRole[];
  tokenUntuk: (roleId: number) => Promise<string>;
};

/**
 * Login ke E-Portal lalu siapkan langkah penyelesaiannya.
 * `password` hanya dipakai di dalam fungsi ini dan tidak pernah keluar darinya.
 */
export async function mulaiLoginEportal(
  base: string, moduleId: string, email: string, password: string,
): Promise<SesiEportal> {
  const jwt = await masuk(base, email, password);
  const roles = await jabatan(base, jwt, moduleId);
  if (!roles.length) {
    throw new Error('Akun Anda belum diberi akses ke modul Meet di E-Portal. Hubungi admin E-Portal.');
  }
  return { roles, tokenUntuk: (roleId: number) => tokenScoped(base, jwt, moduleId, roleId) };
}
