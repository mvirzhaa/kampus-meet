// Video/audio: ubin kamera, audio peserta, berbagi layar, manajemen langganan (hemat bandwidth).
import { RoomEvent, Track, ConnectionQuality } from 'livekit-client';
import { h, icon, initials, toast } from '../shared/common.js';
import { store, on, emit, isMod, isPresenter, roleOf, allParticipants, colorFor, participant, meetApi } from './store.js';

const $ = (s) => document.querySelector(s);
const tiles = new Map(); // identity -> { el, video, attached }
let page = 0;
// Tata letak panggung: 'stage' = presentasi + strip peserta, 'gallery' = semua peserta dalam grid,
// 'focus' = presentasi saja (strip peserta disembunyikan). Disimpan per browser.
const LAYOUTS = ['stage', 'gallery', 'focus'];
let layout = (() => { try { const v = localStorage.getItem('km:layout'); return LAYOUTS.includes(v) ? v : 'stage'; } catch { return 'stage'; } })();
let speaking = new Set();
const PROTO_SRC = { camera: 1, microphone: 2, screen_share: 3, screen_share_audio: 4 };

export function canPublish(source) {
  const p = store.room?.localParticipant.permissions;
  if (!p) return true;
  if (!p.canPublish) return false;
  return !p.canPublishSources?.length || p.canPublishSources.includes(PROTO_SRC[source]);
}

export const getLayout = () => layout;
export function setLayout(v) {
  if (!LAYOUTS.includes(v)) return;
  layout = v; page = 0;
  try { localStorage.setItem('km:layout', v); } catch { /* abaikan */ }
  schedule(); emit('layout');
}
export const isPresVisible = () => layout !== 'gallery';
export function setPresVisible(v) { setLayout(v ? 'stage' : 'gallery'); }

function camPub(p) { return p.getTrackPublication(Track.Source.Camera); }
function hasCam(p) {
  const pub = camPub(p);
  return !!pub && !pub.isMuted && (p === store.room.localParticipant ? !!pub.track : true);
}
/** Peserta yang sedang disorot moderator (hanya bila masih ada di room). */
export const spotlighted = () => (store.meta.spotlight && participant(store.meta.spotlight)) || null;
export const setSpotlight = (identity) => meetApi('POST', '/mod/spotlight', { identity: identity || null })
  .then(() => toast(identity ? 'Kamera peserta disorot untuk semua' : 'Sorotan dihentikan', 'success')).catch(e => toast(e.message, 'error'));

function mayView(p) {
  if (p === store.room.localParticipant) return true;
  if (store.meta.spotlight === p.identity) return true; // sorotan selalu tampil, juga saat mode hemat data
  if (store.dataSaver) return false;
  if (!store.meta.locks?.seeCams || isMod()) return true;
  return roleOf(p.identity) === 'moderator' || isPresenter(p.identity);
}
/** Boleh tampil di strip/galeri: saat "lihat peserta lain" dikunci, peserta hanya melihat moderator, presenter, dan dirinya. */
function mayList(p) {
  if (p === store.room.localParticipant || !store.meta.locks?.seeUsers || isMod()) return true;
  return roleOf(p.identity) === 'moderator' || isPresenter(p.identity);
}
export function screenSharer() {
  for (const p of allParticipants()) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub && !pub.isMuted) return { p, pub };
  }
  return null;
}

function makeTile(p) {
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const el = h('div', { class: 'tile', dataset: { id: p.identity } },
    video,
    h('div', { class: 't-av' }, h('span', { style: { background: colorFor(p.identity) }, text: initials(p.name) })),
    h('div', { class: 't-q' }),
    h('div', { class: 't-name' }, h('i', { class: 'mic' }), h('span', { class: 'nm', text: p.name || p.identity })),
    h('button', { class: 't-spot', type: 'button', title: 'Tayangkan kamera ini besar untuk semua peserta', onclick: (e) => { e.stopPropagation(); setSpotlight(p.identity); } }, icon('sparkles', 13), 'Sorot'));
  el.addEventListener('dblclick', () => el.requestFullscreen?.().catch(() => {}));
  return { el, video, attached: null };
}

