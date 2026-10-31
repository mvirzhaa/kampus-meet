import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { DEFAULT_SERVER, getServer, setServer } from '@/lib/api';
import { C } from '@/lib/theme';

export default function Login() {
  const { login, refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [srv, setSrv] = useState(getServer());

  async function submit() {
    if (!email.includes('@') || !pw) return Alert.alert('Lengkapi data', 'Isi email dan password akun kampus Anda.');
    setBusy(true);
    try {
      if (srv.trim() && srv.trim() !== getServer()) { await setServer(srv); await refresh(); }
      await login(email, pw);
      router.replace('/(tabs)');
    } catch (e) { Alert.alert('Gagal masuk', (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <T w="extrabold" size={26}>Masuk ke UIKA Meet</T>
        <T color={C.muted}>Gunakan akun email kampus yang sama dengan versi web.</T>
        <Card style={{ gap: 14 }}>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="nama@uika-bogor.ac.id" />
          <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="password" placeholder="Password" onSubmitEditing={submit} />
          <Button title="Masuk" onPress={submit} loading={busy} />
        </Card>
        <Button small variant="ghost" icon="server-outline" title={showServer ? 'Sembunyikan pengaturan server' : 'Pengaturan server'} onPress={() => setShowServer(v => !v)} />
        {showServer ? (
          <Card style={{ gap: 10 }}>
            <Field label="Alamat server" value={srv} onChangeText={setSrv} autoCapitalize="none" keyboardType="url" placeholder={DEFAULT_SERVER} />
            <T size={13} color={C.muted}>Biarkan bawaan ({DEFAULT_SERVER}) kecuali diminta admin kampus.</T>
          </Card>
        ) : null}
        <View style={{ height: 30 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
