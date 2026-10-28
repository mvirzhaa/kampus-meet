// Transkripsi otomatis (Bahasa Indonesia / English) dengan nama pembicara + terjemahan otomatis.
//
// Cara kerja (ringan untuk server):
// - Setiap pembicara mengenali ucapannya SENDIRI di browsernya (Web Speech API). Karena hanya mikrofon
//   miliknya yang didengar, nama pembicara selalu tepat — tidak perlu pemisahan suara (diarization).
// - Teks sementara dikirim ke peserta lain lewat data channel (untuk teks langsung/CC).
// - Teks final dikirim ke server (hanya teks, beberapa byte per kalimat) untuk disimpan sebagai notulen.
// - Terjemahan diatur MASING-MASING peserta (mis. ucapan Indonesia → tampil English, atau sebaliknya) dan
//   dikerjakan di perangkat penonton (Translator API Chrome/Edge). Bila tidak tersedia dan admin mengaktifkan
//   TRANSLATE_URL, server kampus menjadi cadangan (hasil di-cache, 1 kalimat cukup diterjemahkan sekali).
// - Server tidak memproses audio sama sekali.
import { Track } from 'livekit-client';
import { h, icon, toast, confirmDialog } from '../shared/common.js';
import { store, on, emit, isMod, nameOf, meetApi } from './store.js';
import { send, str } from './bus.js';

