import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Row, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, type RoomInfo } from '@/lib/api';
import { joinMeeting } from '@/lib/meet';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

export default function RoomDetail() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { me } = useAuth();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    api<{ rooms: RoomInfo[] }>('GET', '/api/rooms').then(r => setRoom(r.rooms.find(x => x.id === code) || null)).catch(() => {});
  }, [code]));

  if (!room) return <View style={{ padding: 18 }}><T color={C.muted}>Memuat…</T></View>;
  const invite = `Anda diundang ke meeting UIKA Meet\n\n${room.name}${room.scheduledAt ? `\n${fmtDateTime(room.scheduledAt)}` : ''}\n\nGabung: ${room.attendeeLink}\nID room: ${room.id}${room.password ? `\nPassword: ${room.password}` : ''}`;
  const copy = async (t: string, what: string) => { await Clipboard.setStringAsync(t); Alert.alert('Tersalin', `${what} disalin.`); };

  async function start() {
    setBusy(true);
    try { await joinMeeting({ code: room!.id, name: me?.user?.name || 'Moderator', audio: true, video: true }); router.push(`/meeting/${room!.id}`); }
    catch (e) { Alert.alert('Tidak bisa memulai', (e as Error).message); }
    finally { setBusy(false); }
  }
  function remove() {
    Alert.alert('Hapus room?', `"${room!.name}" akan dihapus permanen.`, [{ text: 'Batal', style: 'cancel' }, {
      text: 'Hapus', style: 'destructive', onPress: async () => {
        try { await api('DELETE', `/api/rooms/${room!.id}`); router.back(); } catch (e) { Alert.alert('Gagal', (e as Error).message); }
      },
    }]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
      <Card style={{ gap: 6 }}>
        <T w="extrabold" size={21}>{room.name}</T>
        {room.scheduledAt ? <T color={C.muted}>{fmtDateTime(room.scheduledAt)}{room.durationMin ? ` · ${room.durationMin} menit` : ''}</T> : null}
      </Card>
      <Button title="Mulai Meeting" icon="videocam" onPress={start} loading={busy} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row icon="keypad-outline" label="ID room" value={room.id} onPress={() => copy(room.id, 'ID room')} />
        {room.password ? <Row icon="key-outline" label="Password" value={room.password} onPress={() => copy(room.password!, 'Password')} /> : null}
        <Row icon="link-outline" label="Tautan peserta" value="Bagikan ke mahasiswa/peserta" onPress={() => copy(room.attendeeLink || '', 'Tautan peserta')} />
        <Row icon="shield-checkmark-outline" label="Tautan moderator" value="Jangan dibagikan ke peserta" onPress={() => copy(room.moderatorLink || '', 'Tautan moderator')} />
      </Card>
      <Button title="Bagikan undangan" icon="share-social-outline" variant="ghost" onPress={() => Share.share({ message: invite })} />
      <Button title="Hapus room" icon="trash-outline" variant="ghost" onPress={remove} />
    </ScrollView>
  );
}
