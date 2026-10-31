// Layar pembuka ala aplikasi meeting populer: logo, slogan, dua tombol besar.
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, T } from '@/components/ui';
import { C } from '@/lib/theme';

export default function Welcome() {
  return (
    <SafeAreaView style={s.wrap}>
      <StatusBar style="light" />
      <View style={s.top}>
        <Image source={require('../../assets/logo.png')} style={s.logo} />
        <T w="extrabold" size={34} color="#fff">UIKA Meet</T>
        <T size={16} color="#BFE3D3" style={{ textAlign: 'center' }}>Kuliah daring, seminar, dan rapat kampus{'\n'}Universitas Ibn Khaldun Bogor</T>
      </View>
      <View style={s.feat}>
        {['Meeting video & audio jernih', 'Transkripsi + terjemahan Indonesia ⇄ Inggris', 'Pengingat azan 5 waktu'].map(t => (
          <View key={t} style={s.featRow}><View style={s.dot} /><T size={15} color="#D9F2E6">{t}</T></View>
        ))}
      </View>
      <View style={s.actions}>
        <Button title="Gabung ke Meeting" icon="enter-outline" variant="gold" onPress={() => router.push('/join')} />
        <Button title="Masuk" icon="log-in-outline" variant="light" onPress={() => router.push('/login')} />
        <T size={13} color="#8FB5A6" style={{ textAlign: 'center' }}>Masuk dengan akun email kampus untuk membuat meeting & mengikuti event bersertifikat.</T>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.deep, paddingHorizontal: 24 },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  logo: { width: 112, height: 112, marginBottom: 8 },
  feat: { gap: 10, marginBottom: 28, alignSelf: 'center' },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold },
  actions: { gap: 12, paddingBottom: 18 },
});
