// Penyimpanan status bersama + event emitter kecil untuk modul-modul ruang meeting.
export const store = {
  code: '', seat: '', identity: '', role: 'viewer', name: '',
  room: null,           // LiveKit Room
  meta: { locks: {}, presenter: null, pres: null, recording: false, multiWb: false, name: '', welcome: '', muteOnJoin: true, startedAt: null },
  hands: new Map(),      // identity -> timestamp angkat tangan
  audioMode: null,       // 'mic' | 'listen'
  dataSaver: false,
  sounds: true,
  isOwner: false,
  segmenterModelUrl: '',
};

const handlers = new Map();
export function on(evt, fn) { (handlers.get(evt) || handlers.set(evt, new Set()).get(evt)).add(fn); return () => handlers.get(evt).delete(fn); }
export function emit(evt, ...a) { for (const fn of handlers.get(evt) || []) { try { fn(...a); } catch (e) { console.error(evt, e); } } }

export const isMod = (identity = store.identity) => roleOf(identity) === 'moderator';
export const isPresenter = (identity = store.identity) => store.meta.presenter === identity;
export const canPresent = (identity = store.identity) => isPresenter(identity) || isMod(identity);

export function participant(identity) {
  const r = store.room; if (!r) return null;
  return identity === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(identity) || null;
}
export function roleOf(identity) {
  const p = participant(identity);
  if (!p) return 'viewer';
  if (p === store.room?.localParticipant) return p.attributes?.role || store.role;
  return p.attributes?.role === 'moderator' ? 'moderator' : 'viewer';
}
export const nameOf = (identity) => participant(identity)?.name || identity;
export const allParticipants = () => store.room ? [store.room.localParticipant, ...store.room.remoteParticipants.values()] : [];

/** Panggilan API dalam meeting (autentikasi X-Seat, bukan cookie). */
export async function meetApi(method, path, body, headers = {}) {
  const h = { 'X-Seat': store.seat, ...headers };
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api/meet/${store.code}${path}`, { method, headers: h, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) throw new Error(data?.error || `Gagal (${res.status})`);
  return data;
}

// Warna avatar deterministik dari identitas
const COLORS = ['#7b61ff', '#2f80ed', '#00a3a3', '#e05d44', '#d6409f', '#3c9d4e', '#c77b00', '#5b6bd5', '#a259ff', '#e67e22'];
export function colorFor(id) { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return COLORS[x % COLORS.length]; }
