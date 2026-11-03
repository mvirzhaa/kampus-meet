// Rating & komentar event (tidak wajib) — sama dengan web: bintang 1–5, komentar, bintang per narasumber.
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { api } from './api';

export type RatingSummary = { avg: number | null; count: number; dist: number[]; speakers: { name: string; avg: number; count: number }[] };
export type RatingInfo = {
  summary: RatingSummary; speakers: string[];
  can: { ok: boolean; reason: string; message: string };
  mine: { rating: number; comment: string; at: number; speakers: Record<string, number> } | null;
  recent: { name: string; rating: number; comment: string; at: number }[];
};
export type PendingRating = { id: number; slug: string; title: string; roomId: string; endsAt: number };
export const LABELS = ['Sangat buruk', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'];
export const getRating = (eventId: number) => api<RatingInfo>('GET', `/api/events/${eventId}/rating`);
export const sendRating = (eventId: number, body: { rating: number; comment: string; speakers: Record<string, number> }) =>
  api<{ ok: boolean; summary: RatingSummary }>('POST', `/api/events/${eventId}/rating`, body);

/** Setelah keluar dari meeting sebuah event: tawarkan memberi rating (sekali, tidak wajib). */
export function askRatingAfterMeeting(roomCode: string) {
  setTimeout(async () => {
    try {
      const j = await api<{ event: { id?: number; slug: string; title: string } | null }>('GET', `/api/join/${encodeURIComponent(roomCode)}`);
      if (!j.event?.id) return;
      const r = await getRating(j.event.id);
      if (!r.can.ok || r.mine) return;
      Alert.alert('Bagaimana event ini?', `Beri rating & komentar untuk "${j.event.title}" (tidak wajib).`, [
        { text: 'Nanti', style: 'cancel' },
        { text: 'Beri rating', onPress: () => router.push({ pathname: '/event/[slug]', params: { slug: j.event!.slug, rate: '1' } }) },
      ]);
    } catch { /* tidak wajib */ }
  }, 2500);   // beri waktu server mencatat waktu keluar
}