const $ = (s) => document.querySelector(s);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANGS = { 'id-ID': 'ID', 'en-US': 'EN' };
const SHORT = { 'id-ID': 'id', 'en-US': 'en' };
const TR_NAMES = { en: 'English', id: 'Bahasa Indonesia' };
const prefs = (() => { try { return JSON.parse(localStorage.getItem('km:tr') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('km:tr', JSON.stringify(prefs)); } catch { /* abaikan */ } };
let lang = LANGS[prefs.lang] ? prefs.lang : 'id-ID'; // bahasa ucapan saya (bawaan Indonesia)
let ccOn = prefs.cc !== false;
let trTo = TR_NAMES[prefs.to] ? prefs.to : '';      // terjemahkan ke ('' = tidak)
let ccBoth = !!prefs.ccBoth;

const lines = [];            // { id, identity, name, lang, text, ts, tr?: { to, text }, el? }
const interim = new Map();   // identity -> { text, ts, lang, tr? }
const lastFinal = new Map(); // identity -> line
const fmtT = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');

// ==================== Pengenal suara lokal ====================
let rec = null; let running = false; let wanted = false; let restartTimer; let failures = 0; let lastStart = 0;
let gen = 0;                 // naik setiap start/stop → callback milik pengenal lama diabaikan
let mode = '';               // 'lokal' (di perangkat) | 'online'
let segId = 0;
let quickRestart = false;
const localBad = new Set();  // bahasa yang gagal diproses di perangkat → langsung pakai layanan online

function micLive() {
  const pub = store.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  return !!pub && !pub.isMuted;
}
function shouldRun() { return !!SR && !!store.meta.transcribe && store.audioMode === 'mic' && micLive() && !document.hidden; }

async function tryLocal(r, l) {
  // Chrome versi baru dapat mengenali suara di perangkat (tanpa mengirim audio ke internet) bila paket bahasa tersedia.
  if (localBad.has(l)) return false;
  try {
    if (!('processLocally' in r) || typeof SR.available !== 'function') return false;
    const st = await SR.available({ langs: [l], processLocally: true });
    if (st === 'available') { r.processLocally = true; return true; }
    if (st === 'downloadable' && typeof SR.install === 'function') SR.install({ langs: [l], processLocally: true }).catch(() => {});
  } catch { /* tidak didukung */ }
  return false;
}

async function start() {
  if (running || !shouldRun()) return;
  running = true;
  const my = ++gen;
  const l = lang;
  const r = new SR();
  r.lang = l; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  const local = await tryLocal(r, l);
  if (my !== gen) return;                         // dihentikan / bahasa diganti selama menunggu
  if (!shouldRun()) { running = false; renderStatus(); return; }
  mode = local ? 'lokal' : 'online';
  rec = r;
  let lastInterimSent = 0;
  r.onresult = (e) => {
    if (rec !== r) return;
    let partial = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]; const text = res[0].transcript.trim();
      if (!text) continue;
      if (res.isFinal) finalText(text, l); else partial += (partial ? ' ' : '') + text;
    }
    failures = 0;
    if (partial) {
      setInterim(store.identity, partial, l);
      const t = performance.now();
      if (t - lastInterimSent > 400) { lastInterimSent = t; send({ t: 'cap', text: partial.slice(-300), lang: l }); }
    }
  };
  r.onerror = (e) => {
    if (rec !== r) return;
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (r.processLocally && (e.error === 'language-not-supported' || e.error === 'service-not-allowed')) {
      // Paket bahasa di perangkat belum siap / tidak cocok → ulangi lewat layanan online, jangan berhenti.
      localBad.add(l); quickRestart = true; return;
    }
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wanted = false; toast('Transkripsi tidak diizinkan browser. Izinkan mikrofon untuk situs ini.', 'error', 6000); }
    else if (e.error === 'network') { failures++; if (failures === 3) toast('Transkripsi gagal terhubung ke layanan pengenal suara browser. Ucapan Anda tidak tercatat.', 'error', 6000); }
    else if (e.error === 'language-not-supported') { wanted = false; toast(`Pengenal suara browser Anda tidak mendukung ${l === 'en-US' ? 'English' : 'Bahasa Indonesia'}. Coba Chrome versi terbaru.`, 'error', 6000); }
    else { failures++; if (failures === 3) toast(`Transkripsi bermasalah (${e.error}). Mencoba lagi…`, 'error'); }
    renderStatus();
  };
  r.onend = () => {
    if (rec !== r) return;                        // pengenal lama (mis. setelah ganti bahasa): abaikan
    running = false; rec = null;
    clearInterim(store.identity, true);
    // Chrome menghentikan pengenalan berkala; nyalakan lagi selama masih dibutuhkan
    if (shouldRun() && wanted) {
      const quick = quickRestart || performance.now() - lastStart > 3000;
      quickRestart = false;
      restartTimer = setTimeout(start, quick ? 150 : Math.min(10000, 1000 * 2 ** Math.min(failures, 4)));
    }
    renderStatus();
  };
  try { lastStart = performance.now(); r.start(); }
  catch {
    // Pengenal sebelumnya belum benar-benar dilepas browser → coba lagi sebentar lagi
    running = false; rec = null; failures++;
    if (failures < 6) restartTimer = setTimeout(start, 600);
  }
  renderStatus();
}
function stop() {
  clearTimeout(restartTimer);
  gen++;
  const r = rec; rec = null; running = false;
  if (r) { try { r.abort(); } catch { /* abaikan */ } }
  clearInterim(store.identity, true); renderStatus();
}
function sync() { wanted = shouldRun(); if (wanted) start(); else stop(); }

let pending = Promise.resolve();
function finalText(text, l) {
  text = text.slice(0, 1000);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  const id = `${store.identity}:${++segId}`;
  clearInterim(store.identity, true);
  addLine({ id, identity: store.identity, name: store.name, lang: l, text, ts: Date.now() });
  send({ t: 'cap', text, lang: l, final: true, id: String(segId) });
  // Simpan berurutan; gagal (mis. transkripsi baru dimatikan) diabaikan
  pending = pending.then(() => meetApi('POST', '/transcript', { text, lang: l })).catch(() => {});
}

// ==================== Terjemahan (diatur tiap peserta) ====================
const hasDeviceTr = 'Translator' in self;
const translators = new Map(); // 'id>en' -> Promise<Translator|null>
const trCache = new Map();
let trQueue = Promise.resolve();
let trState = '';              // '' | 'device' | 'server' | 'need-gesture' | 'downloading' | 'unsupported' | 'error'
let trDownload = 0; let trErr = '';
const needsTr = (srcLang) => !!trTo && (SHORT[srcLang] || 'id') !== trTo;
const setTrState = (s) => { if (trState !== s) { trState = s; renderTrStatus(); } };

