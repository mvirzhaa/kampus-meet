// Tombol kontrol & dialog: audio, kamera, berbagi layar, rekam, pengaturan, status koneksi, keluar.
import { Track, RoomEvent, createLocalAudioTrack, createLocalVideoTrack, VideoPresets, ScreenSharePresets, ConnectionQuality } from 'livekit-client';
import { h, icon, toast, modal, confirmDialog, copyText } from '../shared/common.js';
import { store, on, emit, isMod, canPresent, meetApi, allParticipants, nameOf } from './store.js';
import { canPublish, schedule, setPresVisible, isPresVisible, setSpeaker } from './media.js';
import { setHand, react, REACTIONS, startPollModal, openPanel } from './panels.js';
import { managePresentations, setBlank } from './presentation.js';
import { BrightnessProcessor, backgroundProcessor, makeBackgrounds } from './processors.js';
import { startRecording, stopRecording, isRecording } from './recorder.js';

const $ = (s) => document.querySelector(s);
const lp = () => store.room.localParticipant;
const micPub = () => lp().getTrackPublication(Track.Source.Microphone);
const camPub = () => lp().getTrackPublication(Track.Source.Camera);
const setIcon = (btn, name) => { const svg = btn.querySelector('svg'); svg.replaceWith(icon(name, 22)); };

const QUALITY = {
  low: { label: 'Rendah (180p, hemat data)', preset: VideoPresets.h180 },
  medium: { label: 'Sedang (360p)', preset: VideoPresets.h360 },
  high: { label: 'Tinggi (720p)', preset: VideoPresets.h720 },
};
const prefs = (() => { try { return JSON.parse(localStorage.getItem('km:prefs') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('km:prefs', JSON.stringify(prefs)); } catch { /* abaikan */ } };
prefs.quality ??= 'medium'; prefs.bg ??= 'none'; prefs.brightness ??= 0;

// ==================== Audio ====================
function levelMeter(track, barEl) {
  let ctx, raf;
  try {
    ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); barEl.style.width = Math.min(100, m * 1.6) + '%'; raf = requestAnimationFrame(tick); };
    tick();
  } catch { /* abaikan */ }
  return () => { cancelAnimationFrame(raf); if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {}); };
}

async function deviceOptions(kind, selected) {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === kind);
  return devs.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === selected, text: d.label || `${kind === 'audioinput' ? 'Mikrofon' : kind === 'videoinput' ? 'Kamera' : 'Speaker'} ${i + 1}` }));
}

export function audioModal() {
  const micAllowed = canPublish('microphone');
  const body = h('div', {},
    h('div', { class: 'audio-choice' },
      h('button', { type: 'button', disabled: !micAllowed, onclick: () => { m.close(); micCheckModal(); } }, h('span', {}, icon('mic', 40)), 'Mikrofon'),
      h('button', { type: 'button', onclick: () => { m.close(); joinListenOnly(); } }, h('span', {}, icon('headphones', 40)), 'Hanya mendengar')),
    !micAllowed ? h('p', { style: { textAlign: 'center', color: '#b7791f', fontSize: '13px' }, text: 'Mikrofon peserta sedang dikunci oleh moderator.' }) : null);
  const m = modal({ title: 'Bagaimana Anda ingin bergabung ke audio?', body, cls: 'audio-modal' });
  m.box.querySelector('.modal-title').style.textAlign = 'center';
}

async function joinListenOnly() {
  store.audioMode = 'listen';
  await store.room.startAudio().catch(() => {});
  updateControls(); emit('participants');
  toast('Anda bergabung dalam mode hanya mendengar', 'info', 2500);
}

