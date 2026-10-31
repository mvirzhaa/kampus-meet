// Transkripsi otomatis (Bahasa Indonesia / English) dengan nama pembicara + terjemahan otomatis.
//
// Cara kerja (ringan untuk server):
// - Setiap pembicara mengenali ucapannya SENDIRI di browsernya (Web Speech API). Karena hanya mikrofon
//   miliknya yang didengar, nama pembicara selalu tepat — tidak perlu pemisahan suara (diarization).
// - Teks sementara dikirim ke peserta lain lewat data channel (untuk teks langsung/CC).
// - Teks final dikirim ke server (hanya teks, beberapa byte per kalimat) untuk disimpan sebagai notulen.
// - Terjemahan diatur MASING-MASING peserta (mis. ucapan Indonesia → tampil English, atau sebaliknya) dan
//   dikerjakan di perangkat (Translator API Chrome/Edge). Terjemahan satu kalimat dibagikan ke semua orang
//   (termasuk perekam) oleh pembicaranya sendiri atau moderator, lalu disimpan untuk ekspor PDF/Word.
//   Bila admin mengaktifkan TRANSLATE_URL, server kampus menerjemahkan setiap kalimat sekali sebagai cadangan.
// - Server tidak memproses audio sama sekali.
import { Track } from 'livekit-client';
import { h, icon, toast, confirmDialog, getMe, modal } from '../shared/common.js';
import { store, on, emit, isMod, nameOf, meetApi } from './store.js';
import { send, str, leaderIdentity } from './bus.js';
import { transcriptPdf, transcriptDocx, saveBlob } from '../shared/export.js';

const $ = (s) => document.querySelector(s);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANGS = { 'id-ID': 'ID', 'en-US': 'EN' };
const SHORT = { 'id-ID': 'id', 'en-US': 'en' };
const OTHER = { 'id-ID': 'en', 'en-US': 'id' };   // bahasa terjemahan "lawan" dari bahasa ucapan
const TR_NAMES = { en: 'English', id: 'Bahasa Indonesia' };
const isRec = () => document.body.classList.contains('rec-mode');
const prefs = (() => { try { return JSON.parse(localStorage.getItem('km:tr') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('km:tr', JSON.stringify(prefs)); } catch { /* abaikan */ } };
let lang = LANGS[prefs.lang] ? prefs.lang : 'id-ID'; // bahasa ucapan saya (bawaan Indonesia)
let ccOn = prefs.cc !== false;
let trTo = TR_NAMES[prefs.to] ? prefs.to : '';      // terjemahkan ke ('' = tidak)
let ccBoth = !!prefs.ccBoth;

const lines = [];            // { id, cid, identity, name, lang, text, ts, trs: { en?, id? }, shared: Set, el? }
const byId = new Map();      // id -> line
const pendingTr = new Map(); // id -> [{ to, text }] (terjemahan yang tiba sebelum kalimatnya)
const interim = new Map();   // identity -> { text, ts, lang, tr? }
const lastFinal = new Map(); // identity -> line
const fmtT = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');

// ==================== Pengenal suara lokal ====================
let rec = null; let running = false; let wanted = false; let restartTimer; let failures = 0; let lastStart = 0;
let gen = 0;                 // naik setiap start/stop → callback milik pengenal lama diabaikan
let mode = '';               // 'lokal' (di perangkat) | 'online'
let segId = 0;
const segBase = Date.now().toString(36).slice(-4); // cid unik walau halaman dimuat ulang
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
  const cid = `${segBase}${++segId}`;
  clearInterim(store.identity, true);
  const line = addLine({ id: `${store.identity}:${cid}`, cid, identity: store.identity, name: store.name, lang: l, text, ts: Date.now() });
  send({ t: 'cap', text, lang: l, final: true, id: cid });
  // Simpan berurutan; gagal (mis. transkripsi baru dimatikan) diabaikan
  pending = pending.then(() => meetApi('POST', '/transcript', { text, lang: l, id: cid })).catch(() => {});
  // Pembicara menerjemahkan kalimatnya sendiri (di perangkat) lalu membagikannya → tampil juga di rekaman
  if (line) autoTranslate(line, 0);
}

// ==================== Terjemahan ====================
const hasDeviceTr = 'Translator' in self;
const translators = new Map(); // 'id>en' -> Promise<Translator|null>
const trCache = new Map();
let trQueue = Promise.resolve();
// 'shared' = browser tanpa penerjemah bawaan (Safari/Firefox) dan server terjemahan tidak aktif: terjemahan
// diambil dari yang dibagikan pembicara/moderator (Chrome/Edge/aplikasi HP).
let trState = '';              // '' | 'device' | 'server' | 'shared' | 'need-gesture' | 'downloading' | 'unsupported' | 'error'
let trDownload = 0; let trErr = '';
const needsTr = (srcLang) => !!trTo && (SHORT[srcLang] || 'id') !== trTo;
/**
 * Bahasa terjemahan yang ditampilkan di panel untuk satu kalimat. Bila terjemahan aktif, panel bersifat dwibahasa:
 * kalimat dalam bahasa lain diterjemahkan ke bahasa tujuan, sedangkan kalimat yang sudah berbahasa tujuan
 * (mis. ucapan English saat tujuan English) tetap menampilkan terjemahan lawannya (Indonesia).
 */
const shownTo = (l) => !trTo ? null : needsTr(l.lang) ? trTo : OTHER[l.lang];
const setTrState = (s) => { if (trState !== s) { trState = s; renderTrStatus(); } };

/** Penerjemah di perangkat untuk satu pasangan bahasa. Melempar Error('gesture') bila perlu klik pengguna dulu. */
function deviceTranslator(from, to, gesture) {
  if (!hasDeviceTr) return Promise.resolve(null);
  const key = from + '>' + to;
  if (translators.has(key)) return translators.get(key);
  const p = (async () => {
    const av = await self.Translator.availability({ sourceLanguage: from, targetLanguage: to });
    if (av === 'unavailable') return null;
    // Paket bahasa perlu diunduh sekali; browser mensyaratkan klik pengguna untuk itu.
    if (av !== 'available' && !gesture && !navigator.userActivation?.isActive) throw new Error('gesture');
    return self.Translator.create({
      sourceLanguage: from, targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (to !== trTo) return;
          trDownload = Math.round((e.loaded || 0) * 100); trState = 'downloading'; renderTrStatus();
        });
      },
    });
  })();
  translators.set(key, p);
  p.catch(() => translators.delete(key));
  return p;
}