function deviceTranslator(from, to, gesture) {
  if (!hasDeviceTr) return Promise.resolve(null);
  const key = from + '>' + to;
  if (translators.has(key)) return translators.get(key);
  const p = (async () => {
    const av = await self.Translator.availability({ sourceLanguage: from, targetLanguage: to });
    if (av === 'unavailable') return null;
    // Paket bahasa perlu diunduh sekali; browser mensyaratkan klik pengguna untuk itu.
    if (av !== 'available' && !gesture && !navigator.userActivation?.isActive) { setTrState('need-gesture'); throw new Error('gesture'); }
    return self.Translator.create({
      sourceLanguage: from, targetLanguage: to,
      monitor(m) { m.addEventListener('downloadprogress', (e) => { trDownload = Math.round((e.loaded || 0) * 100); trState = 'downloading'; renderTrStatus(); }); },
    });
  })();
  translators.set(key, p);
  p.catch(() => translators.delete(key));
  return p;
}

async function translateText(text, srcLang, { interim: isInterim = false } = {}) {
  const from = SHORT[srcLang] || 'id', to = trTo;
  if (!to || from === to) return null;
  const key = `${from}|${to}|${text}`;
  if (trCache.has(key)) return trCache.get(key);
  let out = null; let deviceOk = false;
  try {
    const t = await deviceTranslator(from, to, false);
    if (t) { deviceOk = true; out = await t.translate(text); setTrState('device'); }
  } catch { /* lanjut ke cadangan server */ }
  if (out == null && !isInterim && store.meta.trServer) {
    try { out = (await meetApi('POST', '/translate', { text, from, to })).text; if (trState !== 'device') setTrState('server'); }
    catch (e) { trErr = e.message; setTrState('error'); }
  }
  if (out == null && !deviceOk && !store.meta.trServer && trState !== 'need-gesture' && trState !== 'downloading') setTrState('unsupported');
  if (out != null && !isInterim) { trCache.set(key, out); if (trCache.size > 800) trCache.delete(trCache.keys().next().value); }
  return out;
}

function renderLineTr(l) {
  const body = l.el?.querySelector('.msg-body'); if (!body) return;
  let box = body.querySelector('.msg-tr');
  if (!needsTr(l.lang)) { box?.remove(); return; }
  const t = l.tr?.to === trTo ? l.tr.text : null;
  if (!box) { box = h('div', { class: 'msg-tr' }); body.append(box); }
  box.className = 'msg-tr' + (t ? '' : ' pending');
  const wait = trState === 'unsupported' ? 'terjemahan tidak tersedia di browser ini'
    : trState === 'need-gesture' ? 'klik "Aktifkan terjemahan" di atas' : trState === 'error' ? 'terjemahan gagal' : 'menerjemahkan…';
  box.replaceChildren(h('span', { class: 'tr-lang-tag', text: trTo.toUpperCase() }), t ?? wait);
}
function queueTr(l) {
  renderLineTr(l);
  if (!needsTr(l.lang) || l.tr?.to === trTo) return;
  const want = trTo;
  trQueue = trQueue.then(async () => {
    if (trTo !== want) return;
    const out = await translateText(l.text, l.lang);
    if (out != null && trTo === want) l.tr = { to: want, text: out };
    renderLineTr(l);
    if (lastFinal.get(l.identity) === l) renderCaptions();
  }).catch(() => {});
}
/** Terjemahkan ulang baris terbaru (yang terbaru dulu) setelah pengaturan berubah. */
function refreshTranslations() {
  const recent = new Set(lines.slice(-80));
  for (const l of lines) if (!recent.has(l)) { if (l.tr?.to === trTo) renderLineTr(l); else l.el?.querySelector('.msg-tr')?.remove(); }
  for (const l of [...recent].reverse()) queueTr(l);
  renderCaptions();
}
function prepareTranslation(gesture) {
  if (!trTo) return;
  const from = trTo === 'en' ? 'id' : 'en';
  deviceTranslator(from, trTo, gesture).then((t) => {
    if (t) setTrState('device');
    else if (!store.meta.trServer) setTrState('unsupported');
    for (const l of lines.slice(-80)) if (needsTr(l.lang) && l.tr?.to !== trTo) queueTr(l);
  }).catch(() => {});
}

