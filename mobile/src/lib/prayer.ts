// Jadwal salat 5 waktu wilayah Jakarta (WIB) + notifikasi azan (suara takbir pembuka).
// Parameter sama dengan versi web: sudut Subuh 20°, Isya 18° (Kemenag RI), Asar Syafi'i, ihtiyat 2 menit.
import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { getJSON, setJSON } from './store';
import { getServer } from './api';

export const PLACE = { name: 'Jakarta', lat: -6.2088, lng: 106.8456, tz: 'Asia/Jakarta' };
export const PRAYERS = [['fajr', 'Subuh'], ['dhuhr', 'Zuhur'], ['asr', 'Asar'], ['maghrib', 'Magrib'], ['isha', 'Isya']] as const;
export type PrayerKey = typeof PRAYERS[number][0];
export type Prayer = { key: PrayerKey; name: string; at: Date; time: string };

export const CHANNEL_SOUND = 'azan-takbir-v1';
export const CHANNEL_SILENT = 'azan-senyap-v1';
const SOUND_FILE = 'azan_takbir.wav';

const fmt = (d: Date) => {
  // WIB = UTC+7 tanpa musim panas: hitung manual agar tidak bergantung pada data Intl perangkat
  const w = new Date(d.getTime() + 7 * 3600_000);
  return `${String(w.getUTCHours()).padStart(2, '0')}:${String(w.getUTCMinutes()).padStart(2, '0')}`;
};
/** Tanggal kalender WIB dari sebuah waktu. */
const wibDate = (d: Date) => { const w = new Date(d.getTime() + 7 * 3600_000); return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate() }; };

export function prayerTimes(day: Date = new Date()): Prayer[] {
  const params = CalculationMethod.Singapore();
  params.madhab = Madhab.Shafi;
  params.methodAdjustments = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  params.adjustments = { fajr: 2, sunrise: 0, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 };
  const { y, m, d } = wibDate(day);
  const t = new PrayerTimes(new Coordinates(PLACE.lat, PLACE.lng), new Date(y, m, d), params);
  return PRAYERS.map(([key, name]) => ({ key, name, at: t[key], time: fmt(t[key]) }));
}
export function nextPrayer(now = new Date()): Prayer {
  return prayerTimes(now).find(p => p.at > now) || prayerTimes(new Date(now.getTime() + 86400_000))[0];
}
export function wibDateText(d = new Date()) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const w = new Date(d.getTime() + 7 * 3600_000);
  return `${days[w.getUTCDay()]}, ${w.getUTCDate()} ${months[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
}

// ---------- Pengaturan ----------
export type AzanPrefs = { on: boolean; sound: boolean; skip: PrayerKey[] };
const KEY = 'azan_prefs';
export const getAzanPrefs = () => getJSON<AzanPrefs>(KEY, { on: true, sound: true, skip: [] });
export async function saveAzanPrefs(p: AzanPrefs) { await setJSON(KEY, p); await scheduleAzan(); }

// ---------- Notifikasi ----------
export async function setupAzanChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_SOUND, {
    name: 'Azan (suara takbir)', description: 'Pengingat waktu salat 5 waktu wilayah Jakarta dengan suara takbir pembuka azan',
    importance: Notifications.AndroidImportance.HIGH, sound: SOUND_FILE, vibrationPattern: [0, 300, 200, 300], lightColor: '#047857',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_SILENT, {
    name: 'Azan (tanpa suara)', description: 'Pengingat waktu salat tanpa suara',
    importance: Notifications.AndroidImportance.DEFAULT, sound: null, vibrationPattern: [0, 250],
  });
}

export async function ensureNotifPermission(ask = true) {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!ask || !cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Jadwalkan ulang pengingat 7 hari ke depan (dipanggil saat aplikasi dibuka / pengaturan berubah). */
export async function scheduleAzan() {
  const prefs = await getAzanPrefs();
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(all.filter(n => (n.content.data as { type?: string } | null)?.type === 'azan').map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  if (!prefs.on) return 0;
  if (!(await ensureNotifPermission(false))) return 0;
  await setupAzanChannels();
  const now = Date.now(); let n = 0;
  for (let day = 0; day < 7; day++) {
    for (const p of prayerTimes(new Date(now + day * 86400_000))) {
      if (p.at.getTime() <= now + 5000 || prefs.skip.includes(p.key)) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Waktunya salat ${p.name}`,
          body: `${p.time} WIB · wilayah ${PLACE.name}. Allahu akbar, Allahu akbar.`,
          sound: prefs.sound ? SOUND_FILE : undefined,
          data: { type: 'azan', key: p.key, time: p.time },
          color: '#047857',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: prefs.sound ? CHANNEL_SOUND : CHANNEL_SILENT },
      });
      n++;
    }
  }
  return n;
}

// ---------- Suara takbir di dalam aplikasi ----------
let player: AudioPlayer | null = null;
let serverOk: boolean | null = null;
/**
 * Putar takbir pembuka azan. Bila admin sudah mengunggah rekaman di server, rekaman itu yang diputar;
 * bila belum / offline, dipakai bunyi bawaan aplikasi.
 */
export async function playTakbir() {
  try { await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }); } catch { /* abaikan */ }
  stopTakbir();
  if (serverOk !== false) {
    try {
      const r = await fetch(getServer() + '/api/azan-audio', { method: 'HEAD' });
      serverOk = r.ok;
    } catch { serverOk = false; }
  }
  player = createAudioPlayer(serverOk ? { uri: getServer() + '/api/azan-audio' } : require('../../assets/sounds/azan_takbir.wav'));
  player.volume = 1;
  player.play();
}
export function stopTakbir() { try { player?.pause(); player?.remove(); } catch { /* abaikan */ } player = null; }
