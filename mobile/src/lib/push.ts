// Notifikasi undangan & pengingat event.
// • Push dari server (Firebase Cloud Messaging): token perangkat didaftarkan ke server setelah login,
//   sehingga undangan baru dan pengingat 30 menit sebelum event tetap sampai walau aplikasi ditutup.
// • Cadangan: bila server belum memasang Firebase (atau APK dibangun tanpa google-services.json),
//   pengingat 30 menit dijadwalkan sebagai notifikasi lokal dari daftar "Undangan saya".
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api, type Invitation } from './api';
import { getStr, setStr } from './store';
import { ensureNotifPermission } from './prayer';

export const CHANNEL_MEETINGS = 'meetings';   // sama dengan android.notification.channel_id di server
const LOCAL_PREFIX = 'inv-';

export async function setupMeetingChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_MEETINGS, {
    name: 'Undangan & pengingat event', description: 'Undangan event baru dan pengingat sebelum event dimulai',
    importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#047857',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

type PushState = { serverPush: boolean; deviceToken: string | null; reminderMinutes: number };
let state: PushState = { serverPush: false, deviceToken: null, reminderMinutes: 30 };

/** Daftarkan perangkat ke server (dipanggil setelah login / saat aplikasi dibuka). Aman dipanggil berulang. */
export async function registerPush(ask = true): Promise<PushState> {
  if (Platform.OS !== 'android') return state;
  try { await setupMeetingChannel(); } catch { /* abaikan */ }
  if (!(await ensureNotifPermission(ask).catch(() => false))) { await syncLocalReminders(); return state; }
  let token: string | null = null;
  try { token = String((await Notifications.getDevicePushTokenAsync()).data || '') || null; }
  catch { token = null; }   // APK tanpa konfigurasi Firebase → hanya pengingat lokal
  state.deviceToken = token;
  if (token) {
    try {
      const r = await api<{ push: boolean; reminderMinutes: number }>('POST', '/api/push/register', { token, platform: 'android' });
      state.serverPush = !!r.push; state.reminderMinutes = r.reminderMinutes || 30;
      await setStr('pushToken', token);
    } catch { state.serverPush = false; }
  } else {
    try { const r = await api<{ push: boolean; reminderMinutes: number }>('GET', '/api/push/status'); state.reminderMinutes = r.reminderMinutes || 30; } catch { /* offline */ }
    state.serverPush = false;
  }
  await syncLocalReminders();
  return state;
}

/** Saat keluar akun: lepaskan token dari akun ini dan hapus pengingat lokal. */
export async function unregisterPush() {
  const token = state.deviceToken || (await getStr('pushToken'));
  if (token) { try { await api('POST', '/api/push/unregister', { token }); } catch { /* abaikan */ } }
  await setStr('pushToken', null);
  state = { serverPush: false, deviceToken: null, reminderMinutes: 30 };
  await clearLocalReminders();
}

async function clearLocalReminders() {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(all.filter(n => n.identifier.startsWith(LOCAL_PREFIX)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch { /* abaikan */ }
}

/**
 * Pengingat lokal (hanya bila push server tidak aktif, agar tidak dobel).
 * invitations boleh diberikan dari layar yang baru saja memuatnya, supaya tidak meminta ulang ke server.
 */
export async function syncLocalReminders(invitations?: Invitation[]) {
  await clearLocalReminders();
  if (state.serverPush || Platform.OS !== 'android') return;
  if (!(await ensureNotifPermission(false).catch(() => false))) return;
  let list = invitations;
  if (!list) { try { const r = await api<{ invitations: Invitation[]; reminderMinutes: number }>('GET', '/api/my/invitations'); list = r.invitations; state.reminderMinutes = r.reminderMinutes || state.reminderMinutes; } catch { return; } }
  const lead = state.reminderMinutes * 60;
  const now = Date.now() / 1000;
  for (const e of list.slice(0, 40)) {
    const at = e.startsAt - lead;
    if (at <= now + 10) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${LOCAL_PREFIX}${e.id}`,
        content: {
          title: `Event dimulai ${state.reminderMinutes} menit lagi`,
          body: `${e.title} · ketuk untuk bergabung.`,
          data: { type: 'reminder', eventId: e.id, slug: e.slug, room: e.roomId, startsAt: e.startsAt },
          color: '#047857',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at * 1000), channelId: CHANNEL_MEETINGS },
      });
    } catch { /* abaikan satu event */ }
  }
}

/** Ambil data dari notifikasi (lokal, FCM saat aplikasi terbuka, atau FCM yang ditampilkan sistem). */
export function notifData(n: Notifications.Notification): Record<string, unknown> {
  const c = (n.request.content.data || {}) as Record<string, unknown>;
  const remote = ((n.request.trigger as { remoteMessage?: { data?: Record<string, unknown> } } | null)?.remoteMessage?.data) || {};
  let body: Record<string, unknown> = {};
  const raw = (c.body ?? remote.body) as unknown;
  if (typeof raw === 'string') { try { body = JSON.parse(raw); } catch { /* bukan JSON */ } }
  return { ...remote, ...body, ...c };
}

/** Tujuan saat notifikasi undangan/pengingat diketuk. */
export function routeFor(d: Record<string, unknown>): string | null {
  const type = String(d.type || '');
  if (type !== 'invite' && type !== 'reminder') return null;
  const slug = typeof d.slug === 'string' ? d.slug : '';
  const room = typeof d.room === 'string' ? d.room : '';
  const startsAt = Number(d.startsAt) || 0;
  // Pengingat saat ruang sudah dibuka (30 menit sebelum mulai) → langsung ke halaman gabung
  if (type === 'reminder' && room && /^[a-z0-9-]{3,40}$/.test(room) && Date.now() / 1000 >= startsAt - 1800) return `/join?code=${encodeURIComponent(room)}`;
  return slug && /^[\w-]{3,80}$/.test(slug) ? `/event/${slug}` : null;
}