/**
 * Terjemahkan `text` (bahasa srcLang) ke `to`. deviceOnly: tanpa cadangan server.
 * Mengembalikan null bila tidak bisa.
 */
async function translateText(text, srcLang, to, { interim: isInterim = false, deviceOnly = false } = {}) {
  const from = SHORT[srcLang] || 'id';
  if (!to || from === to) return null;
  const key = `${from}|${to}|${text}`;
  if (trCache.has(key)) return trCache.get(key);
  const mine = to === trTo && !deviceOnly;       // pasangan yang dipilih penonton ini → status ditampilkan
  let out = null; let deviceOk = false;
  try {
    const t = await deviceTranslator(from, to, false);
    if (t) { deviceOk = true; out = await t.translate(text); if (mine) setTrState('device'); }
  } catch (e) { if (mine && e.message === 'gesture') setTrState('need-gesture'); }
  if (out == null && !isInterim && !deviceOnly && store.meta.trServer) {
    try { out = (await meetApi('POST', '/translate', { text, from, to })).text; if (trState !== 'device') setTrState('server'); }
    catch (e) { trErr = e.message; setTrState('error'); }
  }
  if (mine && out == null && !deviceOk && !store.meta.trServer && trState !== 'need-gesture' && trState !== 'downloading') setTrState('shared');
  if (out != null && !isInterim) { trCache.set(key, out); if (trCache.size > 800) trCache.delete(trCache.keys().next().value); }
  return out;
}

/** Simpan terjemahan sebuah kalimat & perbarui tampilan. */
function setTr(l, to, text) {
  if (!text || l.trs[to]) return;
  l.trs[to] = text;
  renderLineTr(l);
  if (lastFinal.get(l.identity) === l) renderCaptions();
}
/** Bagikan terjemahan ke semua peserta (termasuk perekam) & simpan ke server. Hanya pembicara sendiri atau moderator. */
function shareTr(l, to) {
  const text = l.trs[to];
  if (!text || !l.cid || l.shared.has(to) || to !== OTHER[l.lang]) return;
  if (l.identity !== store.identity && !isMod()) return;
  l.shared.add(to);
  send({ t: 'cap-tr', who: l.identity, id: l.cid, to, text: text.slice(0, 1500) });
  pending = pending.then(() => meetApi('POST', '/transcript/tr', { who: l.identity, id: l.cid, to, text })).catch(() => {});
}
/**
 * Terjemahan otomatis ke bahasa lawan untuk rekaman & ekspor:
 * pembicara untuk kalimatnya sendiri (langsung), moderator pemimpin untuk kalimat yang belum diterjemahkan (setelah jeda).
 */
