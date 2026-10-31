// Notifikasi azan salat lima waktu untuk wilayah Jakarta (WIB).
// Jadwal dihitung di browser (pustaka adhan, MIT) dengan parameter Kemenag RI: sudut Subuh 20°, Isya 18°,
// Asar mazhab Syafi'i, ditambah ihtiyat 2 menit. Tidak membutuhkan layanan luar.
// Saat masuk waktu: muncul pemberitahuan + diputar suara takbir pembuka azan ("Allahu akbar, Allahu akbar")
// dari rekaman yang diunggah admin (/api/azan-audio); bila belum ada, dibunyikan lonceng lembut.
import { Coordinates, CalculationMethod, PrayerTimes, Madhab } from 'adhan';
import { h, icon, modal, toast } from './common.js';

export const AZAN_PLACE = { name: 'Jakarta', lat: -6.2088, lng: 106.8456, tz: 'Asia/Jakarta' };
export const PRAYERS = [['fajr', 'Subuh'], ['dhuhr', 'Zuhur'], ['asr', 'Asar'], ['maghrib', 'Magrib'], ['isha', 'Isya']];
const KEY = 'km:azan';
const prefs = () => { try { return { on: true, sound: true, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; } catch { return { on: true, sound: true }; } };
const savePrefs = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* abaikan */ } };
const fmt = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: AZAN_PLACE.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace('.', ':');

/** Waktu salat untuk tanggal (kalender Jakarta) yang memuat `day`. */
export function prayerTimes(day = new Date()) {
  const params = CalculationMethod.Singapore(); // Subuh 20°, Isya 18° (sama dengan Kemenag RI)
  params.madhab = Madhab.Shafi;
  params.methodAdjustments = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  params.adjustments = { fajr: 2, sunrise: 0, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 }; // ihtiyat
  // Tanggal menurut WIB (bukan zona waktu perangkat)
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: AZAN_PLACE.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day).split('-').map(Number);
  const t = new PrayerTimes(new Coordinates(AZAN_PLACE.lat, AZAN_PLACE.lng), new Date(y, m - 1, d), params);
  return PRAYERS.map(([k, name]) => ({ key: k, name, at: t[k], time: fmt(t[k]) }));
}
/** Salat berikutnya (hari ini atau besok). */
export function nextPrayer(now = new Date()) {
  const today = prayerTimes(now).find(p => p.at > now);
  return today || prayerTimes(new Date(now.getTime() + 86400000))[0];
}

// ---------- Suara ----------
let audioEl = null; let audioOk = null;
async function azanAudio() {
  if (audioOk === false) return null;
  if (!audioEl) {
    audioEl = new Audio(`/api/azan-audio?t=${Date.now()}`); audioEl.preload = 'auto';
    audioOk = await new Promise((res) => { audioEl.addEventListener('canplaythrough', () => res(true), { once: true }); audioEl.addEventListener('error', () => res(false), { once: true }); setTimeout(() => res(false), 8000); });
    if (!audioOk) return null;
  }
  return audioEl;
}
/** Lonceng lembut (cadangan bila rekaman azan belum diunggah admin). */
function chime() {
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
  const ctx = new Ctx(); const t0 = ctx.currentTime;
  [[523.25, 0], [659.25, 0.35], [783.99, 0.7], [1046.5, 1.05]].forEach(([f, dt]) => {
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.6);
    o.connect(g).connect(ctx.destination); o.start(t0 + dt); o.stop(t0 + dt + 1.7);
  });
  setTimeout(() => ctx.close(), 3500);
}
export async function playAzan() {
  const a = await azanAudio();
  if (!a) { chime(); return true; }
  try { a.currentTime = 0; a.volume = 0.9; await a.play(); return true; }
  catch { return false; } // diblokir kebijakan autoplay browser (belum ada interaksi di halaman)
}
/** Lupakan rekaman yang sudah dimuat (dipakai setelah admin mengganti/menghapus rekaman). */
export function resetAzanAudio() { try { audioEl?.pause(); } catch { /* abaikan */ } audioEl = null; audioOk = null; }
export function stopAzan() { try { audioEl?.pause(); } catch { /* abaikan */ } }

