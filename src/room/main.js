// Titik masuk ruang meeting.
import { Room, RoomEvent, DisconnectReason, VideoPresets } from 'livekit-client';
import { hydrateIcons, h } from '../shared/common.js';
import { store, emit } from './store.js';
import { initBus } from './bus.js';
import { initMedia } from './media.js';
import { initPanels, requestSync, sysChat } from './panels.js';
import { initPresentation } from './presentation.js';
import { initControls, audioModal } from './controls.js';
import { initTranscript } from './transcript.js';

const $ = (s) => document.querySelector(s);
hydrateIcons();
const code = location.pathname.split('/')[2];
const KEY = `km:join:${code}`;
// Mode perekam: halaman ini dibuka oleh LiveKit Egress (headless Chrome) dengan ?seat=…&url=…&token=…
const REC = location.pathname.startsWith('/rec/');
if (REC) document.body.classList.add('rec-mode');

function overlay(title, text, buttons = []) {
  const ov = $('#overlay'); ov.hidden = false;
  ov.replaceChildren(h('div', { class: 'ov-box' },
    title ? h('h2', { text: title }) : h('div', { class: 'spinner' }),
    h('p', { text }),
    buttons.length ? h('div', { class: 'btns' }, buttons.map(b => h('a', { class: `btn ${b.cls || 'btn-ghost'}`, href: b.href, onclick: b.onClick }, b.label))) : null));
}
const hideOverlay = () => { $('#overlay').hidden = true; };

