import { $, h, api, hydrateIcons, fmtDate, logoMark } from '../shared/common.js';
hydrateIcons();
const code = location.pathname.split('/')[2];
$('#print').addEventListener('click', () => print());
try {
  const { certificate: c } = await api('GET', `/api/certificates/${encodeURIComponent(code)}`);
  document.title = `Sertifikat — ${c.name}`;
  $('#verified').hidden = false;
  $('#cert').replaceChildren(h('div', { class: 'cert-inner' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, color: '#4a78bd', fontSize: 'clamp(14px,2vw,20px)' } }, logoMark(36), `${c.app} · ${c.campus}`),
    h('h1', { text: 'SERTIFIKAT' }),
    h('small', { class: 'label', text: 'Diberikan kepada' }),
    h('div', { class: 'name', text: c.name }),
    h('p', { text: `atas partisipasinya sebagai peserta ${c.category.toLowerCase()}` }),
    h('div', { class: 'title', text: `“${c.title}”` }),
    h('p', { text: `yang diselenggarakan secara daring pada ${fmtDate(c.startsAt)}${c.speaker ? ` dengan narasumber ${c.speaker}` : ''}.` }),
    h('div', { class: 'foot' },
      h('div', { class: 'verify' }, h('div', { text: 'Kode verifikasi:' }), h('b', { text: c.code }), h('div', { text: `${location.origin}/sertifikat/${c.code}` })),
      h('div', { class: 'sign' }, h('b', { text: 'Panitia Penyelenggara' }), h('div', { text: c.campus })))));
} catch (e) {
  $('#cert').replaceChildren(h('div', { class: 'cert-inner' }, h('h1', { text: 'Tidak Valid', style: { color: '#b23a3a' } }), h('p', { text: e.message })));
}
