// Bagikan poster event + keterangannya dari HP ke WhatsApp, Facebook, Instagram (atau aplikasi lain).
// • WhatsApp: pesan berisi keterangan + tautan share (/p/…) yang tampil dengan gambar poster sebagai pratinjau.
// • Facebook: tautan share dibuka di Facebook (pratinjau gambar poster dari meta Open Graph).
// • Instagram / "Kirim gambar": file PNG poster diunduh lalu dibagikan lewat menu berbagi Android;
//   keterangan otomatis disalin ke clipboard untuk ditempel.
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { api, getServer } from './api';

export type PosterInfo = {
  event: { id: number; slug: string; title: string; dateText: string; timeText: string };
  caption: string; shareUrl: string; imageUrl: string | null; canEdit: boolean;
};

export const getPoster = (slug: string) => api<PosterInfo>('GET', `/api/events/${encodeURIComponent(slug)}/poster`);
export const posterImageUri = (p: PosterInfo) => (p.imageUrl ? getServer() + p.imageUrl : null);

/** Unduh PNG poster ke cache aplikasi (dipakai ulang selama versinya sama). */
async function downloadPoster(p: PosterInfo): Promise<string> {
  if (!p.imageUrl) throw new Error('Penyelenggara belum menerbitkan gambar poster untuk event ini.');
  const ver = (p.imageUrl.match(/v=(\d+)/) || [])[1] || '0';
  const file = new File(Paths.cache, `poster-${p.event.id}-${ver}.png`);
  if (file.exists) return file.uri;
  const out = await File.downloadFileAsync(getServer() + p.imageUrl, file, { idempotent: true });
  return out.uri;
}

export async function copyCaption(p: PosterInfo) { await Clipboard.setStringAsync(p.caption); }

export async function shareWhatsApp(p: PosterInfo) {
  const text = encodeURIComponent(p.caption);
  try { await Linking.openURL(`whatsapp://send?text=${text}`); }
  catch { await Linking.openURL(`https://wa.me/?text=${text}`); }
}
export async function shareFacebook(p: PosterInfo) {
  await Linking.openURL(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(p.shareUrl)}`);
}
/** Bagikan gambar poster (Instagram, WhatsApp sebagai gambar, Facebook, dll.). Keterangan disalin lebih dulu. */
export async function shareImage(p: PosterInfo, title = 'Bagikan poster') {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Berbagi file tidak didukung di perangkat ini.');
  const uri = await downloadPoster(p);
  await copyCaption(p);
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: title });
}
