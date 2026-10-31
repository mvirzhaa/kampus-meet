// Inti ruang meeting: koneksi LiveKit, pesan data (protokol sama dengan versi web), chat, angkat tangan,
// reaksi, teks transkripsi (CC) beserta terjemahannya, dan perpindahan ruang kelompok (breakout).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { AudioSession } from '@livekit/react-native';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, VideoPresets, type LocalVideoTrack, type Participant, type RemoteParticipant } from 'livekit-client';
import { meetApi, type Session } from './meet';
import { OTHER, SHORT, prepareTranslate, translate, type Lang2 } from './translate';

export type Pres = { id: string; name: string; pages: number; page: number; downloadable?: boolean };
export type Meta = {
  name?: string; welcome?: string; muteOnJoin?: boolean; transcribe?: boolean; trServer?: boolean; recording?: boolean;
  recMode?: 'egress' | 'local' | 'off'; multiWb?: boolean;
  presenter?: string | null; spotlight?: string | null; pres?: Pres | null; startedAt?: number | null;
  locks?: { webcam?: boolean; mic?: boolean; seeCams?: boolean; publicChat?: boolean; privateChat?: boolean; seeUsers?: boolean; notes?: boolean };
  breakout?: { id: string; active: boolean; rooms: { name: string }[]; endsAt: number | null; closingAt: number | null; allowChoose: boolean; assign: Record<string, number> } | null;
  bo?: { n: number; name: string; rooms: number; endsAt: number | null; closingAt: number | null; main: string; mainName: string };
};
export type ChatMsg = { id: string; from: string; name: string; text: string; ts: number; mine?: boolean; sys?: boolean; priv?: boolean };
export type Cap = { key: string; identity: string; name: string; text: string; lang: string; final: boolean; cid?: string; ts: number };
export const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉'];
/** Anotasi whiteboard (protokol sama dengan web: koordinat 0..1 relatif halaman). */
export type Shape = { id: string; k: string; c: string; w: number; p: number[]; tx?: string; fs?: number; by: string };
const KINDS = new Set(['pen', 'rect', 'ellipse', 'line', 'arrow', 'text']);
function sanitizeShape(s: any, from: string): Shape | null {
  if (!s || !KINDS.has(s.k) || !Array.isArray(s.p) || s.p.length < 2 || s.p.length > 1600) return null;
  const p = s.p.map((v: unknown) => Math.max(-0.5, Math.min(1.5, Math.round((Number(v) || 0) * 10000) / 10000)));
  const out: Shape = { id: String(s.id ?? '').slice(0, 16), k: s.k, c: /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#e53935', w: Math.max(1, Math.min(20, Number(s.w) || 4)), p, by: from };
  if (s.k === 'text') { out.tx = String(s.tx ?? '').slice(0, 500); out.fs = Math.max(0.01, Math.min(0.2, Number(s.fs) || 0.035)); if (!out.tx) return null; }
  return out.id ? out : null;
}
/** Kunci halaman whiteboard: "<id presentasi | default>:<halaman>" (sama dengan web). */
export const wbKey = (pres?: Pres | null) => `${pres?.id || 'default'}:${pres?.page || 1}`;

const enc = new TextEncoder(); const dec = new TextDecoder();
const TOPIC = 'km';
const str = (v: unknown, n: number) => String(v ?? '').slice(0, n);
const rid = () => Math.random().toString(36).slice(2, 10);
export const roleOf = (p?: Participant | null) => (p?.attributes?.role as string) || 'viewer';
export const nameOf = (p?: Participant | null) => p?.name || p?.identity || 'Peserta';

async function askPermissions(audio: boolean, video: boolean) {
  if (Platform.OS !== 'android') return;
  const list: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA];
  if (Number(Platform.Version) >= 31) list.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  if (audio || video) { try { await PermissionsAndroid.requestMultiple(list); } catch { /* abaikan */ } }
}

