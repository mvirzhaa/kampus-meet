// Teks langsung (CC) di atas toolbar: kalimat terbaru tiap pembicara + terjemahannya.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '@/components/ui';
import type { Cap } from '@/lib/useMeeting';
import { SHORT, type Lang2 } from '@/lib/translate';
import { C } from '@/lib/theme';

export function Captions({ caps, trs, trTo, showOriginal, now }: { caps: Record<string, Cap>; trs: Record<string, Partial<Record<Lang2, string>>>; trTo: Lang2 | ''; showOriginal: boolean; now: number }) {
  const list = Object.values(caps).filter(c => now - c.ts < (c.final ? 7000 : 4000)).sort((a, b) => a.ts - b.ts).slice(-2);
  if (!list.length) return null;
  return (
    <View style={s.wrap} pointerEvents="none">
      {list.map(c => {
        const needTr = !!trTo && SHORT[c.lang] !== trTo;
        const tr = needTr ? (c.final ? trs[c.key]?.[trTo as Lang2] : trs[`${c.identity}:interim`]?.[trTo as Lang2]) : undefined;
        const showOrig = !needTr || showOriginal || !tr;
        return (
          <View key={c.identity} style={s.line}>
            <T w="bold" size={12.5} color={C.gold}>{c.name}</T>
            {showOrig ? <T size={15.5} color="#fff" numberOfLines={3}>{c.text}</T> : null}
            {needTr && tr ? <T w="semibold" size={15.5} color="#A7F3D0" numberOfLines={3}>{tr}</T> : null}
          </View>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, bottom: 8, gap: 6 },
  line: { backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});
