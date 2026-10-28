// QR code sebagai SVG murni (tanpa canvas/data URL, aman untuk CSP & tajam saat dicetak).
import qrcode from 'qrcode-generator';

const NS = 'http://www.w3.org/2000/svg';

/** @returns {SVGSVGElement} */
export function qrSvg(text, { margin = 2, label = 'QR code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      // gabungkan modul gelap berurutan dalam satu baris → path lebih ringkas
      let w = 1;
      while (c + w < n && qr.isDark(r, c + w)) w++;
      d += `M${c + margin} ${r + margin}h${w}v1h-${w}z`;
      c += w - 1;
    }
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d); p.setAttribute('fill', '#111');
  svg.append(bg, p);
  return svg;
}
