// Presentasi PDF (dirender di browser dengan pdf.js) + whiteboard anotasi yang tersinkron.
import { h, icon, toast, modal, confirmDialog } from '../shared/common.js';
import { store, on, emit, canPresent, isPresenter, meetApi, nameOf } from './store.js';
import { send, str } from './bus.js';
import { drawShape as drawShapeAt } from '../shared/wbdraw.js';

const $ = (s) => document.querySelector(s);
const DPR = () => Math.min(2, devicePixelRatio || 1);
const drawShape = (ctx, s, W, H) => drawShapeAt(ctx, s, W, H, DPR());
let pdfjs = null;
const docs = new Map();   // presId -> Promise<PDFDocumentProxy>
const shapes = new Map(); // "presKey:page" -> shape[]
let zoom = 1; let fitWidth = false;
let renderTask = null; let pageRatio = 16 / 9;
let tool = 'pointer'; let drawing = null; let lastSent = 0;
const myStack = []; // id shape milik saya (untuk undo)
let localPage = null; // halaman optimistis presenter

const presKey = () => store.meta.pres?.id || 'default';
const curPage = () => localPage ?? store.meta.pres?.page ?? 1;
const key = () => `${presKey()}:${curPage()}`;
const canDraw = () => canPresent() || !!store.meta.multiWb;
const list = (k = key()) => { let a = shapes.get(k); if (!a) { a = []; shapes.set(k, a); } return a; };
const rid = () => Math.random().toString(36).slice(2, 10);

async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  }
  return pdfjs;
}
function getDoc(id) {
  if (!docs.has(id)) {
    docs.set(id, (async () => {
      const lib = await loadPdfjs();
      const data = await meetApi('GET', `/presentations/${id}`);
      return lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false, standardFontDataUrl: '/vendor/standard_fonts/', cMapUrl: '/vendor/cmaps/', cMapPacked: true }).promise;
    })().catch(e => { docs.delete(id); throw e; }));
  }
  return docs.get(id);
}

