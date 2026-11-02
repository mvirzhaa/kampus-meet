// Sertifikat saya: sertifikat sebagai peserta dan sebagai narasumber/pemateri.
// "Unduh PDF" membuka halaman sertifikat di browser HP yang langsung membuat & mengunduh file PDF
// (tersimpan di folder Download), "Lihat" membuka sertifikat, "Bagikan" mengirim tautan verifikasinya.
import React, { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, getServer } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

export type MyCert = { code: string; eventId: number; slug: string; title: string; category: string; startsAt: number; kind: 'participant' | 'speaker'; role: string; attendedMin: number | null };

export const certUrl = (code: string, download = false) => `${getServer()}/sertifikat/${encodeURIComponent(code)}${download ? '?unduh=1' : ''}`;
export const downloadCert = (code: string) => Linking.openURL(certUrl(code, true));

export default function Sertifikat() {
  const { me } = useAuth();
  const [list, setList] = useState<MyCert[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!me?.user) return;
    setLoading(true);
    try { setList((await api<{ certificates: MyCert[] }>('GET', '/api/my/certificates')).certificates); } catch { setList(l => l || []); }
    finally { setLoading(false); }
  }, [me?.user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!me?.user) return (
    <View style={{ padding: 18 }}><Card style={{ gap: 12 }}><T>Masuk untuk melihat sertifikat Anda.</T><Button title="Masuk" icon="log-in-outline" onPress={() => router.push('/login')} /></Card></View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={[C.primary]} />}>
      <T size={13.5} color={C.muted}>Sertifikat terbit otomatis setelah Anda menghadiri event sesuai durasi minimum. Sertifikat narasumber/pemateri diterbitkan penyelenggara.</T>
      {list && !list.length ? <Card><Empty icon="ribbon-outline" text="Belum ada sertifikat. Ikuti event bersertifikat sampai durasi minimum terpenuhi." /></Card> : null}
      {(list || []).map(c => (
        <Card key={c.code} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[s.badge, c.kind === 'speaker' ? { backgroundColor: '#FFF3D6' } : null]}>
              <Ionicons name={c.kind === 'speaker' ? 'mic' : 'ribbon'} size={13} color={c.kind === 'speaker' ? '#8A5A00' : C.primaryDark} />
              <T w="bold" size={12} color={c.kind === 'speaker' ? '#8A5A00' : C.primaryDark}>{c.role}</T>
            </View>
            {c.attendedMin != null ? <T size={12.5} color={C.muted}>Hadir {c.attendedMin} menit</T> : null}
          </View>
          <T w="bold" size={16}>{c.title}</T>
          <T size={13} color={C.muted}>{fmtDateTime(c.startsAt)}</T>
          <T size={12.5} color={C.muted}>Kode: <T w="semibold" size={12.5}>{c.code}</T></T>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Button small title="Unduh PDF" icon="download-outline" style={{ flex: 1.3 }} onPress={() => downloadCert(c.code)} />
            <Button small variant="ghost" title="Lihat" icon="eye-outline" style={{ flex: 1 }} onPress={() => Linking.openURL(certUrl(c.code))} />
            <Button small variant="ghost" title="" icon="share-social-outline" accessibilityLabel="Bagikan tautan verifikasi" style={{ width: 48 }}
              onPress={() => Share.share({ message: `Sertifikat ${c.role.toLowerCase()} "${c.title}" — verifikasi: ${getServer()}/verifikasi/${c.code}` })} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
});