async function micCheckModal() {
  let track;
  try { track = await createLocalAudioTrack({ deviceId: prefs.mic || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true }); }
  catch (e) { toast('Tidak bisa mengakses mikrofon. Periksa izin browser. ' + (e.message || ''), 'error', 6000); return joinListenOnly(); }
  const bar = h('i'); let stopMeter = levelMeter(track, bar);
  const micSel = h('select', { onchange: async () => { prefs.mic = micSel.value; savePrefs(); await track.restartTrack({ deviceId: micSel.value }); stopMeter(); stopMeter = levelMeter(track, bar); } }, await deviceOptions('audioinput', track.mediaStreamTrack.getSettings().deviceId));
  const spkOpts = await deviceOptions('audiooutput', store.speakerId);
  const spkSel = spkOpts.length ? h('select', { onchange: () => { setSpeaker(spkSel.value); prefs.speaker = spkSel.value; savePrefs(); } }, spkOpts) : null;
  let joined = false;
  modal({
    title: 'Cek mikrofon', onClose: () => { stopMeter(); if (!joined) track.stop(); },
    body: h('div', {},
      h('div', { class: 'field' }, h('label', { text: 'Mikrofon' }), micSel),
      h('div', { class: 'field' }, h('label', { text: 'Level suara — bicaralah, bar harus bergerak' }), h('div', { class: 'meter' }, bar)),
      spkSel ? h('div', { class: 'field' }, h('label', { text: 'Speaker' }), spkSel) : null),
    actions: [{ label: 'Hanya mendengar', onClick: () => joinListenOnly() }, { label: 'Ya, gabung audio', cls: 'btn-primary', onClick: async () => {
      joined = true; stopMeter();
      try {
        await store.room.startAudio().catch(() => {});
        const pub = await lp().publishTrack(track, { source: Track.Source.Microphone, dtx: true, red: true });
        store.audioMode = 'mic';
        if (store.meta.muteOnJoin && !isMod()) { await pub.mute(); toast('Mikrofon Anda dimatikan saat bergabung. Klik ikon mikrofon untuk bicara.', 'info', 5000); }
      } catch (e) { track.stop(); toast('Gagal menyalakan mikrofon: ' + e.message, 'error'); return joinListenOnly(); }
      updateControls(); emit('participants');
    } }],
  });
}

async function leaveAudio() {
  const pub = micPub();
  if (pub?.track) await lp().unpublishTrack(pub.track, true);
  store.audioMode = null;
  updateControls(); emit('participants');
}

async function toggleMic() {
  const pub = micPub();
  if (!pub) return audioModal();
  if (pub.isMuted && !canPublish('microphone')) return toast('Mikrofon dikunci oleh moderator', 'error');
  await lp().setMicrophoneEnabled(pub.isMuted);
  updateControls();
}

// ==================== Kamera ====================
let applyingBg = false;
async function applyProcessors(track) {
  if (applyingBg) return; applyingBg = true;
  try {
    if (prefs.bg !== 'none') {
      const bg = prefs.bg === 'blur' ? null : makeBackgrounds().find(b => b.id === prefs.bg)?.url;
      const proc = await backgroundProcessor(prefs.bg === 'blur' ? 'blur' : 'image', bg);
      if (!proc) { toast('Browser ini belum mendukung latar virtual', 'error'); prefs.bg = 'none'; }
      else { await track.setProcessor(proc); return; }
    }
    if (prefs.brightness) await track.setProcessor(new BrightnessProcessor(prefs.brightness));
    else if (track.getProcessor()) await track.stopProcessor();
  } catch (e) { console.warn(e); toast('Efek kamera gagal diterapkan: ' + e.message, 'error'); try { await track.stopProcessor(); } catch { /* abaikan */ } }
  finally { applyingBg = false; }
}

