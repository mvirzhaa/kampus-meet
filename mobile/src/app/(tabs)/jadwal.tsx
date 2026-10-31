import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, Empty, T } from '@/components/ui';
import { RoomCard } from './index';
import { useAuth } from '@/lib/auth';
import { api, type RoomInfo } from '@/lib/api';
import { C } from '@/lib/theme';

export default function Jadwal() {
  const { me } = useAuth();
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!me?.user) return;
    setLoading(true);
    try { setRooms((await api<{ rooms: RoomInfo[] }>('GET', '/api/rooms')).rooms); } catch { setRooms(r => r || []); }
    finally { setLoading(false); }
  }, [me?.user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!me?.user) return (
    <View style={{ padding: 18 }}><Card style={{ gap: 12 }}><T>Masuk untuk melihat dan menjadwalkan meeting Anda.</T><Button title="Masuk" onPress={() => router.push('/login')} /></Card></View>
  );
  const now = Date.now() / 1000;
  const sched = (rooms || []).filter(r => r.scheduledAt && r.scheduledAt + (r.durationMin || 60) * 60 > now).sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
  const others = (rooms || []).filter(r => !sched.includes(r));
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.primary]} />}>
      <Button title="Jadwalkan Meeting" icon="calendar" onPress={() => router.push('/schedule')} />
      <T w="bold" size={17} style={{ marginTop: 6 }}>Terjadwal</T>
      {sched.length ? sched.map(r => <RoomCard key={r.id} r={r} />) : <Card><Empty icon="calendar-clear-outline" text="Tidak ada meeting terjadwal." /></Card>}
      <T w="bold" size={17} style={{ marginTop: 6 }}>Room saya</T>
      {others.length ? others.map(r => <RoomCard key={r.id} r={r} />) : <Card><Empty icon="videocam-outline" text="Belum ada room." /></Card>}
    </ScrollView>
  );
}
