// Sesi login aplikasi. Pengguna tetap login sampai menekan "Keluar":
// • token sesi disimpan di penyimpanan aman perangkat (bukan cookie) dan berlaku panjang di server
//   (diperpanjang otomatis setiap kali aplikasi dipakai);
// • data akun terakhir ikut disimpan, jadi saat aplikasi dibuka tanpa internet / server sedang gangguan
//   pengguna tidak terlempar ke layar masuk;
// • sesi hanya dihapus bila server benar-benar menyatakan token tidak berlaku (mis. akun dinonaktifkan
//   admin, password diganti, atau keluar dari perangkat lain).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, hasSessionToken, loadServer, loadSession, setCsrf, setSessionToken, type Me } from './api';
import { getJSON, setJSON, setStr } from './store';
import { registerPush, unregisterPush } from './push';

type Ctx = {
  me: Me | null;
  ready: boolean;
  refresh: () => Promise<Me | null>;
  login: (email: string, password: string) => Promise<void>;
  loginSso: (scopedToken: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
const CACHE = 'me_cache';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const pushed = useRef(0);

  const remember = useCallback(async (m: Me) => {
    setMe(m);
    await setJSON(CACHE, m.user ? { user: m.user, app: m.app, can: (m as Me & { can?: unknown }).can } : { user: null });
  }, []);
  const afterLogin = useCallback((m: Me) => {
    // Daftarkan perangkat untuk push (paling sering sekali per 6 jam)
    if (m.user && Date.now() - pushed.current > 6 * 3600_000) { pushed.current = Date.now(); registerPush().catch(() => {}); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      let m = await api<Me>('GET', '/api/me');
      setCsrf(m.csrf);
      // Aplikasi versi lama login lewat cookie: tukar sekali dengan token sesi yang tahan lama
      if (m.user && !hasSessionToken()) {
        try { const t = await api<{ token?: string; csrf: string }>('POST', '/api/auth/app-token'); if (t.token) { await setSessionToken(t.token); setCsrf(t.csrf); m = { ...m, csrf: t.csrf }; } }
        catch { /* coba lagi lain kali */ }
      }
      if (!m.user && hasSessionToken()) await setSessionToken(null);   // token ditolak server → benar-benar keluar
      await remember(m);
      afterLogin(m);
      return m;
    } catch {
      // Offline / server gangguan: status login terakhir dipertahankan (tidak dianggap keluar)
      return null;
    }
  }, [remember, afterLogin]);

  useEffect(() => {
    (async () => {
      await loadServer();
      await loadSession();
      const cached = await getJSON<Partial<Me>>(CACHE, {});
      if (cached.user && hasSessionToken()) setMe({ csrf: null, ...cached } as Me);
      // Jangan menunggu jaringan terlalu lama saat membuka aplikasi bila sesi tersimpan sudah ada
      const r = refresh();
      if (cached.user && hasSessionToken()) await Promise.race([r, new Promise(res => setTimeout(res, 2500))]); else await r;
      setReady(true);
    })();
  }, [refresh]);

  // Kembali ke aplikasi → segarkan sesi (token CSRF baru, perpanjangan sesi di server)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh().catch(() => {}); });
    return () => sub.remove();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ csrf: string; token?: string }>('POST', '/api/auth/login', { email: email.trim(), password });
    if (r.token) await setSessionToken(r.token);
    setCsrf(r.csrf);
    pushed.current = 0;
    await refresh();
  }, [refresh]);

  // Login lewat SSO E-Portal: aplikasi sudah memperoleh token ber-scope dari E-Portal
  // (lihat lib/eportal.ts); di sini token itu ditukar menjadi sesi UIKA Meet.
  const loginSso = useCallback(async (scopedToken: string) => {
    const r = await api<{ csrf: string; token?: string }>('POST', '/api/sso/app-exchange', { token: scopedToken });
    if (r.token) await setSessionToken(r.token);
    setCsrf(r.csrf);
    pushed.current = 0;
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await unregisterPush().catch(() => {});
    try { await api('POST', '/api/auth/logout'); } catch { /* abaikan */ }
    await setSessionToken(null);
    await setStr(CACHE, null);
    setCsrf(null);
    pushed.current = 0;
    const m = await refresh();
    if (!m) setMe((prev) => (prev ? { ...prev, user: null, csrf: null } : prev));
  }, [refresh]);

  return <AuthCtx.Provider value={{ me, ready, refresh, login, loginSso, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
