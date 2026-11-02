// Kartu undangan (tab Undangan & beranda). Room sudah dibuka → kartu hijau dengan tombol Gabung.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, T } from '@/components/ui';
import type { Invitation } from '@/lib/api';
import { invitationStatus, openInvitation } from '@/lib/invites';
import { fmtDay, fmtTime } from '@/lib/format';
import { C } from '@/lib/theme';

export function InvitationCard({ e, compact }: { e: Invitation; compact?: boolean }) {
  const st = invitationStatus(e);
  const open = st.key === 'open';
  return (
    <Pressable onPress={() => openInvitation(e)} style={({ pressed }) => [pressed && { opacity: 0.88 }]}
      accessibilityRole="button" accessibilityLabel={`${e.title}. ${st.label}. ${open ? 'Ketuk untuk bergabung' : 'Ketuk untuk detail'}`}>
      <Card style={[s.card, open && s.cardOpen]}>
        <View style={s.when}>
          <T w="extrabold" size={17} color={open ? '#fff' : C.primaryDark}>{fmtTime(e.startsAt)}</T>
          <T size={11.5} color={open ? '#CFEBDD' : C.muted}>{fmtDay(e.startsAt)}</T>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={[s.badge, { backgroundColor: open ? 'rgba(255,255,255,0.18)' : st.key === 'ended' ? '#EEF2F0' : '#FFF3D6' }]}>
            {open ? <View style={s.dot} /> : null}
            <T w="bold" size={11.5} color={open ? '#fff' : st.key === 'ended' ? C.muted : '#8A5A00'}>{st.label}</T>
          </View>
          <T w="bold" size={15.5} numberOfLines={2} color={open ? '#fff' : C.text}>{e.title}</T>
          {!compact && e.organizer ? <T size={12.5} numberOfLines={1} color={open ? '#CFEBDD' : C.muted}>Dari {e.organizer}</T> : null}
        </View>
        {open ? (
          <View style={s.joinBtn}><Ionicons name="videocam" size={18} color={C.deep} /><T w="bold" size={13} color={C.deep}>Gabung</T></View>
        ) : <Ionicons name="chevron-forward" size={18} color="#9AB0A8" />}
      </Card>
    </Pressable>
  );
}


const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  cardOpen: { backgroundColor: C.primary, borderColor: C.primary },
  when: { width: 58, alignItems: 'center' },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.gold, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  cal: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingHorizontal: 6 },
  fitri: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.soft, borderRadius: 14, padding: 12, marginTop: 8 },
});
