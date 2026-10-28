import { h, icon, api, logoMark } from '../shared/common.js';

const code = decodeURIComponent(location.pathname.split('/')[2] || '');
const root = document.getElementById('vf');

const dur = (min) => {
  const j = Math.floor(min / 60), m = min % 60;
  return j ? `${j} jam${m ? ` ${m} menit` : ''}` : `${m} menit`;
};
const row = (ic, label, value, sub) => h('div', { class: 'vf-row' }, icon(ic, 20),
  h('div', {}, h('small', { text: label }), h('b', { text: value }), sub ? h('span', { class: 'sub', text: sub }) : null));

try {
  const { certificate: c } = await api('GET', `/api/certificates/${encodeURIComponent(code)}`);
  // Waktu selalu ditampilkan dalam zona waktu kampus, bukan zona waktu ponsel pemindai.
  const tz = c.timezone || 'Asia/Jakarta';
  const zone = new Intl.DateTimeFormat('id-ID', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(c.startsAt * 1000)).find(p => p.type === 'timeZoneName')?.value || '';
  const D = new Intl.DateTimeFormat('id-ID', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const T = new Intl.DateTimeFormat('id-ID', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const d = (s) => D.format(new Date(s * 1000));
  const t = (s) => T.format(new Date(s * 1000)).replace('.', ':');
  const sameDay = d(c.startsAt) === d(c.endsAt);
  const when = sameDay ? `${t(c.startsAt)} – ${t(c.endsAt)} ${zone}` : `s.d. ${d(c.endsAt)}, ${t(c.endsAt)} ${zone}`;
  document.title = `Sertifikat ${c.name} — Terverifikasi`;
  const codeRow = row('award', 'Kode sertifikat', c.code);
  codeRow.querySelector('b').classList.add('vf-code');
  root.replaceChildren(
    h('div', { class: 'vf-head' }, h('div', { class: 'badge' }, icon('shield-check', 34)),
      h('h1', { text: 'Sertifikat Terverifikasi' }),
      h('p', { text: `Sertifikat ini asli dan diterbitkan oleh ${c.app} · ${c.campus}.` })),
    h('div', { class: 'vf-body' },
      row('user', 'Nama peserta', c.name),
      row('presentation', `Event (${c.category})`, c.title, c.speaker ? `Narasumber: ${c.speaker}` : null),
      row('pen', 'Penanda tangan', c.signerName, c.signerTitle),
      row('calendar', 'Tanggal & waktu pelaksanaan', d(c.startsAt), when),
      row('clock', 'Durasi kehadiran peserta', dur(c.attendedMin),
        c.firstJoin && c.lastLeave ? `Masuk pertama ${t(c.firstJoin)}, keluar terakhir ${t(c.lastLeave)} ${zone}` : null),
      codeRow,
      h('div', { class: 'vf-actions' },
        h('a', { class: 'btn btn-primary', href: `/sertifikat/${encodeURIComponent(c.code)}` }, icon('file', 18), 'Lihat sertifikat'),
        h('a', { class: 'btn btn-ghost', href: '/' }, 'Beranda')),
      h('div', { class: 'vf-foot' }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, logoMark(18), c.app))));
} catch (e) {
  document.title = 'Sertifikat tidak valid';
  root.replaceChildren(
    h('div', { class: 'vf-head bad' }, h('div', { class: 'badge' }, icon('x', 34)),
      h('h1', { text: 'Sertifikat Tidak Valid' }),
      h('p', { text: e.status === 404 || /tidak ditemukan/i.test(e.message) ? 'Kode sertifikat tidak terdaftar di sistem kami.' : e.message })),
    h('div', { class: 'vf-body' },
      row('award', 'Kode yang diperiksa', code || '—'),
      h('p', { style: { color: 'var(--muted)', marginTop: '12px' }, text: 'Pastikan QR code dipindai dari sertifikat asli. Sertifikat yang diubah atau dipalsukan tidak akan lolos verifikasi.' }),
      h('div', { class: 'vf-actions' }, h('a', { class: 'btn btn-ghost', href: '/' }, 'Ke Beranda'))));
}