function updateTile(t, p) {
  const pub = camPub(p);
  const showVideo = hasCam(p) && mayView(p);
  const track = showVideo ? pub?.track : null;
  if (track !== t.attached) {
    if (t.attached) t.attached.detach(t.video);
    if (track) track.attach(t.video);
    t.attached = track;
  }
  t.video.hidden = !track;
  t.el.querySelector('.t-av').hidden = !!track;
  t.video.classList.toggle('mirror', p === store.room.localParticipant && store.mirror !== false);
  t.el.querySelector('.nm').textContent = (p.name || p.identity) + (p === store.room.localParticipant ? ' (Anda)' : '');
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const micOff = !micPub || micPub.isMuted;
  t.el.querySelector('.mic').replaceWith(Object.assign(icon(micOff ? 'mic-off' : 'mic', 13, micOff ? 'mic off' : 'mic'), {}));
  t.el.classList.toggle('talking', speaking.has(p.identity));
  const hand = store.hands.has(p.identity);
  let he = t.el.querySelector('.t-hand');
  if (hand && !he) t.el.append(h('div', { class: 't-hand' }, icon('hand', 15)));
  if (!hand && he) he.remove();
  const q = t.el.querySelector('.t-q');
  q.className = 't-q ' + ({ [ConnectionQuality.Good]: 'good', [ConnectionQuality.Poor]: 'poor', [ConnectionQuality.Lost]: 'poor' }[p.connectionQuality] || '');
}

let raf = 0;
export function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function render() {
  const room = store.room; if (!room) return;
  const sharer = screenSharer();
  const spot = spotlighted();
  // Mode galeri dipilih pengguna sendiri, jadi berlaku juga saat ada yang berbagi layar / disorot
  const gridMode = layout === 'gallery';
  const cams = $('#cams'); const grid = $('#cam-grid'); const main = $('#main-area');

  // Siapa yang tampil di ubin: semua peserta (kamera mati → avatar). Kamera menyala didahulukan.
  // Saat sorotan atau mode "presentasi saja", strip disembunyikan agar panggung bersih & hemat bandwidth.
  const camOn = (p) => hasCam(p) && mayView(p);
  const recMode = document.body.classList.contains('rec-mode');
  let list = (!gridMode && (spot || layout === 'focus')) ? [] : allParticipants().filter(mayList);
  if (recMode) list = list.filter(p => p !== room.localParticipant && camOn(p)); // rekaman: hanya kamera yang menyala
  list.sort((a, b) => (b === room.localParticipant) - (a === room.localParticipant) || (camOn(b) - camOn(a))
    || (speaking.has(b.identity) - speaking.has(a.identity)) || (a.name || '').localeCompare(b.name || ''));

  // Ukuran halaman ubin
  const areaW = (cams.parentElement.clientWidth || 800) - 100;
  const areaH = Math.max(200, (main.parentElement.clientHeight || 600) - 130);
  let perPage, tileW;
  if (gridMode) {
    perPage = innerWidth < 600 ? 4 : innerWidth < 1000 ? 6 : innerWidth < 1400 ? 12 : 16;
    const n = Math.min(perPage, Math.max(1, list.length));
    const cols = Math.ceil(Math.sqrt(n * (areaW / areaH) / (16 / 9)));
    const rows = Math.ceil(n / cols);
    tileW = Math.floor(Math.min((areaW - (cols - 1) * 8) / cols, ((areaH - (rows - 1) * 8) / rows) * 16 / 9));
    grid.style.setProperty('--tw', Math.max(140, tileW) + 'px');
  } else {
    const tw = innerWidth < 860 ? 130 : innerWidth < 1100 ? 170 : 210;
    perPage = Math.max(1, Math.floor(areaW / (tw + 8)));
  }
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  page = Math.min(page, pages - 1);
  const visible = list.slice(page * perPage, page * perPage + perPage);
  const visibleIds = new Set(visible.map(p => p.identity));

  cams.hidden = !visible.length;
  cams.classList.toggle('grid', gridMode);
  main.hidden = gridMode;
  $('#cam-prev').hidden = page === 0;
  $('#cam-next').hidden = page >= pages - 1;
  // Penanda halaman strip (mis. 2/5) agar jelas masih ada peserta lain
  const pg = $('#cam-pages');
  if (pg) { pg.hidden = pages <= 1; pg.textContent = `${page + 1}/${pages}`; pg.title = `${list.length} peserta`; }

  // Hapus ubin yang tidak terlihat & berhenti berlangganan videonya (hemat bandwidth)
  for (const [id, t] of tiles) {
    if (!visibleIds.has(id)) { if (t.attached) t.attached.detach(t.video); t.el.remove(); tiles.delete(id); }
  }
  for (const p of allParticipants()) {
    if (p === room.localParticipant) continue;
    const pub = camPub(p);
    if (pub) { const want = (visibleIds.has(p.identity) || p === spot) && !pub.isMuted && mayView(p); if (pub.isSubscribed !== want) pub.setSubscribed(want); }
  }
  const frag = [];
  for (const p of visible) {
    let t = tiles.get(p.identity);
    if (!t) { t = makeTile(p); tiles.set(p.identity, t); }
    updateTile(t, p);
    frag.push(t.el);
  }
  // Susun ulang hanya bila urutan berubah
  if (frag.some((el, i) => grid.children[i] !== el) || grid.children.length !== frag.length) grid.replaceChildren(...frag);

  renderScreen(gridMode ? null : sharer);
  renderSpot(gridMode ? null : spot);
  if (spot) $('#screen-view').hidden = true;
  $('#pres-view').hidden = !!spot || !!sharer || gridMode;
  notifyHidden(gridMode && (sharer || spot));
}
// Di mode galeri, beri tahu sekali bila ada yang mulai berbagi layar / disorot
let hiddenNote = null;
function notifyHidden(what) {
  const key = what ? (what.p ? 'scr:' + what.p.identity : 'spot:' + what.identity) : null;
  if (key && key !== hiddenNote && !document.body.classList.contains('rec-mode')) {
    toast(what.p ? `${what.p.name} sedang berbagi layar. Pilih tata letak "Presentasi" untuk melihatnya.` : `${what.name} sedang disorot. Pilih tata letak "Presentasi" untuk melihatnya.`, 'info', 6000);
  }
  hiddenNote = key;
}

