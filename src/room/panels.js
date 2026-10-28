// Panel kiri & samping: daftar pengguna, chat publik/privat, catatan bersama, polling, angkat tangan, reaksi.
import { Track } from 'livekit-client';
import { h, icon, initials, toast, modal, confirmDialog, copyText } from '../shared/common.js';
import { store, on, emit, isMod, isPresenter, canPresent, roleOf, nameOf, participant, allParticipants, colorFor, meetApi } from './store.js';
import { send, sendLarge, leaderIdentity, str } from './bus.js';
import { isSpeaking, setSpotlight } from './media.js';

const $ = (s) => document.querySelector(s);
const app = () => $('#app');
const rid = () => Math.random().toString(36).slice(2, 10);
const fmtT = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

// ==================== Navigasi panel ====================
let current = 'chat';
let pchatWith = null;
export function openPanel(view, arg) {
  current = view;
  if (view === 'pchat') { pchatWith = arg; renderPchat(); }
  for (const v of document.querySelectorAll('.p-view')) v.hidden = v.dataset.view !== view;
  for (const b of document.querySelectorAll('.r-nav-item')) b.classList.toggle('active', b.dataset.open === view && (view !== 'pchat' || b.dataset.with === pchatWith));
  app().classList.remove('panel-hidden');
  if (innerWidth <= 860) app().classList.remove('nav-hidden');
  if (view === 'chat') { unread.chat = 0; badge(); setTimeout(() => scrollEnd($('#chat-log'), true), 0); }
  if (view === 'notes') $('#unread-notes').hidden = true;
  if (view === 'poll') $('#unread-poll').hidden = true;
  if (view === 'transcript') { $('#unread-tr').hidden = true; setTimeout(() => { const l = $('#tr-log'); l.scrollTop = l.scrollHeight; }, 0); }
}
function closePanel() { app().classList.add('panel-hidden'); current = null; for (const b of document.querySelectorAll('.r-nav-item')) b.classList.remove('active'); }
const panelOpen = (v) => current === v && !app().classList.contains('panel-hidden') && !app().classList.contains('nav-hidden');

// ==================== Daftar pengguna ====================
let usersRaf = 0;
const reacts = new Map(); // identity -> emoji (sementara)
function scheduleUsers() { if (!usersRaf) usersRaf = requestAnimationFrame(() => { usersRaf = 0; renderUsers(); }); }

function avatar(id, name, { size } = {}) {
  const p = participant(id);
  const el = h('span', { class: `u-av ${roleOf(id) === 'moderator' ? 'mod' : ''} ${isSpeaking(id) ? 'talking' : ''}`, style: { background: colorFor(id) }, text: initials(name) });
  if (size) Object.assign(el.style, { width: size + 'px', height: size + 'px' });
  if (p && isPresenter(id)) el.append(h('span', { class: 'pres-badge', title: 'Presenter' }, icon('presentation', 10)));
  if (p) {
    const mic = p.getTrackPublication(Track.Source.Microphone);
    const listen = p === store.room.localParticipant ? store.audioMode === 'listen' : false;
    if (mic) el.append(h('span', { class: `mic-badge ${mic.isMuted ? 'off' : ''}` }, icon(mic.isMuted ? 'mic-off' : 'mic', 9)));
    else if (listen) el.append(h('span', { class: 'mic-badge listen' }, icon('headphones', 9)));
  }
  return el;
}