// ---------- Pemberitahuan ----------
let bar = null;
function showBanner(p, played) {
  bar?.remove();
  bar = h('div', { class: 'azan-bar', role: 'alert' },
    h('span', { class: 'azan-ic' }, icon('moon-star', 22)),
    h('div', {}, h('b', { text: `Waktunya salat ${p.name}` }), h('span', { text: ` · ${p.time} WIB · wilayah ${AZAN_PLACE.name}` })),
    !played ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => playAzan() }, icon('volume', 15), 'Putar azan') : h('button', { class: 'btn btn-sm btn-ghost', onclick: stopAzan }, 'Hentikan suara'),
    h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: () => { stopAzan(); bar.remove(); bar = null; } }, icon('x', 18)));
  document.body.append(bar);
  setTimeout(() => { if (bar) { bar.remove(); bar = null; } }, 3 * 60 * 1000);
}
async function fire(p) {
  // Banyak tab terbuka: hanya satu tab yang membunyikan azan untuk waktu salat yang sama
  const id = `${p.key}:${p.at.toISOString().slice(0, 10)}`;
  try { if (localStorage.getItem('km:azan-last') === id) return; localStorage.setItem('km:azan-last', id); } catch { /* abaikan */ }
  const pr = prefs();
  const played = pr.sound ? await playAzan() : true;
  showBanner(p, played);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`Waktunya salat ${p.name}`, { body: `${p.time} WIB · wilayah ${AZAN_PLACE.name}`, icon: '/img/uika-meet-mark-128.png', tag: id }); } catch { /* abaikan */ }
  }
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  if (!prefs().on) return;
  const p = nextPrayer();
  const ms = Math.max(1000, p.at.getTime() - Date.now());
  // Dicek ulang tiap 30 menit (perangkat bisa tidur/berganti jam)
  timer = setTimeout(() => { if (Math.abs(Date.now() - p.at.getTime()) < 5 * 60 * 1000) fire(p); schedule(); }, Math.min(ms, 30 * 60 * 1000));
}

/** Jendela jadwal salat hari ini + pengaturan notifikasi. */
export function azanModal() {
  const pr = prefs(); const list = prayerTimes(); const nx = nextPrayer();
  const on = h('input', { type: 'checkbox', checked: pr.on }); const snd = h('input', { type: 'checkbox', checked: pr.sound });
  const body = h('div', { class: 'azan-modal' },
    h('p', { class: 'ev-meta', text: `${new Intl.DateTimeFormat('id-ID', { timeZone: AZAN_PLACE.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · wilayah ${AZAN_PLACE.name} (WIB)` }),
    h('div', { class: 'azan-times' }, list.map(p => h('div', { class: 'azan-t' + (p.key === nx.key && p.at.getTime() === nx.at.getTime() ? ' next' : '') }, h('span', { text: p.name }), h('b', { text: p.time })))),
    h('label', { class: 'check' }, on, 'Tampilkan pemberitahuan saat masuk waktu salat'),
    h('label', { class: 'check' }, snd, 'Putar suara takbir pembuka azan ("Allahu akbar, Allahu akbar")'),
    h('small', { class: 'ev-meta', text: 'Jadwal dihitung dengan parameter Kemenag RI (Subuh 20°, Isya 18°, ihtiyat 2 menit); bisa berbeda ±1–2 menit dengan jadwal resmi.' }));
  modal({ title: 'Jadwal salat & notifikasi azan', body, actions: [
    { label: 'Coba suara', onClick: async () => { if (!(await playAzan())) toast('Suara diblokir browser. Klik sekali lagi.', 'info'); return false; } },
    ...('Notification' in window && Notification.permission === 'default' ? [{ label: 'Izinkan notifikasi browser', onClick: async () => { await Notification.requestPermission(); return false; } }] : []),
    { label: 'Simpan', cls: 'btn-primary', onClick: () => { stopAzan(); savePrefs({ on: on.checked, sound: snd.checked }); schedule(); toast(on.checked ? 'Notifikasi azan aktif' : 'Notifikasi azan dimatikan', 'success'); } },
  ] });
}

export function initAzan() {
  if (document.body.classList.contains('rec-mode')) return; // perekam server tidak ikut membunyikan azan
  schedule();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  for (const el of document.querySelectorAll('[data-azan]')) el.addEventListener('click', (e) => { e.preventDefault(); azanModal(); });
}
