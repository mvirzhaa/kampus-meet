import React, { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, Segmented, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, type EventInfo, type Invitation } from '@/lib/api';
import { syncLocalReminders } from '@/lib/push';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

type Tab = 'upcoming' | 'past' | 'invited' | 'mine';

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}><T w="bold" size={12} color={color}>{text}</T></View>;
}

function EventCard({ e, extra }: { e: EventInfo; extra?: React.ReactNode }) {
  const now = Date.now() / 1000;
  const live = now >= e.startsAt - 1800 && now <= e.endsAt;
  return (
    <Pressable onPress={() => router.push(`/event/${e.slug}`)}>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge text={e.category} color={C.primaryDark} bg={C.soft} />
          {live ? <Badge text="● Room dibuka" color={C.danger} bg="#FDECEC" /> : null}
          {e.inviteOnly ? <Badge text="Khusus undangan" color="#8A5A00" bg="#FFF3D6" /> : null}
          {e.certificate ? <Ionicons name="ribbon" size={16} color="#B7791F" style={{ marginLeft: 'auto' }} /> : null}
        </View>
        <T w="bold" size={16.5}>{e.title}</T>
        <T size={13.5} color={C.muted}>{fmtDateTime(e.startsAt)}</T>
        {e.speaker ? <T size={13.5} color={C.muted}>Narasumber: {e.speaker}</T> : null}
        {extra}
      </Card>
    </Pressable>
  );
}

export default function Events() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [list, setList] = useState<EventInfo[] | null>(null);
  const [inv, setInv] = useState<Invitation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const logged = !!me?.user;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'invited') {
        const r = await api<{ invitations: Invitation[] }>('GET', '/api/my/invitations');
        setInv(r.invitations);
        syncLocalReminders(r.invitations).catch(() => {});   // cadangan bila push server belum aktif
      } else if (tab === 'mine') {
        const r = await api<{ organized: EventInfo[] }>('GET', '/api/my/events');
        setList(r.organized);
      } else {
        setList((await api<{ events: EventInfo[] }>('GET', `/api/events?when=${tab}`)).events);
      }
    } catch { setList(l => l || []); setInv(l => l || []); }
    finally { setLoading(false); }
  }, [tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const options: { value: Tab; label: string }[] = [{ value: 'upcoming', label: 'Mendatang' }, { value: 'past', label: 'Selesai' }];
  if (logged) options.push({ value: 'invited', label: 'Undangan' }, { value: 'mine', label: 'Kelola' });
  const now = Date.now() / 1000;

  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.primary]} />}>
      <Segmented value={tab} onChange={(v) => { setTab(v); setList(null); setInv(null); }} options={options} />

      {tab === 'invited' ? (
        <>
          {inv && !inv.length ? <Card><Empty icon="mail-open-outline" text="Belum ada undangan event untuk Anda." /></Card> : null}
          {(inv || []).map(e => (
            <Pressable key={e.id} onPress={() => router.push(`/event/${e.slug}`)}>
              <Card style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: C.primary }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Badge text="Diundang" color="#8A5A00" bg="#FFF3D6" />
                  {e.joinOpen ? <Badge text="● Room dibuka" color={C.danger} bg="#FDECEC" /> : null}
                </View>
                <T w="bold" size={16.5}>{e.title}</T>
                <T size={13.5} color={C.muted}>{fmtDateTime(e.startsAt)}</T>
                {e.organizer ? <T size={13.5} color={C.muted}>Penyelenggara: {e.organizer}</T> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {e.joinOpen ? <Button small title="Gabung" icon="videocam" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/join', params: { code: e.roomId } })} /> : null}
                  {now < e.endsAt ? <Button small variant="ghost" title={e.joinOpen ? 'Kalender' : 'Simpan ke Google Calendar'} icon="calendar-outline" style={{ flex: 1 }} onPress={() => Linking.openURL(e.googleCalendarUrl)} /> : null}
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          {list && !list.length ? <Card><Empty icon="ribbon-outline" text={tab === 'mine' ? 'Anda belum menyelenggarakan event. Event dibuat dari versi web.' : tab === 'upcoming' ? 'Belum ada event mendatang.' : 'Belum ada event yang selesai.'} /></Card> : null}
          {(list || []).map(e => (
            <EventCard key={e.id} e={e} extra={tab === 'mine' && e.endsAt > now ? (
              <Button small variant="ghost" title={`Kelola undangan${e.invites ? ` (${e.invites})` : ''}`} icon="person-add-outline" style={{ marginTop: 6 }}
                onPress={() => router.push({ pathname: '/event/invites', params: { id: String(e.id), title: e.title } })} />
            ) : null} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
