import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Empty, Segmented, T } from '@/components/ui';
import { api, type EventInfo } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

export default function Events() {
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [list, setList] = useState<EventInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setList((await api<{ events: EventInfo[] }>('GET', `/api/events?when=${when}`)).events); } catch { setList(l => l || []); }
    finally { setLoading(false); }
  }, [when]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const now = Date.now() / 1000;
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.primary]} />}>
      <Segmented value={when} onChange={(v) => { setWhen(v); setList(null); }} options={[{ value: 'upcoming', label: 'Mendatang' }, { value: 'past', label: 'Selesai' }]} />
      {list && !list.length ? <Card><Empty icon="ribbon-outline" text={when === 'upcoming' ? 'Belum ada event mendatang.' : 'Belum ada event yang selesai.'} /></Card> : null}
      {(list || []).map(e => {
        const live = now >= e.startsAt - 1800 && now <= e.endsAt;
        return (
          <Pressable key={e.id} onPress={() => router.push(`/event/${e.slug}`)}>
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={{ backgroundColor: C.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}><T w="bold" size={12} color={C.primaryDark}>{e.category}</T></View>
                {live ? <View style={{ backgroundColor: '#FDECEC', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}><T w="bold" size={12} color={C.danger}>● Room dibuka</T></View> : null}
                {e.certificate ? <Ionicons name="ribbon" size={16} color="#B7791F" style={{ marginLeft: 'auto' }} /> : null}
              </View>
              <T w="bold" size={16.5}>{e.title}</T>
              <T size={13.5} color={C.muted}>{fmtDateTime(e.startsAt)}</T>
              {e.speaker ? <T size={13.5} color={C.muted}>Narasumber: {e.speaker}</T> : null}
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
