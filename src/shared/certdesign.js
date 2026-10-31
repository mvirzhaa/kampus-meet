// Desain sertifikat: template dasar + tata letak elemen yang bisa diatur penyelenggara.
// Dipakai halaman sertifikat (tampil & cetak) dan editor di form event, jadi hasil pratinjau = hasil akhir.
// Koordinat dalam persen bidang sertifikat (x = titik tengah elemen, y = titik tengah), ukuran huruf dalam
// persen lebar sertifikat (satuan cqw), sehingga tata letak tetap sama di layar mana pun dan saat dicetak A4.
import { h } from './common.js';

export const CERT_TEMPLATES = {
  klasik: { name: 'Klasik', desc: 'Bingkai emerald ganda', accent: '#047857', ink: '#0b1f18', soft: '#4b5f58', head: '#064e3b' },
  modern: { name: 'Modern', desc: 'Pita hijau di sisi kiri', accent: '#047857', ink: '#0b1f18', soft: '#4b5f58', head: '#064e3b' },
  elegan: { name: 'Elegan', desc: 'Krem dengan bingkai emas', accent: '#8a6a1f', ink: '#2b2116', soft: '#5f5444', head: '#6b4f12', serif: true },
  minimal: { name: 'Minimal', desc: 'Putih bersih, garis tipis', accent: '#047857', ink: '#111111', soft: '#555555', head: '#111111' },
  gambar: { name: 'Gambar sendiri', desc: 'Unggah desain latar (A4 mendatar)', accent: '#047857', ink: '#111111', soft: '#333333', head: '#111111' },
};

/** Elemen sertifikat. kind menentukan cara gambar; text = boleh diubah isinya (dengan placeholder). */
export const CERT_ELEMENTS = [
  { id: 'brand', label: 'Logo & nama kampus', kind: 'brand' },
  { id: 'heading', label: 'Judul ("SERTIFIKAT")', kind: 'text', text: true },
  { id: 'label', label: 'Keterangan ("Diberikan kepada")', kind: 'text', text: true },
  { id: 'name', label: 'Nama peserta', kind: 'name' },
  { id: 'text1', label: 'Kalimat sebelum judul event', kind: 'text', text: true },
  { id: 'title', label: 'Judul event', kind: 'title' },
  { id: 'text2', label: 'Kalimat tanggal & narasumber', kind: 'text', text: true },
  { id: 'qr', label: 'QR code verifikasi', kind: 'qr' },
  { id: 'signer', label: 'Nama penanda tangan', kind: 'signer' },
  { id: 'signerTitle', label: 'Jabatan penanda tangan', kind: 'plain' },
  { id: 'verify', label: 'Kode verifikasi', kind: 'verify' },
  { id: 'spTL', label: 'Logo sponsor kiri atas', kind: 'sponsors', pos: 'tl' },
  { id: 'spTR', label: 'Logo sponsor kanan atas', kind: 'sponsors', pos: 'tr' },
  { id: 'spBR', label: 'Logo sponsor "Didukung oleh"', kind: 'sponsors', pos: 'br' },
];
export const DEFAULT_TEXTS = {
  heading: 'SERTIFIKAT',
  label: 'Diberikan kepada',
  text1: 'atas partisipasinya sebagai peserta {kategori}',
  text2: 'yang diselenggarakan secara daring pada {tanggal} dengan narasumber {narasumber}.',
};
export const PLACEHOLDER_HELP = '{kategori}, {tanggal}, {narasumber}, {judul}, {durasi}';

/** Tata letak bawaan per template. */
export function defaultLayout(template) {
  const t = CERT_TEMPLATES[template] || CERT_TEMPLATES.klasik;
  const cx = template === 'modern' ? 59 : 50; // template modern: isi bergeser ke kanan karena pita di kiri
  const L = {
    brand: { x: cx, y: 17, w: 70, fs: 1.75, align: 'center', color: t.accent },
    heading: { x: cx, y: 26, w: 80, fs: 5.2, align: 'center', color: t.head },
    label: { x: cx, y: 33.5, w: 60, fs: 1.3, align: 'center', color: t.soft },
    name: { x: cx, y: 42, w: 70, fs: 4.2, align: 'center', color: t.ink },
    text1: { x: cx, y: 50.5, w: 78, fs: 1.6, align: 'center', color: t.soft },
    title: { x: cx, y: 57, w: 80, fs: 2.3, align: 'center', color: t.accent },
    text2: { x: cx, y: 64.5, w: 78, fs: 1.55, align: 'center', color: t.soft },
    qr: { x: cx, y: 75.5, w: 9, fs: 1, align: 'center' },
    signer: { x: cx, y: 85.2, w: 28, fs: 1.35, align: 'center', color: t.ink },
    signerTitle: { x: cx, y: 89.2, w: 32, fs: 1.15, align: 'center', color: t.soft },
    verify: { x: template === 'modern' ? 36 : 18, y: 85.5, w: 22, fs: 1.1, align: 'left', color: t.soft },
    spTL: { x: template === 'modern' ? 33 : 15, y: 10.5, w: 26, fs: 3.8, align: 'left' },
    spTR: { x: 85, y: 10.5, w: 26, fs: 3.8, align: 'right' },
    spBR: { x: 84, y: 85.5, w: 24, fs: 2.9, align: 'right', color: t.soft },
  };
  if (template === 'elegan') { L.heading.fs = 5.6; L.name.fs = 4.6; }
  return L;
}

