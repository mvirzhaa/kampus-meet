// Jadwal salat hari ini (Jakarta, WIB) + pengaturan notifikasi azan.
import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, SwitchRow, T } from '@/components/ui';
import { ensureNotifPermission, getAzanPrefs, nextPrayer, prayerTimes, PLACE, playTakbir, saveAzanPrefs, stopTakbir, wibDateText, type AzanPrefs, type PrayerKey } from '@/lib/prayer';
import { C } from '@/lib/theme';

export default function PrayerScreen() {
  const [prefs, setPrefs] = useState<AzanPrefs | null>(null);
  const [playing, setPlaying] = useState(false);
  const list = prayerTimes(); const nx = nextPrayer();
  useEffect(() => { getAzanPrefs().then(setPrefs); return () => stopTakbir(); }, []);

  async function update(p: AzanPrefs) {
    setPrefs(p);
    if (p.on && !(await ensureNotifPermission(true))) {
      Alert.alert('Izin notifikasi', 'Izinkan notifikasi UIKA Meet di Pengaturan agar pengingat azan muncul.', [{ text: 'Nanti' }, { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() }]);
    }
    await saveAzanPrefs(p);
  }
  const toggleSkip = (k: PrayerKey) => prefs && update({ ...prefs, skip: prefs.skip.includes(k) ? prefs.skip.filter(x => x !== k) : [...prefs.skip, k] });

  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
      <View style={s.hero}>
        <Ionicons name="moon" size={26} color={C.gold} />
        <T size={14} color="#BFE3D3">{wibDateText()} · {PLACE.name} (WIB)</T>
        <T w="extrabold" size={28} color="#fff">{nx.name} {nx.time}</T>
        <T size={13.5} color="#BFE3D3">Salat berikutnya</T>
      </View>
      <Card style={{ padding: 6 }}>
        {list.map(p => {
          const isNext = p.at.getTime() === nx.at.getTime();
          const off = prefs?.skip.includes(p.key);
          return (
            <View key={p.key} style={[s.row, isNext && { backgroundColor: C.soft }]}>
              <T w={isNext ? 'bold' : 'semibold'} size={16} style={{ flex: 1 }} color={isNext ? C.primaryDark : C.text}>{p.name}</T>
              <T w="bold" size={18} color={isNext ? C.primaryDark : C.text} style={{ width: 70 }}>{p.time}</T>
              <Ionicons name={off ? 'notifications-off-outline' : 'notifications'} size={22} color={off || !prefs?.on ? '#9AB0A8' : C.primary} onPress={() => toggleSkip(p.key)} accessibilityLabel={`Pengingat ${p.name}`} />
            </View>
          );
        })}
      </Card>
      {prefs ? (
        <Card style={{ gap: 6 }}>
          <SwitchRow label="Pengingat waktu salat" desc="Notifikasi saat masuk waktu salat, juga ketika aplikasi ditutup" value={prefs.on} onChange={(v) => update({ ...prefs, on: v })} />
          <SwitchRow label="Suara takbir azan" desc={'"Allahu akbar, Allahu akbar" (bagian awal azan)'} value={prefs.sound} onChange={(v) => update({ ...prefs, sound: v })} />
        </Card>
      ) : null}
      <Button title={playing ? 'Hentikan suara' : 'Coba suara azan'} icon={playing ? 'stop' : 'volume-high'} variant="ghost"
        onPress={async () => { if (playing) { stopTakbir(); setPlaying(false); } else { setPlaying(true); await playTakbir(); setTimeout(() => setPlaying(false), 20000); } }} />
      <T size={12.5} color={C.muted}>Jadwal dihitung dengan parameter Kemenag RI (Subuh 20°, Isya 18°, ihtiyat 2 menit) untuk wilayah Jakarta; bisa berbeda ±1–2 menit dengan jadwal resmi. Ketuk ikon lonceng untuk mematikan pengingat waktu tertentu.</T>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  hero: { backgroundColor: C.deep, borderRadius: 20, padding: 20, alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12 },
});