function autoTranslate(l, delay) {
  if (!hasDeviceTr || !l.cid) return;
  const to = OTHER[l.lang];
  setTimeout(() => {
    if (l.trs[to] && l.shared.has(to)) return;
    if (l.trs[to]) return shareTr(l, to);
    trQueue = trQueue.then(async () => {
      if (l.trs[to]) return;
      const out = await translateText(l.text, l.lang, to, { deviceOnly: true });
      if (out != null) { setTr(l, to, out); shareTr(l, to); }
    }).catch(() => {});
  }, delay);
}
const iAmLeaderMod = () => isMod() && leaderIdentity() === store.identity;

function renderLineTr(l) {
  const body = l.el?.querySelector('.msg-body'); if (!body) return;
  let box = body.querySelector('.msg-tr');
  const to = shownTo(l);
  if (!to) { box?.remove(); return; }
  const t = l.trs[to] || null;
  if (!box) { box = h('div', { class: 'msg-tr' }); body.append(box); }
  box.className = 'msg-tr' + (t ? '' : ' pending');
  const wait = trState === 'unsupported' ? 'terjemahan tidak tersedia di browser ini'
    : trState === 'shared' ? 'menunggu terjemahan dari peserta lain…'
    : trState === 'need-gesture' ? 'klik "Aktifkan terjemahan" di atas' : trState === 'error' ? 'terjemahan gagal' : 'menerjemahkan…';
  box.replaceChildren(h('span', { class: 'tr-lang-tag', text: to.toUpperCase() }), t ?? wait);
}
function queueTr(l) {
  renderLineTr(l);
  const want = shownTo(l);
  if (!want || l.trs[want]) return;
  const run = () => {
    trQueue = trQueue.then(async () => {
      if (shownTo(l) !== want || l.trs[want]) return renderLineTr(l);
      const out = await translateText(l.text, l.lang, want);
      if (out != null) { setTr(l, want, out); shareTr(l, want); }
      renderLineTr(l);
    }).catch(() => {});
  };
  // Tanpa penerjemah bawaan (Safari/Firefox): server kampus sudah menerjemahkan setiap kalimat sekali dan
  // membagikannya ke semua peserta. Tunggu sebentar agar tidak meminta terjemahan yang sama dua kali.
  if (!hasDeviceTr && store.meta.trServer && Date.now() - l.ts < 15000) setTimeout(run, 2500); else run();
}
/** Terjemahkan ulang baris terbaru (yang terbaru dulu) setelah pengaturan berubah. */
function refreshTranslations() {
  const recent = new Set(lines.slice(-80));
  for (const l of lines) if (!recent.has(l)) { const to = shownTo(l); if (to && l.trs[to]) renderLineTr(l); else l.el?.querySelector('.msg-tr')?.remove(); }
  for (const l of [...recent].reverse()) queueTr(l);
  renderCaptions();
}
function prepareTranslation(gesture) {
  if (!trTo) return;
  const from = trTo === 'en' ? 'id' : 'en';
  deviceTranslator(from, trTo, gesture).then((t) => {
    if (t) setTrState('device');
    else if (!store.meta.trServer) setTrState('shared');
    for (const l of lines.slice(-80)) { const to = shownTo(l); if (to && !l.trs[to]) queueTr(l); }
  }).catch((e) => { if (e.message === 'gesture') setTrState('need-gesture'); });
}
/**
 * Paket terjemahan butuh klik pengguna untuk diunduh pertama kali. Klik apa pun di ruang meeting dipakai untuk
 * menyiapkan penerjemah yang dibutuhkan: arah ucapan saya (pembicara) dan, bagi moderator, kedua arah.
 */
