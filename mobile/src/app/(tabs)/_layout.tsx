import React from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { C, F } from '@/lib/theme';
import type { IconName } from '@/components/ui';

const icon = (name: IconName, active: IconName) => ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) =>
  <Ionicons name={focused ? active : name} size={size} color={color as string} />;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: C.primary, tabBarInactiveTintColor: '#7E928B',
      tabBarLabelStyle: { fontFamily: F.semibold, fontSize: 12 },
      tabBarStyle: { backgroundColor: '#fff', borderTopColor: C.border, height: 64, paddingTop: 6 },
      headerStyle: { backgroundColor: C.bg }, headerShadowVisible: false, headerTitleStyle: { fontFamily: F.extrabold, fontSize: 22, color: C.text },
      sceneStyle: { backgroundColor: C.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Meeting', headerShown: false, tabBarIcon: icon('videocam-outline', 'videocam') }} />
      <Tabs.Screen name="jadwal" options={{ title: 'Jadwal', tabBarIcon: icon('calendar-outline', 'calendar') }} />
      <Tabs.Screen name="events" options={{ title: 'Event', tabBarIcon: icon('ribbon-outline', 'ribbon') }} />
      <Tabs.Screen name="akun" options={{ title: 'Akun', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
