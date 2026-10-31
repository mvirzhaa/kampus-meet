// Satu kotak peserta: video (bila kamera menyala) atau avatar, nama, status mikrofon, tangan, reaksi, sorotan bicara.
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoTrack, isTrackReference, useIsMuted, useIsSpeaking, type TrackReferenceOrPlaceholder } from '@livekit/react-native';
import { Track, type Participant } from 'livekit-client';
import { Avatar, T } from '@/components/ui';
import { nameOf, roleOf } from '@/lib/useMeeting';
import { C } from '@/lib/theme';

export function Tile({ p, cam, style, big, hand, react, hideVideo, fit = 'cover', label }: {
  p: Participant; cam?: TrackReferenceOrPlaceholder; style?: StyleProp<ViewStyle>; big?: boolean; hand?: boolean; react?: string;
  hideVideo?: boolean; fit?: 'cover' | 'contain'; label?: string;
}) {
  const speaking = useIsSpeaking(p);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone } as TrackReferenceOrPlaceholder);
  const ref = cam ?? ({ participant: p, source: Track.Source.Camera, publication: p.getTrackPublication(Track.Source.Camera) } as TrackReferenceOrPlaceholder);
  const camMuted = useIsMuted(ref);
  const showVideo = !hideVideo && isTrackReference(ref) && !camMuted && !!ref.publication.track;
  const name = label || nameOf(p) + (p.isLocal ? ' (Saya)' : '');
  return (
    <View style={[s.tile, style, speaking && !micMuted && s.speaking]}>
      {showVideo ? (
        <VideoTrack trackRef={isTrackReference(ref) ? ref : undefined} style={StyleSheet.absoluteFill} objectFit={fit} mirror={p.isLocal && ref.source === Track.Source.Camera} zOrder={big ? 0 : 1} />
      ) : (
        <View style={s.center}><Avatar name={nameOf(p)} size={big ? 96 : 56} dark /></View>
      )}
      {react ? <View style={s.react}><T size={big ? 44 : 30}>{react}</T></View> : null}
      {hand ? <View style={s.hand}><T size={big ? 22 : 16}>✋</T></View> : null}
      <View style={s.label}>
        {micMuted ? <Ionicons name="mic-off" size={14} color="#FF8A8A" /> : <Ionicons name="mic" size={14} color={speaking ? '#6EE7B7' : '#fff'} />}
        <T w="semibold" size={big ? 14 : 12.5} color="#fff" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</T>
        {roleOf(p) === 'moderator' ? <Ionicons name="star" size={12} color={C.gold} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tile: { backgroundColor: C.callTile, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  speaking: { borderColor: '#34D399' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  label: { position: 'absolute', left: 8, bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  hand: { position: 'absolute', top: 8, left: 8, backgroundColor: C.gold, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  react: { position: 'absolute', top: 8, right: 10 },
});