// ---------- Tata letak & render ----------
function layout() {
  const scroll = $('#pres-scroll');
  const pageEl = $('#pres-page');
  const cs = getComputedStyle(scroll);
  const availW = scroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = scroll.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let w = fitWidth ? availW : Math.min(availW, availH * pageRatio);
  w = Math.max(100, w) * zoom;
  const hgt = w / pageRatio;
  pageEl.style.width = w + 'px'; pageEl.style.height = hgt + 'px';
  scroll.style.placeItems = (zoom > 1 || fitWidth) ? 'start center' : 'center';
  for (const c of [$('#pdf-canvas'), $('#wb-canvas')]) { c.width = Math.round(w * DPR()); c.height = Math.round(hgt * DPR()); }
  return { w, h: hgt };
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const pres = store.meta.pres;
  const pdfCanvas = $('#pdf-canvas');
  try { renderTask?.cancel(); } catch { /* abaikan */ }
  if (!pres) {
    pageRatio = 16 / 9;
    const { w, h: hh } = layout();
    const ctx = pdfCanvas.getContext('2d');
    ctx.setTransform(DPR(), 0, 0, DPR(), 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#c7d2e0'; ctx.font = `600 ${Math.round(hh * 0.045)}px Inter, Segoe UI, Arial`; ctx.textAlign = 'center';
    ctx.fillText(store.meta.name || 'Whiteboard', w / 2, hh * 0.47);
    ctx.font = `400 ${Math.round(hh * 0.03)}px Inter, Segoe UI, Arial`;
    ctx.fillText(canPresent() ? 'Gunakan alat di kanan untuk menulis, atau unggah PDF lewat tombol +' : 'Whiteboard', w / 2, hh * 0.55);
    drawShapes();
    updateBar();
    return;
  }
  try {
    const doc = await getDoc(pres.id);
    if (seq !== renderSeq) return;
    const n = Math.min(Math.max(1, curPage()), doc.numPages);
    const page = await doc.getPage(n);
    if (seq !== renderSeq) return;
    const vp1 = page.getViewport({ scale: 1 });
    pageRatio = vp1.width / vp1.height;
    const { w } = layout();
    const viewport = page.getViewport({ scale: (w * DPR()) / vp1.width });
    const ctx = pdfCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawShapes();
    renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    if (canPresent() && pres.pages !== doc.numPages && isPresenter()) setPres({ id: pres.id, page: n, pages: doc.numPages });
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    console.warn(e); toast('Gagal memuat presentasi: ' + e.message, 'error');
  }
  updateBar();
}

function updateBar() {
  const pres = store.meta.pres;
  const pages = pres?.pages || 1;
  const sel = $('#pg-select');
  if (sel.options.length !== pages) sel.replaceChildren(...Array.from({ length: pages }, (_, i) => h('option', { value: i + 1, text: `Slide ${i + 1}` })));
  sel.value = curPage();
  const pres_ = canPresent();
  sel.disabled = !pres_;
  $('#pg-prev').hidden = $('#pg-next').hidden = !pres_;
  $('#pg-prev').disabled = curPage() <= 1; $('#pg-next').disabled = curPage() >= pages;
  $('#pres-name').textContent = pres ? pres.name : 'Whiteboard';
  $('#pres-dl').hidden = !pres || !(pres.downloadable || pres_);
  $('#zoom-val').textContent = Math.round(zoom * 100) + '%';
  $('#wb-tools').hidden = !canDraw();
  $('#wb-clear').hidden = !canPresent();
}

// ---------- Gambar anotasi ----------
function drawShapes() {
  const c = $('#wb-canvas'); const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  for (const s of list()) drawShape(ctx, s, c.width, c.height);
  if (drawing?.shape) drawShape(ctx, drawing.shape, c.width, c.height);
}

// ---------- Validasi bentuk dari jaringan ----------
const KINDS = new Set(['pen', 'rect', 'ellipse', 'line', 'arrow', 'text']);
function sanitize(s, from) {
  if (!s || !KINDS.has(s.k) || !Array.isArray(s.p) || s.p.length < 2 || s.p.length > 1600) return null;
  const p = s.p.map(v => Math.max(-0.5, Math.min(1.5, Math.round((+v || 0) * 10000) / 10000)));
  const c = /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#e53935';
  const out = { id: str(s.id, 16), k: s.k, c, w: Math.max(1, Math.min(20, +s.w || 4)), p, by: from };
  if (s.k === 'text') { out.tx = str(s.tx, 500); out.fs = Math.max(0.01, Math.min(0.2, +s.fs || 0.035)); if (!out.tx) return null; }
  return out.id ? out : null;
}
function senderMayDraw(from, role) { return role === 'moderator' || isPresenter(from) || !!store.meta.multiWb; }
const senderIsPresenter = (from, role) => role === 'moderator' || isPresenter(from);

on('msg:wb', (m, from, role) => {
  const k = str(m.key, 80); if (!k) return;
  if (m.op === 'put') {
    if (!senderMayDraw(from, role)) return;
    const s = sanitize(m.s, from); if (!s) return;
    const arr = list(k); if (arr.length > 3000) return;
    const i = arr.findIndex(x => x.id === s.id);
    if (i >= 0) { if (arr[i].by !== from) return; arr[i] = s; } else arr.push(s);
  } else if (m.op === 'del') {
    const arr = list(k); const i = arr.findIndex(x => x.id === m.id);
    if (i >= 0 && (arr[i].by === from || senderIsPresenter(from, role))) arr.splice(i, 1);
  } else if (m.op === 'clear') {
    if (!senderIsPresenter(from, role)) return;
    shapes.set(k, []);
  }
  if (k === key()) drawShapes();
});
on('sync-collect', (payload) => {
  const wb = {}; let total = 0;
  for (const [k, arr] of shapes) { if (arr.length && total < 4000) { wb[k] = arr; total += arr.length; } }
  payload.wb = wb;
});
on('sync', (obj, from) => {
  if (!obj.wb || typeof obj.wb !== 'object') return;
  for (const [k, arr] of Object.entries(obj.wb).slice(0, 200)) {
    if (!Array.isArray(arr)) continue;
    const clean = arr.slice(0, 3000).map(s => sanitize(s, str(s?.by, 64) || from)).filter(Boolean);
    shapes.set(str(k, 80), clean);
  }
  drawShapes();
});

// ---------- Input whiteboard ----------
function pt(e) {
  const r = $('#wb-canvas').getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * 10000) / 10000, Math.round(((e.clientY - r.top) / r.height) * 10000) / 10000];
}
function hit(s, x, y) {
  const tol = 0.015;
  const P = s.p;
  if (s.k === 'text') { const lines = s.tx.split('\n'); const w = Math.max(...lines.map(l => l.length)) * s.fs * 0.55; return x >= P[0] - tol && x <= P[0] + w && y >= P[1] - tol && y <= P[1] + lines.length * s.fs * 1.25; }
  if (s.k === 'rect' || s.k === 'ellipse') {
    const [x1, x2] = [Math.min(P[0], P[2]), Math.max(P[0], P[2])]; const [y1, y2] = [Math.min(P[1], P[3]), Math.max(P[1], P[3])];
    return x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol && !(x > x1 + tol && x < x2 - tol && y > y1 + tol && y < y2 - tol);
  }
  for (let i = 0; i + 3 < P.length || i === 0; i += 2) {
    const ax = P[i], ay = P[i + 1], bx = P[i + 2] ?? ax, by = P[i + 3] ?? ay;
    const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < tol) return true;
    if (P.length <= 2) break;
  }
  return false;
}
function erase(x, y) {
  const arr = list();
  for (let i = arr.length - 1; i >= 0; i--) {
    const s = arr[i];
    if ((s.by === store.identity || canPresent()) && hit(s, x, y)) { arr.splice(i, 1); send({ t: 'wb', op: 'del', key: key(), id: s.id }); drawShapes(); return; }
  }
}
function putShape(s, force) {
  const now = performance.now();
  if (!force && now - lastSent < 70) return;
  lastSent = now;
  send({ t: 'wb', op: 'put', key: key(), s: { id: s.id, k: s.k, c: s.c, w: s.w, p: s.p, tx: s.tx, fs: s.fs } });
}
function commitText() {
  const ta = $('#wb-text');
  if (ta.hidden) return;
  const text = ta.value.trim().slice(0, 500);
  ta.hidden = true;
  if (!text || !ta._pos) return;
  const s = { id: rid(), k: 'text', c: $('#wb-color').value, w: 1, p: ta._pos, tx: text, fs: 0.035, by: store.identity };
  list().push(s); myStack.push([key(), s.id]); putShape(s, true); drawShapes();
}

