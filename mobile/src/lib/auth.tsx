import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, loadServer, setCsrf, type Me } from './api';

type Ctx = {
  me: Me | null;
  ready: boolean;
  refresh: () => Promise<Me | null>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try { const m = await api<Me>('GET', '/api/me'); setCsrf(m.csrf); setMe(m); return m; }
    catch { setMe((prev) => prev); return null; }
  }, []);

  useEffect(() => { (async () => { await loadServer(); await refresh(); setReady(true); })(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ csrf: string }>('POST', '/api/auth/login', { email: email.trim(), password });
    setCsrf(r.csrf);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api('POST', '/api/auth/logout'); } catch { /* abaikan */ }
    setCsrf(null);
    await refresh();
  }, [refresh]);

  return <AuthCtx.Provider value={{ me, ready, refresh, login, logout }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
