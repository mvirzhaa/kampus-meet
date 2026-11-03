import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, getServer, parseMeetingInput, type EventInfo } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';
import { RatingCard } from '@/components/RatingCard';
import { SharePoster } from '@/components/SharePoster';

export default function EventDetail() {
  // rate=1: dibuka dari ajakan rating setelah keluar meeting → kartu rating tampil paling atas
  const { slug, rate } = useLocalSearchParams<{ slug: string; rate?: string }>();
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
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 32 }}>
      {rate === '1' && me?.user ? <RatingCard eventId={ev.id} highlight /> : null}
      <Card style={{ gap: 8 }}>
        <T w="bold" size={13} color={C.primary}>{ev.category.toUpperCase()}</T>
        <T w="extrabold" size={21}>{ev.title}</T>
        <T color={C.muted}>{fmtDateTime(ev.startsAt)}</T>
        {ev.speaker ? <T>Narasumber: <T w="semibold">{ev.speaker}</T></T> : null}
        {ev.organizer ? <T color={C.muted}>Penyelenggara: {ev.organizer}</T> : null}
        {ev.certificate ? <T color="#92400E">🎓 Bersertifikat — hadir sesuai durasi minimum, sertifikat terbit otomatis.</T> : null}
      </Card>
      {ev.description ? <Card><T style={{ lineHeight: 22 }}>{ev.description}</T></Card> : null}
      {ev.invited && !ev.isOwner ? (
        <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#FFF7DC', borderColor: '#F5D77A' }}>
          <Ionicons name="mail-open" size={22} color="#8A5A00" />
          <T size={14} color="#6B4A00" style={{ flex: 1 }}>Anda diundang ke event ini. Anda masuk tanpa password dan akan diingatkan sebelum acara dimulai.</T>
        </Card>
      ) : null}
      {me?.user && ev.allowed === false ? (
        <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Ionicons name="lock-closed" size={20} color={C.muted} />
          <T size={14} color={C.muted} style={{ flex: 1 }}>Event ini khusus peserta yang diundang penyelenggara.</T>
        </Card>
      ) : (
        <Button title={me?.user ? (ev.isOwner ? 'Masuk sebagai Moderator' : 'Gabung ke Event') : 'Masuk untuk bergabung'} icon="enter-outline" onPress={join} />
      )}
      {ev.isOwner ? (
        <Button title={`Kelola undangan${ev.invites ? ` (${ev.invites})` : ''}`} icon="person-add-outline" variant="ghost"
          onPress={() => router.push({ pathname: '/event/invites', params: { id: String(ev.id), title: ev.title } })} />
      ) : null}
      {ev.googleCalendarUrl && Date.now() / 1000 < ev.endsAt && (ev.isOwner || ev.allowed !== false) ? (
        <Button title="Simpan ke Google Calendar" icon="calendar-outline" variant="ghost" small onPress={() => Linking.openURL(ev.googleCalendarUrl!)} />
      ) : null}
      {ev.certCode ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Unduh sertifikat (PDF)" icon="download-outline" style={{ flex: 1.4 }} onPress={() => Linking.openURL(`${getServer()}/sertifikat/${ev.certCode}?unduh=1`)} />
          <Button title="Lihat" icon="ribbon-outline" variant="ghost" style={{ flex: 1 }} onPress={() => Linking.openURL(`${getServer()}/sertifikat/${ev.certCode}`)} />
        </View>
      ) : null}
      {me?.user && ev.attendedMin ? <T size={13.5} color={C.muted} style={{ textAlign: 'center' }}>Kehadiran Anda tercatat {ev.attendedMin} menit.</T> : null}
      {rate !== '1' && Date.now() / 1000 >= ev.startsAt ? <RatingCard eventId={ev.id} /> : null}
      {ev.published !== false ? <SharePoster slug={ev.slug} /> : null}
    </ScrollView>
  );
}