export async function webcamModal() {
  if (!canPublish('camera')) return toast('Kamera peserta sedang dikunci oleh moderator', 'error');
  const existing = camPub()?.track;
  let track = existing;
  if (!track) {
    try { track = await createLocalVideoTrack({ deviceId: prefs.cam || undefined, resolution: QUALITY[prefs.quality].preset.resolution }); }
    catch (e) { return toast('Tidak bisa mengakses kamera. Periksa izin browser & pastikan kamera tidak dipakai aplikasi lain.', 'error', 6000); }
  }
  const preview = h('video', { autoplay: true, playsinline: true, muted: true });
  track.attach(preview);
  const camSel = h('select', { onchange: async () => { prefs.cam = camSel.value; savePrefs(); await track.restartTrack({ deviceId: camSel.value, resolution: QUALITY[prefs.quality].preset.resolution }); } },
    await deviceOptions('videoinput', track.mediaStreamTrack.getSettings().deviceId));
  const qSel = h('select', { onchange: async () => { prefs.quality = qSel.value; savePrefs(); await track.restartTrack({ deviceId: prefs.cam || undefined, resolution: QUALITY[prefs.quality].preset.resolution }); } },
    Object.entries(QUALITY).map(([k, v]) => h('option', { value: k, selected: prefs.quality === k, text: v.label })));
  const bright = h('input', { type: 'range', min: -100, max: 100, value: prefs.brightness, step: 5 });
  const brightVal = h('span', { text: String(prefs.brightness) });
  let bt; bright.addEventListener('input', () => { brightVal.textContent = bright.value; prefs.brightness = +bright.value; clearTimeout(bt); bt = setTimeout(() => applyProcessors(track), 200); });
  const bgs = makeBackgrounds();
  const bgBox = h('div', { class: 'bg-opts' });
  const drawBgs = () => {
    bright.disabled = prefs.bg !== 'none';
    bgBox.replaceChildren(
      h('button', { type: 'button', class: `bg-opt ${prefs.bg === 'none' ? 'active' : ''}`, title: 'Tanpa latar', onclick: () => pick('none') }, icon('x', 20)),
      h('button', { type: 'button', class: `bg-opt ${prefs.bg === 'blur' ? 'active' : ''}`, title: 'Blur', onclick: () => pick('blur') }, 'Blur'),
      ...bgs.map(b => h('button', { type: 'button', class: `bg-opt ${prefs.bg === b.id ? 'active' : ''}`, title: b.name, style: { backgroundImage: `url(${b.url})` }, onclick: () => pick(b.id) })));
  };
  const pick = async (id) => { prefs.bg = id; savePrefs(); drawBgs(); await applyProcessors(track); };
  drawBgs();
  if (prefs.bg !== 'none' || prefs.brightness) applyProcessors(track);
  let shared = false;
  modal({
    title: 'Pengaturan kamera', wide: true,
    onClose: () => { track.detach(preview); if (!existing && !shared) track.stop(); },
    body: h('div', { class: 'cam-settings' },
      h('div', { class: 'cam-preview' }, preview),
      h('div', {},
        h('div', { class: 'field' }, h('label', { text: 'Kamera' }), camSel),
        h('div', { class: 'field' }, h('label', { text: 'Kualitas' }), qSel),
        h('div', { class: 'field' }, h('label', { text: 'Latar virtual' }), bgBox),
        h('div', { class: 'field' }, h('label', {}, 'Kecerahan ', brightVal), bright,
          h('small', { style: { color: '#718096' }, text: 'Kecerahan tidak tersedia saat latar virtual aktif.' })),
        h('label', { class: 'check', style: { fontSize: '13.5px' } }, h('input', { type: 'checkbox', checked: store.mirror !== false, onchange: (e) => { store.mirror = e.target.checked; schedule(); } }), 'Cerminkan video saya (hanya tampilan saya)'))),
    actions: existing ? [{ label: 'Hentikan kamera', cls: 'btn-danger', onClick: () => stopCamera() }, { label: 'Selesai', cls: 'btn-primary' }]
      : [{ label: 'Batal' }, { label: 'Mulai berbagi', cls: 'btn-primary', onClick: async () => {
        shared = true;
        try {
          await lp().publishTrack(track, { source: Track.Source.Camera, simulcast: true, videoEncoding: QUALITY[prefs.quality].preset.encoding, videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h180] });
        } catch (e) { track.stop(); toast('Gagal membagikan kamera: ' + e.message, 'error'); }
        updateControls(); schedule();
      } }],
  });
}
async function stopCamera() {
  const pub = camPub();
  if (pub?.track) { try { await pub.track.stopProcessor(); } catch { /* abaikan */ } await lp().unpublishTrack(pub.track, true); }
  updateControls(); schedule();
}

