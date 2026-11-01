// Cek versi aplikasi terbaru yang diunggah admin (Panel Admin → Aplikasi Android).
import { Alert, Linking } from 'react-native';
import { APP_VERSION, APP_VERSION_CODE, api, getServer } from './api';
import { getStr, setStr } from './store';

export type Release = { id: number; version: string; versionCode: number; notes: string; size: number; publishedAt: number; url: string };

/** Versi a lebih baru dari b? (1.10.0 > 1.9.2) */
function newerName(a: string, b: string) {
  const pa = a.split(/[.+-]/).map(n => parseInt(n, 10) || 0), pb = b.split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
export const isNewer = (r: Release) => r.versionCode > APP_VERSION_CODE || (r.versionCode === APP_VERSION_CODE && newerName(r.version, APP_VERSION));

export async function latestRelease(): Promise<Release | null> {
  try { const r = await api<{ latest: Release | null }>('GET', '/api/app/latest'); return r.latest && isNewer(r.latest) ? r.latest : null; }
  catch { return null; }
}
export const downloadUpdate = (r?: Release | null) => Linking.openURL(getServer() + (r?.url || '/unduh/android'));

/** Saat aplikasi dibuka: tawarkan pembaruan sekali per versi (bisa ditunda, ditawarkan lagi setelah 3 hari). */
export async function promptUpdate() {
  const r = await latestRelease();
  if (!r) return;
  const seen = await getStr('upd_seen');
  const [ver, at] = (seen || '').split('@');
  if (ver === String(r.versionCode) && Date.now() - Number(at || 0) < 3 * 86400_000) return;
  await setStr('upd_seen', `${r.versionCode}@${Date.now()}`);
  const notes = r.notes.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8).map(l => (/^[-•*·]/.test(l) ? l.replace(/^[-*·]\s*/, '• ') : `• ${l}`)).join('\n');
  Alert.alert(`Versi baru ${r.version} tersedia`, `${notes}\n\nUkuran ${(r.size / 1048576).toFixed(0)} MB. Setelah terunduh, buka file-nya untuk memperbarui (data dan login Anda tetap tersimpan).`, [
    { text: 'Nanti', style: 'cancel' },
    { text: 'Unduh pembaruan', onPress: () => downloadUpdate(r) },
  ]);
}
