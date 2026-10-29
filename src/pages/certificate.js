import { $, h, api, hydrateIcons, fmtDate, logoMark } from '../shared/common.js';
import { qrSvg } from '../shared/qr.js';
hydrateIcons();
const code = location.pathname.split('/')[2];
$('#print').addEventListener('click', () => print());

const logos = (list, cls) => list.length
  ? h('div', { class: `cert-sp ${cls}` }, list.map(s => h('img', { src: s.url, alt: s.name || 'Logo sponsor' })))
  : null;

try {
  const { certificate: c } = await api('GET', `/api/certificates/${encodeURIComponent(code)}`);
  document.title = `Sertifikat — ${c.name}`;
  $('#verified').hidden = false;
  const sp = (pos) => (c.sponsors || []).filter(s => s.position === pos);
  const br = sp('br');
  const qr = h('div', { class: 'qr', title: 'Pindai untuk memverifikasi sertifikat' });
  qr.append(qrSvg(c.verifyUrl, { label: `QR verifikasi sertifikat ${c.code}` }));

  const top = sp('tl').length || sp('tr').length
    ? h('div', { class: 'cert-top' }, logos(sp('tl'), 'tl') || h('span'), logos(sp('tr'), 'tr') || h('span')) : null;
  $('#cert').replaceChildren(h('div', { class: 'cert-inner' + (top ? ' has-top' : '') },
    top,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, color: '#047857', fontSize: 'clamp(13px,1.8vw,19px)' } }, logoMark(34), `${c.app} · ${c.campus}`),
    h('h1', { text: 'SERTIFIKAT' }),
    h('small', { class: 'label', text: 'Diberikan kepada' }),
    h('div', { class: 'name', text: c.name }),
    h('p', { text: `atas partisipasinya sebagai peserta ${c.category.toLowerCase()}` }),
    h('div', { class: 'title', text: `“${c.title}”` }),
    h('p', { text: `yang diselenggarakan secara daring pada ${fmtDate(c.startsAt)}${c.speaker ? ` dengan narasumber ${c.speaker}` : ''}.` }),
    h('div', { class: 'foot' + (br.length ? ' has-br' : '') },
      h('div', { class: 'verify' }, h('div', { text: 'Kode verifikasi:' }), h('b', { text: c.code }), h('div', { class: 'url', text: c.verifyUrl.replace(/^https?:\/\//, '') })),
      h('div', { class: 'sign' }, qr, h('b', { class: 'signer', text: c.signerName }), h('div', { text: c.signerTitle })),
      br.length ? h('div', { class: 'support' }, h('small', { text: 'Didukung oleh' }), logos(br, 'br')) : null)));
} catch (e) {
  $('#cert').replaceChildren(h('div', { class: 'cert-inner' }, h('h1', { text: 'Tidak Valid', style: { color: '#b23a3a' } }), h('p', { text: e.message })));
}