function renderUsers() {
  const all = allParticipants();
  const me = store.identity;
  const hideViewers = store.meta.locks?.seeUsers && !isMod();
  let list = all.filter(p => !hideViewers || p.identity === me || roleOf(p.identity) === 'moderator' || isPresenter(p.identity));
  list.sort((a, b) => (b.identity === me) - (a.identity === me)
    || (store.hands.has(b.identity) - store.hands.has(a.identity)) || (store.hands.get(a.identity) || 0) - (store.hands.get(b.identity) || 0)
    || ((roleOf(b.identity) === 'moderator') - (roleOf(a.identity) === 'moderator')) || (a.name || '').localeCompare(b.name || ''));
  $('#user-count').textContent = all.length;
  const rows = list.slice(0, 500).map(p => {
    const id = p.identity;
    const cam = p.getTrackPublication(Track.Source.Camera);
    const sub = [roleOf(id) === 'moderator' ? 'Moderator' : p.attributes?.uid ? 'Peserta' : 'Tamu (tanpa akun)'];
    if (id === me) sub.unshift('Anda');
    return h('button', { class: 'u-row', role: 'listitem', dataset: { id }, onclick: (e) => userMenu(id, e) },
      avatar(id, p.name),
      h('span', { class: 'u-info' }, h('span', { class: 'u-name', text: p.name || id }), h('span', { class: 'u-sub', text: sub.join(' · ') })),
      h('span', { class: 'u-icons' },
        reacts.has(id) ? h('span', { class: 'u-react', text: reacts.get(id) }) : null,
        store.hands.has(id) ? icon('hand', 16, 'hand') : null,
        cam && !cam.isMuted ? icon('video', 15) : null));
  });
  if (list.length > 500) rows.push(h('div', { class: 'sys-msg small', text: `+${list.length - 500} peserta lainnya` }));
  $('#user-list').replaceChildren(...rows);
}

function ctxMenu(e, title, items) {
  document.querySelector('.ctx-menu')?.remove();
  const m = h('div', { class: 'ctx-menu', role: 'menu' }, title ? h('div', { class: 'ctx-head', text: title }) : null,
    items.filter(Boolean).map(it => h('button', { class: it.danger ? 'danger' : '', onclick: () => { m.remove(); it.fn(); } }, icon(it.icon, 16), it.label)));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}

const modCall = (path, body, okMsg) => meetApi('POST', '/mod/' + path, body).then(() => okMsg && toast(okMsg, 'success')).catch(e => toast(e.message, 'error'));

function userMenu(id, e) {
  const me = id === store.identity;
  const mod = isMod();
  const p = participant(id); if (!p) return;
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const targetMod = roleOf(id) === 'moderator';
  const items = [
    !me && (!store.meta.locks?.privateChat || mod || targetMod) ? { icon: 'message-circle', label: 'Mulai chat privat', fn: () => openPrivate(id) } : null,
    store.hands.has(id) && (me || mod) ? { icon: 'hand', label: 'Turunkan tangan', fn: () => me ? setHand(false) : send({ t: 'hand-lower', id }) } : null,
    mod && !isPresenter(id) ? { icon: 'presentation', label: me ? 'Jadikan saya presenter' : 'Jadikan presenter', fn: () => modCall('presenter', { identity: id }, 'Presenter diubah') } : null,
    mod ? (store.meta.spotlight === id ? { icon: 'x', label: 'Hentikan sorotan', fn: () => setSpotlight(null) }
      : { icon: 'sparkles', label: me ? 'Sorot kamera saya (tampil besar)' : 'Sorot kamera (tampil besar untuk semua)', fn: () => setSpotlight(id) }) : null,
    mod && !me && mic && !mic.isMuted ? { icon: 'mic-off', label: 'Matikan mikrofon', fn: () => modCall('mute', { identity: id }) } : null,
    mod && !me ? (targetMod ? { icon: 'user', label: 'Jadikan peserta', fn: () => modCall('role', { identity: id, role: 'viewer' }, 'Peran diubah') }
      : { icon: 'crown', label: 'Jadikan moderator', fn: () => modCall('role', { identity: id, role: 'moderator' }, 'Peran diubah') }) : null,
    mod && !me ? { icon: 'user-x', label: 'Keluarkan', danger: true, fn: async () => { if (await confirmDialog('Keluarkan peserta?', `${p.name} akan dikeluarkan dari room (masih dapat masuk kembali).`, 'Keluarkan')) modCall('kick', { identity: id }, 'Peserta dikeluarkan'); } } : null,
    mod && !me ? { icon: 'ban', label: 'Keluarkan & blokir', danger: true, fn: async () => { if (await confirmDialog('Keluarkan & blokir?', `${p.name} tidak dapat masuk kembali ke room ini selama 24 jam.`, 'Blokir')) modCall('kick', { identity: id, ban: true }, 'Peserta diblokir'); } } : null,
  ].filter(Boolean);
  ctxMenu(e, p.name, items.length ? items : [{ icon: 'info', label: me ? 'Ini Anda' : 'Tidak ada aksi', fn: () => {} }]);
}