function initInput() {
  const cv = $('#wb-canvas'); const scroll = $('#pres-scroll');
  let pan = null;
  cv.addEventListener('pointerdown', (e) => {
    if (tool === 'pan' || (tool === 'pointer' && zoom > 1)) { pan = { x: e.clientX, y: e.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop }; cv.setPointerCapture(e.pointerId); scroll.classList.add('panning'); return; }
    if (!canDraw() || tool === 'pointer') return;
    const [x, y] = pt(e);
    if (tool === 'eraser') { drawing = { erase: true }; erase(x, y); cv.setPointerCapture(e.pointerId); return; }
    if (tool === 'text') {
      commitText();
      const ta = $('#wb-text'); const r = cv.getBoundingClientRect();
      ta._pos = [x, y]; ta.value = ''; ta.hidden = false;
      ta.style.left = (e.clientX - r.left) + 'px'; ta.style.top = (e.clientY - r.top) + 'px'; ta.style.color = $('#wb-color').value;
      setTimeout(() => ta.focus(), 0); e.preventDefault(); return;
    }
    const s = { id: rid(), k: tool, c: $('#wb-color').value, w: +$('#wb-size').value, p: tool === 'pen' ? [x, y] : [x, y, x, y], by: store.identity };
    drawing = { shape: s }; cv.setPointerCapture(e.pointerId);
    drawShapes();
  });
  cv.addEventListener('pointermove', (e) => {
    if (pan) { scroll.scrollLeft = pan.sl - (e.clientX - pan.x); scroll.scrollTop = pan.st - (e.clientY - pan.y); return; }
    if (!drawing) return;
    const [x, y] = pt(e);
    if (drawing.erase) { erase(x, y); return; }
    const s = drawing.shape;
    if (s.k === 'pen') {
      const lx = s.p[s.p.length - 2], ly = s.p[s.p.length - 1];
      if (Math.hypot(x - lx, y - ly) < 0.002 || s.p.length >= 1600) return;
      s.p.push(x, y);
    } else { s.p[2] = x; s.p[3] = y; }
    drawShapes(); putShape(s);
  });
  const end = (e) => {
    if (pan) { pan = null; scroll.classList.remove('panning'); return; }
    if (!drawing) return;
    const s = drawing.shape; drawing = null;
    if (s) { list().push(s); myStack.push([key(), s.id]); putShape(s, true); }
    drawShapes();
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  scroll.addEventListener('pointerdown', (e) => {
    if (e.target !== scroll || tool !== 'pan') return;
    pan = { x: e.clientX, y: e.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop }; scroll.setPointerCapture(e.pointerId); scroll.classList.add('panning');
  });
  scroll.addEventListener('pointermove', (e) => { if (pan && e.target === scroll) { scroll.scrollLeft = pan.sl - (e.clientX - pan.x); scroll.scrollTop = pan.st - (e.clientY - pan.y); } });
  scroll.addEventListener('pointerup', end); scroll.addEventListener('pointercancel', end);
  const ta = $('#wb-text');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } if (e.key === 'Escape') { ta.hidden = true; } });
  ta.addEventListener('blur', commitText);

  for (const b of document.querySelectorAll('#wb-tools [data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  // Sembunyikan/tampilkan alat gambar (diingat per perangkat)
  const tools = $('#wb-tools'), tg = $('#wb-collapse');
  const setCollapsed = (c) => {
    tools.classList.toggle('collapsed', c);
    tg.title = c ? 'Tampilkan alat gambar' : 'Sembunyikan alat gambar';
    tg.setAttribute('aria-expanded', String(!c));
  };
  // Saat awal meeting alat gambar selalu dilipat agar slide/halaman utama tampil penuh
  setCollapsed(true);
  tg.addEventListener('click', () => setCollapsed(!tools.classList.contains('collapsed')));
  $('#wb-undo').addEventListener('click', undo);
  $('#wb-clear').addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus semua anotasi?', 'Semua coretan di slide ini akan dihapus untuk semua peserta.', 'Hapus'))) return;
    shapes.set(key(), []); send({ t: 'wb', op: 'clear', key: key() }); drawShapes();
  });
}
function setTool(t) {
  commitText();
  tool = t;
  for (const b of document.querySelectorAll('#wb-tools [data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
  $('#pres-page').className = 'pres-page tool-' + t;
  // Geser hanya bermakna bila slide lebih besar dari layar: perbesar otomatis bila masih pas layar
  if (t === 'pan') {
    const sc = $('#pres-scroll');
    if (sc.scrollWidth <= sc.clientWidth + 2 && sc.scrollHeight <= sc.clientHeight + 2) {
      zoom = Math.max(zoom, 1.5); fitWidth = false; render();
      toast('Slide diperbesar 150%. Seret slide untuk menggeser; klik − untuk memperkecil.', 'info', 4000);
    } else toast('Seret slide untuk menggeser tampilan.', 'info', 2500);
  }
}
function undo() {
  while (myStack.length) {
    const [k, id] = myStack.pop();
    const arr = shapes.get(k); const i = arr?.findIndex(s => s.id === id) ?? -1;
    if (i >= 0) { arr.splice(i, 1); send({ t: 'wb', op: 'del', key: k, id }); if (k === key()) drawShapes(); return; }
  }
}

// ---------- Navigasi slide (presenter) ----------
let presTimer;
async function setPres(body) {
  try { await meetApi('POST', '/state/presentation', body); }
  catch (e) { toast(e.message, 'error'); localPage = null; render(); }
}
function goto(n) {
  const pres = store.meta.pres; if (!pres || !canPresent()) return;
  n = Math.max(1, Math.min(pres.pages || 1, n));
  if (n === curPage()) return;
  localPage = n; render();
  clearTimeout(presTimer);
  presTimer = setTimeout(() => setPres({ id: pres.id, page: n, pages: pres.pages }), 150);
}

// ---------- Kelola presentasi ----------
export async function managePresentations() {
  let items = [];
  const listEl = h('div', { class: 'pres-list' });
  const refresh = async () => {
    try { ({ presentations: items } = await meetApi('GET', '/presentations')); } catch (e) { toast(e.message, 'error'); }
    listEl.replaceChildren(
      h('div', { class: `pres-item ${!store.meta.pres ? 'current' : ''}` }, icon('presentation', 18), h('b', { text: 'Whiteboard kosong' }),
        !store.meta.pres ? h('span', { class: 'pill', text: 'AKTIF' }) : h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await setPres({ id: null }); refresh(); } }, 'Tampilkan')),
      ...items.map(p => {
        const cur = store.meta.pres?.id === p.id;
        const dl = h('input', { type: 'checkbox', checked: !!p.downloadable, onchange: () => meetApi('PATCH', `/presentations/${p.id}`, { downloadable: dl.checked }).catch(e => toast(e.message, 'error')) });
        return h('div', { class: `pres-item ${cur ? 'current' : ''}` }, icon('file', 18), h('b', { text: p.name, title: p.name }),
          h('label', { class: 'check', style: { fontSize: '12.5px', margin: 0 }, title: 'Izinkan peserta mengunduh' }, dl, 'Unduh'),
          cur ? h('span', { class: 'pill', text: 'AKTIF' }) : h('button', { class: 'btn btn-ghost btn-sm', onclick: () => activate(p).then(refresh) }, 'Tampilkan'),
          h('button', { class: 'icon-btn', title: 'Kirim info ke chat', onclick: () => emit('chat-send', `📄 Materi "${p.name}" ${p.downloadable ? 'dapat diunduh lewat tombol unduh di bawah presentasi' : 'sedang dibagikan'}.`) }, icon('send', 16)),
          h('button', { class: 'icon-btn', title: 'Hapus', onclick: async () => { if (await confirmDialog('Hapus presentasi?', p.name, 'Hapus')) { await meetApi('DELETE', `/presentations/${p.id}`).catch(e => toast(e.message, 'error')); docs.delete(p.id); refresh(); } } }, icon('trash', 16)));
      }));
  };
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, onchange: () => input.files[0] && upload(input.files[0]) });
  const status = h('div', { style: { fontSize: '13px', color: '#4a5568', marginTop: '8px' } });
  const dz = h('div', { class: 'dropzone', tabindex: 0, onclick: () => input.click(), onkeydown: (e) => e.key === 'Enter' && input.click() },
    icon('upload', 34), h('div', { text: 'Seret file PDF ke sini untuk mengunggah' }), h('a', { href: '#', onclick: (e) => e.preventDefault(), text: 'atau pilih file' }), input);
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) upload(f); });

  async function upload(file) {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return toast('Hanya file PDF. Ekspor dokumen Word/PowerPoint ke PDF terlebih dahulu.', 'error');
    if (file.size > 30 * 1024 * 1024) return toast('Ukuran maksimal 30 MB', 'error');
    status.textContent = `Mengunggah ${file.name}…`;
    try {
      const { presentation } = await meetApi('POST', '/presentations', file, { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name) });
      status.textContent = 'Selesai. Menampilkan presentasi…';
      await activate(presentation);
      status.textContent = '';
      refresh();
    } catch (e) { status.textContent = ''; toast(e.message, 'error'); }
  }
  async function activate(p) {
    const doc = await getDoc(p.id);
    await setPres({ id: p.id, page: 1, pages: doc.numPages });
  }
  modal({ title: 'Presentasi', wide: true, body: h('div', {},
    h('p', { style: { color: '#4a5568', fontSize: '14px' }, text: 'Sebagai presenter Anda dapat mengunggah file PDF (maks. 30 MB). Dokumen Office (Word/PowerPoint) silakan disimpan sebagai PDF terlebih dahulu untuk hasil terbaik dan paling ringan.' }),
    h('b', { text: 'Presentasi tersedia' }), listEl, dz, status), actions: [{ label: 'Tutup', cls: 'btn-primary' }] });
  refresh();
}