/** Gabungkan tata letak bawaan template dengan perubahan penyelenggara (hanya yang diubah yang disimpan). */
export function resolveLayout(design) {
  const tpl = CERT_TEMPLATES[design?.template] ? design.template : 'klasik';
  const base = defaultLayout(tpl);
  const out = {};
  for (const el of CERT_ELEMENTS) out[el.id] = { ...base[el.id], ...(design?.els?.[el.id] || {}) };
  return { template: tpl, els: out };
}

function fillText(tpl, data) {
  let s = String(tpl || '');
  if (!data.speaker) s = s.replace(/\s*(dengan|bersama)\s+narasumber\s+\{narasumber\}/gi, '').replace(/\{narasumber\}/g, '');
  return s.replace(/\{kategori\}/g, (data.category || '').toLowerCase()).replace(/\{tanggal\}/g, data.dateText || '')
    .replace(/\{narasumber\}/g, data.speaker || '').replace(/\{judul\}/g, data.title || '').replace(/\{durasi\}/g, data.durationText || '');
}

/**
 * Gambar sertifikat ke dalam `root`.
 * @param {HTMLElement} root   wadah .cd (dibuat ulang isinya)
 * @param {object} design      { template, els } dari server (boleh null → bawaan)
 * @param {object} data        { name, title, category, speaker, dateText, signerName, signerTitle, code, verifyUrl, app, campus, sponsors[] }
 * @param {object} opt         { bgUrl, logoMark(size), qrSvg(text), editable, selected }
 */
export function renderCertDesign(root, design, data, opt = {}) {
  const { template, els } = resolveLayout(design);
  const tpl = CERT_TEMPLATES[template];
  root.className = `cd tpl-${template}${opt.editable ? ' editing' : ''}${tpl.serif ? ' serif' : ''}`;
  const bg = template === 'gambar' && opt.bgUrl ? h('img', { class: 'cd-bg', src: opt.bgUrl, alt: '' }) : null;
  const deco = h('div', { class: 'cd-deco', 'aria-hidden': 'true' });
  const nodes = [bg, deco];
  const sponsors = (pos) => (data.sponsors || []).filter(s => s.position === pos);
  for (const def of CERT_ELEMENTS) {
    const L = els[def.id];
    if (L.hidden && !opt.editable) continue;
    let content;
    switch (def.kind) {
      case 'brand': content = [opt.logoMark ? opt.logoMark() : null, h('span', { text: `${data.app} · ${data.campus}` })]; break;
      case 'text': content = [fillText(L.text ?? DEFAULT_TEXTS[def.id], data)]; break;
      case 'name': content = [data.name]; break;
      case 'title': content = [`“${data.title}”`]; break;
      case 'qr': { const q = h('div', { class: 'cd-qr' }); if (opt.qrSvg) q.append(opt.qrSvg(data.verifyUrl)); content = [q]; break; }
      case 'signer': content = [data.signerName]; break;
      case 'plain': content = [data.signerTitle]; break;
      case 'verify': content = [h('div', { text: 'Kode verifikasi:' }), h('b', { text: data.code }), h('div', { class: 'cd-url', text: String(data.verifyUrl || '').replace(/^https?:\/\//, '') })]; break;
      case 'sponsors': {
        const list = sponsors(def.pos);
        if (!list.length && !opt.editable) continue;
        const logos = list.length ? list.map(s => h('img', { src: s.url, alt: s.name || 'Logo sponsor' }))
          : [h('span', { class: 'cd-ph', text: 'Logo sponsor' })];
        content = def.pos === 'br' ? [h('small', { text: 'Didukung oleh' }), h('div', { class: 'cd-logos' }, logos)] : [h('div', { class: 'cd-logos' }, logos)];
        break;
      }
    }
    const style = {
      left: L.x + '%', top: L.y + '%', width: L.w + '%', textAlign: L.align, color: L.color || '',
    };
    const el = h('div', { class: `cd-el cd-${def.kind} cd-${def.id} cd-a-${L.align}${L.hidden ? ' is-hidden' : ''}${opt.selected === def.id ? ' selected' : ''}`, dataset: { id: def.id }, style }, ...content);
    el.style.setProperty('--fs', String(L.fs));
    if (def.kind === 'qr') el.style.aspectRatio = '1';
    nodes.push(el);
  }
  root.replaceChildren(...nodes.filter(Boolean));
  return root;
}
