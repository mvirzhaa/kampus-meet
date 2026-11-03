// Poster event 1080×1350 (rasio 4:5: pas untuk Instagram, Facebook, WhatsApp), digambar langsung di <canvas>
// sehingga pratinjau di editor = file PNG yang diunduh/dibagikan, piksel demi piksel.
// Data: isian event + rancangan poster (tema warna, label seri, narasumber & foto, benefit, kontak, logo sponsor).
import qrcode from 'qrcode-generator';
import { icon } from './common.js';

export const POSTER_W = 1080, POSTER_H = 1350;
const PAD = 64;
const FONT = '"Plus Jakarta Sans", "Segoe UI", Roboto, Arial, sans-serif';

// ---------- Warna ----------
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = parseInt(m ? m[1] : '047857', 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
export const palette = (c) => ({ base: c, light: mix(c, '#ffffff', 0.28), dark: mix(c, '#000000', 0.45), darker: mix(c, '#000000', 0.68), soft: mix(c, '#ffffff', 0.9) });

// ---------- Aset (gambar, ikon) dengan cache ----------
const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise(res => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return imgCache.get(src);
}
function iconImg(name, color) {
  const svg = icon(name, 48); svg.setAttribute('color', color); svg.setAttribute('stroke', color);
  return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)));
}
async function fontsReady() {
  try { await Promise.all(['500', '600', '700', '800'].map(w => document.fonts.load(`${w} 40px "Plus Jakarta Sans"`))); await document.fonts.ready; } catch { /* abaikan */ }
}