async function downloadCurrent() {
  const p = store.meta.pres; if (!p) return;
  try {
    const data = await meetApi('GET', `/presentations/${p.id}`);
    const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), download: p.name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { toast(e.message, 'error'); }
}

export function setBlank() { setPres({ id: null }); }

// ---------- Inisialisasi ----------
let lastPresSig = ''; let lastPresId;
export function initPresentation() {
  initInput();
  $('#pg-prev').addEventListener('click', () => goto(curPage() - 1));
  $('#pg-next').addEventListener('click', () => goto(curPage() + 1));
  $('#pg-select').addEventListener('change', (e) => goto(+e.target.value));
  $('#zoom-in').addEventListener('click', () => { zoom = Math.min(4, +(zoom + 0.25).toFixed(2)); render(); });
  $('#zoom-out').addEventListener('click', () => { zoom = Math.max(1, +(zoom - 0.25).toFixed(2)); render(); });
  $('#fit-width').addEventListener('click', () => { fitWidth = !fitWidth; zoom = 1; render(); });
  $('#pres-dl').addEventListener('click', downloadCurrent);
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || !canPresent() || !store.meta.pres) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') goto(curPage() + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') goto(curPage() - 1);
  });
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(render, 120); }).observe($('#pres-scroll'));
  on('meta', () => {
    const p = store.meta.pres;
    const sig = `${p?.id}|${p?.page}|${p?.pages}|${p?.downloadable}`;
    if (p?.id !== lastPresId) { lastPresId = p?.id; localPage = null; }
    if (localPage != null && p?.page === localPage) localPage = null;
    if (sig !== lastPresSig) { lastPresSig = sig; if (localPage == null) render(); }
    updateBar();
    if (!canDraw() && tool !== 'pointer') setTool('pointer');
  });
  render();
}
