// Undangan event untuk pengguna yang login: satu sumber data untuk tab "Undangan" (dengan angka badge),
// bagian "Undangan untuk Anda" di beranda, dan pengingat lokal cadangan.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { api, type Invitation } from './api';
import { syncLocalReminders } from './push';

type State = { list: Invitation[] | null; loading: boolean; at: number };
let state: State = { list: null, loading: false, at: 0 };
const subs = new Set<(s: State) => void>();
const emit = () => subs.forEach(f => f(state));

export async function refreshInvitations(force = false) {
  if (state.loading || (!force && Date.now() - state.at < 20_000)) return state.list;
  state = { ...state, loading: true }; emit();
  try {
    const r = await api<{ invitations: Invitation[] }>('GET', '/api/my/invitations');
    state = { list: r.invitations, loading: false, at: Date.now() };
    syncLocalReminders(r.invitations).catch(() => {});
  } catch { state = { ...state, loading: false }; }
  emit();
  return state.list;
}
export function clearInvitations() { state = { list: null, loading: false, at: 0 }; emit(); }

/** enabled = pengguna sudah login. */
export function useInvitations(enabled: boolean) {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  useEffect(() => {
    if (!enabled) { clearInvitations(); return; }
    refreshInvitations(true);
    const t = setInterval(() => refreshInvitations(), 60_000);
    const sub = AppState.addEventListener('change', (a) => { if (a === 'active') refreshInvitations(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [enabled]);
  const refresh = useCallback(() => refreshInvitations(true), []);
  const now = Date.now() / 1000;
  const active = (s.list || []).filter(e => e.endsAt + 3600 > now);
  return { list: s.list, active, loading: s.loading, refresh, openCount: active.filter(e => e.joinOpen).length };
}

/** Status ringkas sebuah undangan. */
export function invitationStatus(e: Invitation) {
  const now = Date.now() / 1000;
  if (now > e.endsAt + 3600) return { key: 'ended' as const, label: 'Selesai' };
  if (e.joinOpen) return { key: 'open' as const, label: now >= e.startsAt ? 'Sedang berlangsung' : 'Room dibuka' };
  const mins = Math.round((e.startsAt - 1800 - now) / 60);
  return { key: 'soon' as const, label: mins < 60 ? `Dibuka ${mins} menit lagi` : mins < 1440 ? `Dibuka ${Math.floor(mins / 60)} jam lagi` : 'Akan datang' };
}

/** Ketuk undangan: room sudah dibuka → langsung masuk meeting; belum → detail event. */
export function openInvitation(e: Invitation) {
  if (e.joinOpen) router.push({ pathname: '/join', params: { code: e.roomId, auto: '1' } });
  else router.push(`/event/${e.slug}`);
}