// ==================== Layar ====================
async function toggleScreen() {
  const on_ = !!lp().getTrackPublication(Track.Source.ScreenShare);
  if (on_) { await lp().setScreenShareEnabled(false); updateControls(); schedule(); return; }
  if (!canPublish('screen_share')) return toast('Hanya presenter atau moderator yang dapat berbagi layar', 'error');
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('Perangkat ini tidak mendukung berbagi layar', 'error');
  try {
    await lp().setScreenShareEnabled(true, { audio: true, resolution: ScreenSharePresets.h1080fps15.resolution, contentHint: 'detail', selfBrowserSurface: 'exclude' },
      { screenShareEncoding: ScreenSharePresets.h1080fps15.encoding, simulcast: false });
  } catch (e) { if (e.name !== 'NotAllowedError') toast('Gagal berbagi layar: ' + e.message, 'error'); }
  updateControls(); schedule();
}

// ==================== Rekaman ====================
async function toggleRecording() {
  if (!isMod()) return;
  if (store.meta.recMode === 'egress') {
    // Perekaman di server: MP4 720p, diunggah otomatis ke Google Drive kampus setelah selesai
    if (store.meta.recording) {
      if (!(await confirmDialog('Hentikan rekaman?', 'Rekaman akan diproses lalu diunggah otomatis ke Google Drive. Tautannya muncul di Dasbor → Meeting Saya → Rekaman.', 'Hentikan', false))) return;
      try { await meetApi('POST', '/mod/recording', { on: false }); toast('Rekaman dihentikan. File sedang diunggah ke Google Drive.', 'success', 6000); } catch (e) { toast(e.message, 'error'); }
      return;
    }
    if (!(await confirmDialog('Mulai merekam?', 'Meeting direkam di server (video 720p MP4: presentasi, layar, kamera, dan suara semua peserta), lalu diunggah otomatis ke folder Google Drive kampus. Semua peserta melihat tanda rekaman. Perekaman mulai dalam ±10 detik.', 'Mulai rekam', false))) return;
    try { await meetApi('POST', '/mod/recording', { on: true }); toast('Perekaman dimulai di server', 'success'); } catch (e) { toast(e.message, 'error', 7000); }
    return;
  }
  if (isRecording()) {
    await stopRecording();
    meetApi('POST', '/mod/recording', { on: false }).catch(() => {});
    return;
  }
  if (store.meta.recording) {
    if (await confirmDialog('Rekaman sedang berjalan', 'Moderator lain sedang merekam. Tandai rekaman sebagai selesai?', 'Tandai selesai', false)) meetApi('POST', '/mod/recording', { on: false }).catch(() => {});
    return;
  }
  const ok = await confirmDialog('Mulai merekam?', 'Rekaman tab meeting ini (video presentasi + suara semua peserta) akan disimpan sebagai file di komputer Anda saat dihentikan. Pilih tab ini ketika browser meminta izin berbagi layar. Semua peserta akan melihat indikator rekaman.', 'Mulai rekam', false);
  if (!ok) return;
  try {
    await startRecording();
    await meetApi('POST', '/mod/recording', { on: true });
    toast('Perekaman dimulai', 'success');
  } catch (e) { if (e.name !== 'NotAllowedError') toast(e.message, 'error'); }
}
store.onRecordingStopped = () => { meetApi('POST', '/mod/recording', { on: false }).catch(() => {}); updateControls(); };

