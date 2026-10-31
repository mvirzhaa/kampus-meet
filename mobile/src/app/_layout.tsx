import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { AuthProvider, useAuth } from '@/lib/auth';
import { playTakbir, scheduleAzan, getAzanPrefs } from '@/lib/prayer';
import { C, F } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Saat aplikasi terbuka: azan diputar oleh aplikasi (rekaman takbir dari server bila ada), bukan bunyi notifikasi.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const azan = (n.request.content.data as { type?: string } | null)?.type === 'azan';
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: !azan, shouldSetBadge: false };
  },
});

function Root() {
  const { ready: authReady } = useAuth();
  // Huruf sudah tertanam di APK (plugin expo-font); useFonts menjamin tersedia juga di Expo Go / pratinjau web
  const [fontsLoaded, fontErr] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const ready = authReady && (fontsLoaded || !!fontErr);
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  useEffect(() => {
    scheduleAzan().catch(() => {});
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') scheduleAzan().catch(() => {}); });
    const rec = Notifications.addNotificationReceivedListener(async (n) => {
      if ((n.request.content.data as { type?: string } | null)?.type !== 'azan') return;
      if ((await getAzanPrefs()).sound) playTakbir().catch(() => {});
    });
    return () => { sub.remove(); rec.remove(); };
  }, []);
  if (!ready) return null;
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: C.bg }, headerShadowVisible: false, headerTintColor: C.text,
      headerTitleStyle: { fontFamily: F.bold, fontSize: 18 }, contentStyle: { backgroundColor: C.bg }, headerBackTitle: 'Kembali',
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: 'Masuk' }} />
      <Stack.Screen name="join" options={{ title: 'Gabung ke Meeting' }} />
      <Stack.Screen name="schedule" options={{ title: 'Jadwalkan Meeting' }} />
      <Stack.Screen name="room/[code]" options={{ title: 'Detail Meeting' }} />
      <Stack.Screen name="event/[slug]" options={{ title: 'Detail Event' }} />
      <Stack.Screen name="prayer" options={{ title: 'Jadwal Salat & Azan', presentation: 'modal' }} />
      <Stack.Screen name="meeting/[code]" options={{ headerShown: false, gestureEnabled: false, animation: 'fade', contentStyle: { backgroundColor: C.call } }} />
      <Stack.Screen name="j/[code]" options={{ headerShown: false }} />
      <Stack.Screen name="r/[code]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
