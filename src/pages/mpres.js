// Penampil presentasi (PDF) + whiteboard untuk aplikasi Android. Halaman ini dimuat di WebView aplikasi;
// koneksi LiveKit tetap di aplikasi, yang meneruskan status presentasi & anotasi ke sini lewat postMessage:
//   { t: 'init', code, seat }                       → kursi meeting untuk mengunduh PDF (header X-Seat)
//   { t: 'state', pres, page, name, shapes, pad }    → slide aktif + anotasi halaman itu
// Halaman ini tidak pernah mengirim data ke peserta lain (hanya menampilkan).
import { drawShape } from '../shared/wbdraw.js';

const $ = (s) => document.querySelector(s);
const DPR = Math.min(2, devicePixelRatio || 1);
const st = { code: '', seat: '', pres: null, page: 1, name: '', shapes: [], pad: 0 };
const docs = new Map();
let pdfjs = null; let ratio = 16 / 9; let seq = 0; let task = null;

const toApp = (m) => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(m)); } catch { /* bukan di aplikasi */ } };
const msg = (text) => { const el = $('#msg'); el.textContent = text || ''; el.hidden = !text; };

async function lib() {
  if (!pdfjs) { pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs'; }
  return pdfjs;
}
function getDoc(id) {
  if (!docs.has(id)) {
    docs.set(id, (async () => {
      const res = await fetch(`/api/meet/${encodeURIComponent(st.code)}/presentations/${encodeURIComponent(id)}`, { headers: { 'X-Seat': st.seat } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Gagal memuat (${res.status})`);
      const data = new Uint8Array(await res.arrayBuffer());
      return (await lib()).getDocument({ data, isEvalSupported: false, standardFontDataUrl: '/vendor/standard_fonts/', cMapUrl: '/vendor/cmaps/', cMapPacked: true }).promise;
    })().catch((e) => { docs.delete(id); throw e; }));
  }
  return docs.get(id);
}

function layout() {
  const pad = 8 + (st.pad || 0);
  const aw = Math.max(50, innerWidth - 16), ah = Math.max(50, innerHeight - pad * 2);
  const w = Math.min(aw, ah * ratio), hh = w / ratio;
  const pg = $('#page'); pg.style.width = w + 'px'; pg.style.height = hh + 'px';
  for (const c of [$('#pdf'), $('#wb')]) { c.width = Math.round(w * DPR); c.height = Math.round(hh * DPR); }
  return { w, h: hh };
}
function drawWb() {
  const c = $('#wb'); const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  for (const s of st.shapes) { try { drawShape(ctx, s, c.width, c.height, DPR); } catch { /* bentuk rusak diabaikan */ } }
}

async function render() {
  const my = ++seq;
  try { task?.cancel(); } catch { /* abaikan */ }
  const c = $('#pdf');
  if (!st.pres) {
    ratio = 16 / 9;
    const { w, h: hh } = layout();
    const ctx = c.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = '#c7d2e0'; ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(hh * 0.06)}px system-ui, sans-serif`; ctx.fillText(st.name || 'Whiteboard', w / 2, hh * (st.name ? 0.48 : 0.52));
    if (st.name) { ctx.font = `400 ${Math.round(hh * 0.04)}px system-ui, sans-serif`; ctx.fillText('Whiteboard', w / 2, hh * 0.58); }
    drawWb(); msg('');
    return;
  }
  if (!st.seat) return;
  try {
    const doc = await getDoc(st.pres.id);
    if (my !== seq) return;
    const n = Math.min(Math.max(1, st.page || 1), doc.numPages);
    const page = await doc.getPage(n);
    if (my !== seq) return;
    const vp1 = page.getViewport({ scale: 1 });
    ratio = vp1.width / vp1.height;
    const { w } = layout();
    drawWb();
    const ctx = c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0);
    task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: (w * DPR) / vp1.width }) });
    await task.promise;
    msg(''); toApp({ t: 'rendered', pages: doc.numPages });
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    msg('Gagal memuat presentasi: ' + e.message); toApp({ t: 'error', message: e.message });
  }
}

let lastSig = '';
function onMessage(ev) {
  let m; try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'init') { st.code = String(m.code || ''); st.seat = String(m.seat || ''); lastSig = ''; }
  if (m.t === 'state' || m.t === 'init') {
    if ('pres' in m) st.pres = m.pres && typeof m.pres.id === 'string' ? m.pres : null;
    if ('page' in m) st.page = +m.page || 1;
    if ('name' in m) st.name = String(m.name || '');
    if ('pad' in m) st.pad = Math.max(0, +m.pad || 0);
    if (Array.isArray(m.shapes)) st.shapes = m.shapes.slice(0, 3000);
    const sig = `${st.pres?.id}|${st.page}|${st.name}|${st.pad}|${st.seat}`;
    if (sig !== lastSig) { lastSig = sig; render(); } else drawWb();
  }
}
addEventListener('message', onMessage);
document.addEventListener('message', onMessage); // WebView Android mengirim lewat document
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
render();
toApp({ t: 'ready' });