function usersGear(e) {
  ctxMenu(e, 'Kelola pengguna', [
    { icon: 'mic-off', label: 'Matikan mikrofon semua', fn: () => modCall('mute', { all: true }, 'Semua mikrofon dimatikan') },
    { icon: 'mic-off', label: 'Matikan semua kecuali presenter', fn: () => modCall('mute', { all: true, exceptPresenter: true }, 'Mikrofon dimatikan') },
    { icon: 'lock', label: 'Kunci peserta (lock viewers)', fn: lockViewersModal },
    ...(store.meta.spotlight ? [{ icon: 'x', label: 'Hentikan sorotan kamera', fn: () => setSpotlight(null) }] : []),
    { icon: 'hand', label: 'Turunkan semua tangan', fn: () => { send({ t: 'hand-lower', all: true }); store.hands.clear(); emit('hands'); } },
    { icon: 'download', label: 'Simpan daftar nama', fn: saveUserList },
  ]);
}

function saveUserList() {
  const lines = allParticipants().map(p => `${p.name}\t${roleOf(p.identity) === 'moderator' ? 'Moderator' : 'Peserta'}`);
  download(`daftar-peserta-${store.code}-${new Date().toISOString().slice(0, 10)}.txt`, `Daftar peserta — ${store.meta.name}\n${new Date().toLocaleString('id-ID')}\n\n${lines.join('\n')}\n\nTotal: ${lines.length}`);
}
export function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const LOCKS = [
  ['webcam', 'Berbagi kamera'], ['seeCams', 'Melihat kamera peserta lain'], ['mic', 'Berbagi mikrofon'],
  ['publicChat', 'Mengirim chat publik'], ['privateChat', 'Mengirim chat privat'], ['notes', 'Mengedit catatan bersama'],
  ['seeUsers', 'Melihat peserta lain di daftar pengguna'],
];
export function lockViewersModal() {
  const state = { ...store.meta.locks };
  const multi = { v: !!store.meta.multiWb };
  const row = (k, label) => {
    const lbl = h('span', { class: 'lbl', text: state[k] ? 'Dikunci' : '' });
    const inp = h('input', { type: 'checkbox', checked: !!state[k], onchange: () => { state[k] = inp.checked; lbl.textContent = inp.checked ? 'Dikunci' : ''; } });
    return h('tr', {}, h('td', { text: label }), h('td', {}, lbl, h('label', { class: 'switch' }, inp, h('i'))));
  };
  const mInp = h('input', { type: 'checkbox', checked: multi.v, onchange: () => { multi.v = mInp.checked; } });
  modal({
    title: 'Kunci peserta', wide: false,
    body: h('div', {}, h('p', { text: 'Opsi ini membatasi peserta (bukan moderator) dalam menggunakan fitur tertentu.', style: { color: '#4a5568', textAlign: 'center' } }),
      h('table', { class: 'lock-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Fitur' }), h('th', { text: 'Status', style: { textAlign: 'right' } }))),
        h('tbody', {}, LOCKS.map(([k, l]) => row(k, l)))),
      h('hr', { style: { border: 0, borderTop: '1px solid #e2e8f0', margin: '12px 0' } }),
      h('table', { class: 'lock-table' }, h('tbody', {}, h('tr', {}, h('td', { text: 'Whiteboard bersama (semua peserta boleh mencoret)' }), h('td', {}, h('label', { class: 'switch plain' }, mInp, h('i'))))))),
    actions: [{ label: 'Batal' }, { label: 'Terapkan', cls: 'btn-primary', onClick: () => modCall('locks', { locks: state, multiWb: multi.v }, 'Pengaturan kunci diterapkan') }],
  });
}