// Terjemahan teks sementara (CC) hanya di perangkat, dibatasi agar ringan
const itBusy = new Set();
function translateInterim(identity) {
  if (!trTo || !ccOn || !hasDeviceTr || trState === 'unsupported' || itBusy.has(identity)) return;
  const it = interim.get(identity); if (!it || !needsTr(it.lang)) return;
  itBusy.add(identity);
  const text = it.text; const want = trTo;
  translateText(text.slice(-300), it.lang, { interim: true }).then((out) => {
    const cur = interim.get(identity);
    if (out != null && cur && want === trTo) { cur.tr = { to: want, text: out }; renderCaptions(); }
  }).catch(() => {}).finally(() => {
    itBusy.delete(identity);
    const cur = interim.get(identity);
    if (cur && cur.text !== text) setTimeout(() => translateInterim(identity), 350);
  });
}

function renderTrStatus() {
  const el = $('#tr-tstatus'); if (!el) return;
  $('#tr-both-wrap').hidden = !trTo;
  el.hidden = !trTo;
  if (!trTo) return;
  const from = trTo === 'en' ? 'Bahasa Indonesia' : 'English';
  let cls = ''; let content;
  if (trState === 'need-gesture') {
    content = [`Paket terjemahan ${from} → ${TR_NAMES[trTo]} perlu diunduh sekali di perangkat ini. `,
      h('button', { type: 'button', onclick: () => prepareTranslation(true), text: 'Aktifkan terjemahan' })]; cls = 'warn';
  } else if (trState === 'downloading') content = [`Mengunduh paket terjemahan… ${trDownload}%`];
  else if (trState === 'unsupported') { content = ['Browser ini belum mendukung terjemahan otomatis. Gunakan Chrome/Edge versi terbaru di laptop/PC.']; cls = 'warn'; }
  else if (trState === 'error') { content = [`Terjemahan gagal: ${trErr}`]; cls = 'warn'; }
  else {
    const how = trState === 'device' ? ' Diproses di perangkat Anda.' : trState === 'server' ? ' Diproses server kampus.' : '';
    content = [`Ucapan dalam ${from} diterjemahkan ke ${TR_NAMES[trTo]}.${how}`]; cls = trState ? 'on' : '';
  }
  el.replaceChildren(...content); el.className = 'tr-status ' + cls;
  for (const l of lines.slice(-80)) if (l.el && needsTr(l.lang) && l.tr?.to !== trTo) renderLineTr(l);
}

// ==================== Tampilan ====================
function setInterim(identity, text, l) {
  const prev = interim.get(identity);
  interim.set(identity, { text, ts: Date.now(), lang: l, tr: prev?.lang === l ? prev.tr : undefined });
  renderCaptions(); renderInterimRow(identity);
  translateInterim(identity);
}
function clearInterim(identity, render) { if (interim.delete(identity) && render) { renderCaptions(); renderInterimRow(identity); } }