// ==================== Pengaturan & info ====================
async function settingsModal() {
  const micOpts = await deviceOptions('audioinput', micPub()?.track?.mediaStreamTrack.getSettings().deviceId || prefs.mic);
  const spkOpts = await deviceOptions('audiooutput', store.speakerId);
  const micSel = h('select', {}, micOpts); const spkSel = spkOpts.length ? h('select', {}, spkOpts) : null;
  const saver = h('input', { type: 'checkbox', checked: store.dataSaver });
  const sounds = h('input', { type: 'checkbox', checked: store.sounds });
  modal({ title: 'Pengaturan', body: h('div', {},
    h('div', { class: 'field' }, h('label', { text: 'Mikrofon' }), micSel),
    spkSel ? h('div', { class: 'field' }, h('label', { text: 'Speaker' }), spkSel) : null,
    h('div', { class: 'field' }, h('label', { class: 'check' }, saver, 'Mode hemat data (sembunyikan video peserta lain)'), h('small', { text: 'Sangat menghemat kuota & CPU. Layar yang dibagikan tetap tampil.' })),
    h('div', { class: 'field' }, h('label', { class: 'check' }, sounds, 'Bunyi notifikasi chat')),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => webcamModal() }, icon('video', 16), 'Pengaturan kamera…')),
  actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async () => {
    store.dataSaver = saver.checked; store.sounds = sounds.checked; prefs.dataSaver = store.dataSaver; prefs.sounds = store.sounds;
    if (spkSel) { setSpeaker(spkSel.value); prefs.speaker = spkSel.value; }
    if (micSel.value && micPub()?.track) { prefs.mic = micSel.value; await micPub().track.restartTrack({ deviceId: micSel.value }).catch(() => {}); }
    savePrefs(); schedule();
  } }] });
}

function connModal() {
  const label = { [ConnectionQuality.Excellent]: ['Sangat baik', '#2f855a'], [ConnectionQuality.Good]: ['Cukup', '#b7791f'], [ConnectionQuality.Poor]: ['Buruk', '#c53030'], [ConnectionQuality.Lost]: ['Terputus', '#4a5568'] };
  const rows = (isMod() ? allParticipants() : [lp()]).map(p => {
    const [t, c] = label[p.connectionQuality] || ['Tidak diketahui', '#718096'];
    return h('tr', {}, h('td', { text: p.name + (p === lp() ? ' (Anda)' : '') }), h('td', {}, h('b', { text: t, style: { color: c } })));
  });
  modal({ title: 'Status koneksi', body: h('div', {},
    h('table', { class: 'lock-table' }, h('tbody', {}, rows)),
    h('p', { style: { fontSize: '13px', color: '#718096', marginTop: '12px' }, text: 'Jika koneksi buruk: matikan kamera, aktifkan Mode hemat data di Pengaturan, atau bergabung dengan mode hanya mendengar.' })) });
}

function infoModal() {
  modal({ title: 'Info room', body: h('div', { class: 'links' },
    h('div', { class: 'link-row' }, h('label', { text: 'Nama' }), h('div', { class: 'link-box' }, h('code', { text: store.meta.name }))),
    h('div', { class: 'link-row' }, h('label', { text: 'ID Room' }), h('div', { class: 'link-box' }, h('code', { text: store.code }), h('button', { class: 'icon-btn', onclick: () => copyText(store.code) }, icon('copy', 18)))),
    h('div', { class: 'link-row' }, h('label', { text: 'Link gabung (peserta tetap memerlukan password room)' }), h('div', { class: 'link-box' }, h('code', { text: `${location.origin}/j/${store.code}` }), h('button', { class: 'icon-btn', onclick: () => copyText(`${location.origin}/j/${store.code}`) }, icon('copy', 18)))),
    store.isOwner ? h('p', { style: { fontSize: '13px', color: '#718096' }, text: 'Link moderator & peserta (tanpa password) tersedia di Dasbor → Meeting Saya → Undang.' }) : null) });
}