// ==================== Angkat tangan & reaksi ====================
export function setHand(up) {
  if (up) store.hands.set(store.identity, Date.now()); else store.hands.delete(store.identity);
  send({ t: 'hand', up: !!up });
  emit('hands');
}
on('msg:hand', (m, from) => {
  const was = store.hands.has(from);
  if (m.up) { store.hands.set(from, Date.now()); if (!was && isMod()) toast(`✋ ${nameOf(from)} mengangkat tangan`, 'info'); }
  else store.hands.delete(from);
  emit('hands');
});
on('msg:hand-lower', (m, from, role) => {
  if (role !== 'moderator') return;
  if (m.all) store.hands.clear(); else if (typeof m.id === 'string') { store.hands.delete(m.id); }
  if (m.all || m.id === store.identity) toast('Moderator menurunkan tangan Anda', 'info');
  emit('hands');
});
export const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉'];
export function react(e) { send({ t: 'react', e }); showReact(store.identity, e); }
on('msg:react', (m, from) => { if (REACTIONS.includes(m.e)) showReact(from, m.e); });
function showReact(id, e) {
  reacts.set(id, e); scheduleUsers();
  setTimeout(() => { if (reacts.get(id) === e) { reacts.delete(id); scheduleUsers(); } }, 4000);
  const layer = $('#reactions-layer');
  if (layer.childElementCount > 25) return;
  const el = h('div', { class: 'float-react', style: { left: (10 + Math.random() * 80) + '%' } }, e, h('small', { text: nameOf(id) }));
  layer.append(el); setTimeout(() => el.remove(), 3000);
}
// Kirim status tangan ke peserta yang baru bergabung
on('participant-joined', (id) => { if (store.hands.has(store.identity)) send({ t: 'hand', up: true }, id); });

// ==================== Chat ====================
const chat = []; // {id, from, name, text, ts}
const pchats = new Map(); // identity -> [{from, text, ts}]
const unread = { chat: 0 };
const pUnread = new Map();
function badge() {
  const b = $('#unread-chat'); b.textContent = unread.chat > 99 ? '99+' : unread.chat; b.hidden = !unread.chat;
  renderPchatNav();
}
const scrollEnd = (el, force) => { if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight; };

