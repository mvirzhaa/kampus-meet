// Transkripsi otomatis (Bahasa Indonesia / English) dengan nama pembicara.
//
// Cara kerja (ringan untuk server):
// - Setiap pembicara mengenali ucapannya SENDIRI di browsernya (Web Speech API). Karena hanya mikrofon
//   miliknya yang didengar, nama pembicara selalu tepat — tidak perlu pemisahan suara (diarization).
// - Teks sementara dikirim ke peserta lain lewat data channel (untuk teks langsung/CC).
// - Teks final dikirim ke server (hanya teks, beberapa byte per kalimat) untuk disimpan sebagai notulen.
// - Server tidak memproses audio sama sekali.
import { Track } from 'livekit-client';
import { h, icon, toast, confirmDialog } from '../shared/common.js';
import { store, on, emit, isMod, nameOf, meetApi } from './store.js';
import { send, str } from './bus.js';

const $ = (s) => document.querySelector(s);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANGS = { 'id-ID': 'ID', 'en-US': 'EN' };
const prefs = (() => { try { return JSON.parse(localStorage.getItem('km:tr') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('km:tr', JSON.stringify(prefs)); } catch { /* abaikan */ } };
let lang = LANGS[prefs.lang] ? prefs.lang : 'id-ID'; // bawaan Bahasa Indonesia
let ccOn = prefs.cc !== false;

const lines = [];            // { id, identity, name, lang, text, ts }
const interim = new Map();   // identity -> { text, ts }
const fmtT = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');

// ==================== Pengenal suara lokal ====================
let rec = null; let running = false; let wanted = false; let restartTimer; let failures = 0; let lastStart = 0;
let mode = '';               // 'lokal' (di perangkat) | 'online'
let segId = 0;

function micLive() {
  const pub = store.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  return !!pub && !pub.isMuted;
}
function shouldRun() { return !!SR && !!store.meta.transcribe && store.audioMode === 'mic' && micLive() && !document.hidden; }

async function tryLocal(r) {
  // Chrome versi baru dapat mengenali suara di perangkat (tanpa mengirim audio ke internet) bila paket bahasa tersedia.
  try {
    if (!('processLocally' in r) || typeof SR.available !== 'function') return false;
    const st = await SR.available({ langs: [lang], processLocally: true });
    if (st === 'available') { r.processLocally = true; return true; }
    if (st === 'downloadable' && typeof SR.install === 'function') SR.install({ langs: [lang], processLocally: true }).catch(() => {});
  } catch { /* tidak didukung */ }
  return false;
}

async function start() {
  if (running || !shouldRun()) return;
  running = true;
  const r = new SR();
  r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  mode = (await tryLocal(r)) ? 'lokal' : 'online';
  rec = r;
  let lastInterimSent = 0;
  r.onresult = (e) => {
    let partial = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]; const text = res[0].transcript.trim();
      if (!text) continue;
      if (res.isFinal) finalText(text); else partial += (partial ? ' ' : '') + text;
    }
    failures = 0;
    if (partial) {
      setInterim(store.identity, partial);
      const t = performance.now();
      if (t - lastInterimSent > 400) { lastInterimSent = t; send({ t: 'cap', text: partial.slice(-300), lang }); }
    }
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wanted = false; toast('Transkripsi tidak diizinkan browser. Izinkan mikrofon untuk situs ini.', 'error', 6000); }
    else if (e.error === 'network') { failures++; if (failures === 3) toast('Transkripsi gagal terhubung ke layanan pengenal suara browser. Ucapan Anda tidak tercatat.', 'error', 6000); }
    else if (e.error === 'language-not-supported') { wanted = false; toast('Bahasa ini tidak didukung pengenal suara browser Anda.', 'error'); }
    else failures++;
    renderStatus();
  };
  r.onend = () => {
    running = false; rec = null;
    clearInterim(store.identity, true);
    // Chrome menghentikan pengenalan berkala; nyalakan lagi selama masih dibutuhkan
    if (shouldRun() && wanted) {
      const quick = performance.now() - lastStart > 3000;
      restartTimer = setTimeout(start, quick ? 150 : Math.min(10000, 1000 * 2 ** Math.min(failures, 4)));
    }
    renderStatus();
  };
  try { lastStart = performance.now(); r.start(); } catch { running = false; rec = null; }
  renderStatus();
}
function stop() { clearTimeout(restartTimer); if (rec) { try { rec.abort(); } catch { /* abaikan */ } } running = false; rec = null; clearInterim(store.identity, true); renderStatus(); }
function sync() { wanted = shouldRun(); if (wanted) start(); else stop(); }

