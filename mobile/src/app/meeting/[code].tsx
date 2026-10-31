// Ruang meeting ala Zoom mobile:
// • geser kiri/kanan: tampilan pembicara ⇄ galeri (4 per halaman)
// • bilah atas: speaker, ganti kamera, nama room + durasi, tombol Keluar
// • bilah bawah: Mikrofon, Video, Peserta, Chat, Lainnya
// • teks langsung (CC) + terjemahan Indonesia ⇄ Inggris di atas bilah bawah
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, BackHandler, FlatList, Pressable, ScrollView, Share, StyleSheet, TextInput, useWindowDimensions, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AudioSession, RoomContext, isTrackReference, useLocalParticipant, useParticipants, useSpeakingParticipants, useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { ConnectionState, Track, type Participant } from 'livekit-client';
import { Avatar, Button, Segmented, Sheet, SwitchRow, T, type IconName } from '@/components/ui';
import { Tile } from '@/components/meeting/Tile';
import { Captions } from '@/components/meeting/Captions';
import { getSession, setSession, type Session } from '@/lib/meet';
import { REACTIONS, nameOf, roleOf, useMeeting, type Cap } from '@/lib/useMeeting';
import { useTranscriber } from '@/lib/useTranscriber';
import { hasDeviceTranslate, prepareTranslate, SHORT, type Lang2 } from '@/lib/translate';
import { getJSON, setJSON } from '@/lib/store';
import { getServer } from '@/lib/api';
import { nextPrayer } from '@/lib/prayer';
import { fmtClock } from '@/lib/format';
import { C, F } from '@/lib/theme';

type TrPrefs = { lang: 'id-ID' | 'en-US'; to: Lang2 | ''; cc: boolean; orig: boolean; mine: boolean };
type SheetName = 'people' | 'chat' | 'more' | 'tr' | 'info' | 'bo' | null;

export default function MeetingScreen() {
  const session = getSession();
  if (!session) return <Redirect href="/" />;
  return <Meeting session={session} />;
}

