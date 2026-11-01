// Kelola undangan event (khusus pembuat event / admin): cari pengguna terdaftar, tambah/hapus peserta,
// atur "khusus undangan", lalu kirim email + push notification ke semua peserta dengan satu tombol.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, Field, T } from '@/components/ui';
import { api, type InviteList } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

type Cand = { id: number; name: string; email: string };

function Pill({ text, color = C.primaryDark, bg = C.soft, icon }: { text: string; color?: string; bg?: string; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <T w="semibold" size={11.5} color={color}>{text}</T>
    </View>
  );
}

export default function EventInvites() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const [d, setD] = useState<InviteList | null>(null);
  const [q, setQ] = useState('');
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await api<InviteList>('GET', `/api/events/${id}/invites`)); }
    catch (e) { Alert.alert('Undangan', (e as Error).message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const search = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setCands(null); return; }
    setSearching(true);
    try { setCands((await api<{ users: Cand[] }>('GET', `/api/events/${id}/invite-candidates?q=${encodeURIComponent(term.trim())}`)).users); }
    catch { setCands([]); }
    finally { setSearching(false); }
  }, [id]);
  const onQ = (v: string) => { setQ(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => search(v), 300); };

  async function add(ids: number[]) {
    try {
      const r = await api<InviteList & { added: number }>('POST', `/api/events/${id}/invites`, { userIds: ids });
      setD(r); search(q);
    } catch (e) { Alert.alert('Gagal menambah', (e as Error).message); }
  }
  function remove(uid: number, name: string) {
    Alert.alert('Hapus dari undangan?', name, [{ text: 'Batal', style: 'cancel' }, { text: 'Hapus', style: 'destructive', onPress: async () => {
      try { setD(await api<InviteList>('DELETE', `/api/events/${id}/invites/${uid}`)); } catch (e) { Alert.alert('Gagal', (e as Error).message); }
    } }]);
  }
  async function toggleOnly(v: boolean) {
    try { setD(await api<InviteList>('PATCH', `/api/events/${id}/invite-only`, { inviteOnly: v })); } catch (e) { Alert.alert('Gagal', (e as Error).message); }
  }
  async function send(all: boolean) {
    setBusy(true);
    try {
      const r = await api<InviteList & { recipients: number; emails: number; pushes: number | null; mail: boolean; push: boolean }>('POST', `/api/events/${id}/invites/send`, { all });
      setD(r);
      const parts = [r.mail ? `${r.emails} email` : null, r.push ? `${r.pushes ?? 'beberapa'} notifikasi aplikasi` : null].filter(Boolean);
      Alert.alert('Undangan terkirim', `Undangan dikirim ke ${r.recipients} peserta${parts.length ? ` (${parts.join(', ')})` : ''}.`);
    } catch (e) { Alert.alert('Gagal mengirim', (e as Error).message); }
    finally { setBusy(false); }
  }
  const confirmResend = () => Alert.alert('Kirim ulang ke semua?', `Email dan notifikasi undangan dikirim lagi ke ${d?.invites.length || 0} peserta.`, [{ text: 'Batal', style: 'cancel' }, { text: 'Kirim ulang', onPress: () => send(true) }]);

  return (
    <>
      <Stack.Screen options={{ title: 'Undangan Peserta' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.primary]} />}>
        {title ? <T w="extrabold" size={19}>{title}</T> : null}
        {!d ? <ActivityIndicator color={C.primary} style={{ marginTop: 30 }} /> : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Pill icon="people" text={`${d.invites.length} diundang`} />
              {d.pending ? <Pill icon="mail" text={`${d.pending} belum dikirimi`} color={C.danger} bg={C.dangerSoft} /> : d.invites.length ? <Pill icon="checkmark-circle" text="Semua sudah dikirimi" /> : null}
              <Pill icon="person" text={`${d.invites.filter(i => i.joined).length} hadir`} color={C.muted} bg="#EEF2F0" />
            </View>

            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <T w="bold">Khusus peserta undangan</T>
                <T size={13} color={C.muted}>Bila aktif, hanya pengguna di daftar ini (serta Anda dan admin) yang dapat bergabung. Peserta undangan masuk tanpa password event.</T>
              </View>
              <Switch value={d.inviteOnly} onValueChange={toggleOnly} trackColor={{ true: C.primary, false: '#C9D6D0' }} thumbColor="#fff" />
            </Card>

            <View style={{ gap: 8 }}>
              <Field label="Tambah peserta" value={q} onChangeText={onQ} placeholder="Cari nama atau email pengguna terdaftar…" autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => search(q)} />
              <T size={12} color={C.muted}>Hanya pengguna yang sudah terdaftar. Akun admin tidak ditampilkan.</T>
              {searching ? <ActivityIndicator color={C.primary} /> : null}
              {cands ? (
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {cands.length ? cands.map(c => (
                    <Pressable key={c.id} onPress={() => add([c.id])} style={({ pressed }) => [s.row, pressed && { backgroundColor: '#F4F9F7' }]} accessibilityLabel={`Tambah ${c.name}`}>
                      <View style={{ flex: 1 }}><T w="semibold" numberOfLines={1}>{c.name}</T><T size={12.5} color={C.muted} numberOfLines={1}>{c.email}</T></View>
                      <Ionicons name="add-circle" size={26} color={C.primary} />
                    </Pressable>
                  )) : <View style={{ padding: 14 }}><T size={13.5} color={C.muted}>Tidak ada pengguna yang cocok (atau semuanya sudah diundang).</T></View>}
                  {cands.length > 1 ? (
                    <Pressable onPress={() => add(cands.map(c => c.id))} style={({ pressed }) => [s.row, { justifyContent: 'center' }, pressed && { backgroundColor: '#F4F9F7' }]}>
                      <Ionicons name="person-add" size={17} color={C.primary} /><T w="bold" color={C.primary}>Tambah semua ({cands.length})</T>
                    </Pressable>
                  ) : null}
                </Card>
              ) : null}
            </View>

            <T w="bold" size={16} style={{ marginTop: 4 }}>Daftar peserta undangan</T>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {d.invites.length ? d.invites.map(i => (
                <View key={i.userId} style={s.row}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <T w="semibold" numberOfLines={1}>{i.name}</T>
                    <T size={12.5} color={C.muted} numberOfLines={1}>{i.email}</T>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                      {i.notifiedAt ? <Pill icon="mail" text={`Terkirim ${fmtDateTime(i.notifiedAt).replace(/ \d{4} ·/, ',')}`} /> : <Pill text="Belum dikirim" color={C.muted} bg="#EEF2F0" />}
                      {i.remindedAt ? <Pill icon="notifications" text="Diingatkan" /> : null}
                      {i.app ? <Pill icon="phone-portrait" text="Aplikasi" /> : null}
                      {i.joined ? <Pill icon="checkmark" text="Hadir" /> : null}
                    </View>
                  </View>
                  <Pressable hitSlop={10} onPress={() => remove(i.userId, i.name)} accessibilityLabel={`Hapus ${i.name}`}><Ionicons name="close-circle-outline" size={24} color={C.muted} /></Pressable>
                </View>
              )) : <Empty icon="person-add-outline" text="Belum ada peserta. Cari pengguna di atas untuk menambahkan." />}
            </Card>

            <Card style={{ gap: 10, backgroundColor: '#F6FAF8' }}>
              <T w="bold">Kirim undangan ke semua peserta</T>
              <T size={13} color={C.muted}>Email berisi tautan gabung, tombol “Simpan ke Google Calendar”, dan lampiran kalender. Peserta yang memakai aplikasi juga menerima push notification. Pengingat otomatis dikirim {d.reminderMinutes} menit sebelum event dimulai.</T>
              <Button title={d.pending ? `Kirim undangan (${d.pending})` : 'Kirim undangan'} icon="send" onPress={() => send(false)} loading={busy} disabled={!d.pending} />
              <Button title="Kirim ulang ke semua" icon="refresh" variant="ghost" small onPress={confirmResend} disabled={!d.invites.length || busy} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Pill icon="mail" text={d.mail ? 'Email aktif' : 'Email belum diatur admin'} color={d.mail ? C.primaryDark : C.muted} bg={d.mail ? C.soft : '#EEF2F0'} />
                <Pill icon="notifications" text={d.push ? 'Notifikasi aplikasi aktif' : 'Notifikasi aplikasi belum diatur admin'} color={d.push ? C.primaryDark : C.muted} bg={d.push ? C.soft : '#EEF2F0'} />
              </View>
            </Card>
            <Button title="Simpan ke Google Calendar saya" icon="calendar-outline" variant="ghost" small onPress={() => Linking.openURL(d.googleCalendarUrl)} />
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
});
