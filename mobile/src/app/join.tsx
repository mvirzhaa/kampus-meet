// Gabung ke meeting: ID/tautan, nama tampilan, pilihan audio & video — seperti layar "Join" Zoom.
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Field, SwitchRow, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, ApiError, parseMeetingInput, type JoinInfo } from '@/lib/api';
import { joinMeeting } from '@/lib/meet';
import { getJSON, setJSON } from '@/lib/store';
import { fmtDateTime } from '@/lib/format';
import { C } from '@/lib/theme';

export default function Join() {
  const params = useLocalSearchParams<{ code?: string; k?: string }>();
  const { me } = useAuth();
  const [input, setInput] = useState(params.code ? params.code + (params.k ? `?k=${params.k}` : '') : '');
  const [name, setName] = useState(me?.user?.name || '');
  const [password, setPassword] = useState('');
  const [noAudio, setNoAudio] = useState(false);
  const [noVideo, setNoVideo] = useState(true);
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getJSON('join_prefs', { name: '', noAudio: false, noVideo: true }).then(p => { if (!me?.user && p.name) setName(p.name); setNoAudio(p.noAudio); setNoVideo(p.noVideo); }); }, [me?.user]);
  const target = (() => {
    if (params.code && input === params.code + (params.k ? `?k=${params.k}` : '')) return { code: params.code, key: params.k };
    return parseMeetingInput(input);
  })();

  async function go() {
    if (!target) return Alert.alert('ID tidak valid', 'Masukkan ID room (mis. abc-defg-hij) atau tempel tautan undangan.');
    if (name.trim().length < 2) return Alert.alert('Nama tampilan', 'Isi nama tampilan minimal 2 karakter (disarankan nama & NIM).');
    setBusy(true);
    try {
      const i = info?.room.id === target.code ? info : await api<JoinInfo>('GET', `/api/join/${encodeURIComponent(target.code)}${target.key ? `?k=${encodeURIComponent(target.key)}` : ''}`);
      setInfo(i);
      if (i.needLogin) { setBusy(false); return Alert.alert('Perlu masuk', i.event ? 'Silakan masuk dengan akun kampus untuk mengikuti event ini.' : 'Room ini hanya untuk pengguna yang sudah masuk.', [{ text: 'Batal', style: 'cancel' }, { text: 'Masuk', onPress: () => router.push('/login') }]); }
      if (i.event && !i.event.open && i.role !== 'moderator') { setBusy(false); return Alert.alert('Room belum dibuka', `Room event dibuka 30 menit sebelum acara (${fmtDateTime(i.event.startsAt)}).`); }
      if (i.needPassword && !password) { setBusy(false); return; } // tampilkan kolom password
      await setJSON('join_prefs', { name: name.trim(), noAudio, noVideo });
      await joinMeeting({ code: target.code, key: target.key, name: name.trim(), password, audio: !noAudio, video: !noVideo });
      router.replace(`/meeting/${i.room.id}`);
    } catch (e) {
      const err = e as ApiError;
      Alert.alert(err.status === 404 ? 'Room tidak ditemukan' : 'Tidak bisa bergabung', err.status === 404 ? 'Periksa kembali ID room.' : err.message);
    } finally { setBusy(false); }
  }

  const needPw = !!info?.needPassword && info.room.id === target?.code;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 14 }}>
          <Field label="ID room atau tautan undangan" value={input} onChangeText={(v) => { setInput(v); setInfo(null); }} placeholder="abc-defg-hij" autoCapitalize="none" autoCorrect={false} style={{ fontSize: 18, textAlign: 'center' }} />
          <Field label="Nama tampilan" value={name} onChangeText={setName} placeholder="Nama lengkap (dan NIM)" />
          {needPw ? <Field label={info?.event ? 'Password event' : 'Password room'} value={password} onChangeText={setPassword} placeholder="Password dari dosen/panitia" autoCapitalize="none" autoFocus /> : null}
          {info ? <T size={13.5} color={C.muted}>{info.event ? `Event: ${info.event.title}` : `${info.room.name}${info.room.owner ? ` · ${info.room.owner}` : ''}`}</T> : null}
        </Card>
        <Button title="Gabung" icon="enter-outline" onPress={go} loading={busy} disabled={!input.trim()} />
        <T size={13} color={C.muted} style={{ textAlign: 'center' }}>Dengan bergabung, nama tampilan Anda terlihat oleh peserta lain dan tercatat di daftar hadir.</T>
        <Card style={{ gap: 4 }}>
          <T w="bold" size={14} color={C.muted}>PILIHAN BERGABUNG</T>
          <SwitchRow label="Jangan nyalakan mikrofon" desc="Masuk dalam keadaan bisu" value={noAudio} onChange={setNoAudio} />
          <SwitchRow label="Matikan video saya" desc="Hemat kuota; kamera bisa dinyalakan nanti" value={noVideo} onChange={setNoVideo} />
        </Card>
        <View style={{ height: 20 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
