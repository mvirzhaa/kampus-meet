import { initSite, $, h, icon, api, toast, fmtDate, fmtTime, getMe, confirmDialog } from '../shared/common.js';
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
  const ended = t > e.endsAt;
  const user = getMe().user;
  let action;
  if (e.isOwner) action = h('a', { class: 'btn btn-primary', href: e.joinLink }, icon('door', 18), 'Masuk sebagai Moderator');
  else if (!user) action = h('a', { class: 'btn btn-primary', href: '/login?next=' + encodeURIComponent(location.pathname) }, icon('log-in', 18), 'Login untuk Mendaftar');
  else if (!e.isRegistered) action = ended ? h('span', { class: 'pill gray', text: 'Event telah berakhir' })
    : (e.quota && e.registered >= e.quota) ? h('span', { class: 'pill red', text: 'Kuota penuh' })
      : h('button', { class: 'btn btn-violet', onclick: register }, icon('user-check', 18), 'Daftar Event');
  else if (e.joinLink && !ended) action = h('a', { class: 'btn btn-primary', href: e.joinLink }, icon('door', 18), 'Masuk Room Event');
  else action = h('span', { class: 'pill green' }, icon('check', 14), ended ? 'Anda terdaftar (event selesai)' : 'Anda terdaftar — room dibuka 30 menit sebelum mulai');

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
          h('span', { class: 'ev-meta' }, icon('users', 17), `${e.registered} terdaftar${e.quota ? ` dari ${e.quota}` : ''}`),
          h('span', { class: 'ev-meta' }, icon('building', 17), `Penyelenggara: ${e.organizer}`),
          e.certificate ? h('span', { class: 'ev-meta' }, icon('award', 17), `Sertifikat (min. hadir ${e.minAttendMin} menit)`) : null),
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, action,
          e.isRegistered && !ended && !e.attendedMin ? h('button', { class: 'btn btn-ghost btn-sm', onclick: unregister }, 'Batalkan pendaftaran') : null),
        e.isRegistered ? h('div', { class: 'alert info' }, icon('info', 18), h('span', { text: e.certCode
          ? `Kehadiran ${e.attendedMin} menit. Sertifikat Anda sudah terbit.` : `Kehadiran tercatat: ${e.attendedMin} menit.` }),
        e.certCode ? h('a', { href: `/sertifikat/${e.certCode}`, style: { marginLeft: 'auto', fontWeight: 600 } }, 'Lihat sertifikat →') : null) : null,
        h('div', {}, h('h3', { text: 'Deskripsi' }), h('p', { text: e.description || 'Belum ada deskripsi.', style: { whiteSpace: 'pre-line', color: 'var(--muted)' } })))));
}
async function register() { try { await api('POST', `/api/events/${slug}/register`); toast('Pendaftaran berhasil!', 'success'); load(); } catch (e) { toast(e.message, 'error'); } }
async function unregister() {
  if (!(await confirmDialog('Batalkan pendaftaran?', 'Anda dapat mendaftar lagi selama kuota masih tersedia.'))) return;
  try { await api('DELETE', `/api/events/${slug}/register`); load(); } catch (e) { toast(e.message, 'error'); }
}
load();
