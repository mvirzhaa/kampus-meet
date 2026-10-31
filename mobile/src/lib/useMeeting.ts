// Inti ruang meeting: koneksi LiveKit, pesan data (protokol sama dengan versi web), chat, angkat tangan,
// reaksi, teks transkripsi (CC) beserta terjemahannya, dan perpindahan ruang kelompok (breakout).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { AudioSession } from '@livekit/react-native';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, VideoPresets, type LocalVideoTrack, type Participant, type RemoteParticipant } from 'livekit-client';
import { meetApi, type Session } from './meet';
import { OTHER, SHORT, translate, type Lang2 } from './translate';

export type Meta = {
  name?: string; welcome?: string; muteOnJoin?: boolean; transcribe?: boolean; trServer?: boolean; recording?: boolean;
  presenter?: string | null; spotlight?: string | null; pres?: unknown; startedAt?: number | null;
  locks?: { webcam?: boolean; mic?: boolean; seeCams?: boolean; publicChat?: boolean; privateChat?: boolean; seeUsers?: boolean };
  breakout?: { id: string; active: boolean; rooms: { name: string }[]; endsAt: number | null; closingAt: number | null; allowChoose: boolean; assign: Record<string, number> } | null;
  bo?: { n: number; name: string; rooms: number; endsAt: number | null; closingAt: number | null; main: string; mainName: string };
};
export type ChatMsg = { id: string; from: string; name: string; text: string; ts: number; mine?: boolean; sys?: boolean; priv?: boolean };
export type Cap = { key: string; identity: string; name: string; text: string; lang: string; final: boolean; cid?: string; ts: number };
export const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉'];

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
    setChat(c => [...c.slice(-299), m]);
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
  const ensureTr = useCallback((c: Cap, to: Lang2) => {
    if (!to || SHORT[c.lang] === to) return;
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
    translate(text, SHORT[lang], to).then(out => {
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

  // ---------- Pesan masuk ----------
  useEffect(() => {
    const rate = new Map<string, { n: number; t: number }>();
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic === 'km-srv' && !participant) {
        let m: any; try { m = JSON.parse(dec.decode(payload)); } catch { return; }
        if (m?.t === 'cap-tr') receiveTr(m);
        else if (m?.t === 'bo-move' && m.identity === me().identity) { optsRef.current.toast(m.n ? 'Moderator memindahkan Anda ke ruang kelompok' : 'Moderator memindahkan Anda ke ruang utama'); setTimeout(() => goRoomRef.current(parseInt(m.n, 10) || 0), 1200); }
        else if (m?.t === 'bo-msg' && metaRef.current.bo) sys(`📣 Pengumuman dari ${str(m.from || 'Moderator', 60)}: ${str(m.text, 300)}`);
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
    room.on(RoomEvent.DataReceived, onData).on(RoomEvent.ParticipantConnected, onJoin).on(RoomEvent.ParticipantDisconnected, onLeave)
      .on(RoomEvent.RoomMetadataChanged, onMeta).on(RoomEvent.ConnectionStateChanged, onState).on(RoomEvent.Disconnected, onDisc);
    return () => {
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
      await room.connect(t.url, t.token, { autoSubscribe: true });
      applyMeta(room.metadata);
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

  return { room, conn, meta, chat, unread, hands, reacts, caps, lines, trs, error, actions, myFinal, myInterim, myHand };
}
