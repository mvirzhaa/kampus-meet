// Ubah satu atau beberapa sertifikat (elemen .cert di halaman) menjadi file PDF A4 mendatar yang langsung terunduh.
// Dipakai halaman sertifikat (tombol "Unduh PDF", juga dari aplikasi Android lewat ?unduh=1) dan cetak massal.
import { saveBlob } from './export.js';

/** Tunggu gambar (logo sponsor, latar) & huruf selesai dimuat agar tidak hilang di PDF. */
async function ready(el) {
  try { await document.fonts.ready; } catch { /* abaikan */ }
  await Promise.all([...el.querySelectorAll('img')].map(img => (img.complete ? null : new Promise(res => { img.onload = img.onerror = res; }))));
}

/**
 * @param {HTMLElement[]} els  elemen sertifikat (masing-masing satu halaman)
 * @param {string} fileName    nama file .pdf
 * @param {(i:number, n:number) => void} [onProgress]
 */
export async function certsToPdf(els, fileName, onProgress) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, H = 210;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    onProgress?.(i, els.length);
    await ready(el);
    // ±2400 px lebar → tajam saat dicetak, ukuran file tetap wajar
    const scale = Math.min(4, Math.max(1.5, 2400 / Math.max(1, el.offsetWidth)));
    const canvas = await html2canvas(el, { scale, useCORS: true, backgroundColor: '#ffffff', logging: false });
    if (i) pdf.addPage('a4', 'landscape');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H, undefined, 'FAST');
  }
  onProgress?.(els.length, els.length);
  saveBlob(pdf.output('blob'), fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

export const safeFileName = (s) => String(s || 'sertifikat').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'sertifikat';
