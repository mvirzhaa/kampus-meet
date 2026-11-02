import { $, h, api, hydrateIcons, fmtDate, logoMark, toast } from '../shared/common.js';
import { qrSvg } from '../shared/qr.js';
import { renderCertDesign } from '../shared/certdesign.js';
import { certsToPdf, safeFileName } from '../shared/certpdf.js';
hydrateIcons();
const code = location.pathname.split('/')[2];
const auto = new URLSearchParams(location.search).has('unduh');   // dari aplikasi Android: langsung unduh PDF
$('#print').addEventListener('click', () => print());

const dur = (min) => { const j = Math.floor(min / 60), m = min % 60; return j ? `${j} jam${m ? ` ${m} menit` : ''}` : `${m} menit`; };

try {
  const { certificate: c } = await api('GET', `/api/certificates/${encodeURIComponent(code)}`);
  document.title = `Sertifikat — ${c.name}`;
  $('#verified').hidden = false;
  // Desain mengikuti pengaturan penyelenggara event (template, posisi & ukuran tiap teks)
  renderCertDesign($('#cert'), c.design, {
    name: c.name, title: c.title, category: c.category, speaker: c.speaker, dateText: fmtDate(c.startsAt),
    durationText: dur(c.attendedMin || 0), signerName: c.signerName, signerTitle: c.signerTitle,
    code: c.code, verifyUrl: c.verifyUrl, app: c.app, campus: c.campus, sponsors: c.sponsors || [],
    kind: c.kind, role: c.role, speakerText: c.speakerText,
  }, { bgUrl: c.bgUrl, logoMark: () => logoMark(34), qrSvg: (t) => qrSvg(t, { label: `QR verifikasi sertifikat ${c.code}` }) });
  const btn = $('#pdf'); btn.disabled = false;
  const download = async () => {
    btn.disabled = true; const label = btn.lastChild.textContent; btn.lastChild.textContent = 'Menyiapkan PDF…';
    try { await certsToPdf([$('#cert')], `Sertifikat-${safeFileName(c.name)}-${c.code}`); toast('Sertifikat PDF terunduh', 'success'); }
    catch (e) { toast(`Gagal membuat PDF: ${e.message}. Gunakan tombol Cetak → Simpan sebagai PDF.`, 'error', 8000); }
    finally { btn.disabled = false; btn.lastChild.textContent = label; }
  };
  btn.addEventListener('click', download);
  if (auto) setTimeout(download, 400);
} catch (e) {
  $('#cert').replaceChildren(h('div', { class: 'cert-inner' }, h('h1', { text: 'Tidak Valid', style: { color: '#b23a3a' } }), h('p', { text: e.message })));
}