let join;
if (REC) {
  const sp = new URLSearchParams(location.search);
  join = { seat: sp.get('seat'), url: sp.get('url'), token: sp.get('token'), role: 'recorder', name: 'Perekam', at: Date.now() };
} else {
  try { join = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { join = null; }
  if (!join?.seat) { location.replace(`/j/${code}`); throw new Error('belum join'); }
}

/** Minta token LiveKit baru dari server memakai kursi (seat). Token berumur pendek & izinnya dihitung ulang server. */
async function freshToken() {
  const res = await fetch(`/api/meet/${code}/token`, { method: 'POST', headers: { 'X-Seat': join.seat } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Gagal'); e.status = res.status; throw e; }
  return data;
}

Object.assign(store, { code, seat: join.seat, identity: join.identity, role: join.role, name: join.name, isOwner: !!join.room?.isOwner, segmenterModelUrl: join.segmenterModelUrl });
document.title = `${join.room?.name || 'Meeting'} — Meeting`;

function applyMeta(raw) {
  let m = {}; try { m = JSON.parse(raw || '{}'); } catch { /* abaikan */ }
  store.meta = { ...store.meta, ...m, locks: { ...(m.locks || {}) } };
  $('#room-name').textContent = store.meta.name || join.room?.name || 'Meeting';
  emit('meta');
}

const room = new Room({
  adaptiveStream: true,         // resolusi video menyesuaikan ukuran elemen yang tampil
  dynacast: true,               // lapisan simulcast yang tidak ditonton tidak dikirim
  disconnectOnPageLeave: true,
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  publishDefaults: { simulcast: true, dtx: true, red: true, videoCodec: 'vp8', backupCodec: false },
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
});
store.room = room;

room.on(RoomEvent.RoomMetadataChanged, applyMeta)
  .on(RoomEvent.ParticipantConnected, (p) => { emit('participant-joined', p.identity); if (room.numParticipants < 40) sysChat(`${p.name} bergabung`); })
  .on(RoomEvent.ParticipantDisconnected, (p) => { if (room.numParticipants < 40) sysChat(`${p.name} keluar`); })
  .on(RoomEvent.ParticipantAttributesChanged, (changed, p) => {
    if (p === room.localParticipant && changed.role) {
      store.role = changed.role;
      sysChat(changed.role === 'moderator' ? 'Anda sekarang moderator' : 'Anda sekarang peserta');
      emit('meta');
    }
  })
  .on(RoomEvent.Reconnecting, () => overlay(null, 'Koneksi terputus, mencoba menyambung kembali…'))
  .on(RoomEvent.Reconnected, hideOverlay)
  .on(RoomEvent.Disconnected, (reason) => {
    if (REC) { console.log('END_RECORDING'); return; }
    const back = { label: 'Masuk kembali', cls: 'btn-primary', href: `/j/${code}` };
    const home = { label: 'Ke beranda', href: '/' };
    if (reason === DisconnectReason.PARTICIPANT_REMOVED) { sessionStorage.removeItem(KEY); overlay('Anda dikeluarkan', 'Moderator telah mengeluarkan Anda dari meeting ini.', [home]); }
    else if (reason === DisconnectReason.ROOM_DELETED) { sessionStorage.removeItem(KEY); overlay('Meeting telah berakhir', 'Moderator mengakhiri meeting ini. Terima kasih telah bergabung!', [home]); }
    else if (reason === DisconnectReason.DUPLICATE_IDENTITY) overlay('Terhubung di tempat lain', 'Sesi ini dibuka di tab/perangkat lain.', [back, home]);
    else if (store.leaving) { sessionStorage.removeItem(KEY); overlay('Anda telah keluar dari meeting', 'Sampai jumpa di pertemuan berikutnya.', [back, home]); }
    else autoRejoin();
  });

addEventListener('pagehide', () => {
  if (REC) return;
  try { navigator.sendBeacon(`/api/meet/${code}/leave`, new Blob([JSON.stringify({ seat: store.seat })], { type: 'application/json' })); } catch { /* abaikan */ }
});

// Timer durasi meeting
setInterval(() => {
  const s = store.meta.startedAt ? Math.max(0, Math.floor(Date.now() / 1000 - store.meta.startedAt)) : 0;
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  $('#elapsed').textContent = (hh ? hh + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}, 1000);

// Koneksi putus total (bukan dikeluarkan): coba sambung ulang dengan token baru
async function autoRejoin() {
  const back = { label: 'Masuk kembali', cls: 'btn-primary', href: `/j/${code}` };
  for (let i = 0; i < 6; i++) {
    overlay(null, 'Koneksi terputus, mencoba menyambung kembali…');
    await new Promise(r => setTimeout(r, Math.min(15000, 1500 * 2 ** i)));
    try {
      const t = await freshToken();
      await room.connect(t.url, t.token, { autoSubscribe: false });
      store.audioMode = null;
      applyMeta(room.metadata); hideOverlay(); requestSync(); emit('participants'); emit('local-tracks');
      audioModal();
      return;
    } catch (e) {
      if (e.status === 401 || e.status === 403) { sessionStorage.removeItem(KEY); overlay('Tidak dapat bergabung kembali', e.message, [back, { label: 'Ke beranda', href: '/' }]); return; }
    }
  }
  overlay('Koneksi terputus', 'Tidak dapat terhubung kembali ke server media. Periksa koneksi internet Anda.', [back, { label: 'Ke beranda', href: '/' }]);
}

async function startRecorder() {
  initBus(room);
  await room.connect(join.url, join.token, { autoSubscribe: false });
  store.identity = room.localParticipant.identity;
  applyMeta(room.metadata);
  initMedia(room); initPanels(); initPresentation(); initTranscript();
  hideOverlay();
  // Minta isi whiteboard/catatan terkini lewat server (perekam tersembunyi & tidak bisa mengirim data)
  fetch(`/api/meet/${code}/rec-ready`, { method: 'POST', headers: { 'X-Seat': join.seat, 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: store.identity }) }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500)); // beri waktu presentasi & video tampil
  console.log('START_RECORDING');
}

if (REC) startRecorder().catch(e => { console.error('recorder', e); console.log('END_RECORDING'); });
else try {
  initBus(room);
  // Token dari halaman join hanya dipakai bila masih baru; selain itu minta token baru (mis. setelah muat ulang halaman)
  const conn = join.token && Date.now() - (join.at || 0) < 60000 ? { url: join.url, token: join.token } : await freshToken();
  sessionStorage.setItem(KEY, JSON.stringify({ ...join, token: null }));
  room.prepareConnection(conn.url, conn.token);
  await room.connect(conn.url, conn.token, { autoSubscribe: false });
  applyMeta(room.metadata);
  initMedia(room);
  initPanels();
  initPresentation();
  initControls(room);
  initTranscript();
  hideOverlay();
  requestSync();
  audioModal();
} catch (e) {
  console.error(e);
  const expired = e?.status === 401 || e?.status === 403 || /token|401|unauthorized|expired/i.test(String(e?.message));
  if (expired) sessionStorage.removeItem(KEY);
  overlay('Gagal terhubung', expired ? (e?.status === 403 ? e.message : 'Sesi meeting kedaluwarsa. Silakan masuk kembali.') : 'Tidak dapat terhubung ke server media. Periksa koneksi internet Anda lalu coba lagi.',
    [{ label: 'Coba lagi', cls: 'btn-primary', href: expired ? `/j/${code}` : location.pathname }, { label: 'Ke beranda', href: '/' }]);
}