// ---------- Sorotan (spotlight) ----------
let spotEl = null; let spotTrack = null; let spotId = null;
function renderSpot(p) {
  const view = $('#spot-view');
  view.hidden = !p;
  const pub = p ? camPub(p) : null;
  const track = p && hasCam(p) ? pub?.track || null : null;
  if (track !== spotTrack) {
    if (spotTrack && spotEl) spotTrack.detach(spotEl);
    spotEl?.remove(); spotEl = null;
    if (track) { spotEl = h('video', { autoplay: true, playsinline: true, muted: true }); track.attach(spotEl); view.prepend(spotEl); }
    spotTrack = track;
  }
  if (!p) { if (document.fullscreenElement === view) document.exitFullscreen?.().catch(() => {}); return; }
  spotEl?.classList.toggle('mirror', p === store.room.localParticipant && store.mirror !== false);
  const me = p === store.room.localParticipant;
  $('#spot-name').textContent = `${p.name || p.identity}${me ? ' (Anda)' : ''}`;
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const micOff = !micPub || micPub.isMuted;
  $('#spot-mic').replaceChildren(icon(micOff ? 'mic-off' : 'mic', 16, micOff ? 'off' : ''));
  const av = $('#spot-av');
  av.hidden = !!track;
  if (!track && av.dataset.id !== p.identity + ':' + p.name) {
    av.dataset.id = p.identity + ':' + p.name;
    av.replaceChildren(h('span', { class: 'av', style: { background: colorFor(p.identity) }, text: initials(p.name) }),
      h('div', { text: me ? 'Kamera Anda mati: nyalakan kamera agar tampil di sorotan.' : 'Kamera sedang dimatikan' }));
  }
  view.classList.toggle('talking', speaking.has(p.identity));
}
function spotChanged() {
  const id = store.meta.spotlight || null;
  if (id === spotId) return;
  spotId = id;
  if (!id || document.body.classList.contains('rec-mode')) return;
  const p = participant(id);
  if (!p) return;
  if (p === store.room.localParticipant) {
    toast(hasCam(p) ? 'Moderator menyorot kamera Anda: tampil besar untuk semua peserta. Pilih kualitas kamera "Tinggi (720p)" agar lebih tajam.'
      : 'Moderator menyorot Anda. Nyalakan kamera agar tampil besar untuk semua peserta.', 'info', 7000);
  } else toast(`${p.name} sedang disorot. Klik tombol layar penuh untuk menonton lebih besar.`, 'info', 5000);
}

let screenEl = null; let screenTrack = null;
function renderScreen(sharer) {
  const view = $('#screen-view');
  view.hidden = !sharer;
  for (const p of allParticipants()) {
    if (p === store.room.localParticipant) continue;
    for (const src of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) {
      const pub = p.getTrackPublication(src);
      if (pub && !pub.isSubscribed) pub.setSubscribed(true);
    }
  }
  const track = sharer?.pub.track || null;
  if (track !== screenTrack) {
    if (screenTrack && screenEl) screenTrack.detach(screenEl);
    screenEl?.remove(); screenEl = null;
    if (track) { screenEl = h('video', { autoplay: true, playsinline: true, muted: true }); track.attach(screenEl); view.prepend(screenEl); }
    screenTrack = track;
  }
  if (sharer) $('#screen-label').textContent = sharer.p === store.room.localParticipant ? 'Anda sedang berbagi layar' : `Layar ${sharer.p.name}`;
}