const prepped = new Set();
function prepOnGesture() {
  if (!hasDeviceTr || !store.meta.transcribe || isRec()) return;
  const pairs = new Set([`${SHORT[lang]}>${OTHER[lang]}`]);
  if (isMod()) { pairs.add('id>en'); pairs.add('en>id'); }
  if (trTo) { const o = trTo === 'en' ? 'id' : 'en'; pairs.add(`${o}>${trTo}`); pairs.add(`${trTo}>${o}`); }
  for (const k of pairs) {
    if (prepped.has(k)) continue;
    prepped.add(k);
    const [f, t] = k.split('>');
    deviceTranslator(f, t, true).catch(() => prepped.delete(k));
  }
}

// Terjemahan teks sementara (CC) hanya di perangkat, dibatasi agar ringan
const itBusy = new Set();
function translateInterim(identity) {
  if (!trTo || !ccOn || !hasDeviceTr || trState === 'unsupported' || trState === 'shared' || itBusy.has(identity)) return;
  const it = interim.get(identity); if (!it || !needsTr(it.lang)) return;
  itBusy.add(identity);
  const text = it.text; const want = trTo;
  translateText(text.slice(-300), it.lang, want, { interim: true }).then((out) => {
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
  else if (trState === 'shared') {
    content = [`Browser ini (mis. Safari/Firefox) tidak punya penerjemah bawaan. Terjemahan ${from} → ${TR_NAMES[trTo]} diambil dari pembicara/moderator yang memakai Chrome, Edge, atau aplikasi HP, jadi bisa tertunda beberapa detik. Admin dapat mengaktifkan server terjemahan kampus agar terjemahan selalu tersedia di semua browser.`];
  }
  else if (trState === 'error') { content = [`Terjemahan gagal: ${trErr}`]; cls = 'warn'; }
  else {
    const how = trState === 'device' ? ' Diproses di perangkat Anda.' : trState === 'server' ? ' Diproses server kampus.' : '';
    content = [`Ucapan dalam ${from} diterjemahkan ke ${TR_NAMES[trTo]}; ucapan dalam ${TR_NAMES[trTo]} disertai terjemahan ${from}.${how}`]; cls = trState ? 'on' : '';
  }
  el.replaceChildren(...content); el.className = 'tr-status ' + cls;
  for (const l of lines.slice(-80)) { const to = shownTo(l); if (l.el && to && !l.trs[to]) renderLineTr(l); }
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
function newLine(l) {
  l.trs ||= {}; l.shared ||= new Set();
  for (const p of pendingTr.get(l.id) || []) { l.trs[p.to] ||= p.text; l.shared.add(p.to); }
  pendingTr.delete(l.id);
  return l;
}
function addLine(l) {
  if (byId.has(l.id)) return null;
  newLine(l);
  lines.push(l); byId.set(l.id, l);
  if (lines.length > 2000) byId.delete(lines.shift().id);
  const log = $('#tr-log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const row = log.querySelector(`[data-interim="${CSS.escape(l.identity)}"]`);
  log.insertBefore(lineEl(l), row || null);
  if (near) log.scrollTop = log.scrollHeight;
  l.shownAt = Date.now();
  lastFinal.set(l.identity, l);
  queueTr(l);
  // Moderator pemimpin mengisi terjemahan yang belum dibagikan pembicaranya (mis. pembicara memakai HP)
  if (l.identity !== store.identity && iAmLeaderMod()) autoTranslate(l, 2500);
  renderCaptions();
  if (!isPanelOpen()) $('#unread-tr').hidden = false;
  return l;
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

// Teks langsung (CC): maksimal 2 pembicara terakhir.
// Penonton: sesuai pilihan terjemahannya. Rekaman: teks asli + terjemahannya sekaligus.
let capTimer;
function renderCaptions() {
  const box = $('#captions');
  const rec_ = isRec();
  const show = (ccOn || rec_) && store.meta.transcribe;
  if (!show) { box.hidden = true; return; }
  const t = Date.now();
  const hold = rec_ ? 7000 : 5000;               // rekaman: beri waktu terjemahan tiba & terbaca
  const items = [];
  for (const [id, v] of interim) if (t - v.ts < 6000) items.push({ id, text: v.text, lang: v.lang, it: v, ts: v.ts, interim: true });
  for (const [id, l] of lastFinal) if (t - (l.shownAt || l.ts) < hold && !interim.has(id)) items.push({ id, text: l.text, lang: l.lang, line: l, ts: l.shownAt || l.ts });
  items.sort((a, b) => b.ts - a.ts);
  const top = items.slice(0, 2).reverse();
  box.hidden = !top.length;
  const cut = (s) => s.length > 180 ? '…' + s.slice(-180) : s;
  box.replaceChildren(...top.map((i) => {
    if (rec_) {
      const to = OTHER[i.lang];
      const tr = i.line?.trs[to] || null;
      return h('div', { class: `cap-line rec ${i.interim ? 'interim' : ''}` }, h('b', { text: nameOf(i.id) + ':' }), h('span', { text: cut(i.text) }),
        tr ? h('em', { class: 'cap-tr' }, h('i', { text: to.toUpperCase() }), cut(tr)) : null);
    }
    const tr = !needsTr(i.lang) ? null : i.line ? (i.line.trs[trTo] || null) : (i.it?.tr?.to === trTo ? i.it.tr.text : null);
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
  // Tombol di bar atas: moderator memulai transkripsi; saat aktif semua peserta bisa mengatur bahasanya
  const tb = $('#cap-badge');
  tb.hidden = !on_ && !isMod();
  tb.classList.toggle('on', on_);
  $('#tr-btn-label').textContent = on_ ? 'Transkripsi aktif' : 'Mulai transkripsi';
  tb.title = on_ ? 'Atur bahasa transkripsi & terjemahan' : 'Mulai transkripsi otomatis';
  let text, cls = '';
  if (!on_) text = isMod() ? 'Transkripsi belum aktif. Klik "Mulai transkripsi" agar ucapan semua pembicara tercatat otomatis.' : 'Transkripsi belum diaktifkan moderator.';
  else if (!SR) { text = 'Browser Anda tidak mendukung pengenalan suara, jadi ucapan Anda tidak tercatat. Gunakan Chrome, Edge, atau Safari (Mac), atau aplikasi UIKA Meet di HP. Ucapan pembicara lain tetap tampil di sini.'; cls = 'warn'; }
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

// ==================== Ekspor (TXT / PDF / Word) ====================
/** Semua kalimat sesi ini dari server (+ terjemahan lokal yang belum tersimpan). */
async function exportRows() {
  let rows = [];
  try { rows = (await meetApi('GET', '/transcript?all=1')).lines; } catch { /* pakai data lokal */ }
  const seen = new Set();
  const out = rows.map((r) => {
    const id = r.cid ? `${r.identity}:${r.cid}` : null; if (id) seen.add(id);
    const local = id && byId.get(id);
    const to = OTHER[r.lang] || 'en';
    const trText = r.tr_text || local?.trs[to] || null;
    return { ts: r.ts, name: r.name, lang: r.lang, text: r.text, trLang: trText ? (to === 'en' ? 'en-US' : 'id-ID') : null, trText };
  });
  for (const l of lines) {
    if (seen.has(l.id) || rows.some(r => r.identity === l.identity && r.text === l.text)) continue;
    const to = OTHER[l.lang]; const trText = l.trs[to] || null;
    out.push({ ts: Math.floor(l.ts / 1000), name: l.name, lang: l.lang, text: l.text, trLang: trText ? (to === 'en' ? 'en-US' : 'id-ID') : null, trText });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
function exportInfo(rows) {
  const me = getMe();
  return { app: store.meta.app || me?.app?.name || 'Meeting', campus: store.meta.campus || me?.app?.campus || '', title: store.meta.name || store.code, roomId: store.code, lines: rows };
}
async function exportAs(kind) {
  toast('Menyiapkan file transkrip…', 'info', 2000);
  const rows = await exportRows();
  if (!rows.length) return toast(store.meta.transcribe ? 'Belum ada ucapan yang tercatat untuk diunduh.' : 'Belum ada transkrip. Mulai transkripsi terlebih dahulu, lalu unduh setelah ada ucapan yang tercatat.', 'error', 6000);
  const base = `transkrip-${store.code}-${new Date().toISOString().slice(0, 10)}`;
  try {
    if (kind === 'pdf') saveBlob(await transcriptPdf(exportInfo(rows)), base + '.pdf');
    else if (kind === 'docx') saveBlob(await transcriptDocx(exportInfo(rows)), base + '.docx');
    else {
      const head = `Transkrip otomatis — ${store.meta.name}\nRoom: ${store.code}\nDiunduh: ${new Date().toLocaleString('id-ID')}\n\n`;
      const body = rows.map(r => `[${fmtT(r.ts * 1000)}] ${r.name} (${LANGS[r.lang] || 'ID'}): ${r.text}` + (r.trText ? `\n           [${LANGS[r.trLang]}] ${r.trText}` : '')).join('\n');
      saveBlob(new Blob([head + body], { type: 'text/plain;charset=utf-8' }), base + '.txt');
    }
  } catch (e) { toast('Gagal mengekspor: ' + e.message, 'error'); }
}

// ==================== Pesan dari peserta lain ====================
on('msg:cap', (m, from) => {
  if (!store.meta.transcribe) return;
  const text = str(m.text, 1000).trim(); if (!text) return;
  const l = LANGS[m.lang] ? m.lang : 'id-ID';
  if (m.final) {
    clearInterim(from, false);
    const cid = str(m.id, 20);
    addLine({ id: `${from}:${cid}`, cid, identity: from, name: nameOf(from), lang: l, text, ts: Date.now() });
    renderInterimRow(from);
  } else setInterim(from, text.slice(-300), l);
});
function receiveTr(m) {
  const who = str(m.who, 80), cid = str(m.id, 20), to = m.to === 'en' ? 'en' : m.to === 'id' ? 'id' : null;
  const text = str(m.text, 1500).trim();
  if (!who || !cid || !to || !text) return;
  const id = `${who}:${cid}`; const l = byId.get(id);
  if (!l) { const arr = pendingTr.get(id) || []; arr.push({ to, text }); pendingTr.set(id, arr.slice(-2)); if (pendingTr.size > 200) pendingTr.delete(pendingTr.keys().next().value); return; }
  l.shared.add(to);
  setTr(l, to, text);
}
// Terjemahan dari peserta: hanya diterima dari pembicara kalimat itu sendiri atau moderator
on('msg:cap-tr', (m, from, role) => { if (str(m.who, 80) === from || role === 'moderator') receiveTr(m); });
// Terjemahan dari server kampus (TRANSLATE_URL)
on('srv:cap-tr', (m) => receiveTr(m));

async function loadHistory() {
  try {
    const { lines: rows } = await meetApi('GET', '/transcript');
    if (!rows.length) return;
    const log = $('#tr-log');
    const known = new Set(lines.map(l => `${l.identity}|${l.text}`));
    const older = rows.filter(r => !known.has(`${r.identity}|${r.text}`) && !(r.cid && byId.has(`${r.identity}:${r.cid}`))).map((r) => {
      const l = newLine({ id: r.cid ? `${r.identity}:${r.cid}` : 'db' + r.id, cid: r.cid || null, identity: r.identity, name: r.name, lang: r.lang, text: r.text, ts: r.ts * 1000 });
      if (r.tr_text && r.tr_lang) { const to = SHORT[r.tr_lang]; l.trs[to] = r.tr_text; l.shared.add(to); }
      return l;
    });
    for (const l of older) byId.set(l.id, l);
    lines.unshift(...older);
    log.replaceChildren(...lines.map(lineEl));
    log.scrollTop = log.scrollHeight;
    refreshTranslations();
  } catch { /* abaikan */ }
}

// ==================== Popup bahasa (tombol di samping "Mulai rekam") ====================
function transcribeDialog() {
  const on_ = !!store.meta.transcribe; const mod = isMod();
  if (!on_ && !mod) return;
  const src = h('select', {}, [['id-ID', 'Bahasa Indonesia'], ['en-US', 'English']].map(([v, t]) => h('option', { value: v, text: t, selected: v === lang })));
  const dst = h('select', {}, [['', 'Tidak diterjemahkan'], ['en', 'English'], ['id', 'Bahasa Indonesia']].map(([v, t]) => h('option', { value: v, text: t, selected: v === trTo })));
  const cc = h('input', { type: 'checkbox', checked: ccOn });
  const both = h('input', { type: 'checkbox', checked: ccBoth });
  const apply = () => {
    const ls = $('#tr-lang'); if (ls.value !== src.value) { ls.value = src.value; ls.dispatchEvent(new Event('change')); }
    const ts = $('#tr-to'); if (ts.value !== dst.value) { ts.value = dst.value; ts.dispatchEvent(new Event('change')); }
    const tb = $('#tr-both'); if (tb.checked !== both.checked) { tb.checked = both.checked; tb.dispatchEvent(new Event('change')); }
    if (ccOn !== cc.checked) { ccOn = cc.checked; prefs.cc = ccOn; savePrefs(); renderCaptions(); renderStatus(); }
  };
  const body = h('div', { class: 'tr-dialog' },
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { text: 'Bahasa asal (ucapan saya)' }), src),
      h('div', { class: 'field' }, h('label', { text: 'Bahasa tujuan (terjemahan)' }), dst)),
    h('label', { class: 'check', style: { marginBottom: '8px' } }, cc, 'Tampilkan teks langsung (CC) di layar'),
    h('label', { class: 'check' }, both, 'CC juga menampilkan teks asli di bawah terjemahan'),
    h('p', { class: 'tr-note', text: on_
      ? 'Pengaturan ini hanya berlaku untuk Anda. Peserta lain bisa memilih bahasanya sendiri lewat tombol "Transkripsi aktif".'
      : 'Ucapan setiap peserta yang menyalakan mikrofon akan diubah menjadi teks beserta namanya dan disimpan sebagai notulen. Semua peserta melihat tanda "Transkripsi aktif" dan dapat memilih bahasa terjemahannya masing-masing.' }));
  const actions = on_
    ? [...(mod ? [{ label: 'Hentikan transkripsi', cls: 'btn-ghost', onClick: async () => {
        try { await meetApi('POST', '/mod/transcribe', { on: false }); toast('Transkripsi dihentikan', 'success'); } catch (e) { toast(e.message, 'error'); }
      } }] : []), { label: 'Simpan', cls: 'btn-primary', onClick: () => { apply(); toast('Pengaturan bahasa disimpan', 'success'); } }]
    : [{ label: 'Batal' }, { label: 'Mulai transkripsi', cls: 'btn-primary', onClick: async () => {
        apply();
        try { await meetApi('POST', '/mod/transcribe', { on: true }); toast('Transkripsi dimulai', 'success'); } catch (e) { toast(e.message, 'error'); }
      } }];
  modal({ title: on_ ? 'Transkripsi & terjemahan' : 'Mulai transkripsi otomatis', body, actions });
}

// ==================== Inisialisasi ====================
export function initTranscript() {
  const sel = $('#tr-lang'); sel.value = lang;
  sel.addEventListener('change', () => {
    lang = sel.value; prefs.lang = lang; savePrefs();
    // Lepas pengenal lama dulu; Chrome butuh jeda singkat sebelum sesi pengenalan baru dimulai
    stop(); failures = 0; setTimeout(sync, 350);
    prepOnGesture();
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
  // Menu unduh dipasang di <body> dengan posisi tetap: panel samping memakai overflow:hidden sehingga
  // menu yang berada di dalamnya akan terpotong dan tidak bisa diklik.
  $('#cap-badge').addEventListener('click', transcribeDialog);
  const dlMenu = $('#tr-dl-menu'); const dlBtn = $('#tr-dl');
  document.body.append(dlMenu);
  const placeMenu = () => {
    const r = dlBtn.getBoundingClientRect();
    dlMenu.style.top = `${Math.round(r.bottom + 6)}px`;
    dlMenu.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - dlMenu.offsetWidth - 8, r.right - dlMenu.offsetWidth)))}px`;
  };
  const closeMenu = () => { dlMenu.hidden = true; dlBtn.setAttribute('aria-expanded', 'false'); };
  dlBtn.setAttribute('aria-expanded', 'false');
  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!dlMenu.hidden) return closeMenu();
    dlMenu.hidden = false; dlBtn.setAttribute('aria-expanded', 'true'); placeMenu();
    dlMenu.querySelector('button')?.focus();
  });
  for (const b of dlMenu.querySelectorAll('[data-fmt]')) b.addEventListener('click', () => { closeMenu(); exportAs(b.dataset.fmt); });
  document.addEventListener('click', (e) => { if (!dlMenu.hidden && !e.target.closest('#tr-dl-menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlMenu.hidden) { closeMenu(); dlBtn.focus(); } });
  addEventListener('resize', () => { if (!dlMenu.hidden) placeMenu(); });
  $('#btn-cc').addEventListener('click', () => { ccOn = !ccOn; prefs.cc = ccOn; savePrefs(); renderCaptions(); renderStatus(); });
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('pointerdown', prepOnGesture, { capture: true });
  document.addEventListener('keydown', prepOnGesture, { capture: true });

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
