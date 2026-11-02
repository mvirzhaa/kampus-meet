// Tab "Undangan": daftar undangan meeting/event yang dikirim khusus ke pengguna ini.
// Ketuk undangan yang room-nya sudah dibuka → langsung masuk meeting (tanpa password event).
import React, { useCallback } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useInvitations } from '@/lib/invites';
import { InvitationCard } from '@/components/InvitationCard';
import { C } from '@/lib/theme';

export default function Undangan() {
  const { me } = useAuth();
  const inv = useInvitations(!!me?.user);
  useFocusEffect(useCallback(() => { if (me?.user) inv.refresh(); }, [me?.user])); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me?.user) {
    return (
      <ScrollView contentContainerStyle={{ padding: 18 }}>
        <Card style={{ gap: 12 }}>
          <T w="bold" size={17}>Masuk untuk melihat undangan</T>
          <T color={C.muted}>Undangan meeting dan event dari dosen atau panitia akan muncul di sini, lengkap dengan tombol gabung.</T>
          <Button title="Masuk" icon="log-in-outline" onPress={() => router.push('/login')} />
        </Card>
      </ScrollView>
    );
  }
  const list = inv.active;
  const open = list.filter(e => e.joinOpen), soon = list.filter(e => !e.joinOpen);
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={inv.loading} onRefresh={() => { inv.refresh(); }} colors={[C.primary]} />}>
      <T size={13.5} color={C.muted}>Undangan yang dikirim khusus untuk Anda. Ketuk undangan yang sudah dibuka untuk langsung masuk ke meeting.</T>
      {inv.list && !list.length ? <Card><Empty icon="mail-open-outline" text="Belum ada undangan untuk Anda. Undangan dari penyelenggara akan muncul di sini dan dikirim lewat notifikasi." /></Card> : null}
      {open.length ? <T w="bold" size={16} style={{ marginTop: 4 }}>Bisa bergabung sekarang</T> : null}
      {open.map(e => <InvitationCard key={e.id} e={e} />)}
      {soon.length ? <T w="bold" size={16} style={{ marginTop: 8 }}>Akan datang</T> : null}
      {soon.map(e => (
        <View key={e.id} style={{ gap: 6 }}>
          <InvitationCard e={e} />
          <Pressable onPress={() => Linking.openURL(e.googleCalendarUrl)} style={s.cal} hitSlop={6}>
            <Ionicons name="calendar-outline" size={15} color={C.primary} /><T w="semibold" size={13} color={C.primary}>Simpan ke Google Calendar</T>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => router.push('/fitri')} style={({ pressed }) => [s.fitri, pressed && { opacity: 0.85 }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={C.primaryDark} />
        <T size={13.5} color={C.primaryDark} style={{ flex: 1 }}>Tanya Fitri: “undangan saya” untuk ringkasan & tautan undangan</T>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  cal: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingHorizontal: 6 },
  fitri: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.soft, borderRadius: 14, padding: 12, marginTop: 8 },
});