// ---------- Utilitas gambar ----------
function rr(ctx, x, y, w, h, r) {
  const R = typeof r === 'number' ? [r, r, r, r] : r; // [kiri-atas, kanan-atas, kanan-bawah, kiri-bawah]
  const m = Math.min(w, h) / 2; const [a, b, c, d] = R.map(v => Math.min(v, m));
  ctx.beginPath(); ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
  ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h); ctx.lineTo(x + d, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - d); ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y); ctx.closePath();
}
const font = (ctx, size, weight = 700, italic = false) => { ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`; };
/** Pecah teks menjadi baris selebar maxW; maxLines → baris terakhir diberi elipsis. */
function wrap(ctx, text, maxW, maxLines = 99) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) {
      if (!cur && ctx.measureText(w).width > maxW) { // kata sangat panjang (mis. URL): potong per karakter
        let part = '';
        for (const ch of w) { if (ctx.measureText(part + ch).width > maxW && part) { lines.push(part); part = ''; } part += ch; }
        cur = part; continue;
      }
      cur = t;
    } else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1];
    while (last.length && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    keep[maxLines - 1] = last.replace(/[\s,.;:–-]+$/, '') + '…';
    return keep;
  }
  return lines;
}
function drawLines(ctx, lines, x, y, lh, align = 'left') {
  ctx.textAlign = align; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return lines.length * lh;
}
function grad(ctx, x, y, w, c) { const g = ctx.createLinearGradient(x, y, x + w, y); g.addColorStop(0, c.light); g.addColorStop(1, c.darker); return g; }
/** Pil judul bagian: isi gradasi + garis putih. */
function pill(ctx, x, y, w, h, text, c, size = 31) {
  rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = grad(ctx, x, y, w, c); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
  font(ctx, size, 800); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 30, y + h / 2 + 1);
}
function card(ctx, x, y, w, h, r = 26) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.16)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  rr(ctx, x, y, w, h, r); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
}
async function iconBox(ctx, x, y, s, name, c) {
  rr(ctx, x, y, s, s, s * 0.31); const g = ctx.createLinearGradient(x, y, x + s, y + s); g.addColorStop(0, c.light); g.addColorStop(1, c.darker); ctx.fillStyle = g; ctx.fill();
  const im = await iconImg(name, '#ffffff'); if (im) ctx.drawImage(im, x + s * 0.24, y + s * 0.24, s * 0.52, s * 0.52);
}
/** Gambar foto mengisi kotak (object-fit: cover, fokus atas). */
function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height); const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, 0, sw, sh, x, y, w, h);
}
function contain(img, maxW, maxH) { const s = Math.min(maxW / img.width, maxH / img.height); return [img.width * s, img.height * s]; }
const initials = (n) => String(n || '?').replace(/^(Dr|Prof|Ir|Drs|Dra|H|Hj)\.?\s+/i, '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const BENEFIT_ICONS = [[/sertifikat|certificate/i, 'award'], [/materi|modul|slide/i, 'book'], [/wawasan|pengetahuan|ilmu|insight/i, 'sparkles'], [/tanya|diskusi|question/i, 'message-circle'], [/doorprize|hadiah|prize/i, 'smile'], [/rekam|video/i, 'video']];
const benefitIcon = (t) => (BENEFIT_ICONS.find(([re]) => re.test(t)) || [null, 'circle-check'])[1];

/** Gambar poster ke canvas 1080×1350. */
export async function drawPoster(canvas, d) {
  const { event: e, poster: p, app } = d;
  canvas.width = POSTER_W; canvas.height = POSTER_H;
  const ctx = canvas.getContext('2d');
  const c = palette(p.color || '#047857');
  const W = POSTER_W, H = POSTER_H, CW = W - PAD * 2;
  await fontsReady();
  const all = e.sponsors || [];
  const topSp = [...all.filter(s => s.position === 'tl'), ...all.filter(s => s.position === 'tr')].slice(0, 6);
  const supSp = all.filter(s => s.position === 'br').slice(0, 8);
  const speakers = (p.speakers || []).slice(0, 4);
  const [mark, topImgs, supImgs, photos] = await Promise.all([
    loadImg('/img/uika-meet-mark.svg'), Promise.all(topSp.map(s => loadImg(s.url))), Promise.all(supSp.map(s => loadImg(s.url))),
    Promise.all(speakers.map(s => loadImg(s.photoUrl)))]);

  // Latar
  const bg = ctx.createRadialGradient(W * 0.78, H * 0.1, 0, W * 0.78, H * 0.1, H * 1.15);
  bg.addColorStop(0, c.light); bg.addColorStop(0.38, c.base); bg.addColorStop(0.78, c.dark); bg.addColorStop(1, c.darker);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.arc(W + 80, 120, 380, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.045)'; ctx.beginPath(); ctx.arc(-40, H - 380, 260, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,61,.16)'; ctx.lineWidth = 24; ctx.beginPath(); ctx.arc(W - 150, 610, 80, 0, Math.PI * 2); ctx.stroke();

  // 1) Bar logo: UIKA Meet + logo sponsor kiri/kanan atas
  {
    const many = topImgs.filter(Boolean).length > 3;
    const lh = many ? 50 : 60, lmax = many ? 130 : 170, gap = many ? 22 : 30;
    font(ctx, many ? 27 : 30, 800); const nameW = ctx.measureText(app.name).width;
    font(ctx, 16, 600); const campusW = ctx.measureText(app.campus).width;
    const brandW = 62 + 14 + Math.max(nameW, campusW);
    const logos = topImgs.map(im => (im ? contain(im, lmax, lh) : null));
    let inner = brandW + logos.reduce((s, l) => s + (l ? l[0] + gap : 0), 0);
    const scale = Math.min(1, (CW - 60) / inner);
    const bw = inner * scale + 60, bh = 90, bx = (W - bw) / 2, by = 40;
    card(ctx, bx, by, bw, bh, bh / 2);
    ctx.save(); ctx.translate(bx + 30, by + bh / 2); ctx.scale(scale, scale);
    if (mark) ctx.drawImage(mark, 0, -31, 62, 62);
    font(ctx, many ? 27 : 30, 800); ctx.fillStyle = c.dark; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText(app.name, 76, 2);
    font(ctx, 16, 600); ctx.fillStyle = '#4b5f58'; ctx.fillText(app.campus, 76, 24);
    let x = brandW + gap;
    topImgs.forEach((im, i) => { if (!im) return; const [w, h] = logos[i]; ctx.drawImage(im, x, -h / 2, w, h); x += w + gap; });
    ctx.restore();
  }
  let y = 166;

  // 2) Label seri, judul, ringkasan
  if (p.series) {
    font(ctx, 40, 800); const tw = Math.min(ctx.measureText(p.series).width, CW - 80);
    pill(ctx, PAD, y, tw + 68, 74, p.series, c, 40); y += 74 + 24;
  }
  const title = p.headline || e.title;
  let ts = 66, tl;
  for (ts of [66, 60, 54, 48, 44, 40]) { font(ctx, ts, 800); tl = wrap(ctx, title, CW); if (tl.length <= 3) break; }
  font(ctx, ts, 800); ctx.fillStyle = '#fff';
  tl = wrap(ctx, title, CW, ts <= 40 ? 4 : 3);
  y += drawLines(ctx, tl, PAD, y, Math.round(ts * 1.1)) + 16;
  if (p.summary) {
    font(ctx, 24, 500); ctx.fillStyle = 'rgba(255,255,255,.92)';
    y += drawLines(ctx, wrap(ctx, p.summary, CW, tl.length >= 3 ? 3 : 4), PAD, y, 33);
  }
  y += 30;

  // Hitung susunan dari bawah: footer → "Didukung oleh" → detail
  const f = p.footer || {};
  const foot = [[f.email, 'mail'], [f.website, 'globe'], [f.whatsapp, 'phone'], [f.instagram, 'image']].filter(([v]) => v);
  let bottomY = H - 40;
  const footH = foot.length ? 58 : 0; if (footH) bottomY -= footH + 16;
  const supLogos = supImgs.map(im => (im ? contain(im, 150, 48) : null));
  const supH = supLogos.some(Boolean) ? 72 : 0; if (supH) bottomY -= supH + 18;
  const hasLink = !!p.link?.url;
  const sideH = (hasLink ? 104 + 14 : 0) + 140;
  const detH = 60 + 14 + 150;
  const blockH = Math.max(sideH, detH);
  const blockY = bottomY - blockH;
  const midY = y;
  // Kolom kiri (benefit) berakhir di atas "Detail Kegiatan", kolom kanan (narasumber) di atas kartu tautan/QR
  const leftH = blockY + (blockH - detH) - 30 - midY, rightH = blockY + (blockH - sideH) - 30 - midY;

  // 3) Benefit (kiri) & narasumber (kanan)
  const benefits = (p.benefits || []).slice(0, 6);
  const both = benefits.length && speakers.length;
  const colW = both ? (CW - 34) / 2 : CW;
  if (benefits.length) {
    pill(ctx, PAD, midY, colW, 60, 'Benefit Peserta', c);
    const avail = (both ? leftH : Math.min(leftH, rightH)) - 60 - 14;
    let n = benefits.length, ih = 76, gap = 12;
    while (n > 1 && n * ih + (n - 1) * gap > avail) { if (ih > 52) { ih -= 4; gap = ih < 64 ? 8 : 12; } else n--; }
    const bs = ih < 60 ? 21 : 24;
    for (let i = 0; i < n; i++) {
      const by = midY + 74 + i * (ih + gap);
      card(ctx, PAD, by, colW, ih, 26);
      const isz = Math.min(58, ih - 12); await iconBox(ctx, PAD + 9, by + (ih - isz) / 2, isz, benefitIcon(benefits[i]), c);
      font(ctx, bs, 800); ctx.fillStyle = '#0b1f18';
      const bl = wrap(ctx, benefits[i], colW - 100, ih < 64 ? 1 : 2);
      drawLines(ctx, bl, PAD + 84, by + ih / 2 - (bl.length * (bs + 4)) / 2 + 1, bs + 4);
    }
  }
  if (speakers.length) {
    const sx = benefits.length ? PAD + colW + 34 : PAD, sw = colW;
    if (speakers.length === 1) {
      const s = speakers[0], ph = photos[0];
      const sh = Math.min(benefits.length ? rightH : Math.min(leftH, rightH), 450);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
      rr(ctx, sx, midY, sw, sh, 30); const cg = ctx.createLinearGradient(sx, midY, sx, midY + sh); cg.addColorStop(0, '#ffffff'); cg.addColorStop(1, '#eef4f1'); ctx.fillStyle = cg; ctx.fill(); ctx.restore();
      ctx.save(); rr(ctx, sx, midY, sw, sh, 30); ctx.clip();
      const pw = sw * 0.56, px = sx + sw - pw;
      if (ph) cover(ctx, ph, px, midY, pw, sh);
      else { const g = ctx.createLinearGradient(px, midY, px + pw, midY + sh); g.addColorStop(0, c.light); g.addColorStop(1, c.dark); ctx.fillStyle = g; ctx.fillRect(px, midY, pw, sh); font(ctx, 110, 800); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(s.name), px + pw / 2, midY + sh * 0.42); }
      // Bayangan lembut di kiri foto agar nama tetap terbaca
      const fade = ctx.createLinearGradient(px, 0, px + 120, 0); fade.addColorStop(0, 'rgba(255,255,255,.95)'); fade.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = fade; ctx.fillRect(px, midY, 120, sh);
      ctx.restore();
      font(ctx, 19, 700); ctx.fillStyle = c.base; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.save(); ctx.translate(0, 0); ctx.fillText('NARASUMBER', sx + 30, midY + 32); ctx.restore();
      const ns = s.name.length <= 22 ? 50 : s.name.length <= 34 ? 42 : 36;
      font(ctx, ns, 800); ctx.fillStyle = '#0b1f18';
      ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 14;
      drawLines(ctx, wrap(ctx, s.name, sw * 0.62, 4), sx + 30, midY + 66, Math.round(ns * 1.06));
      ctx.restore();
      if (s.title) {
        const rh = 66, ry = midY + sh - rh - 24, rw = sw - 40;
        rr(ctx, sx - 4, ry, rw, rh, [0, rh / 2, rh / 2, 0]); ctx.fillStyle = grad(ctx, sx, ry, rw, c); ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
        font(ctx, 25, 600, true); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(wrap(ctx, s.title, rw - 40, 1)[0], sx - 4 + rw / 2, ry + rh / 2 + 1);
      }
    } else {
      pill(ctx, sx, midY, sw, 60, 'Narasumber', c);
      const top = midY + 74, avail = (benefits.length ? rightH : Math.min(leftH, rightH)) - 74;
      if (speakers.length === 2) {
        const chh = Math.min(170, (avail - 14) / 2);
        for (let i = 0; i < 2; i++) {
          const s = speakers[i], cy = top + i * (chh + 14);
          card(ctx, sx, cy, sw, chh, 24);
          const ps = chh - 24;
          ctx.save(); rr(ctx, sx + 12, cy + 12, ps * 0.85, ps, 18); ctx.clip();
          if (photos[i]) cover(ctx, photos[i], sx + 12, cy + 12, ps * 0.85, ps); else { ctx.fillStyle = c.base; ctx.fillRect(sx + 12, cy + 12, ps * 0.85, ps); font(ctx, 44, 800); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(s.name), sx + 12 + ps * 0.425, cy + 12 + ps / 2); }
          ctx.restore();
          const tx = sx + 12 + ps * 0.85 + 18, tw = sw - (tx - sx) - 16;
          font(ctx, 25, 800); ctx.fillStyle = '#0b1f18';
          const nl = wrap(ctx, s.name, tw, 3); const tl2 = s.title ? (font(ctx, 19, 600), wrap(ctx, s.title, tw, 2)) : [];
          const th = nl.length * 30 + (tl2.length ? 6 + tl2.length * 24 : 0); let ty = cy + chh / 2 - th / 2;
          font(ctx, 25, 800); ctx.fillStyle = '#0b1f18'; ty += drawLines(ctx, nl, tx, ty, 30);
          if (tl2.length) { font(ctx, 19, 600); ctx.fillStyle = c.dark; drawLines(ctx, tl2, tx, ty + 6, 24); }
        }
      } else {
        const cw2 = (sw - 14) / 2, ch2 = Math.min(250, (avail - 14) / 2);
        for (let i = 0; i < speakers.length; i++) {
          const s = speakers[i], cx = sx + (i % 2) * (cw2 + 14), cy = top + Math.floor(i / 2) * (ch2 + 14);
          card(ctx, cx, cy, cw2, ch2, 22);
          const ps = Math.min(108, ch2 - 110);
          ctx.save(); rr(ctx, cx + cw2 / 2 - ps / 2, cy + 14, ps, ps, 20); ctx.clip();
          if (photos[i]) cover(ctx, photos[i], cx + cw2 / 2 - ps / 2, cy + 14, ps, ps); else { ctx.fillStyle = c.base; ctx.fillRect(cx + cw2 / 2 - ps / 2, cy + 14, ps, ps); font(ctx, 38, 800); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(s.name), cx + cw2 / 2, cy + 14 + ps / 2); }
          ctx.restore();
          font(ctx, 21, 800); ctx.fillStyle = '#0b1f18';
          const nl = wrap(ctx, s.name, cw2 - 24, 2); let ty = cy + 14 + ps + 10;
          ty += drawLines(ctx, nl, cx + cw2 / 2, ty, 25, 'center');
          if (s.title) { font(ctx, 17, 600); ctx.fillStyle = c.dark; drawLines(ctx, wrap(ctx, s.title, cw2 - 24, 2), cx + cw2 / 2, ty + 2, 21, 'center'); }
        }
      }
    }
  }

  // 4) Detail kegiatan (kiri bawah) + tautan & QR (kanan bawah)
  const dw = (CW - 28) * 0.535, rx = PAD + dw + 28, rw = CW - dw - 28;
  {
    const dy = blockY + (blockH - detH);
    pill(ctx, PAD, dy, dw, 60, 'Detail Kegiatan', c);
    const cy = dy + 74, ch = 150;
    card(ctx, PAD, cy, dw, ch, 26);
    const rows = [['calendar', e.dateText, e.timeText], ['video', 'Media Online', p.platform || `Melalui ${app.name}`]];
    for (let i = 0; i < rows.length; i++) {
      const [ic, a, b] = rows[i]; const ry0 = cy + 12 + i * 64;
      await iconBox(ctx, PAD + 14, ry0 + 4, 52, ic, c);
      const tx = PAD + 82, tw = dw - 96;
      font(ctx, 22, 800); ctx.fillStyle = '#0b1f18'; drawLines(ctx, wrap(ctx, a, tw, 1), tx, ry0 + 4, 26);
      font(ctx, 18, 500); ctx.fillStyle = '#3e524b'; drawLines(ctx, wrap(ctx, b, tw, 1), tx, ry0 + 32, 22);
    }
  }
  {
    let ry = blockY + (blockH - sideH);
    if (hasLink) {
      card(ctx, rx, ry, rw, 104, 26);
      await iconBox(ctx, rx + 12, ry + 23, 58, 'link', c);
      const tx = rx + 84, tw = rw - 96;
      font(ctx, 15, 700); ctx.fillStyle = c.base; drawLines(ctx, [(p.link.label || 'Tautan').toUpperCase()], tx, ry + 18, 18);
      font(ctx, 20, 800); ctx.fillStyle = '#0b1f18'; drawLines(ctx, wrap(ctx, p.link.url.replace(/^https?:\/\//, ''), tw, 2), tx, ry + 40, 24);
      ry += 104 + 14;
    }
    card(ctx, rx, ry, rw, 140, 26);
    let tx = rx + 18;
    if (p.showQr && d.shareUrl) {
      const qr = qrcode(0, 'M'); qr.addData(d.shareUrl); qr.make();
      const n = qr.getModuleCount(), qs = 112, cell = qs / n, qx = rx + 14, qy = ry + 14;
      ctx.fillStyle = '#fff'; ctx.fillRect(qx, qy, qs, qs); ctx.fillStyle = '#0b1f18';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) ctx.fillRect(qx + k * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
      tx = qx + qs + 16;
    } else { await iconBox(ctx, rx + 14, ry + 41, 58, 'log-in', c); tx = rx + 86; }
    const tw = rx + rw - 14 - tx;
    font(ctx, 15, 700); ctx.fillStyle = c.base; drawLines(ctx, ['DAFTAR & GABUNG'], tx, ry + 18, 18);
    font(ctx, 20, 800); ctx.fillStyle = '#0b1f18';
    const ul = wrap(ctx, String(d.shareUrl || '').replace(/^https?:\/\//, ''), tw, 2);
    const uh = drawLines(ctx, ul, tx, ry + 40, 24);
    if (p.contact?.phone || p.contact?.name) {
      font(ctx, 17, 700); ctx.fillStyle = c.dark;
      drawLines(ctx, wrap(ctx, `☎ ${[p.contact.name, p.contact.phone].filter(Boolean).join(' · ')}`, tw, 1), tx, ry + 46 + uh, 20);
    }
  }

  // 5) "Didukung oleh" (logo sponsor kanan bawah)
  if (supH) {
    font(ctx, 16, 700); const lw = ctx.measureText('DIDUKUNG OLEH').width + 4;
    const gap = 22; let inner = lw + supLogos.reduce((s, l) => s + (l ? l[0] + gap : 0), 0);
    const sc = Math.min(1, (CW - 52) / inner); const bw = inner * sc + 52, bx = (W - bw) / 2, by = bottomY + 18;
    card(ctx, bx, by, bw, supH, 22);
    ctx.save(); ctx.translate(bx + 26, by + supH / 2); ctx.scale(sc, sc);
    font(ctx, 16, 700); ctx.fillStyle = '#5b6f68'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('DIDUKUNG OLEH', 0, 1);
    let x = lw + gap; supImgs.forEach((im, i) => { if (!im) return; const [w, h] = supLogos[i]; ctx.drawImage(im, x, -h / 2, w, h); x += w + gap; });
    ctx.restore();
  }

  // 6) Footer kontak
  if (footH) {
    font(ctx, 20, 600);
    const items = foot.map(([v, ic]) => ({ v, ic, w: 30 + ctx.measureText(v).width }));
    const gap = 30; const inner = items.reduce((s, it) => s + it.w, 0) + gap * (items.length - 1);
    const sc = Math.min(1, (CW - 68) / inner); const bw = inner * sc + 68, bx = (W - bw) / 2, by = H - 40 - footH;
    card(ctx, bx, by, bw, footH, footH / 2);
    const icons = await Promise.all(items.map(it => iconImg(it.ic, c.base)));
    ctx.save(); ctx.translate(bx + 34, by + footH / 2); ctx.scale(sc, sc);
    let x = 0;
    items.forEach((it, i) => {
      if (icons[i]) ctx.drawImage(icons[i], x, -11, 22, 22);
      font(ctx, 20, 600); ctx.fillStyle = '#0b1f18'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(it.v, x + 30, 1);
      x += it.w + gap;
    });
    ctx.restore();
  }
  return canvas;
}

/** Tampilkan poster di elemen (canvas responsif selebar wadah). */
let seq = 0;
export async function renderPoster(root, d) {
  const my = ++seq;
  const cv = document.createElement('canvas');
  cv.className = 'pst-canvas'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `Poster ${d.event.title}`);
  await drawPoster(cv, d);
  if (my !== seq && root.firstChild) return root.firstChild;     // sudah ada render yang lebih baru
  root.replaceChildren(cv);
  return cv;
}

/** PNG (Blob) 1080×1350. */
export async function posterToBlob(d, type = 'image/png') {
  const cv = document.createElement('canvas');
  await drawPoster(cv, d);
  return new Promise(res => cv.toBlob(res, type, 0.92));
}

// ---------- Berbagi ----------
export const shareLinks = (d) => ({
  whatsapp: `https://wa.me/?text=${encodeURIComponent(d.caption)}`,
  facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(d.shareUrl)}`,
  instagram: 'https://www.instagram.com/',
});
/** Bagikan gambar + keterangan lewat menu berbagi perangkat (HP: WhatsApp/Instagram/Facebook menerima gambar). */
export async function nativeShare(blob, d) {
  const file = new File([blob], `Poster-${d.event.slug}.png`, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: d.caption, title: d.event.title }); return true; }
  return false;
}
