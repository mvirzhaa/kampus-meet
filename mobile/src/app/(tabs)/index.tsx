// Beranda ala Zoom mobile: empat tombol aksi besar, pengingat salat berikutnya, dan meeting mendatang.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Empty, Sheet, SwitchRow, T, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, type RoomInfo } from '@/lib/api';
import { joinMeeting } from '@/lib/meet';
import { nextPrayer } from '@/lib/prayer';
import { fmtTime, fmtDay } from '@/lib/format';
import { C } from '@/lib/theme';

export default function Home() {
  const { me } = useAuth();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [video, setVideo] = useState(true);
  const [starting, setStarting] = useState(false);
  const [np, setNp] = useState(nextPrayer());

  const load = useCallback(async () => {
    if (!me?.user) return;
    setLoading(true);
    try { setRooms((await api<{ rooms: RoomInfo[] }>('GET', '/api/rooms')).rooms); } catch { /* offline */ }
    finally { setLoading(false); }
  }, [me?.user]);
  useFocusEffect(useCallback(() => { load(); setNp(nextPrayer()); }, [load]));
  useEffect(() => { const t = setInterval(() => setNp(nextPrayer()), 30_000); return () => clearInterval(t); }, []);

  async function startNew() {
    if (!me?.user) return router.push('/login');
    setStarting(true);
    try {
      const { room } = await api<{ room: RoomInfo }>('POST', '/api/rooms', { name: `Meeting ${me.user.name}` });
      await joinMeeting({ code: room.id, name: me.user.name, audio: true, video });
      setNewOpen(false);
      router.push(`/meeting/${room.id}`);
    } catch (e) { Alert.alert('Tidak bisa memulai meeting', (e as Error).message); }
    finally { setStarting(false); }
  }

  const now = Date.now() / 1000;
  const upcoming = rooms.filter(r => r.scheduledAt && r.scheduledAt + (r.durationMin || 60) * 60 > now).sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0)).slice(0, 5);
  const recent = rooms.filter(r => !upcoming.includes(r)).slice(0, 5);
  const mins = Math.max(0, Math.round((np.at.getTime() - Date.now()) / 60000));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 18 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.primary]} />}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <T size={14} color={C.muted}>Selamat datang,</T>
            <T w="extrabold" size={22} numberOfLines={1}>{me?.user?.name || 'Tamu'}</T>
          </View>
          <Pressable onPress={() => router.push('/(tabs)/akun')} accessibilityLabel="Akun"><Avatar name={me?.user?.name || 'Tamu'} size={46} /></Pressable>
        </View>

        <View style={s.actions}>
          <Action icon="videocam" label="Meeting Baru" color={C.gold} fg={C.deep} onPress={() => (me?.user ? setNewOpen(true) : router.push('/login'))} />
          <Action icon="add" label="Gabung" onPress={() => router.push('/join')} />
          <Action icon="calendar" label="Jadwalkan" onPress={() => (me?.user ? router.push('/schedule') : router.push('/login'))} />
          <Action icon="moon" label="Jadwal Salat" onPress={() => router.push('/prayer')} />
        </View>

        <Pressable onPress={() => router.push('/prayer')}>
          <View style={s.prayer}>
            <View style={s.prayerIc}><Ionicons name="moon" size={22} color={C.deep} /></View>
            <View style={{ flex: 1 }}>
              <T size={13} color="#BFE3D3">Salat berikutnya · Jakarta (WIB)</T>
              <T w="bold" size={18} color="#fff">{np.name} {np.time}</T>
            </View>
            <T w="semibold" size={13} color={C.gold}>{mins >= 60 ? `${Math.floor(mins / 60)} j ${mins % 60} m lagi` : `${mins} menit lagi`}</T>
          </View>
        </Pressable>

        {me?.user ? (
          <>
            <Section title="Meeting mendatang" action={rooms.length ? 'Semua' : undefined} onAction={() => router.push('/(tabs)/jadwal')} />
            {upcoming.length ? upcoming.map(r => <RoomCard key={r.id} r={r} />) : <Card><Empty icon="calendar-clear-outline" text="Belum ada meeting terjadwal. Ketuk Jadwalkan untuk membuat." /></Card>}
            {recent.length ? <><Section title="Room terakhir" />{recent.map(r => <RoomCard key={r.id} r={r} />)}</> : null}
          </>
        ) : (
          <Card style={{ gap: 12 }}>
            <T w="bold" size={17}>Masuk untuk fitur lengkap</T>
            <T color={C.muted}>Buat meeting, jadwalkan kelas, dan ikuti event bersertifikat dengan akun kampus.</T>
            <Button title="Masuk" icon="log-in-outline" onPress={() => router.push('/login')} />
          </Card>
        )}
      </ScrollView>

      <Sheet visible={newOpen} onClose={() => setNewOpen(false)} title="Meeting Baru">
        <SwitchRow label="Video aktif" desc="Kamera langsung menyala saat masuk" value={video} onChange={setVideo} />
        <T size={13.5} color={C.muted}>Room baru dibuat dengan ID & password otomatis. Bagikan tautan undangan dari menu Info di dalam meeting.</T>
        <Button title="Mulai Meeting" icon="videocam" onPress={startNew} loading={starting} />
      </Sheet>
    </SafeAreaView>
  );
}

function Action({ icon, label, onPress, color = C.primary, fg = '#fff' }: { icon: IconName; label: string; onPress: () => void; color?: string; fg?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[s.actionIc, { backgroundColor: color }]}><Ionicons name={icon} size={28} color={fg} /></View>
      <T w="semibold" size={13} style={{ textAlign: 'center' }}>{label}</T>
    </Pressable>
  );
}
function Section({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <T w="bold" size={17} style={{ flex: 1 }}>{title}</T>
      {action ? <Pressable onPress={onAction} hitSlop={10}><T w="semibold" color={C.primary}>{action}</T></Pressable> : null}
    </View>
  );
}
export function RoomCard({ r }: { r: RoomInfo }) {
  return (
    <Pressable onPress={() => router.push(`/room/${r.id}`)} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <Card style={s.roomCard}>
        <View style={s.roomTime}>
          {r.scheduledAt ? <><T w="bold" size={15} color={C.primaryDark}>{fmtTime(r.scheduledAt)}</T><T size={11.5} color={C.muted}>{fmtDay(r.scheduledAt)}</T></>
            : <Ionicons name="videocam-outline" size={22} color={C.primary} />}
        </View>
        <View style={{ flex: 1 }}>
          <T w="bold" size={15.5} numberOfLines={1}>{r.name}</T>
          <T size={13} color={C.muted}>ID: {r.id}{r.live ? ` · ${r.live} orang di dalam` : ''}</T>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9AB0A8" />
      </Card>
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  action: { flex: 1, alignItems: 'center', gap: 8 },
  actionIc: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  prayer: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.deep, borderRadius: 18, padding: 14 },
  prayerIc: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' },
  roomCard: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  roomTime: { width: 58, alignItems: 'center' },
});