function linkify(text) {
  const out = []; const re = /\bhttps?:\/\/[^\s<>"']+/g; let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0].replace(/[).,;:!?]+$/, '');
    out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', text: url }));
    last = m.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function msgEl(msg, prev) {
  const cont = prev && prev.from === msg.from && msg.ts - prev.ts < 120000;
  return h('div', { class: `msg ${cont ? 'cont' : ''}` }, avatarStatic(msg.from, msg.name),
    h('div', { class: 'msg-body' }, cont ? null : h('div', { class: 'msg-head' }, h('b', { text: msg.name }), h('time', { text: fmtT(msg.ts) })),
      h('div', { class: 'msg-text' }, linkify(msg.text))));
}
function avatarStatic(id, name) { return h('span', { class: `u-av ${roleOf(id) === 'moderator' ? 'mod' : ''}`, style: { background: colorFor(id) }, text: initials(name) }); }

function welcomeEl() {
  return h('div', { class: 'sys-msg' }, h('b', { text: `Selamat datang di ${store.meta.name || 'meeting'}!` }),
    store.meta.welcome ? store.meta.welcome + '\n\n' : '',
    'Untuk bergabung ke audio, klik tombol headphone/mikrofon di bawah. Gunakan headset untuk menghindari gema dan suara bising bagi peserta lain.');
}
function renderChat() {
  const log = $('#chat-log');
  log.replaceChildren(welcomeEl(), ...chat.map((m, i) => m.sys ? h('div', { class: 'sys-msg small', text: m.text }) : msgEl(m, chat[i - 1]?.sys ? null : chat[i - 1])));
  scrollEnd(log, true);
}
function addChat(msg) {
  if (chat.some(m => m.id === msg.id)) return;
  chat.push(msg); if (chat.length > 500) chat.shift();
  const log = $('#chat-log');
  log.append(msg.sys ? h('div', { class: 'sys-msg small', text: msg.text }) : msgEl(msg, chat[chat.length - 2]?.sys ? null : chat[chat.length - 2]));
  scrollEnd(log, msg.from === store.identity);
  if (!panelOpen('chat') && msg.from !== store.identity && !msg.sys) { unread.chat++; badge(); ping(); }
}
export function sysChat(text) { addChat({ id: rid(), sys: true, text, ts: Date.now() }); }

let lastSend = 0;
function chatLocked() { return store.meta.locks?.publicChat && !isMod(); }
function sendChat(text) {
  text = text.trim().slice(0, 1000); if (!text) return;
  if (chatLocked()) return toast('Chat publik dikunci oleh moderator', 'error');
  if (Date.now() - lastSend < 400) return;
  lastSend = Date.now();
  const msg = { t: 'chat', id: rid(), text, ts: Date.now() };
  send(msg);
  addChat({ id: msg.id, from: store.identity, name: store.name, text, ts: msg.ts });
}
on('msg:chat', (m, from, role) => {
  if (store.meta.locks?.publicChat && role !== 'moderator') return; // abaikan pesan dari peserta saat chat dikunci
  const text = str(m.text, 1000).trim(); if (!text) return;
  addChat({ id: str(m.id, 20) || rid(), from, name: nameOf(from), text, ts: Date.now() });
});
on('msg:chat-clear', (m, from, role) => { if (role !== 'moderator') return; chat.length = 0; renderChat(); sysChat(`Chat publik dihapus oleh ${nameOf(from)}`); });

// ----- Chat privat -----
function openPrivate(id) {
  if (!pchats.has(id)) pchats.set(id, []);
  pUnread.delete(id);
  openPanel('pchat', id);
  renderPchatNav();
  setTimeout(() => $('#pchat-input').focus(), 0);
}
function renderPchatNav() {
  $('#pchat-list').replaceChildren(...[...pchats.keys()].map(id => h('button', { class: `r-nav-item ${current === 'pchat' && pchatWith === id ? 'active' : ''}`, dataset: { open: 'pchat', with: id }, onclick: () => openPrivate(id) },
    avatarStatic(id, nameOf(id)), h('span', { text: nameOf(id) }), pUnread.get(id) ? h('b', { class: 'badge', text: pUnread.get(id) }) : null)));
}
function renderPchat() {
  if (!pchatWith) return;
  $('#pchat-title').textContent = nameOf(pchatWith);
  const list = pchats.get(pchatWith) || [];
  $('#pchat-log').replaceChildren(h('div', { class: 'sys-msg small', text: `Percakapan privat dengan ${nameOf(pchatWith)}. Hanya Anda berdua yang dapat melihatnya.` }),
    ...list.map((m, i) => msgEl({ ...m, name: m.from === store.identity ? store.name : nameOf(m.from) }, list[i - 1])));
  scrollEnd($('#pchat-log'), true);
}
on('msg:pchat', (m, from, role) => {
  if (store.meta.locks?.privateChat && role !== 'moderator' && !isMod()) return;
  const text = str(m.text, 1000).trim(); if (!text) return;
  if (!pchats.has(from)) pchats.set(from, []);
  pchats.get(from).push({ from, text, ts: Date.now() });
  if (panelOpen('pchat') && pchatWith === from) renderPchat();
  else { pUnread.set(from, (pUnread.get(from) || 0) + 1); toast(`Pesan privat dari ${nameOf(from)}`, 'info'); ping(); }
  renderPchatNav();
});

// ----- Notifikasi suara ringan (tanpa file audio) -----
let actx;
function ping() {
  if (!store.sounds) return;
  try {
    actx ??= new AudioContext();
    const o = actx.createOscillator(); const g = actx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.05, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.25);
  } catch { /* abaikan */ }
}

// ==================== Catatan bersama ====================
let notes = { text: '', v: 0, by: '' };
let notesTimer;
const notesLocked = () => store.meta.locks?.notes && !isMod();
function applyNotesLock() {
  const ta = $('#notes'); ta.readOnly = notesLocked(); $('#notes-lock').hidden = !notesLocked();
}
function setNotesText(text) {
  const ta = $('#notes');
  if (ta.value === text) return;
  const focused = document.activeElement === ta;
  const s = ta.selectionStart, e = ta.selectionEnd, delta = text.length - ta.value.length;
  const before = ta.value.slice(0, s);
  ta.value = text;
  if (focused) { const shift = text.slice(0, s) === before ? 0 : delta; ta.setSelectionRange(Math.max(0, s + shift), Math.max(0, e + shift)); }
}
on('msg:notes', (m, from, role) => {
  if (store.meta.locks?.notes && role !== 'moderator') return;
  const text = str(m.text, 20000); const v = +m.v || 0;
  if (v < notes.v || (v === notes.v && from < notes.by)) return; // aturan "versi terbaru menang"
  notes = { text, v, by: from };
  setNotesText(text);
  if (!panelOpen('notes')) $('#unread-notes').hidden = false;
});

// ==================== Polling ====================
let poll = null; // { id, q, opts, by, votes: Map(identity->i) (pembuat), myVote, result, ended }
export function startPollModal() {
  const presets = { yn: ['Ya', 'Tidak'], tf: ['Benar', 'Salah'], abcd: ['A', 'B', 'C', 'D'], abc: ['A', 'B', 'C'] };
  let opts = ['', ''];
  const q = h('input', { placeholder: 'Tulis pertanyaan (opsional untuk kuis lisan)', maxlength: 200 });
  const box = h('div', { style: { display: 'grid', gap: '8px' } });
  const draw = () => box.replaceChildren(...opts.map((o, i) => h('div', { style: { display: 'flex', gap: '6px' } },
    h('input', { value: o, maxlength: 60, placeholder: `Opsi ${i + 1}`, oninput: (e) => { opts[i] = e.target.value; } }),
    opts.length > 2 ? h('button', { class: 'icon-btn', type: 'button', onclick: () => { opts.splice(i, 1); draw(); } }, icon('x', 16)) : null)),
  opts.length < 8 ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { opts.push(''); draw(); } }, icon('plus', 15), 'Tambah opsi') : null);
  draw();
  modal({ title: 'Mulai polling', body: h('div', {},
    h('div', { class: 'field' }, h('label', { text: 'Pertanyaan' }), q),
    h('div', { class: 'field' }, h('label', { text: 'Jenis cepat' }), h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      Object.entries({ yn: 'Ya / Tidak', tf: 'Benar / Salah', abc: 'A / B / C', abcd: 'A / B / C / D' }).map(([k, l]) =>
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { opts = [...presets[k]]; draw(); } }, l)))),
    h('div', { class: 'field' }, h('label', { text: 'Opsi jawaban' }), box),
    h('p', { style: { fontSize: '13px', color: '#718096' }, text: 'Jawaban bersifat anonim bagi peserta lain; hanya pembuat polling yang melihat hasil sampai dipublikasikan.' })),
  actions: [{ label: 'Batal' }, { label: 'Mulai', cls: 'btn-primary', onClick: () => {
    const clean = opts.map(o => o.trim()).filter(Boolean).slice(0, 8);
    if (clean.length < 2) { toast('Minimal 2 opsi', 'error'); return false; }
    poll = { id: rid(), q: q.value.trim().slice(0, 200), opts: clean, by: store.identity, votes: new Map(), myVote: null, result: null, ended: false };
    send({ t: 'poll', op: 'start', id: poll.id, q: poll.q, opts: poll.opts });
    $('#poll-nav').hidden = false; renderPoll(); openPanel('poll');
  } }] });
}
function counts() { const c = poll.opts.map(() => 0); for (const i of poll.votes.values()) c[i]++; return c; }
function bars(c) {
  const total = c.reduce((a, b) => a + b, 0);
  return h('div', { style: { display: 'grid', gap: '6px' } }, poll.opts.map((o, i) => {
    const pct = total ? Math.round(c[i] / total * 100) : 0;
    return h('div', { class: 'poll-bar' }, h('i', { style: { width: pct + '%' } }), h('span', {}, h('span', { text: o }), h('span', { text: `${c[i]} (${pct}%)` })));
  }), h('small', { style: { color: '#718096' }, text: `${total} jawaban` }));
}
function renderPoll() {
  const box = $('#poll-box');
  if (!poll) { box.replaceChildren(h('div', { class: 'sys-msg small', text: 'Tidak ada polling aktif.' })); return; }
  const mine = poll.by === store.identity;
  const parts = [h('div', { class: 'poll-q', text: poll.q || 'Polling' }), h('small', { style: { color: '#718096' }, text: `oleh ${nameOf(poll.by)}${poll.ended ? ' · selesai' : ''}` })];
  if (mine) {
    parts.push(bars(counts()));
    if (!poll.ended) parts.push(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn btn-primary btn-sm', onclick: publishPoll }, icon('send', 15), 'Publikasikan hasil'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: endPoll }, 'Akhiri polling')));
  } else if (poll.result) parts.push(bars(poll.result));
  if (!mine && !poll.ended) {
    parts.push(...poll.opts.map((o, i) => h('button', { class: `poll-opt ${poll.myVote === i ? 'chosen' : ''}`, disabled: poll.myVote != null, onclick: () => {
      poll.myVote = i; send({ t: 'poll', op: 'vote', id: poll.id, i }, poll.by); renderPoll(); toast('Jawaban terkirim', 'success', 1500);
    } }, h('b', { text: String.fromCharCode(65 + i) + '.' }), o)));
    if (poll.myVote != null) parts.push(h('small', { style: { color: '#2f855a' }, text: '✓ Jawaban Anda sudah tercatat.' }));
  }
  box.replaceChildren(...parts);
}
function publishPoll() {
  const c = counts();
  poll.result = c;
  send({ t: 'poll', op: 'result', id: poll.id, counts: c });
  const total = c.reduce((a, b) => a + b, 0);
  const text = `Hasil polling${poll.q ? ` "${poll.q}"` : ''}:\n` + poll.opts.map((o, i) => `${o}: ${c[i]} (${total ? Math.round(c[i] / total * 100) : 0}%)`).join('\n');
  sendChat(text);
  endPoll();
}
function endPoll() { if (!poll) return; poll.ended = true; send({ t: 'poll', op: 'end', id: poll.id }); renderPoll(); }
on('msg:poll', (m, from, role) => {
  if (m.op === 'start') {
    if (!(role === 'moderator' || isPresenter(from))) return;
    const opts = Array.isArray(m.opts) ? m.opts.slice(0, 8).map(o => str(o, 60)).filter(Boolean) : [];
    if (opts.length < 2) return;
    poll = { id: str(m.id, 20), q: str(m.q, 200), opts, by: from, votes: new Map(), myVote: null, result: null, ended: false };
    $('#poll-nav').hidden = false; renderPoll(); openPanel('poll'); ping();
  } else if (!poll || m.id !== poll.id) {
    return;
  } else if (m.op === 'vote' && poll.by === store.identity && !poll.ended) {
    const i = +m.i; if (Number.isInteger(i) && i >= 0 && i < poll.opts.length) { poll.votes.set(from, i); renderPoll(); }
  } else if (from === poll.by) {
    if (m.op === 'result' && Array.isArray(m.counts)) poll.result = m.counts.slice(0, poll.opts.length).map(n => Math.max(0, +n || 0));
    if (m.op === 'end' || m.op === 'result') poll.ended = true;
    renderPoll();
    if (!panelOpen('poll')) $('#unread-poll').hidden = false;
  }
});

// ==================== Sinkronisasi peserta baru ====================
export function requestSync() {
  const leader = leaderIdentity();
  if (leader && leader !== store.identity) send({ t: 'sync?' }, leader);
}
function syncPayload() {
  const payload = {
    chat: chat.filter(c => !c.sys).slice(-100).map(c => ({ id: c.id, from: c.from, name: c.name, text: c.text, ts: c.ts })),
    notes,
    poll: poll && !poll.ended ? { id: poll.id, q: poll.q, opts: poll.opts, by: poll.by } : null,
  };
  emit('sync-collect', payload);
  return payload;
}
on('msg:sync?', (m, from) => { if (leaderIdentity() === store.identity) sendLarge(syncPayload(), from); });
// Perekam server (tersembunyi) meminta isi terkini lewat server
on('srv:sync-for', (m) => { if (typeof m.id === 'string' && leaderIdentity() === store.identity) sendLarge(syncPayload(), m.id.slice(0, 80)); });
on('sync', (obj, from) => {
  if (from !== leaderIdentity()) return;
  if (Array.isArray(obj.chat)) {
    for (const c of obj.chat.slice(-100)) {
      if (typeof c?.text !== 'string') continue;
      chat.push({ id: str(c.id, 20), from: str(c.from, 64), name: str(c.name, 60), text: c.text.slice(0, 1000), ts: +c.ts || Date.now() });
    }
    chat.sort((a, b) => a.ts - b.ts); renderChat();
  }
  if (obj.notes && typeof obj.notes.text === 'string' && (+obj.notes.v || 0) >= notes.v) { notes = { text: obj.notes.text.slice(0, 20000), v: +obj.notes.v || 0, by: str(obj.notes.by, 64) }; setNotesText(notes.text); }
  if (obj.poll?.opts && !poll) {
    poll = { id: str(obj.poll.id, 20), q: str(obj.poll.q, 200), opts: obj.poll.opts.slice(0, 8).map(o => str(o, 60)), by: str(obj.poll.by, 64), votes: new Map(), myVote: null, result: null, ended: false };
    $('#poll-nav').hidden = false; renderPoll();
  }
});

// ==================== Inisialisasi ====================
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }
function applyChatLock() {
  const locked = chatLocked();
  $('#chat-input').disabled = locked;
  $('#chat-input').placeholder = locked ? 'Chat publik dikunci oleh moderator' : 'Kirim pesan ke Chat Publik';
  $('#chat-form .send-btn').disabled = locked;
}

