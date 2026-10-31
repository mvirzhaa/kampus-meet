import React from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { Avatar, Button, Card, Row, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { getServer } from '@/lib/api';
import { C } from '@/lib/theme';

export default function Akun() {
  const { me, logout } = useAuth();
  const u = me?.user;
  return (
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={u?.name || 'Tamu'} size={56} />
        <View style={{ flex: 1 }}>
          <T w="bold" size={18}>{u?.name || 'Tamu'}</T>
          <T size={13.5} color={C.muted}>{u?.email || 'Belum masuk'}</T>
        </View>
      </Card>
      {!u ? <Button title="Masuk" icon="log-in-outline" onPress={() => router.push('/login')} /> : null}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row icon="moon-outline" label="Jadwal salat & azan" value="Pengingat 5 waktu · wilayah Jakarta" onPress={() => router.push('/prayer')} />
        <Row icon="ribbon-outline" label="Sertifikat saya" value="Buka di versi web" onPress={() => Linking.openURL(getServer() + '/dashboard#sertifikat')} />
        <Row icon="book-outline" label="Panduan penggunaan" onPress={() => Linking.openURL(getServer() + '/panduan')} />
        <Row icon="globe-outline" label="Buka versi web" value={getServer().replace(/^https?:\/\//, '')} onPress={() => Linking.openURL(getServer())} />
      </Card>
      {u ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Row icon="log-out-outline" label="Keluar" danger onPress={() => Alert.alert('Keluar dari akun?', '', [{ text: 'Batal', style: 'cancel' }, { text: 'Keluar', style: 'destructive', onPress: async () => { await logout(); router.replace('/welcome'); } }])} />
        </Card>
      ) : null}
      <T size={12.5} color={C.muted} style={{ textAlign: 'center' }}>UIKA Meet {Constants.expoConfig?.version} · Universitas Ibn Khaldun Bogor</T>
    </ScrollView>
  );
}