function Meeting({ session }: { session: Session }) {
  useKeepAwake();
  const [trPrefs, setTrPrefs] = useState<TrPrefs>({ lang: 'id-ID', to: '', cc: true, orig: true, mine: true });
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setToastMsg(m); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3500);
  }, []);
  const left = useRef(false);
  const onLeft = useCallback((why: string) => {
    if (left.current) return; left.current = true;
    setSession(null);
    if (why) Alert.alert('Meeting', why);
    if (router.canGoBack()) router.back(); else router.replace('/');
  }, []);
  useEffect(() => { getJSON<TrPrefs>('tr_prefs', trPrefs).then(setTrPrefs); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const saveTr = (p: TrPrefs) => { setTrPrefs(p); setJSON('tr_prefs', p); if (p.to) prepareTranslate(p.to === 'en' ? 'id' : 'en', p.to); };

  const m = useMeeting(session, { trTo: trPrefs.cc ? trPrefs.to : '', onLeft, toast });

  if (m.error) return (
    <View style={[s.root, { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }]}>
      <Ionicons name="cloud-offline-outline" size={48} color={C.callMuted} />
      <T color={C.callText} style={{ textAlign: 'center' }}>{m.error}</T>
      <Button title="Kembali" variant="light" onPress={() => onLeft('')} />
    </View>
  );
  return (
    <RoomContext.Provider value={m.room}>
      <CallView session={session} m={m} trPrefs={trPrefs} saveTr={saveTr} toast={toast} toastMsg={toastMsg} onLeft={onLeft} />
    </RoomContext.Provider>
  );
}

function CallView({ session, m, trPrefs, saveTr, toast, toastMsg, onLeft }: {
  session: Session; m: ReturnType<typeof useMeeting>; trPrefs: TrPrefs; saveTr: (p: TrPrefs) => void; toast: (m: string) => void; toastMsg: string; onLeft: (w: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const all = useParticipants().filter(p => roleOf(p) !== 'recorder');
  const camRefs = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const speakingList = useSpeakingParticipants();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [page, setPage] = useState(0);
  const [barsHidden, setBarsHidden] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [joinedAt] = useState(Date.now());
  const [output, setOutput] = useState<string>('speaker');
  const isMod = session.role === 'moderator';
  const meta = m.meta;
  const myId = localParticipant.identity;

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const sp = speakingList.find(p => !p.isLocal); if (sp && sp.identity !== activeId) setActiveId(sp.identity); }, [speakingList, activeId]);
  useEffect(() => { m.actions.setChatOpen(sheet === 'chat'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sheet]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (sheet) setSheet(null); else confirmLeave(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  // Transkripsi ucapan saya (hanya saat mikrofon menyala & moderator mengaktifkan transkripsi)
  const tr = useTranscriber({
    enabled: !!meta.transcribe && isMicrophoneEnabled && trPrefs.mine && m.conn === ConnectionState.Connected,
    lang: trPrefs.lang, onInterim: m.myInterim, onFinal: m.myFinal,
  });

  // Ruang kelompok: kembali otomatis saat ruang ditutup
  const boReturning = useRef(false);
  useEffect(() => {
    if (meta.bo?.closingAt && now / 1000 > meta.bo.closingAt + 2 && !boReturning.current) { boReturning.current = true; m.actions.goRoom(0).finally(() => { boReturning.current = false; }); }
  }, [now, meta.bo?.closingAt, m.actions]);

  const camOf = useMemo(() => { const map = new Map<string, TrackReferenceOrPlaceholder>(); camRefs.forEach(r => map.set(r.participant.identity, r)); return map; }, [camRefs]);
  const others = all.filter(p => !p.isLocal);
  const local = all.find(p => p.isLocal) || localParticipant;
  // Kunci "lihat kamera": peserta hanya melihat kamera moderator/presenter/yang disorot
  const canSeeVideo = (p: Participant) => isMod || p.isLocal || !meta.locks?.seeCams || roleOf(p) === 'moderator' || p.identity === meta.presenter || p.identity === meta.spotlight;
  const screen = screens.find(isTrackReference);
  const featured: Participant = (meta.spotlight && all.find(p => p.identity === meta.spotlight))
    || (activeId && others.find(p => p.identity === activeId)) || others.find(p => p.identity === meta.presenter) || others[0] || local;
  const ordered = [local, ...others.sort((a, b) => (m.hands[b.identity] ? 1 : 0) - (m.hands[a.identity] ? 1 : 0))];
  const galleryPages = useMemo(() => { const pages: Participant[][] = []; for (let i = 0; i < ordered.length; i += 4) pages.push(ordered.slice(i, i + 4)); return pages; }, [ordered]);
  const pageCount = 1 + (others.length ? galleryPages.length : 0);

  const elapsed = meta.startedAt ? now - meta.startedAt * 1000 : now - joinedAt;
  const handUp = !!m.hands[myId];
  const chatLocked = !!meta.locks?.publicChat && !isMod;
  const usersHidden = !!meta.locks?.seeUsers && !isMod;

  function confirmLeave() {
    const btns: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [{ text: 'Batal', style: 'cancel' }];
    if (isMod && !meta.bo) btns.push({ text: 'Akhiri untuk semua', style: 'destructive', onPress: () => Alert.alert('Akhiri meeting untuk semua?', 'Semua peserta akan dikeluarkan.', [{ text: 'Batal', style: 'cancel' }, { text: 'Akhiri', style: 'destructive', onPress: async () => { await m.actions.endAll(); onLeft(''); } }]) });
    btns.push({ text: 'Keluar dari meeting', style: 'destructive', onPress: async () => { await m.actions.leave(); onLeft(''); } });
    Alert.alert('Keluar dari meeting?', isMod ? 'Meeting tetap berjalan bila Anda hanya keluar.' : undefined, btns);
  }
  async function cycleOutput() {
    try {
      const outs = (await AudioSession.getAudioOutputs()).filter(o => o !== 'default');
      if (!outs.length) return;
      const next = outs[(outs.indexOf(output) + 1) % outs.length];
      await AudioSession.selectAudioOutput(next); setOutput(next);
      toast(({ speaker: 'Pengeras suara', earpiece: 'Earpiece (telinga)', headset: 'Headset', bluetooth: 'Bluetooth' } as Record<string, string>)[next] || next);
    } catch { /* abaikan */ }
  }
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const topH = 56; const botH = 70;
  const stageH = height - insets.top - insets.bottom;
  const tileStyle = (n: number) => {
    const cols = landscape ? Math.min(n, 4) : n <= 1 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const gw = width - 16, gh = stageH - topH - botH - 16;
    return { width: (gw - (cols - 1) * 8) / cols, height: Math.min((gh - (rows - 1) * 8) / rows, ((gw - (cols - 1) * 8) / cols) * (landscape ? 0.75 : 1.5)) };
  };

  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="light" />
      {/* ---------- Panggung ---------- */}
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} style={StyleSheet.absoluteFill} contentContainerStyle={{ paddingTop: insets.top }}>
        <Pressable style={{ width, height: stageH }} onPress={() => setBarsHidden(h => !h)}>
          <View style={{ flex: 1, marginTop: barsHidden ? 0 : topH, marginBottom: barsHidden ? 0 : botH, padding: 6 }}>
            {screen ? (
              <View style={{ flex: 1 }}>
                <Tile p={screen.participant} cam={screen} big fit="contain" style={{ flex: 1 }} label={`Layar ${nameOf(screen.participant)}`} />
              </View>
            ) : (
              <Tile key={featured.identity} p={featured} cam={camOf.get(featured.identity)} big style={{ flex: 1 }} hideVideo={!canSeeVideo(featured)} hand={!!m.hands[featured.identity]} react={m.reacts[featured.identity]} />
            )}
            {others.length && !featured.isLocal ? (
              <View style={[s.pip, landscape && { width: 150, height: 100 }]}>
                <Tile p={local} cam={camOf.get(local.identity)} style={{ flex: 1 }} hand={handUp} react={m.reacts[myId]} label="Saya" />
              </View>
            ) : null}
            {meta.pres && !screen ? <View style={s.presNote}><Ionicons name="easel-outline" size={16} color={C.gold} /><T size={12.5} color="#fff" style={{ flex: 1 }}>Moderator menampilkan presentasi/whiteboard — slide tampil di versi web.</T></View> : null}
          </View>
        </Pressable>
        {others.length ? galleryPages.map((pg, i) => {
          const st = tileStyle(pg.length);
          return (
            <Pressable key={i} style={{ width, height: stageH }} onPress={() => setBarsHidden(h => !h)}>
              <View style={[s.grid, { marginTop: topH, marginBottom: botH }]}>
                {pg.map(p => <Tile key={p.identity} p={p} cam={camOf.get(p.identity)} style={st} hideVideo={!canSeeVideo(p)} hand={!!m.hands[p.identity]} react={m.reacts[p.identity]} />)}
              </View>
            </Pressable>
          );
        }) : null}
      </ScrollView>

      {/* ---------- Bilah atas ---------- */}
      {!barsHidden ? (
        <View style={[s.top, { top: insets.top }]}>
          <TopBtn icon={output === 'earpiece' ? 'ear-outline' : output === 'bluetooth' ? 'bluetooth' : output === 'headset' ? 'headset-outline' : 'volume-high'} label="Audio keluar" onPress={cycleOutput} />
          {isCameraEnabled ? <TopBtn icon="camera-reverse-outline" label="Ganti kamera" onPress={m.actions.switchCamera} /> : <View style={{ width: 40 }} />}
          <Pressable style={s.title} onPress={() => setSheet('info')} accessibilityLabel="Info meeting">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {meta.recording ? <View style={s.rec} /> : null}
              <T w="bold" size={15} color="#fff" numberOfLines={1} style={{ maxWidth: width - 220 }}>{meta.name || session.room.name}</T>
              <Ionicons name="chevron-down" size={14} color={C.callMuted} />
            </View>
            <T size={12} color={C.callMuted}>{m.conn === ConnectionState.Connected ? fmtClock(elapsed) : m.conn === ConnectionState.Reconnecting ? 'Menyambung ulang…' : 'Menghubungkan…'}</T>
          </Pressable>
          <Pressable style={s.leave} onPress={confirmLeave} accessibilityLabel="Keluar dari meeting"><T w="bold" size={14} color="#fff">Keluar</T></Pressable>
        </View>
      ) : null}

      {/* ---------- Banner ruang kelompok ---------- */}
      <BreakoutBanner meta={meta} myId={myId} now={now} isMod={isMod} onGo={m.actions.goRoom} onChoose={() => setSheet('bo')} top={insets.top + (barsHidden ? 6 : topH + 4)} />

      {/* ---------- CC + titik halaman ---------- */}
      <View style={[s.capArea, { bottom: insets.bottom + (barsHidden ? 6 : botH + 4) }]} pointerEvents="none">
        {trPrefs.cc && meta.transcribe ? <Captions caps={m.caps} trs={m.trs} trTo={trPrefs.to} showOriginal={trPrefs.orig} now={now} /> : null}
      </View>
      {pageCount > 1 && !barsHidden ? (
        <View style={[s.dots, { bottom: insets.bottom + botH + 2 }]} pointerEvents="none">
          {Array.from({ length: pageCount }).map((_, i) => <View key={i} style={[s.dot, i === page && s.dotOn]} />)}
        </View>
      ) : null}

      {/* ---------- Bilah bawah ---------- */}
      {!barsHidden ? (
        <View style={[s.bottom, { bottom: insets.bottom }]}>
          <BarBtn icon={isMicrophoneEnabled ? 'mic' : 'mic-off'} label={isMicrophoneEnabled ? 'Bisukan' : 'Bunyikan'} warn={!isMicrophoneEnabled} onPress={() => { Haptics.selectionAsync().catch(() => {}); m.actions.toggleMic(); }} />
          <BarBtn icon={isCameraEnabled ? 'videocam' : 'videocam-off'} label={isCameraEnabled ? 'Hentikan Video' : 'Mulai Video'} warn={!isCameraEnabled} onPress={m.actions.toggleCam} />
          <BarBtn icon="people" label="Peserta" badge={usersHidden ? undefined : String(all.length)} onPress={() => setSheet('people')} />
          <BarBtn icon="chatbubble-ellipses" label="Chat" badge={m.unread ? String(m.unread) : undefined} badgeRed onPress={() => setSheet('chat')} />
          <BarBtn icon="ellipsis-horizontal" label="Lainnya" onPress={() => setSheet('more')} dot={handUp} />
        </View>
      ) : null}

      {toastMsg ? <View style={[s.toast, { top: insets.top + topH + 10 }]} pointerEvents="none"><T w="semibold" size={14} color="#fff" style={{ textAlign: 'center' }}>{toastMsg}</T></View> : null}

      {/* ---------- Sheet ---------- */}
      <PeopleSheet visible={sheet === 'people'} onClose={() => setSheet(null)} all={ordered} hands={m.hands} isMod={isMod} hidden={usersHidden} myId={myId}
        onMuteAll={async () => { try { await m.actions.muteAll(); toast('Semua peserta dibisukan'); } catch (e) { toast((e as Error).message); } }}
        onAct={(p) => personMenu(p)} handUp={handUp} onHand={() => m.actions.setHand(!handUp)} />
      <ChatSheet visible={sheet === 'chat'} onClose={() => setSheet(null)} chat={m.chat} locked={chatLocked} onSend={m.actions.sendChat} />
      <Sheet dark visible={sheet === 'more'} onClose={() => setSheet(null)} title="Lainnya">
        <View style={s.reactRow}>
          {REACTIONS.map(e => <Pressable key={e} style={s.reactBtn} onPress={() => { m.actions.react(e); setSheet(null); }} accessibilityLabel={`Reaksi ${e}`}><T size={28}>{e}</T></Pressable>)}
        </View>
        <MoreItem icon="hand-left" label={handUp ? 'Turunkan tangan' : 'Angkat tangan'} onPress={() => { m.actions.setHand(!handUp); setSheet(null); }} active={handUp} />
        <MoreItem icon="language" label="Transkripsi & terjemahan" desc={meta.transcribe ? `Aktif · ${trPrefs.lang === 'id-ID' ? 'Indonesia' : 'English'}${trPrefs.to ? ` → ${trPrefs.to === 'en' ? 'English' : 'Indonesia'}` : ''}` : isMod ? 'Mulai transkripsi untuk room ini' : 'Belum diaktifkan moderator'} onPress={() => setSheet('tr')} />
        {meta.breakout?.active && !meta.bo ? <MoreItem icon="git-branch-outline" label="Ruang kelompok" desc="Pilih/gabung ruang diskusi" onPress={() => setSheet('bo')} /> : null}
        {meta.bo ? <MoreItem icon="return-up-back" label="Kembali ke ruang utama" onPress={() => { setSheet(null); m.actions.goRoom(0); }} /> : null}
        <MoreItem icon="moon-outline" label="Jadwal salat & azan" desc={`Berikutnya: ${nextPrayer().name} ${nextPrayer().time} WIB`} onPress={() => { setSheet(null); router.push('/prayer'); }} />
        <MoreItem icon="information-circle-outline" label="Info meeting & undangan" onPress={() => setSheet('info')} />
      </Sheet>
      <TranscriptSheet visible={sheet === 'tr'} onClose={() => setSheet(null)} meta={meta} isMod={isMod} prefs={trPrefs} save={saveTr} status={tr.status} err={tr.errMsg} lines={m.lines} trs={m.trs}
        onToggle={async (on) => { try { await m.actions.setTranscribe(on); toast(on ? 'Transkripsi dimulai' : 'Transkripsi dihentikan'); } catch (e) { toast((e as Error).message); } }} micOn={isMicrophoneEnabled} />
      <Sheet dark visible={sheet === 'info'} onClose={() => setSheet(null)} title="Info meeting">
        <InfoRow label="Nama" value={meta.name || session.room.name} />
        <InfoRow label="ID room" value={session.room.id} />
        <InfoRow label="Peran Anda" value={isMod ? 'Moderator' : 'Peserta'} />
        <InfoRow label="Tautan" value={`${getServer().replace(/^https?:\/\//, '')}/r/${session.room.id}`} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button small style={{ flex: 1 }} variant="light" icon="copy-outline" title="Salin tautan" onPress={async () => { await Clipboard.setStringAsync(`${getServer()}/r/${session.room.id}`); toast('Tautan disalin'); }} />
          <Button small style={{ flex: 1 }} icon="share-social-outline" title="Undang" onPress={() => Share.share({ message: `Gabung ke meeting UIKA Meet "${meta.name || session.room.name}"\n${getServer()}/r/${session.room.id}\nID room: ${session.room.id}` })} />
        </View>
        {meta.welcome ? <T size={14} color={C.callMuted}>{meta.welcome}</T> : null}
      </Sheet>
      <Sheet dark visible={sheet === 'bo'} onClose={() => setSheet(null)} title="Ruang kelompok">
        {(meta.breakout?.rooms || []).map((r, i) => {
          const assigned = meta.breakout?.assign?.[myId] === i + 1;
          const can = isMod || meta.breakout?.allowChoose || assigned;
          return <MoreItem key={i} icon="people-circle-outline" label={r.name} desc={assigned ? 'Ruang Anda' : can ? 'Ketuk untuk bergabung' : 'Hanya untuk anggota ruang ini'} active={assigned}
            onPress={can ? () => { setSheet(null); m.actions.goRoom(i + 1); } : undefined} />;
        })}
      </Sheet>
    </View>
  );

  function personMenu(p: Participant) {
    if (!isMod || p.isLocal) return;
    Alert.alert(nameOf(p), undefined, [
      { text: 'Bisukan', onPress: () => m.actions.mute(p.identity).catch(e => toast(e.message)) },
      ...(m.hands[p.identity] ? [{ text: 'Turunkan tangan', onPress: () => m.actions.lowerHand(p.identity) }] : []),
      { text: 'Keluarkan', style: 'destructive' as const, onPress: () => Alert.alert('Keluarkan peserta?', nameOf(p), [{ text: 'Batal', style: 'cancel' }, { text: 'Keluarkan', style: 'destructive', onPress: () => m.actions.kick(p.identity).catch(e => toast(e.message)) }]) },
      { text: 'Tutup', style: 'cancel' as const },
    ]);
  }
}

// ==================== Bagian-bagian kecil ====================
function TopBtn({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} hitSlop={8} style={s.topBtn} accessibilityLabel={label}><Ionicons name={icon} size={22} color="#fff" /></Pressable>;
}
function BarBtn({ icon, label, onPress, warn, badge, badgeRed, dot }: { icon: IconName; label: string; onPress: () => void; warn?: boolean; badge?: string; badgeRed?: boolean; dot?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.barBtn, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View>
        <Ionicons name={icon} size={25} color={warn ? '#FF6B6B' : '#fff'} />
        {badge ? <View style={[s.badge, badgeRed && { backgroundColor: C.danger }]}><T w="bold" size={10.5} color="#fff">{badge}</T></View> : null}
        {dot ? <View style={s.badgeDot} /> : null}
      </View>
      <T w="semibold" size={11} color={warn ? '#FFB4B4' : C.callMuted} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}
function MoreItem({ icon, label, desc, onPress, active }: { icon: IconName; label: string; desc?: string; onPress?: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.more, pressed && { backgroundColor: '#1B2A25' }, !onPress && { opacity: 0.5 }]}>
      <View style={[s.moreIc, active && { backgroundColor: C.gold }]}><Ionicons name={icon} size={21} color={active ? C.deep : '#fff'} /></View>
      <View style={{ flex: 1 }}>
        <T w="semibold" size={15.5} color="#fff">{label}</T>
        {desc ? <T size={12.5} color={C.callMuted}>{desc}</T> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={C.callMuted} /> : null}
    </Pressable>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={{ gap: 2 }}><T size={12.5} color={C.callMuted}>{label}</T><T w="semibold" size={15.5} color="#fff" selectable>{value}</T></View>;
}

function BreakoutBanner({ meta, myId, now, isMod, onGo, onChoose, top }: { meta: ReturnType<typeof useMeeting>['meta']; myId: string; now: number; isMod: boolean; onGo: (n: number) => void; onChoose: () => void; top: number }) {
  let text = ''; let btn = ''; let act: (() => void) | null = null; let warn = false;
  if (meta.bo) {
    const closing = meta.bo.closingAt ? Math.max(0, Math.round(meta.bo.closingAt - now / 1000)) : null;
    if (closing != null) { text = `Ruang kelompok ditutup dalam ${closing} detik`; warn = true; }
    else text = `${meta.bo.name}${meta.bo.endsAt ? ` · sisa ${fmtClock(meta.bo.endsAt * 1000 - now)}` : ''}`;
    btn = 'Kembali'; act = () => onGo(0);
  } else if (meta.breakout?.active) {
    const n = meta.breakout.assign?.[myId];
    if (n) { text = `Anda ditempatkan di ${meta.breakout.rooms[n - 1]?.name || `Ruang ${n}`}`; btn = 'Gabung'; act = () => onGo(n); }
    else if (meta.breakout.allowChoose || isMod) { text = 'Ruang kelompok dibuka'; btn = 'Pilih'; act = onChoose; }
  }
  if (!text) return null;
  return (
    <View style={[s.bo, { top }, warn && { backgroundColor: '#7C2D12' }]}>
      <Ionicons name="git-branch-outline" size={17} color={C.gold} />
      <T w="semibold" size={13.5} color="#fff" style={{ flex: 1 }} numberOfLines={2}>{text}</T>
      {act ? <Pressable style={s.boBtn} onPress={act}><T w="bold" size={13} color={C.deep}>{btn}</T></Pressable> : null}
    </View>
  );
}

function PeopleSheet({ visible, onClose, all, hands, isMod, hidden, myId, onMuteAll, onAct, handUp, onHand }: {
  visible: boolean; onClose: () => void; all: Participant[]; hands: Record<string, number>; isMod: boolean; hidden: boolean; myId: string;
  onMuteAll: () => void; onAct: (p: Participant) => void; handUp: boolean; onHand: () => void;
}) {
  return (
    <Sheet dark full visible={visible} onClose={onClose} title={hidden ? 'Peserta' : `Peserta (${all.length})`} scroll={false}>
      {hidden ? <T color={C.callMuted} style={{ padding: 18 }}>Daftar peserta disembunyikan oleh moderator.</T> : (
        <FlatList data={all} keyExtractor={p => p.identity} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderItem={({ item: p }) => (
            <Pressable onPress={() => onAct(p)} style={s.person}>
              <Avatar name={nameOf(p)} size={40} dark />
              <View style={{ flex: 1 }}>
                <T w="semibold" size={15} color="#fff" numberOfLines={1}>{nameOf(p)}{p.identity === myId ? ' (Saya)' : ''}</T>
                <T size={12.5} color={C.callMuted}>{roleOf(p) === 'moderator' ? 'Moderator' : 'Peserta'}</T>
              </View>
              {hands[p.identity] ? <T size={18}>✋</T> : null}
              <Ionicons name={p.isMicrophoneEnabled ? 'mic' : 'mic-off'} size={19} color={p.isMicrophoneEnabled ? '#fff' : '#FF8A8A'} />
              <Ionicons name={p.isCameraEnabled ? 'videocam' : 'videocam-off'} size={19} color={p.isCameraEnabled ? '#fff' : '#FF8A8A'} />
            </Pressable>
          )} />
      )}
      <View style={{ flexDirection: 'row', gap: 10, padding: 14 }}>
        <Button small style={{ flex: 1 }} variant={handUp ? 'gold' : 'light'} icon="hand-left" title={handUp ? 'Turunkan tangan' : 'Angkat tangan'} onPress={onHand} />
        {isMod ? <Button small style={{ flex: 1 }} variant="light" icon="mic-off" title="Bisukan semua" onPress={onMuteAll} /> : null}
      </View>
    </Sheet>
  );
}

function ChatSheet({ visible, onClose, chat, locked, onSend }: { visible: boolean; onClose: () => void; chat: ReturnType<typeof useMeeting>['chat']; locked: boolean; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);
  return (
    <Sheet dark full visible={visible} onClose={onClose} title="Chat" scroll={false}>
      <FlatList ref={listRef} data={chat} keyExtractor={c => c.id} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<T color={C.callMuted} style={{ textAlign: 'center', marginTop: 30 }}>Belum ada pesan. Sapa peserta lain 👋</T>}
        renderItem={({ item: c }) => c.sys ? <T size={12.5} color={C.callMuted} style={{ textAlign: 'center' }}>{c.text}</T> : (
          <View style={[s.msg, c.mine && s.msgMine]}>
            {!c.mine ? <T w="bold" size={12.5} color={C.gold}>{c.name}{c.priv ? ' · pesan pribadi' : ''}</T> : null}
            <T size={15} color="#fff" selectable>{c.text}</T>
          </View>
        )} />
      <View style={s.chatInput}>
        <TextInput value={text} onChangeText={setText} editable={!locked} placeholder={locked ? 'Chat publik dikunci moderator' : 'Tulis pesan…'} placeholderTextColor="#7F978F"
          style={s.chatField} multiline maxLength={1000} />
        <Pressable onPress={() => { onSend(text); setText(''); }} disabled={locked || !text.trim()} style={[s.send, (locked || !text.trim()) && { opacity: 0.4 }]} accessibilityLabel="Kirim">
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </Sheet>
  );
}

function TranscriptSheet({ visible, onClose, meta, isMod, prefs, save, status, err, lines, trs, onToggle, micOn }: {
  visible: boolean; onClose: () => void; meta: ReturnType<typeof useMeeting>['meta']; isMod: boolean; prefs: TrPrefs; save: (p: TrPrefs) => void;
  status: string; err: string; lines: Cap[]; trs: Record<string, Partial<Record<Lang2, string>>>; onToggle: (on: boolean) => void; micOn: boolean;
}) {
  const on = !!meta.transcribe;
  return (
    <Sheet dark full visible={visible} onClose={onClose} title="Transkripsi & terjemahan">
      {!on && !isMod ? <T color={C.callMuted}>Transkripsi belum dimulai. Minta moderator menekan “Mulai transkripsi”.</T> : null}
      <T w="semibold" size={14} color={C.callMuted}>Bahasa asal (ucapan saya)</T>
      <Segmented dark value={prefs.lang} onChange={(v) => save({ ...prefs, lang: v })} options={[{ value: 'id-ID', label: 'Indonesia' }, { value: 'en-US', label: 'English' }]} />
      <T w="semibold" size={14} color={C.callMuted}>Bahasa tujuan (terjemahan)</T>
      <Segmented dark value={prefs.to || 'none'} onChange={(v) => save({ ...prefs, to: v === 'none' ? '' : (v as Lang2) })} options={[{ value: 'none', label: 'Tanpa' }, { value: 'en', label: 'English' }, { value: 'id', label: 'Indonesia' }]} />
      <SwitchRow dark label="Tampilkan teks langsung (CC)" value={prefs.cc} onChange={(v) => save({ ...prefs, cc: v })} />
      <SwitchRow dark label="Tampilkan juga teks asli" desc="Teks asli di atas terjemahannya" value={prefs.orig} onChange={(v) => save({ ...prefs, orig: v })} />
      <SwitchRow dark label="Transkripsikan ucapan saya" desc={micOn ? (status === 'listening' ? '● Mendengarkan…' : status === 'starting' ? 'Menyiapkan pengenal suara…' : 'Aktif saat transkripsi room berjalan') : 'Nyalakan mikrofon untuk ikut ditranskripsi'} value={prefs.mine} onChange={(v) => save({ ...prefs, mine: v })} />
      {err ? <T size={13} color="#FCA5A5">{err}</T> : null}
      {!hasDeviceTranslate ? <T size={12.5} color={C.callMuted}>Penerjemah di perangkat tidak tersedia pada build ini; terjemahan memakai server kampus bila diaktifkan admin.</T>
        : prefs.to ? <T size={12.5} color={C.callMuted}>Terjemahan berjalan di perangkat (Google ML Kit). Model bahasa ±30 MB diunduh sekali saat pertama dipakai.</T> : null}
      {isMod ? <Button variant={on ? 'danger' : 'primary'} icon={on ? 'stop-circle-outline' : 'mic-circle-outline'} title={on ? 'Hentikan transkripsi' : 'Mulai transkripsi'} onPress={() => onToggle(!on)} /> : null}
      {lines.length ? <T w="bold" size={15} color="#fff" style={{ marginTop: 6 }}>Transkrip</T> : null}
      {lines.slice(-60).map(l => {
        const to = prefs.to && SHORT[l.lang] !== prefs.to ? prefs.to : null;
        const t = to ? trs[l.key]?.[to] : undefined;
        return (
          <View key={l.key} style={{ gap: 2 }}>
            <T w="bold" size={12.5} color={C.gold}>{l.name}</T>
            <T size={14.5} color="#fff">{l.text}</T>
            {t ? <T size={14.5} color="#A7F3D0">{t}</T> : null}
          </View>
        );
      })}
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.call },
  top: { position: 'absolute', left: 0, right: 0, height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6, backgroundColor: 'rgba(10,20,17,0.82)' },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, alignItems: 'center' },
  rec: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#EF4444' },
  leave: { backgroundColor: C.danger, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, height: 70, flexDirection: 'row', backgroundColor: C.callBar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#22332D' },
  barBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  badge: { position: 'absolute', top: -6, right: -12, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#3A4E47', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeDot: { position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.gold },
  pip: { position: 'absolute', right: 14, top: 14, width: 104, height: 150, borderRadius: 12, overflow: 'hidden', elevation: 6 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  dots: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4B5F58' },
  dotOn: { backgroundColor: '#fff' },
  capArea: { position: 'absolute', left: 0, right: 0, height: 180 },
  toast: { position: 'absolute', alignSelf: 'center', maxWidth: '86%', backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  presNote: { position: 'absolute', left: 14, right: 14, top: 14, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 9 },
  bo: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#064E3B', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  boBtn: { backgroundColor: C.gold, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  reactRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#1B2A25', borderRadius: 14, padding: 8 },
  reactBtn: { padding: 6 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderRadius: 12 },
  moreIc: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#20332C', alignItems: 'center', justifyContent: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  msg: { alignSelf: 'flex-start', maxWidth: '86%', backgroundColor: '#1D2C27', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  msgMine: { alignSelf: 'flex-end', backgroundColor: C.primary },
  chatInput: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#22332D' },
  chatField: { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: '#1B2A25', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontFamily: F.regular, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
});