export function initPanels() {
  for (const b of document.querySelectorAll('.r-nav-item[data-open]')) b.addEventListener('click', () => panelOpen(b.dataset.open) ? closePanel() : openPanel(b.dataset.open));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closePanel);
  $('#users-gear').addEventListener('click', (e) => { e.stopPropagation(); usersGear(e); });

  const ci = $('#chat-input');
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat(ci.value); ci.value = ''; autoGrow(ci); });
  ci.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); } });
  ci.addEventListener('input', () => autoGrow(ci));
  const pi = $('#pchat-input');
  $('#pchat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = pi.value.trim().slice(0, 1000); if (!text || !pchatWith) return;
    if (store.meta.locks?.privateChat && !isMod() && roleOf(pchatWith) !== 'moderator') return toast('Chat privat dikunci oleh moderator', 'error');
    if (!participant(pchatWith)) return toast('Peserta sudah keluar dari room', 'error');
    send({ t: 'pchat', text }, pchatWith);
    pchats.get(pchatWith).push({ from: store.identity, text, ts: Date.now() });
    pi.value = ''; autoGrow(pi); renderPchat();
  });
  pi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#pchat-form').requestSubmit(); } });
  $('#pchat-close').addEventListener('click', () => { pchats.delete(pchatWith); pchatWith = null; renderPchatNav(); openPanel('chat'); });

  $('#chat-save').addEventListener('click', () => download(`chat-${store.code}.txt`, chatText()));
  $('#chat-copy').addEventListener('click', () => copyText(chatText(), 'Chat tersalin'));
  $('#chat-clear').addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus chat publik?', 'Riwayat chat publik akan dihapus untuk semua peserta.', 'Hapus'))) return;
    send({ t: 'chat-clear' }); chat.length = 0; renderChat();
  });

  const ta = $('#notes');
  ta.addEventListener('input', () => {
    if (notesLocked()) return;
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => { notes = { text: ta.value, v: notes.v + 1, by: store.identity }; send({ t: 'notes', text: notes.text, v: notes.v }); }, 350);
  });
  $('#notes-dl').addEventListener('click', () => download(`catatan-${store.code}.txt`, ta.value));

  on('chat-send', sendChat);
  on('sys-chat', sysChat);
  on('participants', scheduleUsers); on('hands', scheduleUsers); on('speaking', scheduleUsers);
  on('meta', () => { scheduleUsers(); applyChatLock(); applyNotesLock(); });
  renderChat(); renderPoll(); applyChatLock(); applyNotesLock(); scheduleUsers();
  if (innerWidth <= 860) app().classList.add('nav-hidden');
  if (innerWidth <= 520) app().classList.add('panel-hidden');
  // Ponsel: ketuk area panggung untuk menutup panel samping
  $('#stage').addEventListener('pointerdown', (e) => {
    if (innerWidth <= 860 && !e.target.closest('#toggle-nav') && !app().classList.contains('nav-hidden')) app().classList.add('nav-hidden');
  });
}
const chatText = () => `Chat publik — ${store.meta.name}\n\n` + chat.map(m => m.sys ? `-- ${m.text}` : `[${fmtT(m.ts)}] ${m.name}: ${m.text}`).join('\n');
