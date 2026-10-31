// Jadwalkan meeting: judul, tanggal, jam mulai (WIB), durasi, password.
import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, Segmented, SwitchRow, T } from '@/components/ui';
import { api, type RoomInfo } from '@/lib/api';
import { C } from '@/lib/theme';

const pad = (n: number) => String(n).padStart(2, '0');
function defaults() {
  const d = new Date(Date.now() + 7 * 3600_000 + 3600_000); // satu jam lagi (WIB)
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:00` };
}

export default function Schedule() {
  const def = defaults();
  const [name, setName] = useState('');
  const [date, setDate] = useState(def.date);
  const [time, setTime] = useState(def.time);
  const [dur, setDur] = useState<'30' | '60' | '90' | '120'>('60');
  const [pw, setPw] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/); const t = time.match(/^(\d{1,2})[.:](\d{2})$/);
    if (name.trim().length < 3) return Alert.alert('Judul meeting', 'Isi judul minimal 3 karakter.');
    if (!m || !t) return Alert.alert('Tanggal/jam tidak valid', 'Gunakan format tanggal TTTT-BB-HH dan jam JJ:MM.');
    const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) / 1000 - 7 * 3600; // WIB → UTC
    if (at < Date.now() / 1000 - 300) return Alert.alert('Waktu sudah lewat', 'Pilih waktu di masa mendatang.');
    setBusy(true);
    try {
      const { room } = await api<{ room: RoomInfo }>('POST', '/api/rooms', { name: name.trim(), scheduledAt: at, durationMin: +dur, ...(pw ? {} : { password: '' }) });
      router.replace(`/room/${room.id}`);
    } catch (e) { Alert.alert('Gagal menyimpan', (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 14 }}>
        <Field label="Judul meeting" value={name} onChangeText={setName} placeholder="mis. Kuliah Basis Data — Kelas A" />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1.3 }}><Field label="Tanggal" value={date} onChangeText={setDate} placeholder="2026-11-02" keyboardType="numbers-and-punctuation" /></View>
          <View style={{ flex: 1 }}><Field label="Jam (WIB)" value={time} onChangeText={setTime} placeholder="08:00" keyboardType="numbers-and-punctuation" /></View>
        </View>
        <T w="semibold" size={14} color={C.muted}>Durasi</T>
        <Segmented value={dur} onChange={setDur} options={[{ value: '30', label: '30 m' }, { value: '60', label: '1 jam' }, { value: '90', label: '1,5 j' }, { value: '120', label: '2 jam' }]} />
        <SwitchRow label="Pakai password" desc="Password 6 angka dibuat otomatis" value={pw} onChange={setPw} />
      </Card>
      <Button title="Simpan Jadwal" icon="checkmark" onPress={save} loading={busy} />
    </ScrollView>
  );
}
