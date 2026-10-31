// Klien API server UIKA Meet. Sesi memakai cookie (dikelola otomatis oleh jaringan Android),
// perubahan data memakai header X-CSRF-Token, dan API di dalam meeting memakai header X-Seat.
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getStr, setStr } from './store';

export const DEFAULT_SERVER: string = (Constants.expoConfig?.extra as { defaultServer?: string } | undefined)?.defaultServer || 'https://meet.uika-bogor.ac.id';
let server = DEFAULT_SERVER;
let csrf: string | null = null;

export async function loadServer() {
  // Pratinjau browser: API diakses lewat asal (origin) yang sama
  if (Platform.OS === 'web' && typeof location !== 'undefined') { server = location.origin; return server; }
  server = (await getStr('server')) || DEFAULT_SERVER; return server;
}
export function getServer() { return server; }
export async function setServer(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  server = u; await setStr('server', u === DEFAULT_SERVER ? null : u);
}
export function setCsrf(t: string | null) { csrf = t; }

export class ApiError extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status; } }

export async function api<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { Accept: 'application/json', ...headers };
  if (csrf) h['X-CSRF-Token'] = csrf;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(server + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'include' });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 0);
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Gagal (${res.status})`, res.status);
  return data as T;
}

// ---------- Tipe data ----------
export type Me = {
  user: { id: number; email: string; name: string; role: string } | null;
  csrf: string | null;
  app: { name: string; campus: string; allowRegistration: boolean };
};
export type RoomInfo = {
  id: string; name: string; welcome?: string; hasPassword: boolean; password?: string | null;
  scheduledAt: number | null; durationMin: number | null; createdAt: number; lastUsedAt: number | null;
  attendeeLink?: string; moderatorLink?: string; live?: number | null;
};
export type EventInfo = {
  id: number; slug: string; title: string; description: string; speaker: string; category: string;
  startsAt: number; endsAt: number; organizer: string; hasPassword: boolean; certificate: boolean;
  joinOpen?: boolean; opensAt?: number; joinLink?: string | null; isOwner?: boolean; attendedMin?: number; certCode?: string | null;
};
export type JoinInfo = {
  room: { id: string; name: string; owner: string; scheduledAt: number | null; durationMin: number | null; allowGuests: boolean };
  role: 'moderator' | 'viewer';
  event: { title: string; slug: string; startsAt: number; endsAt: number; opensAt: number; open: boolean } | null;
  needPassword: boolean; needLogin: boolean; user: { name: string } | null;
};
export type JoinResult = {
  url: string; token: string; seat: string; identity: string; role: 'moderator' | 'viewer'; name: string;
  room: { id: string; name: string; isOwner: boolean };
};

/** Ambil kode room & kunci undangan dari ID ("abc-defg-hij") atau tautan (/j/<kode>?k=… atau /r/<kode>). */
export function parseMeetingInput(input: string): { code: string; key?: string } | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/\/(?:j|r)\/([a-z0-9-]{3,40})(?:\?(?:.*&)?k=([A-Za-z0-9_-]+))?/i);
  if (m) return { code: m[1].toLowerCase(), key: m[2] };
  const id = s.toLowerCase().replace(/\s+/g, '');
  if (/^[a-z0-9-]{3,40}$/.test(id)) return { code: id };
  return null;
}
