// Grafik SVG ringan untuk Panel Admin (tanpa pustaka): kolom berkelompok, garis, dan batang horizontal.
// Mengikuti aturan visual: batang ≤24px dengan ujung membulat 4px, garis 2px, titik ujung ≥8px bercincin,
// grid tipis, label teks memakai warna teks (bukan warna seri), legenda untuk ≥2 seri, tooltip saat hover
// & fokus keyboard, dan tampilan tabel sebagai alternatif.
import { h } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
export const SERIES = ['#2a78d6', '#eb6834'];   // urutan kategori tetap (biru, oranye) — divalidasi CVD
const C = { grid: '#e6ece9', axis: '#cfd9d4', text: '#0f1d18', muted: '#5a6b64', surface: '#ffffff' };

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
}
const fmtN = (n) => n >= 10000 ? (Math.round(n / 100) / 10) + 'K' : new Intl.NumberFormat('id-ID').format(n);
/** Batas atas sumbu Y yang "bulat" + jarak tick. */
function niceScale(max, ticks = 4) {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw) || 10 * mag;
  const st = Math.max(1, Math.ceil(step));   // data hitungan: tick bilangan bulat
  return { top: Math.ceil(max / st) * st, step: st };
}
/** Batang dengan ujung atas membulat 4px dan pangkal persegi. */
function colPath(x, y, w, hgt) {
  const r = Math.min(4, w / 2, hgt);
  if (hgt <= 0) return '';
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}
function hbarPath(x, y, w, hgt) {
  const r = Math.min(4, hgt / 2, w);
  if (w <= 0) return '';
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
}

function legend(series) {
  if (series.length < 2) return null;
  return h('div', { class: 'cv-legend' }, series.map((sr, i) => h('span', {},
    h('i', { class: sr.kind === 'line' ? 'ln' : 'sw', style: { background: SERIES[i] } }), sr.name)));
}
function tooltip(wrap) {
  const tip = h('div', { class: 'cv-tip', role: 'status', hidden: true });
  wrap.append(tip);
  return {
    show(title, rows, x, y) {
      tip.replaceChildren(h('div', { class: 'cv-tip-t', text: title }),
        ...rows.map(r => h('div', { class: 'cv-tip-r' }, h('i', { style: { background: r.color } }), h('b', { text: fmtN(r.value) }), h('span', { text: r.name }))));
      tip.hidden = false;
      const W = wrap.clientWidth; const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, x - tw / 2)) + 'px';
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
    },
    hide() { tip.hidden = true; },
  };
}
/** Tabel data (alternatif aksesibel untuk grafik). */
function dataTable(labels, series) {
  return h('div', { class: 'table-wrap cv-table' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Periode' }), series.map(sr => h('th', { text: sr.name })))),
    h('tbody', {}, labels.map((l, i) => h('tr', {}, h('td', { text: l }), series.map(sr => h('td', { class: 'num', text: fmtN(sr.values[i]) })))))));
}

/**
 * Grafik kolom (1–2 seri, berkelompok) atau garis.
 * opts: { labels[], full[] (label panjang utk tooltip), series: [{ name, values[] }], kind: 'column'|'line', height }
 */
