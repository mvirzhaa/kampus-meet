import { initSite, $, h, icon, api, fmtDate, fmtTime, getMe, copyText } from '../shared/common.js';
import { emptyState } from '../shared/ui.js';
await initSite();
document.getElementById('yr').textContent = new Date().getFullYear();
const slug = location.pathname.split('/')[2];

async function load() {
  let e;
  try { ({ event: e } = await api('GET', `/api/events/${slug}`)); }
  catch (err) { $('#ev').replaceChildren(emptyState(err.message)); return; }
  document.title = e.title;
  const t = Date.now() / 1000;
  const ended = t > e.endsAt + 3600;
  const user = getMe().user;
  const full = e.quota && e.registered >= e.quota && !e.joined;

  // Tanpa pendaftaran: login + link → langsung gabung (password ditanya di halaman berikutnya bila ada)
  let action;
  if (e.isOwner) action = h('a', { class: 'btn btn-primary', href: e.joinLink }, icon('door', 18), 'Masuk sebagai Moderator');
  else if (ended) action = h('span', { class: 'pill gray', text: 'Event telah berakhir' });
  else if (!user) action = h('a', { class: 'btn btn-primary', href: '/login?next=' + encodeURIComponent(location.pathname) }, icon('log-in', 18), 'Login untuk Bergabung');
  else if (full) action = h('span', { class: 'pill red', text: 'Kuota peserta penuh' });
  else if (e.joinLink) action = h('a', { class: 'btn btn-violet', href: e.joinLink }, icon('door', 18), 'Gabung ke Event');
  else action = h('span', { class: 'pill green' }, icon('clock', 14), `Room dibuka ${fmtDate(e.opensAt)}, pukul ${fmtTime(e.opensAt)}`);

  const ownerInfo = e.isOwner ? h('div', { class: 'alert info' }, icon('link', 18),
    h('span', {}, 'Bagikan link halaman ini ke peserta', e.password ? ' beserta password ' : ' (tanpa password)', e.password ? h('b', { text: e.password, style: { letterSpacing: '.15em' } }) : null, '.'),
    h('button', { class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto' }, onclick: () => copyText(location.href, 'Link event tersalin') }, icon('copy', 15), 'Salin link')) : null;

  $('#ev').replaceChildren(
    h('div', { class: 'section-card', style: { padding: 0, overflow: 'hidden' } },
      h('div', { class: 'ev-cover', style: { height: 'auto', padding: '34px 30px', gap: '14px' } },
        h('span', { class: 'cat', text: e.category }),
        h('h1', { text: e.title, style: { color: '#fff', fontSize: 'clamp(26px,4vw,38px)', margin: 0 } }),
        e.speaker ? h('div', { class: 'date' }, icon('user', 18), e.speaker) : null),
      h('div', { style: { padding: '26px 30px', display: 'grid', gap: '16px' } },
        h('div', { class: 'meta', style: { display: 'flex', flexWrap: 'wrap', gap: '18px', color: 'var(--muted)' } },
          h('span', { class: 'ev-meta' }, icon('calendar', 17), fmtDate(e.startsAt)),
          h('span', { class: 'ev-meta' }, icon('clock', 17), `${fmtTime(e.startsAt)} – ${fmtTime(e.endsAt)}`),
          h('span', { class: 'ev-meta' }, icon('users', 17), `${e.registered} peserta${e.quota ? ` (kuota ${e.quota})` : ''}`),
          h('span', { class: 'ev-meta' }, icon('building', 17), `Penyelenggara: ${e.organizer}`),
          e.hasPassword ? h('span', { class: 'ev-meta' }, icon('lock', 17), 'Berpassword') : null,
          e.certificate ? h('span', { class: 'ev-meta' }, icon('award', 17), `Sertifikat (min. ${e.minAttendMin} menit)`) : null),
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, action),
        ownerInfo,
        e.joined && !e.isOwner ? h('div', { class: 'alert info' }, icon('info', 18), h('span', { text: e.certCode
          ? `Kehadiran ${e.attendedMin} menit. Sertifikat Anda sudah terbit.` : `Kehadiran tercatat: ${e.attendedMin} menit.` }),
        e.certCode ? h('a', { href: `/sertifikat/${e.certCode}`, style: { marginLeft: 'auto', fontWeight: 600 } }, 'Lihat sertifikat →') : null) : null,
        h('div', {}, h('h3', { text: 'Deskripsi' }), h('p', { text: e.description || 'Belum ada deskripsi.', style: { whiteSpace: 'pre-line', color: 'var(--muted)' } })),
        e.sponsors?.length ? h('div', {}, h('h3', { text: 'Didukung oleh' }),
          h('div', { class: 'ev-sponsors' }, e.sponsors.map(sp => h('img', { src: sp.url, alt: sp.name || 'Logo sponsor', title: sp.name || '' })))) : null)));
}
load();
