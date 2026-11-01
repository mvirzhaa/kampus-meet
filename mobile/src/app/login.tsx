import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Field, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { DEFAULT_SERVER, getServer, setServer } from '@/lib/api';
import { mulaiLoginEportal, type EportalRole } from '@/lib/eportal';
import { C } from '@/lib/theme';

type Mode = 'lokal' | 'eportal';

export default function Login() {
  const { me, login, loginSso, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>('lokal');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [srv, setSrv] = useState(getServer());
  // Pemilih jabatan hanya muncul bila E-Portal mengembalikan lebih dari satu
  const [roles, setRoles] = useState<EportalRole[] | null>(null);
  const [ambilToken, setAmbilToken] = useState<((id: number) => Promise<string>) | null>(null);

  const sso = me?.app?.sso || null;

  async function simpanServerBilaBerubah() {
    if (srv.trim() && srv.trim() !== getServer()) { await setServer(srv); await refresh(); }
  }

  async function submitLokal() {
    if (!email.includes('@') || !pw) return Alert.alert('Lengkapi data', 'Isi email dan password akun kampus Anda.');
    setBusy(true);
    try {
      await simpanServerBilaBerubah();
      await login(email, pw);
      router.replace('/(tabs)');
    } catch (e) { Alert.alert('Gagal masuk', (e as Error).message); }
    finally { setBusy(false); }
  }

  /** Selesaikan login setelah jabatan diketahui (otomatis bila hanya satu). */
  async function selesaikan(ambil: (id: number) => Promise<string>, roleId: number) {
    const scoped = await ambil(roleId);
    await loginSso(scoped);
    router.replace('/(tabs)');
  }

  async function submitEportal() {
    if (!sso) return;
    if (!email.includes('@') || !pw) return Alert.alert('Lengkapi data', 'Isi email dan password akun E-Portal Anda.');
    setBusy(true);
    try {
      await simpanServerBilaBerubah();
      const sesi = await mulaiLoginEportal(sso.baseUrl, sso.moduleId, email.trim(), pw);
      setPw('');                                   // password tidak perlu disimpan lebih lama
      if (sesi.roles.length === 1) {
        await selesaikan(sesi.tokenUntuk, sesi.roles[0].id);
      } else {
        setRoles(sesi.roles);                      // tampilkan pemilih jabatan
        setAmbilToken(() => sesi.tokenUntuk);
      }
    } catch (e) { Alert.alert('Gagal masuk lewat E-Portal', (e as Error).message); }
    finally { setBusy(false); }
  }

  async function pilihJabatan(r: EportalRole) {
    if (!ambilToken) return;
    setBusy(true);
    try { await selesaikan(ambilToken, r.id); }
    catch (e) { Alert.alert('Gagal masuk', (e as Error).message); }
    finally { setBusy(false); }
  }

  // ── Layar pemilih jabatan ──────────────────────────────────────────────
  if (roles) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <T w="extrabold" size={24}>Pilih jabatan</T>
        <T color={C.muted}>Akun E-Portal Anda memiliki lebih dari satu jabatan. Pilih yang akan dipakai di UIKA Meet.</T>
        <Card style={{ gap: 10 }}>
          {roles.map(r => (
            <Button key={r.id} title={r.name} variant="ghost" disabled={busy} onPress={() => pilihJabatan(r)} />
          ))}
        </Card>
        <Button small variant="ghost" icon="arrow-back-outline" title="Kembali"
          onPress={() => { setRoles(null); setAmbilToken(null); }} />
      </ScrollView>
    );
  }

  // ── Layar masuk ────────────────────────────────────────────────────────
  const eportal = mode === 'eportal';
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <T w="extrabold" size={26}>Masuk ke UIKA Meet</T>

        {sso ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Tab aktif={!eportal} label="Akun UIKA Meet" onPress={() => setMode('lokal')} />
              <Tab aktif={eportal} label="E-Portal" onPress={() => setMode('eportal')} />
            </View>
            <T color={C.muted}>
              {eportal
                ? 'Gunakan email dan password E-Portal UIKA. Password dikirim langsung ke E-Portal dan tidak disimpan di aplikasi ini.'
                : 'Gunakan akun UIKA Meet yang sama dengan versi web.'}
            </T>
          </>
        ) : (
          <T color={C.muted}>Gunakan akun email kampus yang sama dengan versi web.</T>
        )}

        <Card style={{ gap: 14 }}>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none"
            keyboardType="email-address" autoComplete="email"
            placeholder={eportal ? 'Email E-Portal Anda' : 'nama@uika-bogor.ac.id'} />
          <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="password"
            placeholder="Password" onSubmitEditing={eportal ? submitEportal : submitLokal} />
          <Button title={eportal ? 'Masuk lewat E-Portal' : 'Masuk'} loading={busy}
            onPress={eportal ? submitEportal : submitLokal} />
        </Card>

        <Button small variant="ghost" icon="server-outline"
          title={showServer ? 'Sembunyikan pengaturan server' : 'Pengaturan server'}
          onPress={() => setShowServer(v => !v)} />
        {showServer ? (
          <Card style={{ gap: 10 }}>
            <Field label="Alamat server" value={srv} onChangeText={setSrv} autoCapitalize="none"
              keyboardType="url" placeholder={DEFAULT_SERVER} />
            <T size={13} color={C.muted}>Biarkan bawaan ({DEFAULT_SERVER}) kecuali diminta admin kampus.</T>
          </Card>
        ) : null}
        <View style={{ height: 30 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Tab({ aktif, label, onPress }: { aktif: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
      backgroundColor: aktif ? C.primary : 'transparent',
      borderWidth: 1, borderColor: aktif ? C.primary : C.border,
    }}>
      <T w="bold" size={14} color={aktif ? '#fff' : C.muted}>{label}</T>
    </Pressable>
  );
}
