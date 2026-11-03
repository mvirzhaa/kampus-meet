// Kartu "Bagikan event": pratinjau poster + tombol WhatsApp, Facebook, Instagram, kirim gambar, salin.
import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, T } from '@/components/ui';
import { copyCaption, getPoster, posterImageUri, shareFacebook, shareImage, shareWhatsApp, type PosterInfo } from '@/lib/poster';
import { C } from '@/lib/theme';

type Btn = { key: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; bg: string; fg?: string; run: (p: PosterInfo) => Promise<void> };

export function SharePoster({ slug }: { slug: string }) {
  const [p, setP] = useState<PosterInfo | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { getPoster(slug).then(setP).catch(() => {}); }, [slug]);
  if (!p) return null;
  const img = posterImageUri(p);

  const run = async (b: Btn) => {
    setBusy(b.key);
    try { await b.run(p); }
    catch (e) { Alert.alert('Tidak dapat membagikan', (e as Error).message); }
    finally { setBusy(''); }
  };
  const btns: Btn[] = [
    { key: 'wa', label: 'WhatsApp', icon: 'logo-whatsapp', bg: '#25D366', run: shareWhatsApp },
    { key: 'fb', label: 'Facebook', icon: 'logo-facebook', bg: '#1877F2', run: shareFacebook },
    { key: 'ig', label: 'Instagram', icon: 'logo-instagram', bg: '#D62976', run: async (x: PosterInfo) => {
      await shareImage(x, 'Pilih Instagram');
      Alert.alert('Keterangan disalin', 'Pilih Instagram (Feed/Story), lalu tempel keterangan event yang sudah disalin.');
    } },
    { key: 'img', label: 'Kirim gambar', icon: 'image-outline', bg: C.primary, run: async (x: PosterInfo) => { await shareImage(x); } },
    { key: 'cp', label: 'Salin teks', icon: 'copy-outline', bg: '#EEF2F0', fg: C.primaryDark, run: async (x: PosterInfo) => { await copyCaption(x); Alert.alert('Tersalin', 'Keterangan & tautan event tersalin ke clipboard.'); } },
  ].filter(b => img || (b.key !== 'ig' && b.key !== 'img')) as Btn[];

  return (
    <Card style={{ gap: 12 }}>
      <T w="bold" size={16}>Bagikan event</T>
      {img ? <Image source={{ uri: img }} style={s.poster} resizeMode="cover" accessibilityLabel={`Poster ${p.event.title}`} /> : null}
      <T size={13} color={C.muted}>{img
        ? 'WhatsApp & Facebook mengirim keterangan + tautan bergambar poster. Instagram/Kirim gambar membagikan file poster; keterangannya otomatis disalin untuk ditempel.'
        : 'Bagikan keterangan & tautan event. (Gambar poster tersedia setelah penyelenggara menerbitkannya.)'}</T>
      <View style={s.row}>
        {btns.map(b => (
          <Pressable key={b.key} onPress={() => run(b)} disabled={!!busy} style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Bagikan ke ${b.label}`}>
            <View style={[s.ic, { backgroundColor: b.bg }]}><Ionicons name={busy === b.key ? 'hourglass-outline' : b.icon} size={24} color={b.fg || '#fff'} /></View>
            <T w="semibold" size={11.5} style={{ textAlign: 'center' }}>{b.label}</T>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  poster: { width: '100%', aspectRatio: 4 / 5, borderRadius: 12, backgroundColor: C.soft },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
  btn: { alignItems: 'center', gap: 6, width: 62 },
  ic: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