// ---------- Audio ----------
const audioEls = new Map();
function attachAudio(track, pub, p) {
  if (track.kind !== Track.Kind.Audio || p === store.room.localParticipant) return;
  const el = track.attach();
  el.dataset.id = pub.trackSid;
  if (store.speakerId && el.setSinkId) el.setSinkId(store.speakerId).catch(() => {});
  document.getElementById('audio-sink').append(el);
  audioEls.set(pub.trackSid, el);
  emit('audio-track', track);
}
function detachAudio(track, pub) {
  const el = audioEls.get(pub.trackSid);
  if (el) { track.detach(el); el.remove(); audioEls.delete(pub.trackSid); }
}
export function setSpeaker(id) {
  store.speakerId = id;
  for (const el of audioEls.values()) el.setSinkId?.(id).catch(() => {});
}
export const remoteAudioTracks = () => allParticipants().flatMap(p => p === store.room.localParticipant ? [] :
  [Track.Source.Microphone, Track.Source.ScreenShareAudio].map(s => p.getTrackPublication(s)?.track).filter(Boolean));

function subscribeDefaults(pub) {
  if (pub.kind === Track.Kind.Audio) pub.setSubscribed(true);
  else if (pub.source === Track.Source.ScreenShare) pub.setSubscribed(true);
}

export function initMedia(room) {
  room.on(RoomEvent.TrackPublished, (pub) => { subscribeDefaults(pub); schedule(); emit('participants'); })
    .on(RoomEvent.TrackUnpublished, () => { schedule(); emit('participants'); })
    .on(RoomEvent.TrackSubscribed, (track, pub, p) => { attachAudio(track, pub, p); schedule(); })
    .on(RoomEvent.TrackUnsubscribed, (track, pub) => { detachAudio(track, pub); schedule(); })
    .on(RoomEvent.TrackMuted, () => { schedule(); emit('participants'); })
    .on(RoomEvent.TrackUnmuted, () => { schedule(); emit('participants'); })
    .on(RoomEvent.LocalTrackPublished, () => { schedule(); emit('participants'); emit('local-tracks'); })
    .on(RoomEvent.LocalTrackUnpublished, () => { schedule(); emit('participants'); emit('local-tracks'); })
    .on(RoomEvent.ParticipantConnected, () => { schedule(); emit('participants'); })
    .on(RoomEvent.ParticipantDisconnected, (p) => { store.hands.delete(p.identity); schedule(); emit('participants'); })
    .on(RoomEvent.ParticipantNameChanged, () => { schedule(); emit('participants'); })
    .on(RoomEvent.ParticipantAttributesChanged, () => { schedule(); emit('participants'); })
    .on(RoomEvent.ConnectionQualityChanged, () => schedule())
    .on(RoomEvent.ActiveSpeakersChanged, (sp) => {
      speaking = new Set(sp.map(p => p.identity));
      for (const [id, t] of tiles) t.el.classList.toggle('talking', speaking.has(id));
      $('#spot-view').classList.toggle('talking', !!store.meta.spotlight && speaking.has(store.meta.spotlight));
      emit('speaking', speaking);
    });
  for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) subscribeDefaults(pub);
  $('#cam-prev').addEventListener('click', () => { page--; schedule(); });
  $('#cam-next').addEventListener('click', () => { page++; schedule(); });
  $('#screen-full').addEventListener('click', () => $('#screen-view').requestFullscreen?.().catch(() => {}));
  const sv = $('#spot-view');
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : sv.requestFullscreen?.())?.catch?.(() => {});
  $('#spot-full').addEventListener('click', toggleFull);
  sv.addEventListener('dblclick', toggleFull);
  $('#spot-stop').addEventListener('click', () => setSpotlight(null));
  on('meta', spotChanged);
  addEventListener('resize', schedule);
  // Lebar panggung berubah saat menu/panel kiri dibuka-tutup → hitung ulang jumlah ubin per halaman
  new ResizeObserver(() => schedule()).observe($('#stage'));
  on('meta', schedule); on('hands', schedule);
  schedule();
}

export const isSpeaking = (id) => speaking.has(id);
