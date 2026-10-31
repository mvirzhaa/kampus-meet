// Pengganti @livekit/react-native untuk pratinjau di browser saja (tidak ikut ke aplikasi Android).
import React, { useEffect, useRef } from 'react';
// @ts-expect-error: tidak ada tipe untuk API internal react-native-web
import { unstable_createElement } from 'react-native-web';
import type { TrackReference } from '@livekit/components-react';

export {
  RoomContext, useRoomContext, useTracks, useParticipants, useLocalParticipant, useSpeakingParticipants, useIsSpeaking, useIsMuted,
  isTrackReference, useRemoteParticipants, useConnectionState,
} from '@livekit/components-react';
export type { TrackReferenceOrPlaceholder, TrackReference } from '@livekit/components-react';

export function registerGlobals() { /* browser sudah punya WebRTC */ }
export const AudioSession = {
  startAudioSession: async () => {}, stopAudioSession: async () => {},
  getAudioOutputs: async () => ['speaker'], selectAudioOutput: async (_: string) => {},
};

export function VideoTrack({ trackRef, style, objectFit = 'cover', mirror }: { trackRef?: TrackReference; style?: object; objectFit?: 'cover' | 'contain'; mirror?: boolean; zOrder?: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const track = trackRef?.publication?.track;
  useEffect(() => {
    const el = ref.current; if (!track || !el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return unstable_createElement('video', {
    ref, autoPlay: true, muted: true, playsInline: true,
    style: [{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit, transform: mirror ? 'scaleX(-1)' : undefined }, style],
  });
}