function shortcutsModal() {
  const rows = [['M', 'Nyalakan/matikan mikrofon'], ['V', 'Nyalakan/matikan kamera'], ['H', 'Angkat/turunkan tangan'], ['C', 'Buka chat publik'], ['← / →', 'Slide sebelumnya/berikutnya (presenter)']];
  modal({ title: 'Pintasan keyboard', body: h('table', { class: 'lock-table' }, h('tbody', {}, rows.map(([k, d]) => h('tr', {}, h('td', {}, h('span', { class: 'kbd', text: k })), h('td', { text: d, style: { textAlign: 'left' } }))))) });
}

export async function leave(endForAll) {
  if (endForAll) {
    if (!(await confirmDialog('Akhiri meeting untuk semua?', 'Semua peserta akan dikeluarkan dan meeting ditutup.', 'Akhiri meeting'))) return;
    if (isRecording()) await stopRecording();
    try { await meetApi('POST', '/mod/end', {}); } catch (e) { toast(e.message, 'error'); }
  } else if (isRecording()) {
    if (!(await confirmDialog('Rekaman masih berjalan', 'Keluar akan menghentikan dan menyimpan rekaman. Lanjutkan?', 'Keluar'))) return;
    await stopRecording();
  }
  store.leaving = true;
  await store.room.disconnect();
}

// ==================== Status tombol ====================
export function updateControls() {
  const mic = micPub(); const cam = camPub(); const scr = lp().getTrackPublication(Track.Source.ScreenShare);
  const bA = $('#btn-audio'); const bM = $('#btn-mic');
  bA.classList.toggle('on', !!store.audioMode);
  bA.title = store.audioMode ? 'Keluar dari audio' : 'Gabung audio';
  bA.setAttribute('aria-label', bA.title);
  bM.hidden = store.audioMode !== 'mic';
  if (mic) { bM.classList.toggle('on', !mic.isMuted); setIcon(bM, mic.isMuted ? 'mic-off' : 'mic'); bM.title = mic.isMuted ? 'Nyalakan mikrofon (M)' : 'Matikan mikrofon (M)'; }
  const bC = $('#btn-cam');
  bC.classList.toggle('on', !!cam); setIcon(bC, cam ? 'video' : 'video-off');
  bC.title = cam ? 'Matikan kamera (V)' : 'Bagikan kamera (V)';
  bC.disabled = !cam && !canPublish('camera');
  const bS = $('#btn-screen');
  bS.classList.toggle('on', !!scr); setIcon(bS, scr ? 'monitor-x' : 'monitor-up');
  bS.hidden = !canPublish('screen_share') && !scr;
  bS.title = scr ? 'Hentikan berbagi layar' : 'Bagikan layar';
  const bH = $('#btn-hand'); bH.classList.toggle('warn', store.hands.has(store.identity)); bH.title = store.hands.has(store.identity) ? 'Turunkan tangan (H)' : 'Angkat tangan (H)';
  const bL = $('#btn-layout'); bL.classList.toggle('on', isPresVisible()); bL.title = isPresVisible() ? 'Sembunyikan presentasi' : 'Tampilkan presentasi';
  const rb = $('#rec-btn'); const recOn = store.meta.recording;
  rb.classList.toggle('on', recOn);
  const serverRec = store.meta.recMode === 'egress';
  $('#rec-label').textContent = (isRecording() || (serverRec && recOn && isMod())) ? 'Hentikan rekam' : recOn ? 'Sedang direkam' : 'Mulai rekam';
  rb.disabled = !isMod();
  rb.hidden = store.meta.recMode === 'off' || (!isMod() && !recOn);
  $('#rec-banner').hidden = !recOn;
  document.getElementById('app').classList.toggle('is-mod', isMod());
  document.getElementById('app').classList.toggle('can-present', canPresent());
}

function updateConn(q) {
  const b = $('#conn-btn');
  b.className = 'conn-btn ' + ({ [ConnectionQuality.Good]: 'good', [ConnectionQuality.Poor]: 'poor', [ConnectionQuality.Lost]: 'lost' }[q] || '');
}

