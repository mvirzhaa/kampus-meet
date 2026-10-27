// Pesan antar-peserta lewat data channel LiveKit (tidak lewat server aplikasi → beban server minimal).
// Setiap pesan masuk divalidasi: ukuran, tipe, peran pengirim (dari atribut yang ditandatangani server), dan rate limit.
import { RoomEvent } from 'livekit-client';
import { store, emit, roleOf } from './store.js';

const enc = new TextEncoder(); const dec = new TextDecoder();
const TOPIC = 'km'; const SYNC = 'km-sync';
const MAX_IN = 16 * 1024;
const rate = new Map(); // identity -> {n, t}

function allowFrom(identity) {
  const t = Date.now(); let r = rate.get(identity);
  if (!r || t - r.t > 5000) { r = { n: 0, t }; rate.set(identity, r); }
  return ++r.n <= 60; // maks 60 pesan / 5 detik per pengirim
}

export function send(msg, to) {
  const lp = store.room?.localParticipant; if (!lp) return;
  const data = enc.encode(JSON.stringify(msg));
  if (data.length > 15000) { console.warn('pesan terlalu besar', msg.t); return; }
  return lp.publishData(data, { reliable: true, topic: TOPIC, ...(to ? { destinationIdentities: Array.isArray(to) ? to : [to] } : {}) }).catch(e => console.warn('publishData', e));
}

/** Kirim payload besar (sinkronisasi awal) via text stream, otomatis dipecah. */
export function sendLarge(obj, to) {
  return store.room?.localParticipant.sendText(JSON.stringify(obj), { topic: SYNC, destinationIdentities: [to] }).catch(e => console.warn('sendText', e));
}

export function initBus(room) {
  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    // Pesan dari server (dikirim lewat API LiveKit, tanpa peserta pengirim) — hanya server yang bisa melakukannya
    if (topic === 'km-srv' && !participant && payload.byteLength < 4096) {
      try { const m = JSON.parse(dec.decode(payload)); if (typeof m?.t === 'string') emit('srv:' + m.t, m); } catch { /* abaikan */ }
      return;
    }
    if (topic !== TOPIC || !participant || payload.byteLength > MAX_IN) return;
    if (!allowFrom(participant.identity)) return;
    let msg; try { msg = JSON.parse(dec.decode(payload)); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    emit('msg:' + msg.t, msg, participant.identity, roleOf(participant.identity));
  });
  room.registerTextStreamHandler(SYNC, async (reader, info) => {
    try {
      const text = await reader.readAll();
      if (text.length > 2_000_000) return;
      const obj = JSON.parse(text);
      emit('sync', obj, info.identity, roleOf(info.identity));
    } catch (e) { console.warn('sync', e); }
  });
}

/** Peserta "pemimpin" yang menjawab permintaan sinkronisasi: moderator dengan identitas terkecil. */
export function leaderIdentity() {
  const r = store.room; if (!r) return null;
  const all = [r.localParticipant, ...r.remoteParticipants.values()];
  const mods = all.filter(p => roleOf(p.identity) === 'moderator').map(p => p.identity).sort();
  if (mods.length) return mods[0];
  if (store.meta.presenter && all.some(p => p.identity === store.meta.presenter)) return store.meta.presenter;
  return all.map(p => p.identity).sort()[0];
}

export const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
