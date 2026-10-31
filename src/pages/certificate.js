import { $, h, api, hydrateIcons, fmtDate, logoMark } from '../shared/common.js';
import { qrSvg } from '../shared/qr.js';
import { renderCertDesign } from '../shared/certdesign.js';
hydrateIcons();
const code = location.pathname.split('/')[2];
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
  }, { bgUrl: c.bgUrl, logoMark: () => logoMark(34), qrSvg: (t) => qrSvg(t, { label: `QR verifikasi sertifikat ${c.code}` }) });
} catch (e) {
  $('#cert').replaceChildren(h('div', { class: 'cert-inner' }, h('h1', { text: 'Tidak Valid', style: { color: '#b23a3a' } }), h('p', { text: e.message })));
}