let pending = Promise.resolve();
function finalText(text) {
  text = text.slice(0, 1000);
  if (lang === 'id-ID' || lang === 'en-US') text = text.charAt(0).toUpperCase() + text.slice(1);
  const id = `${store.identity}:${++segId}`;
  clearInterim(store.identity, true);
  addLine({ id, identity: store.identity, name: store.name, lang, text, ts: Date.now() });
  send({ t: 'cap', text, lang, final: true, id: String(segId) });
  // Simpan berurutan; gagal (mis. transkripsi baru dimatikan) diabaikan
  pending = pending.then(() => meetApi('POST', '/transcript', { text, lang })).catch(() => {});
}

// ==================== Tampilan ====================
function setInterim(identity, text) { interim.set(identity, { text, ts: Date.now() }); renderCaptions(); renderInterimRow(identity); }
function clearInterim(identity, render) { if (interim.delete(identity) && render) { renderCaptions(); renderInterimRow(identity); } }

function lineEl(l) {
  return h('div', { class: 'msg' },
    h('div', { class: 'msg-body' },
      h('div', { class: 'msg-head' }, h('b', { text: l.name }), h('time', { text: fmtT(l.ts) }), h('span', { class: 'tr-lang-tag', text: LANGS[l.lang] || '' })),
      h('div', { class: 'msg-text', text: l.text })));
}
function addLine(l) {
  if (lines.some(x => x.id === l.id)) return;
  lines.push(l); if (lines.length > 2000) lines.shift();
  const log = $('#tr-log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const row = log.querySelector(`[data-interim="${CSS.escape(l.identity)}"]`);
  log.insertBefore(lineEl(l), row || null);
  if (near) log.scrollTop = log.scrollHeight;
  lastFinal.set(l.identity, { text: l.text, ts: Date.now() });
  renderCaptions();
  if (!isPanelOpen()) $('#unread-tr').hidden = false;
}
function renderInterimRow(identity) {
  const log = $('#tr-log');
  let row = log.querySelector(`[data-interim="${CSS.escape(identity)}"]`);
  const it = interim.get(identity);
  if (!it) { row?.remove(); return; }
  if (!row) { row = h('div', { class: 'msg', dataset: { interim: identity } }, h('div', { class: 'msg-body' }, h('div', { class: 'msg-head' }, h('b', { text: nameOf(identity) })), h('div', { class: 'msg-text interim' }))); log.append(row); }
  row.querySelector('.msg-text').textContent = it.text + ' …';
}
const isPanelOpen = () => !$('[data-view="transcript"]').hidden && !document.getElementById('app').classList.contains('panel-hidden');

// Teks langsung (CC): maksimal 2 pembicara terakhir
const lastFinal = new Map();
let capTimer;
function renderCaptions() {
  const box = $('#captions');
  const show = ccOn && store.meta.transcribe;
  if (!show) { box.hidden = true; return; }
  const t = Date.now();
  const items = [];
  for (const [id, v] of interim) if (t - v.ts < 6000) items.push({ id, text: v.text, ts: v.ts, interim: true });
  for (const [id, v] of lastFinal) if (t - v.ts < 5000 && !interim.has(id)) items.push({ id, text: v.text, ts: v.ts });
  items.sort((a, b) => b.ts - a.ts);
  const top = items.slice(0, 2).reverse();
  box.hidden = !top.length;
  box.replaceChildren(...top.map(i => h('div', { class: `cap-line ${i.interim ? 'interim' : ''}` }, h('b', { text: nameOf(i.id) + ':' }), h('span', { text: i.text.length > 180 ? '…' + i.text.slice(-180) : i.text }))));
  clearTimeout(capTimer);
  if (top.length) capTimer = setTimeout(renderCaptions, 1500);
}

function renderStatus() {
  const el = $('#tr-status'); const on_ = !!store.meta.transcribe;
  $('#tr-toggle').textContent = on_ ? 'Hentikan transkripsi' : 'Mulai transkripsi';
  $('#tr-toggle').className = `btn btn-sm mod-only ${on_ ? 'btn-ghost' : 'btn-primary'}`;
  $('#cap-badge').hidden = !on_;
  let text, cls = '';
  if (!on_) text = isMod() ? 'Transkripsi belum aktif. Klik "Mulai transkripsi" agar ucapan semua pembicara tercatat otomatis.' : 'Transkripsi belum diaktifkan moderator.';
  else if (!SR) { text = 'Browser Anda tidak mendukung pengenalan suara, jadi ucapan Anda tidak tercatat. Gunakan Chrome atau Edge di laptop/PC. Ucapan pembicara lain tetap tampil di sini.'; cls = 'warn'; }
  else if (store.audioMode !== 'mic') text = 'Ucapan Anda akan dicatat bila Anda bergabung dengan mikrofon.';
  else if (!micLive()) text = 'Mikrofon Anda mati — ucapan tidak dicatat.';
  else if (running) { text = `Mencatat ucapan Anda (${lang === 'id-ID' ? 'Bahasa Indonesia' : 'English'}, ${mode === 'lokal' ? 'diproses di perangkat' : 'diproses layanan pengenal suara browser'}).`; cls = 'on'; }
  else text = 'Menyiapkan pengenal suara…';
  el.textContent = text; el.className = 'tr-status ' + cls;
  const b = $('#btn-cc');
  b.classList.toggle('on', ccOn && on_);
  b.querySelector('svg').replaceWith(icon(ccOn ? 'captions' : 'captions-off', 22));
  b.title = ccOn ? 'Sembunyikan teks langsung (CC)' : 'Tampilkan teks langsung (CC)';
  b.hidden = !on_;
}

function transcriptText() {
  const head = `Transkrip otomatis — ${store.meta.name}\nRoom: ${store.code}\nDiunduh: ${new Date().toLocaleString('id-ID')}\n\n`;
  return head + lines.map(l => `[${fmtT(l.ts)}] ${l.name}: ${l.text}`).join('\n');
}

// ==================== Pesan dari peserta lain ====================
on('msg:cap', (m, from) => {
  if (!store.meta.transcribe) return;
  const text = str(m.text, 1000).trim(); if (!text) return;
  const l = LANGS[m.lang] ? m.lang : 'id-ID';
  if (m.final) { clearInterim(from, false); addLine({ id: `${from}:${str(m.id, 12)}`, identity: from, name: nameOf(from), lang: l, text, ts: Date.now() }); renderInterimRow(from); }
  else setInterim(from, text.slice(-300));
});

async function loadHistory() {
  try {
    const { lines: rows } = await meetApi('GET', '/transcript');
    if (!rows.length) return;
    const log = $('#tr-log');
    const known = new Set(lines.map(l => `${l.identity}|${l.text}`));
    const older = rows.filter(r => !known.has(`${r.identity}|${r.text}`)).map(r => ({ id: 'db' + r.id, identity: r.identity, name: r.name, lang: r.lang, text: r.text, ts: r.ts * 1000 }));
    lines.unshift(...older);
    log.replaceChildren(...lines.map(lineEl));
    log.scrollTop = log.scrollHeight;
  } catch { /* abaikan */ }
}

// ==================== Inisialisasi ====================
export function initTranscript() {
  const sel = $('#tr-lang'); sel.value = lang;
  sel.addEventListener('change', () => { lang = sel.value; prefs.lang = lang; savePrefs(); stop(); sync(); });
  $('#tr-toggle').addEventListener('click', async () => {
    const turnOn = !store.meta.transcribe;
    if (turnOn && !(await confirmDialog('Mulai transkripsi otomatis?',
      'Ucapan setiap peserta yang menyalakan mikrofon akan diubah menjadi teks beserta namanya, tampil sebagai teks langsung, dan disimpan sebagai notulen room ini. Semua peserta melihat tanda "Transkripsi aktif". Di Chrome, audio dapat diproses oleh layanan pengenal suara Google bila pengenalan di perangkat belum tersedia.', 'Mulai transkripsi', false))) return;
    try { await meetApi('POST', '/mod/transcribe', { on: turnOn }); toast(turnOn ? 'Transkripsi dimulai' : 'Transkripsi dihentikan', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  });
  $('#tr-dl').addEventListener('click', () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain;charset=utf-8' })), download: `transkrip-${store.code}-${new Date().toISOString().slice(0, 10)}.txt` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#btn-cc').addEventListener('click', () => { ccOn = !ccOn; prefs.cc = ccOn; savePrefs(); renderCaptions(); renderStatus(); });
  document.addEventListener('visibilitychange', sync);

  let was = false;
  on('meta', () => {
    const now_ = !!store.meta.transcribe;
    if (now_ && !was) { emit('sys-chat', 'Transkripsi otomatis dimulai'); loadHistory(); }
    if (!now_ && was) emit('sys-chat', 'Transkripsi otomatis dihentikan');
    was = now_;
    sync(); renderStatus(); renderCaptions();
  });
  on('local-tracks', () => { sync(); renderStatus(); });
  on('participants', () => { sync(); renderStatus(); });
  was = !!store.meta.transcribe;
  if (was) loadHistory();
  sync(); renderStatus();
}
