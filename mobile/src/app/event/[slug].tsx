import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Card, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, getServer, parseMeetingInput, type EventInfo } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

export default function EventDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { me } = useAuth();
  const [ev, setEv] = useState<EventInfo | null>(null);
  useFocusEffect(useCallback(() => { api<{ event: EventInfo }>('GET', `/api/events/${slug}`).then(r => setEv(r.event)).catch((e) => Alert.alert('Event', (e as Error).message)); }, [slug]));
  if (!ev) return <View style={{ padding: 18 }}><T color={C.muted}>Memuat…</T></View>;

  function join() {
    if (!me?.user) return router.push('/login');
    const t = ev!.joinLink ? parseMeetingInput(ev!.joinLink) : null;
    if (!t) return Alert.alert('Room belum dibuka', `Room dibuka 30 menit sebelum acara: ${fmtDateTime(ev!.startsAt)}.`);
    router.push({ pathname: '/join', params: { code: t.code, ...(t.key ? { k: t.key } : {}) } });
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
      <Card style={{ gap: 8 }}>
        <T w="bold" size={13} color={C.primary}>{ev.category.toUpperCase()}</T>
        <T w="extrabold" size={21}>{ev.title}</T>
        <T color={C.muted}>{fmtDateTime(ev.startsAt)}</T>
        {ev.speaker ? <T>Narasumber: <T w="semibold">{ev.speaker}</T></T> : null}
        {ev.organizer ? <T color={C.muted}>Penyelenggara: {ev.organizer}</T> : null}
        {ev.certificate ? <T color="#92400E">🎓 Bersertifikat — hadir sesuai durasi minimum, sertifikat terbit otomatis.</T> : null}
      </Card>
      {ev.description ? <Card><T style={{ lineHeight: 22 }}>{ev.description}</T></Card> : null}
      <Button title={me?.user ? 'Gabung ke Event' : 'Masuk untuk bergabung'} icon="enter-outline" onPress={join} />
      {ev.certCode ? <Button title="Lihat sertifikat" icon="ribbon-outline" variant="ghost" onPress={() => Linking.openURL(`${getServer()}/sertifikat/${ev.certCode}`)} /> : null}
      {me?.user && ev.attendedMin ? <T size={13.5} color={C.muted} style={{ textAlign: 'center' }}>Kehadiran Anda tercatat {ev.attendedMin} menit.</T> : null}
    </ScrollView>
  );
}