function lineEl(l) {
  l.el = h('div', { class: 'msg' },
    h('div', { class: 'msg-body' },
      h('div', { class: 'msg-head' }, h('b', { text: l.name }), h('time', { text: fmtT(l.ts) }), h('span', { class: 'tr-lang-tag', text: LANGS[l.lang] || '' })),
      h('div', { class: 'msg-text', text: l.text })));
  renderLineTr(l);
  return l.el;
}
function addLine(l) {
  if (lines.some(x => x.id === l.id)) return;
  lines.push(l); if (lines.length > 2000) lines.shift();
  const log = $('#tr-log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const row = log.querySelector(`[data-interim="${CSS.escape(l.identity)}"]`);
  log.insertBefore(lineEl(l), row || null);
  if (near) log.scrollTop = log.scrollHeight;
  l.shownAt = Date.now();
  lastFinal.set(l.identity, l);
  queueTr(l);
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

// Teks langsung (CC): maksimal 2 pembicara terakhir; menampilkan terjemahan sesuai pilihan penonton
let capTimer;
function renderCaptions() {
  const box = $('#captions');
  const show = ccOn && store.meta.transcribe;
  if (!show) { box.hidden = true; return; }
  const t = Date.now();
  const items = [];
  for (const [id, v] of interim) if (t - v.ts < 6000) items.push({ id, text: v.text, lang: v.lang, tr: v.tr, ts: v.ts, interim: true });
  for (const [id, l] of lastFinal) if (t - (l.shownAt || l.ts) < 5000 && !interim.has(id)) items.push({ id, text: l.text, lang: l.lang, tr: l.tr, ts: l.shownAt || l.ts });
  items.sort((a, b) => b.ts - a.ts);
  const top = items.slice(0, 2).reverse();
  box.hidden = !top.length;
  const cut = (s) => s.length > 180 ? '…' + s.slice(-180) : s;
  box.replaceChildren(...top.map((i) => {
    const tr = needsTr(i.lang) && i.tr?.to === trTo ? i.tr.text : null;
    return h('div', { class: `cap-line ${i.interim ? 'interim' : ''}` }, h('b', { text: nameOf(i.id) + ':' }), h('span', { text: cut(tr ?? i.text) }),
      tr && ccBoth ? h('small', { text: cut(i.text) }) : null);
  }));
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
  else if (running && rec) { text = `Mencatat ucapan Anda (${lang === 'id-ID' ? 'Bahasa Indonesia' : 'English'}, ${mode === 'lokal' ? 'diproses di perangkat' : 'diproses layanan pengenal suara browser'}).`; cls = 'on'; }
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
  return head + lines.map(l => `[${fmtT(l.ts)}] ${l.name} (${LANGS[l.lang] || 'ID'}): ${l.text}` +
    (l.tr?.to === trTo && needsTr(l.lang) ? `\n           [${trTo.toUpperCase()}] ${l.tr.text}` : '')).join('\n');
}

// ==================== Pesan dari peserta lain ====================
on('msg:cap', (m, from) => {
  if (!store.meta.transcribe) return;
  const text = str(m.text, 1000).trim(); if (!text) return;
  const l = LANGS[m.lang] ? m.lang : 'id-ID';
  if (m.final) { clearInterim(from, false); addLine({ id: `${from}:${str(m.id, 12)}`, identity: from, name: nameOf(from), lang: l, text, ts: Date.now() }); renderInterimRow(from); }
  else setInterim(from, text.slice(-300), l);
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
    refreshTranslations();
  } catch { /* abaikan */ }
}

// ==================== Inisialisasi ====================
export function initTranscript() {
  const sel = $('#tr-lang'); sel.value = lang;
  sel.addEventListener('change', () => {
    lang = sel.value; prefs.lang = lang; savePrefs();
    // Lepas pengenal lama dulu; Chrome butuh jeda singkat sebelum sesi pengenalan baru dimulai
    stop(); failures = 0; setTimeout(sync, 350);
  });
  const toSel = $('#tr-to'); toSel.value = trTo;
  toSel.addEventListener('change', () => {
    trTo = toSel.value; prefs.to = trTo; savePrefs();
    trState = ''; trErr = '';
    prepareTranslation(true);      // dipanggil langsung dari klik: boleh mengunduh paket bahasa
    renderTrStatus(); refreshTranslations();
  });
  const both = $('#tr-both'); both.checked = ccBoth;
  both.addEventListener('change', () => { ccBoth = both.checked; prefs.ccBoth = ccBoth; savePrefs(); renderCaptions(); });
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
  if (trTo) prepareTranslation(false);
  sync(); renderStatus(); renderTrStatus();
}