export function timeChart(box, { labels, full = labels, series, kind = 'column', height = 240, ariaLabel = '' }) {
  const wrap = h('div', { class: 'cv-wrap' });
  const tableBtn = h('button', { class: 'btn btn-ghost btn-sm cv-tbtn', type: 'button', 'aria-pressed': 'false' }, 'Lihat tabel');
  const table = dataTable(full, series); table.hidden = true;
  tableBtn.addEventListener('click', () => { table.hidden = !table.hidden; tableBtn.textContent = table.hidden ? 'Lihat tabel' : 'Sembunyikan tabel'; tableBtn.setAttribute('aria-pressed', String(!table.hidden)); });
  box.replaceChildren(h('div', { class: 'cv-top' }, legend(series.map(sr => ({ ...sr, kind: kind === 'line' ? 'line' : 'col' }))), tableBtn), wrap, table);

  const draw = () => {
    const W = Math.max(280, wrap.clientWidth || box.clientWidth || 600);
    const m = { l: 40, r: kind === 'line' ? 34 : 10, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = height - m.t - m.b;
    const n = labels.length;
    const max = Math.max(0, ...series.flatMap(sr => sr.values));
    const { top, step } = niceScale(max);
    const Y = (v) => m.t + ph - (v / top) * ph;
    const band = pw / n;
    const X = (i) => m.l + band * i + band / 2;
    const svg = s('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': ariaLabel, class: 'cv-svg' });
    // Grid & sumbu Y
    for (let v = 0; v <= top; v += step) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: v === 0 ? C.axis : C.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
      svg.append(s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'cv-tick' }, fmtN(v)));
    }
    // Label sumbu X (sebagian saja agar tidak bertumpuk)
    const every = Math.max(1, Math.ceil(n * 46 / pw));
    for (let i = 0; i < n; i++) if ((n - 1 - i) % every === 0) svg.append(s('text', { x: X(i), y: height - 7, 'text-anchor': 'middle', class: 'cv-tick' }, labels[i]));
    // Highlight band (hover)
    const hl = s('rect', { x: 0, y: m.t, width: band, height: ph, fill: '#0f1d18', opacity: 0, 'pointer-events': 'none' });
    svg.append(hl);
    if (kind === 'column') {
      const k = series.length;
      const bw = Math.max(2, Math.min(24, (band * 0.7 - (k - 1) * 2) / k));
      const groupW = bw * k + (k - 1) * 2;
      series.forEach((sr, si) => sr.values.forEach((v, i) => {
        const x = X(i) - groupW / 2 + si * (bw + 2);
        const d = colPath(x, Y(v), bw, Y(0) - Y(v));
        if (d) svg.append(s('path', { d, fill: SERIES[si] }));
      }));
    } else {
      series.forEach((sr, si) => {
        const pts = sr.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
        svg.append(s('polyline', { points: pts, fill: 'none', stroke: SERIES[si], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        const lv = sr.values[n - 1];
        svg.append(s('circle', { cx: X(n - 1), cy: Y(lv), r: 4, fill: SERIES[si], stroke: C.surface, 'stroke-width': 2 }));
      });
      // Nilai di ujung garis (tanpa menumpuk: bila terlalu dekat, cukup legenda + tooltip)
      const ends = series.map((sr, si) => ({ y: Y(sr.values[n - 1]), v: sr.values[n - 1], si }));
      if (ends.length < 2 || Math.abs(ends[0].y - ends[1].y) > 14) for (const e of ends) svg.append(s('text', { x: X(n - 1) + 9, y: e.y + 4, class: 'cv-end' }, fmtN(e.v)));
    }
    const cross = s('line', { y1: m.t, y2: m.t + ph, stroke: C.muted, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
    if (kind === 'line') svg.append(cross);
    // Target hover/fokus per periode (lebih lebar dari batang)
    const tip = tooltip(wrap);
    for (let i = 0; i < n; i++) {
      const hit = s('rect', { x: m.l + band * i, y: m.t, width: band, height: ph, fill: 'transparent', tabindex: 0, class: 'cv-hit', 'aria-label': `${full[i]}: ${series.map(sr => `${sr.name} ${sr.values[i]}`).join(', ')}` });
      const on = () => {
        if (kind === 'line') { cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('opacity', 0.6); }
        else { hl.setAttribute('x', m.l + band * i); hl.setAttribute('opacity', 0.04); }
        const topY = Math.min(...series.map(sr => Y(sr.values[i])));
        tip.show(full[i], series.map((sr, si) => ({ name: sr.name, value: sr.values[i], color: SERIES[si] })), X(i), topY);
      };
      const off = () => { cross.setAttribute('opacity', 0); hl.setAttribute('opacity', 0); tip.hide(); };
      hit.addEventListener('pointerenter', on); hit.addEventListener('focus', on);
      hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
      svg.append(hit);
    }
    wrap.querySelector('svg')?.remove();
    wrap.prepend(svg);
  };
  draw();
  const ro = new ResizeObserver(() => { clearTimeout(ro.t); ro.t = setTimeout(draw, 120); });
  ro.observe(wrap);
}

/** Batang horizontal satu seri (mis. pengguna paling aktif). items: [{ label, sub, value, tip }] */
export function hbarChart(box, { items, unit = '', ariaLabel = '' }) {
  const wrap = h('div', { class: 'cv-wrap' });
  box.replaceChildren(wrap);
  const draw = () => {
    const W = Math.max(280, wrap.clientWidth || 600);
    const rowH = 34, barH = 18, labelW = Math.min(220, W * 0.38), valW = 80;
    const height = items.length * rowH + 6;
    const max = Math.max(1, ...items.map(it => it.value));
    const pw = W - labelW - valW;
    const svg = s('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': ariaLabel, class: 'cv-svg' });
    const tip = tooltip(wrap);
    items.forEach((it, i) => {
      const y = i * rowH + 4; const w = Math.max(it.value ? 3 : 0, (it.value / max) * pw);
      const name = it.label.length > 28 ? it.label.slice(0, 27) + '…' : it.label;
      svg.append(s('text', { x: 0, y: y + barH / 2 + 4, class: 'cv-lbl' }, `${i + 1}. ${name}`));
      const d = hbarPath(labelW, y, w, barH);
      if (d) svg.append(s('path', { d, fill: SERIES[0] }));
      svg.append(s('text', { x: labelW + w + 8, y: y + barH / 2 + 4, class: 'cv-end' }, `${fmtN(it.value)}${unit ? ' ' + unit : ''}`));
      const hit = s('rect', { x: 0, y: y - 6, width: W, height: rowH, fill: 'transparent', tabindex: 0, class: 'cv-hit', 'aria-label': `${it.label}: ${it.value} ${unit}` });
      const on = () => tip.show(it.label, [{ name: it.tip || unit, value: it.value, color: SERIES[0] }], labelW + w / 2, y);
      hit.addEventListener('pointerenter', on); hit.addEventListener('focus', on);
      hit.addEventListener('pointerleave', () => tip.hide()); hit.addEventListener('blur', () => tip.hide());
      svg.append(hit);
    });
    wrap.querySelector('svg')?.remove();
    wrap.prepend(svg);
  };
  draw();
  const ro = new ResizeObserver(() => { clearTimeout(ro.t); ro.t = setTimeout(draw, 120); });
  ro.observe(wrap);
}