export function useMeeting(session: Session, opts: { trTo: Lang2 | '' ; onLeft: (reason: string) => void; toast: (m: string) => void }) {
  const room = useMemo(() => new Room({
    adaptiveStream: { pixelDensity: 'screen' }, dynacast: true,
    publishDefaults: { simulcast: true, videoCodec: 'vp8' },
    videoCaptureDefaults: { resolution: VideoPresets.h540.resolution, facingMode: 'user' },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }), []);
  const [conn, setConn] = useState<ConnectionState>(ConnectionState.Connecting);
  const [meta, setMeta] = useState<Meta>({});
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [unread, setUnread] = useState(0);
  const [hands, setHands] = useState<Record<string, number>>({});
  const [reacts, setReacts] = useState<Record<string, string>>({});
  const [caps, setCaps] = useState<Record<string, Cap>>({});
  const [lines, setLines] = useState<Cap[]>([]);
  const [trs, setTrs] = useState<Record<string, Partial<Record<Lang2, string>>>>({});
  const [error, setError] = useState<string | null>(null);
  const [seat, setSeat] = useState(session);
  // Whiteboard & catatan bersama disimpan juga di aplikasi, agar bisa ditampilkan dan dibagikan ke peserta
  // yang baru masuk bila aplikasi ini menjadi "pemimpin" sinkronisasi (moderator dengan identitas terkecil).
  const wbRef = useRef(new Map<string, Shape[]>());
  const [wbVer, setWbVer] = useState(0);
  const notesRef = useRef<{ text: string; v: number; by: string }>({ text: '', v: 0, by: '' });
  const chatRef = useRef<ChatMsg[]>([]);
  const chatOpen = useRef(false);
  const switching = useRef(false);
  const myHand = useRef(false);
  const optsRef = useRef(opts); optsRef.current = opts;
  const metaRef = useRef(meta); metaRef.current = meta;
  const goRoomRef = useRef<(n: number) => void>(() => {});

  const me = () => room.localParticipant;
  const send = useCallback((msg: object, to?: string[]) => {
    if (room.state !== ConnectionState.Connected) return;
    room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC, ...(to ? { destinationIdentities: to } : {}) }).catch(() => {});
  }, [room]);

  const addChat = useCallback((m: ChatMsg) => {
    setChat(c => { const next = [...c.slice(-299), m]; chatRef.current = next; return next; });
    if (!chatOpen.current && !m.mine && !m.sys) setUnread(u => u + 1);
  }, []);
  const sys = useCallback((text: string) => addChat({ id: rid(), from: '', name: '', text, ts: Date.now(), sys: true }), [addChat]);

  const applyMeta = useCallback((raw?: string) => {
    let m: Meta = {}; try { m = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
    setMeta(prev => ({ ...prev, ...m, locks: { ...(m.locks || {}) } }));
  }, []);

  // ---------- Terjemahan ----------
  const pendingTr = useRef(new Set<string>());
  const setTr = useCallback((key: string, to: Lang2, text: string) => setTrs(t => (t[key]?.[to] ? t : { ...t, [key]: { ...t[key], [to]: text } })), []);
  const ensureTr = useCallback((c: Cap, want: Lang2) => {
    // Kalimat yang sudah berbahasa tujuan tetap diberi terjemahan lawannya (transkrip dwibahasa), hanya untuk kalimat final
    const to: Lang2 = SHORT[c.lang] === want ? OTHER[c.lang] : want;
    if (!want || !to || (to !== want && !c.final)) return;
    const k = `${c.key}|${to}|${c.final ? 'f' : c.text.length}`;
    if (pendingTr.current.has(k)) return;
    pendingTr.current.add(k);
    translate(c.text, SHORT[c.lang] || 'id', to, { code: seat.code, seat: seat.seat, server: c.final && !!metaRef.current.trServer })
      .then(out => { if (out) setTr(c.final ? c.key : `${c.identity}:interim`, to, out); })
      .finally(() => { if (pendingTr.current.size > 500) pendingTr.current.clear(); });
  }, [seat, setTr]);

  const addCap = useCallback((c: Cap) => {
    setCaps(m => ({ ...m, [c.identity]: c }));
    if (c.final) setLines(l => [...l.slice(-199), c]);
    if (optsRef.current.trTo) ensureTr(c, optsRef.current.trTo);
  }, [ensureTr]);

  /** Kalimat final dari mikrofon saya: kirim ke peserta, simpan ke server, terjemahkan & bagikan. */
  const pending = useRef(Promise.resolve());
  const myFinal = useCallback((text: string, lang: string) => {
    text = text.slice(0, 1000); text = text.charAt(0).toUpperCase() + text.slice(1);
    const cid = Date.now().toString(36).slice(-4) + rid().slice(0, 4);
    const p = me();
    const c: Cap = { key: `${p.identity}:${cid}`, identity: p.identity, name: nameOf(p), text, lang, final: true, cid, ts: Date.now() };
    addCap(c);
    send({ t: 'cap', text, lang, final: true, id: cid });
    pending.current = pending.current.then(() => meetApi(seat, 'POST', '/transcript', { text, lang, id: cid })).then(() => {}, () => {});
    const to = OTHER[lang];
    const from = SHORT[lang] || 'id';
    // Terjemahan ke bahasa lawan dibagikan ke semua peserta & disimpan di server (dipakai web, rekaman, ekspor).
    // ML Kit kadang gagal pada kalimat pertama saat model masih diunduh → siapkan model lalu coba sekali lagi,
    // dan pakai server kampus (TRANSLATE_URL) sebagai cadangan terakhir.
    const opt = { code: seat.code, seat: seat.seat, server: !!metaRef.current.trServer };
    translate(text, from, to)
      .then(out => out ?? prepareTranslate(from, to).then(() => translate(text, from, to, opt)))
      .then(out => {
      if (!out) return;
      setTr(c.key, to, out);
      send({ t: 'cap-tr', who: p.identity, id: cid, to, text: out.slice(0, 1500) });
      pending.current = pending.current.then(() => meetApi(seat, 'POST', '/transcript/tr', { who: p.identity, id: cid, to, text: out })).then(() => {}, () => {});
    });
  }, [addCap, send, seat, setTr]);
  const lastInterim = useRef(0);
  const myInterim = useCallback((text: string, lang: string) => {
    const p = me();
    addCap({ key: `${p.identity}:interim`, identity: p.identity, name: nameOf(p), text: text.slice(-300), lang, final: false, ts: Date.now() });
    const t = Date.now();
    if (t - lastInterim.current > 400) { lastInterim.current = t; send({ t: 'cap', text: text.slice(-300), lang }); }
  }, [addCap, send]);

  // ---------- Sinkronisasi (riwayat chat, catatan, whiteboard) ----------
  /** Sama dengan web: moderator dengan identitas terkecil, lalu presenter, lalu identitas terkecil. */
  const leaderIdentity = useCallback(() => {
    const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const mods = all.filter(p => roleOf(p) === 'moderator').map(p => p.identity).sort();
    if (mods.length) return mods[0];
    const pr = metaRef.current.presenter;
    if (pr && all.some(p => p.identity === pr)) return pr;
    return all.map(p => p.identity).sort()[0];
  }, [room]);
  const requestSync = useCallback(() => {
    const leader = leaderIdentity();
    if (leader && leader !== room.localParticipant.identity) send({ t: 'sync?' }, [leader]);
  }, [leaderIdentity, room, send]);
  const syncPayload = useCallback(() => {
    const wb: Record<string, Shape[]> = {}; let total = 0;
    for (const [k, arr] of wbRef.current) if (arr.length && total < 4000) { wb[k] = arr; total += arr.length; }
    return {
      chat: chatRef.current.filter(c => !c.sys && !c.priv).slice(-100).map(c => ({ id: c.id, from: c.from, name: c.name, text: c.text, ts: c.ts })),
      notes: notesRef.current.v ? notesRef.current : undefined,
      poll: null,
      wb,
    };
  }, []);
  const sendSync = useCallback((to: string) => {
    room.localParticipant.sendText(JSON.stringify(syncPayload()), { topic: 'km-sync', destinationIdentities: [to] }).catch(() => {});
  }, [room, syncPayload]);

  // ---------- Pesan masuk ----------
  useEffect(() => {
    const rate = new Map<string, { n: number; t: number }>();
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic === 'km-srv' && !participant) {
        let m: any; try { m = JSON.parse(dec.decode(payload)); } catch { return; }
        if (m?.t === 'cap-tr') receiveTr(m);
        else if (m?.t === 'bo-move' && m.identity === me().identity) { optsRef.current.toast(m.n ? 'Moderator memindahkan Anda ke ruang kelompok' : 'Moderator memindahkan Anda ke ruang utama'); setTimeout(() => goRoomRef.current(parseInt(m.n, 10) || 0), 1200); }
        else if (m?.t === 'bo-msg' && metaRef.current.bo) sys(`📣 Pengumuman dari ${str(m.from || 'Moderator', 60)}: ${str(m.text, 300)}`);
        // Perekam server meminta isi whiteboard/catatan terkini
        else if (m?.t === 'sync-for' && typeof m.id === 'string' && leaderIdentity() === me().identity) sendSync(m.id.slice(0, 80));
        return;
      }
      if (topic !== TOPIC || !participant || payload.byteLength > 16 * 1024) return;
      const id = participant.identity; const role = roleOf(participant);
      const now = Date.now(); let r = rate.get(id);
      if (!r || now - r.t > 5000) { r = { n: 0, t: now }; rate.set(id, r); }
      if (++r.n > 60) return;
      let m: any; try { m = JSON.parse(dec.decode(payload)); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      switch (m.t) {
        case 'chat': {
          if (metaRef.current.locks?.publicChat && role !== 'moderator') return;
          const text = str(m.text, 1000).trim(); if (text) addChat({ id: str(m.id, 20) || rid(), from: id, name: nameOf(participant), text, ts: Date.now() });
          break;
        }
        case 'pchat': { const text = str(m.text, 1000).trim(); if (text) addChat({ id: rid(), from: id, name: nameOf(participant), text, ts: Date.now(), priv: true }); break; }
        case 'chat-clear': if (role === 'moderator') { setChat([]); sys(`Chat publik dihapus oleh ${nameOf(participant)}`); } break;
        case 'hand': setHands(h => { const n = { ...h }; if (m.up) n[id] = n[id] || Date.now(); else delete n[id]; return n; }); break;
        case 'hand-lower':
          if (role !== 'moderator') return;
          if (m.all || m.id === me().identity) { if (myHand.current) { myHand.current = false; optsRef.current.toast('Moderator menurunkan tangan Anda'); } }
          setHands(h => (m.all ? {} : (() => { const n = { ...h }; delete n[str(m.id, 80)]; return n; })()));
          break;
        case 'react': if (REACTIONS.includes(m.e)) showReact(id, m.e); break;
        case 'cap': {
          if (!metaRef.current.transcribe) return;
          const text = str(m.text, 1000).trim(); if (!text) return;
          const lang = m.lang === 'en-US' ? 'en-US' : 'id-ID';
          const cid = m.final ? str(m.id, 20) : undefined;
          addCap({ key: m.final ? `${id}:${cid}` : `${id}:interim`, identity: id, name: nameOf(participant), text, lang, final: !!m.final, cid, ts: Date.now() });
          break;
        }
        case 'cap-tr': if (str(m.who, 80) === id || role === 'moderator') receiveTr(m); break;
        case 'wb': {
          const k = str(m.key, 80); if (!k) return;
          const mt = metaRef.current;
          const isPres = role === 'moderator' || mt.presenter === id;
          const arr = wbRef.current.get(k) || [];
          if (m.op === 'put') {
            if (!isPres && !mt.multiWb) return;
            const sh = sanitizeShape(m.s, id); if (!sh || arr.length > 3000) return;
            const i = arr.findIndex(x => x.id === sh.id);
            if (i >= 0) { if (arr[i].by !== id) return; arr[i] = sh; } else arr.push(sh);
            wbRef.current.set(k, arr);
          } else if (m.op === 'del') {
            const i = arr.findIndex(x => x.id === m.id);
            if (i >= 0 && (arr[i].by === id || isPres)) arr.splice(i, 1);
          } else if (m.op === 'clear') {
            if (!isPres) return;
            wbRef.current.set(k, []);
          } else return;
          setWbVer(v => v + 1);
          break;
        }
        case 'notes': {
          if (metaRef.current.locks?.notes && role !== 'moderator') return;
          const v = Number(m.v) || 0; const cur = notesRef.current;
          if (v < cur.v || (v === cur.v && id < cur.by)) return;
          notesRef.current = { text: str(m.text, 20000), v, by: id };
          break;
        }
        case 'sync?': if (leaderIdentity() === me().identity) sendSync(id); break;
      }
    };
    function receiveTr(m: any) {
      const who = str(m.who, 80), cid = str(m.id, 20), to = m.to === 'en' ? 'en' : m.to === 'id' ? 'id' : null;
      const text = str(m.text, 1500).trim();
      if (who && cid && to && text) setTr(`${who}:${cid}`, to, text);
    }
    const onJoin = (p: RemoteParticipant) => { if (myHand.current) send({ t: 'hand', up: true }, [p.identity]); };
    const onLeave = (p: RemoteParticipant) => setHands(h => { if (!h[p.identity]) return h; const n = { ...h }; delete n[p.identity]; return n; });
    const onMeta = (md: string) => applyMeta(md);
    const onState = (s: ConnectionState) => setConn(s);
    const onDisc = (reason?: DisconnectReason) => {
      if (switching.current) return;
      const why = reason === DisconnectReason.PARTICIPANT_REMOVED ? 'Anda dikeluarkan dari meeting oleh moderator.'
        : reason === DisconnectReason.ROOM_DELETED ? 'Meeting telah diakhiri oleh moderator.'
        : reason === DisconnectReason.CLIENT_INITIATED ? '' : 'Koneksi ke meeting terputus.';
      optsRef.current.onLeft(why);
    };
    // Riwayat dari "pemimpin" (web atau aplikasi): chat, catatan bersama, whiteboard
    try {
      room.registerTextStreamHandler('km-sync', async (reader, info) => {
        try {
          const text = await reader.readAll();
          if (text.length > 2_000_000 || info.identity !== leaderIdentity()) return;
          const obj = JSON.parse(text);
          if (obj?.wb && typeof obj.wb === 'object') {
            for (const [k, arr] of Object.entries(obj.wb).slice(0, 200)) {
              if (!Array.isArray(arr)) continue;
              wbRef.current.set(str(k, 80), arr.slice(0, 3000).map((x: any) => sanitizeShape(x, str(x?.by, 64) || info.identity)).filter(Boolean) as Shape[]);
            }
            setWbVer(v => v + 1);
          }
          if (Array.isArray(obj?.chat)) {
            const have = new Set(chatRef.current.map(c => c.id));
            const add: ChatMsg[] = obj.chat.slice(-100).filter((c: any) => typeof c?.text === 'string' && !have.has(str(c.id, 20)))
              .map((c: any) => ({ id: str(c.id, 20) || rid(), from: str(c.from, 64), name: str(c.name, 60), text: c.text.slice(0, 1000), ts: Number(c.ts) || Date.now() }));
            if (add.length) setChat(c => { const next = [...add, ...c].sort((a, b) => a.ts - b.ts).slice(-300); chatRef.current = next; return next; });
          }
          if (obj?.notes && typeof obj.notes.text === 'string' && (Number(obj.notes.v) || 0) >= notesRef.current.v) {
            notesRef.current = { text: obj.notes.text.slice(0, 20000), v: Number(obj.notes.v) || 0, by: str(obj.notes.by, 64) };
          }
        } catch { /* abaikan */ }
      });
    } catch { /* sudah terdaftar */ }
    room.on(RoomEvent.DataReceived, onData).on(RoomEvent.ParticipantConnected, onJoin).on(RoomEvent.ParticipantDisconnected, onLeave)
      .on(RoomEvent.RoomMetadataChanged, onMeta).on(RoomEvent.ConnectionStateChanged, onState).on(RoomEvent.Disconnected, onDisc);
    return () => {
      try { room.unregisterTextStreamHandler('km-sync'); } catch { /* abaikan */ }
      room.off(RoomEvent.DataReceived, onData).off(RoomEvent.ParticipantConnected, onJoin).off(RoomEvent.ParticipantDisconnected, onLeave)
        .off(RoomEvent.RoomMetadataChanged, onMeta).off(RoomEvent.ConnectionStateChanged, onState).off(RoomEvent.Disconnected, onDisc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Terjemahkan ulang teks yang tampil bila bahasa tujuan diganti
  useEffect(() => { if (opts.trTo) Object.values(caps).forEach(c => ensureTr(c, opts.trTo as Lang2)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [opts.trTo]);

  const reactTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function showReact(id: string, e: string) {
    setReacts(r => ({ ...r, [id]: e }));
    clearTimeout(reactTimers.current.get(id));
    reactTimers.current.set(id, setTimeout(() => setReacts(r => { const n = { ...r }; delete n[id]; return n; }), 4000));
  }

  // ---------- Koneksi ----------
  const enableMedia = useCallback(async (audio: boolean, video: boolean) => {
    const lp = room.localParticipant;
    if (audio) { try { await lp.setMicrophoneEnabled(true); } catch { optsRef.current.toast('Mikrofon tidak dapat dinyalakan (dikunci moderator atau izin ditolak).'); } }
    if (video) { try { await lp.setCameraEnabled(true); } catch { optsRef.current.toast('Kamera tidak dapat dinyalakan (dikunci moderator atau izin ditolak).'); } }
  }, [room]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await askPermissions(session.audio, session.video);
      try { await AudioSession.startAudioSession(); } catch { /* abaikan */ }
      try { await room.connect(session.url, session.token, { autoSubscribe: true }); }
      catch { if (alive) setError('Gagal terhubung ke server media. Periksa koneksi internet lalu coba lagi.'); return; }
      if (!alive) { room.disconnect(); return; }
      applyMeta(room.metadata);
      requestSync();
      let m: Meta = {}; try { m = JSON.parse(room.metadata || '{}'); } catch { /* abaikan */ }
      const muteOnJoin = !!m.muteOnJoin && session.role !== 'moderator';
      await enableMedia(session.audio && !muteOnJoin, session.video);
      if (muteOnJoin && session.audio) optsRef.current.toast('Anda masuk dalam keadaan bisu sesuai pengaturan moderator.');
      // Riwayat transkrip sesi berjalan
      try {
        const { lines: rows } = await meetApi<{ lines: { identity: string; name: string; lang: string; text: string; cid: string | null; ts: number; tr_lang: string | null; tr_text: string | null }[] }>(session, 'GET', '/transcript');
        if (rows.length && alive) {
          setLines(rows.slice(-200).map(r => ({ key: `${r.identity}:${r.cid || r.ts}`, identity: r.identity, name: r.name, text: r.text, lang: r.lang, final: true, cid: r.cid || undefined, ts: r.ts * 1000 })));
          setTrs(t => { const n = { ...t }; for (const r of rows) if (r.tr_text && r.tr_lang) n[`${r.identity}:${r.cid || r.ts}`] = { ...n[`${r.identity}:${r.cid || r.ts}`], [SHORT[r.tr_lang]]: r.tr_text }; return n; });
        }
      } catch { /* transkripsi belum pernah aktif */ }
    })();
    return () => { alive = false; room.disconnect(); AudioSession.stopAudioSession().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  /** Pindah ruang: 0 = ruang utama, n = ruang kelompok ke-n. */
  const goRoom = useCallback(async (n: number) => {
    if (switching.current) return;
    switching.current = true;
    const lp = room.localParticipant;
    const mic = lp.isMicrophoneEnabled, cam = lp.isCameraEnabled;
    try {
      await meetApi(seat, 'POST', '/breakout/go', { n });
      const t = await meetApi<{ url: string; token: string }>(seat, 'POST', '/token');
      await room.disconnect();
      setCaps({}); setHands({}); myHand.current = false;
      wbRef.current.clear(); setWbVer(v => v + 1);
      await room.connect(t.url, t.token, { autoSubscribe: true });
      applyMeta(room.metadata);
      requestSync();
      setSeat(s => ({ ...s, token: t.token }));
      await enableMedia(mic, cam);
      sys(n ? 'Anda masuk ke ruang kelompok.' : 'Anda kembali ke ruang utama.');
    } catch (e) { optsRef.current.toast((e as Error).message || 'Gagal pindah ruang'); }
    finally { switching.current = false; }
  }, [room, seat, applyMeta, enableMedia, sys]);

  goRoomRef.current = goRoom;

  // ---------- Aksi ----------
  const actions = useMemo(() => ({
    toggleMic: async () => {
      const lp = room.localParticipant; const on = !lp.isMicrophoneEnabled;
      try { await lp.setMicrophoneEnabled(on); } catch { optsRef.current.toast(metaRef.current.locks?.mic ? 'Mikrofon peserta sedang dikunci moderator.' : 'Mikrofon tidak dapat dinyalakan.'); }
    },
    toggleCam: async () => {
      const lp = room.localParticipant; const on = !lp.isCameraEnabled;
      try { await lp.setCameraEnabled(on); } catch { optsRef.current.toast(metaRef.current.locks?.webcam ? 'Kamera peserta sedang dikunci moderator.' : 'Kamera tidak dapat dinyalakan.'); }
    },
    switchCamera: async () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.track as LocalVideoTrack | undefined; if (!track) return;
      const mst = track.mediaStreamTrack as unknown as { _switchCamera?: () => void };
      if (typeof mst._switchCamera === 'function') mst._switchCamera();
    },
    sendChat: (text: string) => {
      const t = text.trim().slice(0, 1000); if (!t) return;
      const msg = { t: 'chat', id: rid(), text: t, ts: Date.now() };
      send(msg);
      addChat({ id: msg.id, from: room.localParticipant.identity, name: nameOf(room.localParticipant), text: t, ts: Date.now(), mine: true });
    },
    setHand: (up: boolean) => {
      myHand.current = up; send({ t: 'hand', up });
      setHands(h => { const n = { ...h }; if (up) n[room.localParticipant.identity] = Date.now(); else delete n[room.localParticipant.identity]; return n; });
    },
    react: (e: string) => { send({ t: 'react', e }); showReact(room.localParticipant.identity, e); },
    setChatOpen: (o: boolean) => { chatOpen.current = o; if (o) setUnread(0); },
    setTranscribe: (on: boolean) => meetApi(seat, 'POST', '/mod/transcribe', { on }),
    /** Rekam di server (LiveKit Egress → Google Drive). Hanya moderator, hanya bila admin memakai mode egress. */
    setRecording: (on: boolean) => meetApi(seat, 'POST', '/mod/recording', { on }),
    /** Berbagi layar HP (Android: MediaProjection; sistem menampilkan dialog izin terlebih dulu). */
    toggleScreen: async () => {
      const lp = room.localParticipant; const on = !lp.isScreenShareEnabled;
      try {
        await lp.setScreenShareEnabled(on, on ? { audio: false, resolution: { width: 1280, height: 720, frameRate: 10 } } : undefined);
        if (on) optsRef.current.toast('Layar HP Anda sedang dibagikan ke semua peserta');
      } catch (e) {
        const msg = (e as Error)?.message || '';
        optsRef.current.toast(/permission|denied|NotAllowed/i.test(msg) ? 'Izin berbagi layar ditolak.' : `Tidak dapat berbagi layar${msg ? `: ${msg}` : ''}`);
      }
    },
    /** Presenter/moderator: pindah slide. */
    gotoSlide: (n: number) => {
      const p = metaRef.current.pres; if (!p) return Promise.resolve();
      const page = Math.max(1, Math.min(p.pages || 1, n));
      return meetApi(seat, 'POST', '/state/presentation', { id: p.id, page, pages: p.pages });
    },
    muteAll: () => meetApi(seat, 'POST', '/mod/mute', { all: true, exceptPresenter: true }),
    mute: (identity: string) => meetApi(seat, 'POST', '/mod/mute', { identity }),
    kick: (identity: string) => meetApi(seat, 'POST', '/mod/kick', { identity }),
    endAll: async () => { switching.current = true; try { await meetApi(seat, 'POST', '/mod/end', {}); } catch { /* abaikan */ } await room.disconnect(); },
    lowerHand: (id: string) => { send({ t: 'hand-lower', id }); setHands(h => { const n = { ...h }; delete n[id]; return n; }); },
    goRoom,
    leave: async () => {
      switching.current = true;
      try { await meetApi(seat, 'POST', '/leave', { seat: seat.seat }); } catch { /* abaikan */ }
      await room.disconnect();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [room, seat, send, addChat, goRoom]);

  // Hanya pratinjau browser: kait uji otomatis (tidak aktif di Android)
  if (Platform.OS === 'web') (globalThis as unknown as { __kmDebug?: object }).__kmDebug = { myFinal, myInterim, setTr, room };

  const shapesFor = useCallback((key: string) => wbRef.current.get(key) || [], []);
  return { room, conn, meta, chat, unread, hands, reacts, caps, lines, trs, error, actions, myFinal, myInterim, myHand, wbVer, shapesFor };
}
