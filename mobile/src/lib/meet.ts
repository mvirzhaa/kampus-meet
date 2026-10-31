// Sesi meeting yang sedang berjalan (hasil POST /api/join) — disimpan di memori, bukan di URL.
import { api, type JoinResult } from './api';

export type Session = JoinResult & { code: string; audio: boolean; video: boolean };
let current: Session | null = null;
export const setSession = (s: Session | null) => { current = s; };
export const getSession = () => current;

/** Panggil API di dalam meeting (autentikasi kursi lewat X-Seat). */
export function meetApi<T = any>(s: Session, method: string, path: string, body?: unknown) {
  return api<T>(method, `/api/meet/${s.code}${path}`, body, { 'X-Seat': s.seat });
}

/** Gabung ke room: minta token LiveKit + kursi dari server lalu simpan sebagai sesi aktif. */
export async function joinMeeting(o: { code: string; key?: string; name: string; password?: string; audio: boolean; video: boolean }) {
  const r = await api<JoinResult>('POST', `/api/join/${encodeURIComponent(o.code)}`, { name: o.name, password: o.password || '', key: o.key || '' });
  const s: Session = { ...r, code: r.room.id, audio: o.audio, video: o.video };
  setSession(s);
  return s;
}