// ==================== Inisialisasi ====================
export function initControls(room) {
  store.dataSaver = !!prefs.dataSaver; store.sounds = prefs.sounds !== false;
  if (prefs.speaker) setSpeaker(prefs.speaker);
  $('#btn-audio').addEventListener('click', () => store.audioMode ? leaveAudio() : audioModal());
  $('#btn-mic').addEventListener('click', toggleMic);
  $('#btn-cam').addEventListener('click', () => camPub() ? stopCamera() : webcamModal());
  $('#btn-screen').addEventListener('click', toggleScreen);
  $('#btn-leave').addEventListener('click', () => leave(false));
  $('#btn-hand').addEventListener('click', () => { setHand(!store.hands.has(store.identity)); updateControls(); });
  $('#btn-layout').addEventListener('click', () => { setPresVisible(!isPresVisible()); updateControls(); });
  $('#react-menu').append(...REACTIONS.map(e => h('button', { type: 'button', onclick: () => { react(e); $('#react-menu').parentElement.classList.remove('open'); } }, e)));
  $('#rec-btn').addEventListener('click', toggleRecording);
  $('#conn-btn').addEventListener('click', connModal);
  $('#toggle-nav').addEventListener('click', () => document.getElementById('app').classList.toggle('nav-hidden'));
  $('#m-full').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}));
  $('#m-settings').addEventListener('click', settingsModal);
  $('#a-settings').addEventListener('click', settingsModal);
  $('#m-info').addEventListener('click', infoModal);
  $('#m-shortcuts').addEventListener('click', shortcutsModal);
  $('#m-leave').addEventListener('click', () => leave(false));
  $('#m-end').addEventListener('click', () => leave(true));
  $('#a-pres').addEventListener('click', managePresentations);
  $('#a-poll').addEventListener('click', startPollModal);
  $('#a-blank').addEventListener('click', setBlank);
  $('#a-take').addEventListener('click', () => meetApi('POST', '/mod/presenter', { identity: store.identity }).then(() => toast('Anda sekarang presenter', 'success')).catch(e => toast(e.message, 'error')));

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.modal-back')) return;
    const k = e.key.toLowerCase();
    if (k === 'm') { store.audioMode === 'mic' ? toggleMic() : audioModal(); }
    else if (k === 'v') { camPub() ? stopCamera() : webcamModal(); }
    else if (k === 'h') { setHand(!store.hands.has(store.identity)); updateControls(); }
    else if (k === 'c') openPanel('chat');
  });

  room.on(RoomEvent.ConnectionQualityChanged, (q, p) => { if (p === room.localParticipant) updateConn(q); })
    .on(RoomEvent.ParticipantPermissionsChanged, async (_prev, p) => {
      if (p !== room.localParticipant) return;
      // Patuhi izin terbaru dari server (lock viewers / presenter)
      if (!canPublish('microphone') && micPub()?.track) { await lp().unpublishTrack(micPub().track, true); store.audioMode = 'listen'; toast('Mikrofon dikunci oleh moderator', 'info'); }
      if (!canPublish('camera') && camPub()?.track) { await lp().unpublishTrack(camPub().track, true); toast('Kamera dikunci oleh moderator', 'info'); }
      if (!canPublish('screen_share') && lp().getTrackPublication(Track.Source.ScreenShare)) await lp().setScreenShareEnabled(false);
      updateControls(); schedule(); emit('participants');
    })
    .on(RoomEvent.MediaDevicesError, (e) => toast('Masalah perangkat media: ' + e.message, 'error'))
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (!room.canPlaybackAudio && store.audioMode) toast('Klik di mana saja untuk mengaktifkan suara', 'info');
    });
  document.addEventListener('click', () => { if (!room.canPlaybackAudio && store.audioMode) room.startAudio().catch(() => {}); });
  on('participants', updateControls); on('local-tracks', updateControls); on('meta', updateControls); on('hands', updateControls); on('layout', updateControls);
  updateControls();
}
