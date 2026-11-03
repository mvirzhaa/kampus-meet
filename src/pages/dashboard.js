import { initSite, $, $$, h, icon, api, toast, modal, confirmDialog, copyText, fmtDateTime, fmtDate, fmtTime, formData,
  toLocalInput, fromLocalInput, requireLogin, roomLinksModal, invitationText, startInstantMeeting, loadMe } from '../shared/common.js';
import { roomFormModal, emptyState } from '../shared/ui.js';
import { toXlsx, attendancePdf, transcriptPdf, transcriptDocx, saveBlob } from '../shared/export.js';
import { eventForm as eventFormBase } from '../shared/eventform.js';
import { inviteManager } from '../shared/invites.js';
import { speakerCertManager } from '../shared/speakers.js';
import { ratingsModal } from '../shared/rating.js';

const me = await initSite();
if (!requireLogin()) throw new Error('login');
if (me.user.role === 'admin') { $('#side-int').hidden = false; $('#side-admin').hidden = false; }

// ---------- Navigasi seksi ----------
function show() {
  const sec = (location.hash || '#meeting').slice(1);
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== sec;
  for (const a of $$('.side a')) a.classList.toggle('active', a.dataset.sec === sec);
  ({ meeting: loadRooms, event: loadEvents, sertifikat: loadCerts, akun: loadAccount, integrasi: loadIntegrations, masukan: loadMyFeedback })[sec]?.();
}
addEventListener('hashchange', show);

// ---------- Meeting ----------
// Hak membuat ditentukan server (peran E-Portal + toggle admin). Tombol disembunyikan
// bila tidak berhak, tapi penegakan sebenarnya tetap di server.
if (me.can && !me.can.meeting) {
  $('.quick')?.remove();
  $('#rooms')?.before(h('div', { class: 'note-ok' }, icon('info', 18),
    h('div', {}, h('strong', { text: 'Pembuatan meeting sedang dinonaktifkan' }),
      h('p', { text: 'Anda tetap dapat bergabung ke meeting lewat tautan undangan. Hubungi admin bila perlu membuat meeting sendiri.' }))));
}
if (me.can && !me.can.event) $('#new-event')?.remove();

$('#q-now')?.addEventListener('click', startInstantMeeting);
$('#q-later')?.addEventListener('click', () => roomFormModal({ onSaved: loadRooms }));
$('#q-sched')?.addEventListener('click', () => roomFormModal({ schedule: true, onSaved: loadRooms }));
$('#refresh').addEventListener('click', () => loadRooms());

const enterLink = (room) => `/j/${room.id}?k=${encodeURIComponent(new URL(room.moderatorLink).searchParams.get('k'))}`;

async function loadRooms() {
  const box = $('#rooms');
  try {
    const { rooms } = await api('GET', '/api/rooms');
    if (!rooms.length) return box.replaceChildren(emptyState('Belum ada meeting. Mulai meeting pertama Anda di atas.', 'video'));
    box.replaceChildren(...rooms.map(roomItem));
  } catch (e) { box.replaceChildren(emptyState(e.message)); }
}

function roomItem(room) {
  return h('div', { class: 'room-item' },
    h('div', {},
      h('h3', {}, room.name, room.live ? h('span', { class: 'pill live', text: `${room.live} peserta online` }) : null),
      h('div', { class: 'meta' },
        h('span', {}, icon('link', 15), 'ID: ', h('b', { text: room.id })),
        room.password ? h('span', {}, icon('lock', 15), 'Password: ', h('b', { text: room.password })) : h('span', {}, icon('unlock', 15), 'Tanpa password'),
        room.scheduledAt ? h('span', {}, icon('calendar', 15), `${fmtDateTime(room.scheduledAt)}${room.durationMin ? ` · ${room.durationMin} mnt` : ''}`) : null,
        room.lastUsedAt ? h('span', {}, icon('clock', 15), `Terakhir dipakai ${fmtDate(room.lastUsedAt)}`) : null)),
    h('div', { class: 'acts' },
      h('a', { class: 'btn btn-primary btn-sm', href: enterLink(room) }, icon('door', 16), 'Masuk'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => roomLinksModal(room, 'Link & Undangan') }, icon('link', 16), 'Undang'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Salin undangan', onclick: () => copyText(invitationText(room), 'Undangan tersalin') }, icon('copy', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Ubah', onclick: () => roomFormModal({ room, onSaved: loadRooms }) }, icon('pencil', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Presensi (Excel/PDF)', onclick: () => attendance(room) }, icon('list-checks', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Rekaman (Google Drive)', onclick: () => recordings(room) }, icon('record', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Transkrip / notulen', onclick: () => transcripts(room) }, icon('audio-lines', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus', onclick: async () => {
        if (!(await confirmDialog('Hapus meeting?', `Room "${room.name}" beserta presentasinya akan dihapus permanen.`, 'Hapus'))) return;
        try { await api('DELETE', `/api/rooms/${room.id}`); toast('Meeting dihapus', 'success'); loadRooms(); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash', 16))));
}

const dur = (a, b) => b ? `${Math.max(1, Math.round((b - a) / 60))} mnt` : 'masih di room';

// ---------- Presensi otomatis ----------
const TZ = 'Asia/Jakarta';
const clock = (sec) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(sec * 1000)).replace(/\./g, ':');
const dayLong = (sec) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(sec * 1000));
const hms = (sec) => { sec = Math.max(0, Math.round(sec)); const hh = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60; return hh ? `${hh} j ${mm} mnt` : `${mm} mnt`; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function attendance(room, pick) {
  let d;
  try { d = await api('GET', `/api/rooms/${room.id}/attendance${pick ? `?session=${pick}` : ''}`); } catch (e) { return toast(e.message, 'error'); }
  if (!d.sessions.length) return modal({ title: `Presensi — ${room.name}`, body: emptyState('Belum ada data presensi. Presensi tercatat otomatis saat peserta masuk ke room.', 'users') });
  TZ !== d.timezone && console.info('Zona waktu server:', d.timezone);
  const rows = d.rows;
  const minSec = d.certMinMinutes * 60;
  const sel = h('select', { onchange: () => { m.close(); attendance(room, +sel.value); } },
    d.sessions.map(x => h('option', { value: x.session, selected: x.session === d.session, text: `${dayLong(x.first)}, ${clock(x.first).slice(0, 5)} · ${x.people} orang` })));
  const headers = ['No', 'Nama', 'Status', 'Peran', 'Masuk pertama', 'Keluar terakhir', 'Durasi', 'Waktu aktif', 'Jumlah masuk', `Min. ${d.certMinMinutes} mnt`];
  const line = (r, i) => [i + 1, r.name, r.user_id ? 'Akun kampus' : 'Tamu', r.moderator ? 'Moderator' : 'Peserta', clock(r.first_in), r.online ? 'masih di room' : clock(r.last_out),
    hms(r.duration_sec), hms(r.active_sec), r.entries, r.duration_sec >= minSec ? 'Ya' : 'Tidak'];
  const table = h('div', { class: 'table-wrap', style: { maxHeight: '52vh', overflow: 'auto' } }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, headers.map(t => h('th', { text: t })))),
    h('tbody', {}, rows.map((r, i) => h('tr', {}, line(r, i).map((v, c) => h('td', { text: String(v), style: c === 9 ? { color: v === 'Ya' ? '#217a52' : '#b23a3a', fontWeight: 600 } : null })))))));
  const day = dayLong(d.session);
  const base = `presensi-${slug(room.name)}-${new Date(d.session * 1000).toISOString().slice(0, 10)}`;
  const titleLines = [`Presensi — ${room.name}`, `Sesi: ${day}`, `ID room: ${room.id} · ${rows.length} orang · dibuat ${new Date().toLocaleString('id-ID')}`, `Durasi = keluar terakhir - masuk pertama. Waktu aktif = total waktu benar-benar berada di room.`];
  const m = modal({ title: `Presensi — ${room.name}`, wide: true, cls: 'modal-xl', body: h('div', {},
    h('div', { class: 'field' }, h('label', { text: 'Sesi meeting' }), sel),
    h('p', { class: 'ev-meta', text: `Peserta yang keluar-masuk dihitung dari masuk pertama sampai keluar terakhir. Kolom terakhir menandai durasi minimal ${d.certMinMinutes} menit (syarat sertifikat).` }),
    table), actions: [
    { label: 'Unduh Excel', onClick: () => {
      saveBlob(toXlsx({ sheetName: 'Presensi', titleLines, headers: headers.slice(0, 6).concat(['Durasi (menit)', 'Waktu aktif (menit)', 'Jumlah masuk', headers[9]]),
        rows: rows.map((r, i) => { const l = line(r, i); return [...l.slice(0, 6), Math.round(r.duration_sec / 60), Math.round(r.active_sec / 60), r.entries, l[9]]; }),
        widths: [5, 32, 13, 11, 15, 16, 14, 18, 13, 10] }), base + '.xlsx');
      return false;
    } },
    { label: 'Unduh PDF', cls: 'btn-primary', onClick: async (e) => {
      e.target.disabled = true;
      try {
        const first = Math.min(...rows.map(r => r.first_in)), last = Math.max(...rows.map(r => r.online ? Date.now() / 1000 : r.last_out));
        const ok = rows.filter(r => r.duration_sec >= minSec).length;
        saveBlob(await attendancePdf({
          orientation: 'landscape', app: me.app.name, campus: me.app.campus, title: 'DAFTAR HADIR MEETING', subtitle: room.name,
          info: [['Nama meeting', room.name], ['ID room', room.id], ['Hari, tanggal', day], ['Waktu', `${clock(first).slice(0, 5)} - ${clock(last).slice(0, 5)} WIB`], ['Penyelenggara', me.user.name]],
          headers, rows: rows.map(line), statusCol: 9,
          columnStyles: { 2: { cellWidth: 66 }, 3: { cellWidth: 62 }, 4: { halign: 'center', cellWidth: 62 }, 5: { halign: 'center', cellWidth: 66 }, 6: { halign: 'center', cellWidth: 58 }, 7: { halign: 'center', cellWidth: 62 }, 8: { halign: 'center', cellWidth: 46 }, 9: { halign: 'center', cellWidth: 56 } },
          summary: `Jumlah hadir: ${rows.length} orang  |  Hadir minimal ${d.certMinMinutes} menit: ${ok} orang`,
          note: 'Durasi = keluar terakhir - masuk pertama (peserta yang keluar-masuk dihitung sekali). Waktu aktif = total waktu benar-benar berada di room.',
          sign: { date: new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()), title: 'Penyelenggara,', name: me.user.name },
        }), base + '.pdf');
      }
      catch (err) { toast('Gagal membuat PDF: ' + err.message, 'error'); }
      e.target.disabled = false; return false;
    } }] });
}

// ---------- Rekaman (Google Drive) ----------
const REC_STATUS = { recording: ['Sedang merekam', 'live'], pending_upload: ['Menunggu unggah', 'gray'], uploading: ['Mengunggah ke Drive', ''], uploaded: ['Tersimpan di Google Drive', 'green'], failed: ['Gagal', 'red'] };
async function recordings(room) {
  let d;
  try { d = await api('GET', `/api/rooms/${room.id}/recordings`); } catch (e) { return toast(e.message, 'error'); }
  if (!d.recordings.length) return modal({ title: `Rekaman — ${room.name}`, body: emptyState(d.mode === 'egress' ? 'Belum ada rekaman. Klik "Mulai rekam" di dalam ruang meeting; hasilnya otomatis diunggah ke Google Drive.' : 'Perekaman server belum diaktifkan admin (RECORDING_MODE=egress).', 'record') });
  const body = h('div', { class: 'room-list' }, d.recordings.map(r => {
    const [label, cls] = REC_STATUS[r.status] || [r.status, 'gray'];
    return h('div', { class: 'room-item' },
      h('div', {}, h('h3', {}, fmtDateTime(r.startedAt), h('span', { class: `pill ${cls}`, text: label + (r.progress != null ? ` ${r.progress}%` : '') })),
        h('div', { class: 'meta' },
          r.durationSec ? h('span', {}, icon('clock', 15), hms(r.durationSec)) : null,
          r.size ? h('span', {}, icon('file', 15), `${(r.size / 1048576).toFixed(0)} MB`) : null,
          r.startedBy ? h('span', {}, icon('user', 15), r.startedBy) : null,
          r.error && r.status !== 'uploaded' ? h('span', { style: { color: '#b23a3a' } }, icon('alert', 15), r.error) : null)),
      h('div', { class: 'acts' },
        r.fileLink ? h('a', { class: 'btn btn-primary btn-sm', href: r.fileLink, target: '_blank', rel: 'noopener' }, icon('video', 16), 'Putar') : null,
        r.folderLink ? h('a', { class: 'btn btn-ghost btn-sm', href: r.folderLink, target: '_blank', rel: 'noopener' }, 'Folder') : null,
        r.status === 'failed' || r.status === 'pending_upload' ? h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { await api('POST', `/api/rooms/${room.id}/recordings/${r.id}/retry`); toast('Unggah diulang', 'success'); m.close(); recordings(room); } catch (e) { toast(e.message, 'error'); }
        } }, icon('refresh', 16), 'Ulangi unggah') : null));
  }));
  const m = modal({ title: `Rekaman — ${room.name}`, wide: true, body, actions: [{ label: 'Muat ulang', onClick: () => { m.close(); recordings(room); } }, { label: 'Tutup', cls: 'btn-primary' }] });
}

// ---------- Integrasi (admin) ----------
async function loadIntegrations() {
  const box = $('#integrations');
  if (me.user.role !== 'admin') { box.replaceChildren(emptyState('Halaman ini khusus admin.', 'shield')); return; }
  const gq = new URLSearchParams(location.search).get('gdrive');
  if (gq) { toast({ ok: 'Google Drive berhasil dihubungkan', ditolak: 'Izin Google dibatalkan', state: 'Sesi tidak valid, coba lagi', gagal: 'Gagal menghubungkan Google Drive' }[gq] || gq, gq === 'ok' ? 'success' : 'error', 6000); history.replaceState(null, '', '/dashboard#integrasi'); }
  let d;
  try { d = await api('GET', '/api/admin/integrations'); } catch (e) { box.replaceChildren(emptyState(e.message)); return; }
  const g = d.gdrive; const t = d.translate || {};
  const row = (k, v) => h('tr', {}, h('th', { text: k, style: { width: '34%' } }), h('td', {}, v));
  const trCard = h('div', { class: 'section-card' }, h('h3', { text: 'Terjemahan transkrip' }),
    h('table', { class: 'tbl' }, h('tbody', {},
      row('Chrome & Edge (laptop/PC)', 'Diterjemahkan di perangkat peserta (tanpa server)'),
      row('Aplikasi Android', 'Diterjemahkan di perangkat (Google ML Kit)'),
      row('Safari, Firefox, browser HP', t.ok ? h('span', { class: 'pill green', text: 'Server terjemahan kampus aktif' })
        : t.configured ? h('span', { class: 'pill red', text: `Server terjemahan bermasalah: ${t.error || 'tidak diketahui'}` })
        : h('span', { class: 'pill red', text: 'Hanya menerima terjemahan yang dibagikan pembicara/moderator' })),
      t.configured ? row('TRANSLATE_URL', h('code', { text: t.url })) : null)),
    t.ok ? null : h('div', { class: 'tr-setup' },
      h('b', { text: 'Agar terjemahan selalu tersedia di Safari & Firefox, aktifkan server terjemahan kampus:' }),
      h('ol', {},
        h('li', {}, 'Jalankan di server: ', h('code', { text: 'docker compose -f deploy/docker-compose.yml --profile translate --env-file .env up -d' })),
        h('li', {}, 'Isi ', h('code', { text: 'TRANSLATE_URL=http://127.0.0.1:5000' }), ' di .env, lalu restart aplikasi.'),
        h('li', {}, 'Muat ulang halaman ini; status di atas berubah menjadi hijau setelah model bahasa selesai diunduh (±1–3 menit saat pertama kali).')),
      h('p', { text: 'Setiap kalimat diterjemahkan sekali oleh server lalu dibagikan ke semua peserta, jadi bebannya ringan walau pesertanya ratusan.' })));
  let n = null; try { n = await api('GET', '/api/admin/notify-status'); } catch { /* abaikan */ }
  const notifyCard = n ? h('div', { class: 'section-card' }, h('h3', { text: 'Undangan & pengingat event (email + notifikasi aplikasi)' }),
    h('table', { class: 'tbl' }, h('tbody', {},
      row('Email (SMTP)', n.mail.configured ? h('span', { class: 'pill green', text: `Aktif · ${n.mail.host}:${n.mail.port} · pengirim ${n.mail.from}` }) : h('span', { class: 'pill red', text: 'Belum: isi SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM di .env' })),
      n.mail.configured ? row('Antrean email', `${n.mail.sent} terkirim (30 hari) · ${n.mail.queued} menunggu · ${n.mail.failed} gagal`) : null,
      n.mail.lastError ? row('Error terakhir', h('span', { style: { color: '#b23a3a' }, text: `${n.mail.lastError.error} (${fmtDateTime(n.mail.lastError.created_at)})` })) : null,
      row('Push notification Android', n.push.configured ? h('span', { class: 'pill green', text: `Aktif (Firebase) · ${n.push.devices} perangkat terdaftar` }) : h('span', { class: 'pill red', text: 'Belum: isi FCM_SERVICE_ACCOUNT_FILE di .env (akun layanan Firebase)' })),
      row('Pengingat otomatis', `${n.reminderMinutes} menit sebelum event dimulai (push + email ke peserta undangan dan penyelenggara)`))),
    n.mail.configured ? h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
      h('button', { class: 'btn btn-ghost', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { const r = await api('POST', '/api/admin/test-email'); toast(`Email uji terkirim ke ${r.to}`, 'success', 6000); } catch (e) { toast(e.message, 'error', 8000); }
        finally { ev.target.closest('button').disabled = false; }
      } }, icon('mail', 16), 'Kirim email uji ke saya')) : null,
    !n.push.configured || !n.mail.configured ? h('p', { class: 'ev-meta', style: { marginTop: '12px' }, text: 'Panduan pengisian ada di README bagian "Undangan, email & push notification". Setelah mengubah .env, restart aplikasi.' }) : null) : null;
  box.replaceChildren(trCard, ...(notifyCard ? [notifyCard] : []),
    h('div', { class: 'section-card' }, h('h3', { text: 'Perekaman' }),
      h('table', { class: 'tbl' }, h('tbody', {},
        row('Mode', d.recordingMode === 'egress' ? 'Server (LiveKit Egress) → Google Drive' : d.recordingMode === 'local' ? 'Browser moderator (file diunduh ke komputer)' : 'Nonaktif'),
        d.recordingMode === 'egress' ? row('Format', d.encoding) : null,
        row('Antrean', d.queue.length ? d.queue.map(x => `${(REC_STATUS[x.status] || [x.status])[0]}: ${x.n}`).join(' · ') : 'kosong')))),
    h('div', { class: 'section-card' }, h('h3', { text: 'Google Drive' }),
      h('table', { class: 'tbl' }, h('tbody', {},
        row('Konfigurasi .env', g.configured ? h('span', { class: 'pill green', text: 'Lengkap' }) : h('span', { class: 'pill red', text: 'Belum: isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GDRIVE_FOLDER_ID' })),
        row('Folder tujuan', g.folder ? h('a', { href: g.folder.link, target: '_blank', rel: 'noopener', text: g.folder.name }) : (g.folderId || '—')),
        row('Akun terhubung', g.connected ? `${g.email || '(email tidak diketahui)'}` : 'Belum terhubung'),
        g.folderError || g.error ? row('Masalah', h('span', { style: { color: '#b23a3a' }, text: g.folderError || g.error })) : null,
        g.folder && !g.folder.canAdd ? row('Peringatan', 'Akun ini tidak punya izin menambah isi folder. Beri akses Editor.') : null,
        row('Redirect URI (daftarkan di Google Cloud)', h('code', { text: g.redirectUri })))),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' } },
        g.configured ? h('a', { class: 'btn btn-primary', href: '/api/admin/gdrive/connect' }, icon('link', 16), g.connected ? 'Hubungkan ulang' : 'Hubungkan Google Drive') : null,
        g.connected ? h('button', { class: 'btn btn-ghost', onclick: async () => {
          if (!(await confirmDialog('Putuskan Google Drive?', 'Rekaman baru tidak akan bisa diunggah sampai dihubungkan lagi.', 'Putuskan'))) return;
          await api('POST', '/api/admin/gdrive/disconnect'); loadIntegrations();
        } }, 'Putuskan') : null),
      h('p', { class: 'ev-meta', style: { marginTop: '12px' }, text: 'Google tidak mengizinkan unggahan tanpa login, walaupun folder dibagikan publik. Hubungkan satu akun Google yang memiliki akses Editor ke folder; rekaman tersimpan atas nama dan kuota akun tersebut.' })));
}

// ---------- Transkrip (notulen otomatis) ----------
async function transcripts(room, pick) {
  let data;
  try { data = await api('GET', `/api/rooms/${room.id}/transcripts${pick ? `?session=${pick}` : ''}`); } catch (e) { return toast(e.message, 'error'); }
  if (!data.sessions.length) {
    return modal({ title: `Transkrip — ${room.name}`, body: emptyState('Belum ada transkrip. Aktifkan lewat menu Transkrip di dalam ruang meeting (moderator).', 'audio-lines') });
  }
  const session = pick || data.sessions[0].session;
  if (!pick) { try { data = { ...data, ...(await api('GET', `/api/rooms/${room.id}/transcripts?session=${session}`)) }; } catch (e) { return toast(e.message, 'error'); } }
  const fmt = (t) => new Date(t * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');
  const sel = h('select', { style: { maxWidth: '100%' }, onchange: () => { m.close(); transcripts(room, +sel.value); } },
    data.sessions.map(x => h('option', { value: x.session, selected: x.session === session, text: `${fmtDateTime(x.first)} · ${x.n} kalimat` })));
  const tag = (lg) => lg === 'en-US' ? 'EN' : 'ID';
  const text = () => `Transkrip otomatis — ${room.name}\nRoom: ${room.id}\nSesi: ${fmtDateTime(data.lines[0]?.ts || session)}\n\n` + data.lines.map(l => `[${fmt(l.ts)}] ${l.name}${l.user_id ? '' : ' (tamu)'} (${tag(l.lang)}): ${l.text}` + (l.tr_text ? `\n           [${tag(l.tr_lang)}] ${l.tr_text}` : '')).join('\n');
  const expInfo = () => ({ app: me.app.name, campus: me.app.campus, title: room.name, roomId: room.id,
    lines: data.lines.map(l => ({ ts: l.ts, name: l.name + (l.user_id ? '' : ' (tamu)'), lang: l.lang, text: l.text, trLang: l.tr_text ? l.tr_lang : null, trText: l.tr_text || null })) });
  const base = `transkrip-${room.id}-${new Date(session * 1000).toISOString().slice(0, 10)}`;
  const speakers = [...new Set(data.lines.map(l => l.name))];
  const body = h('div', {},
    h('div', { class: 'field' }, h('label', { text: 'Sesi meeting' }), sel),
    h('p', { class: 'ev-meta', text: `${data.lines.length} kalimat · ${speakers.length} pembicara: ${speakers.join(', ')}` }),
    h('div', { style: { maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--border-2)', borderRadius: '10px', padding: '12px 14px', display: 'grid', gap: '10px' } },
      data.lines.map(l => h('div', {}, h('div', { style: { fontSize: '13px', color: 'var(--muted)' } }, h('b', { text: l.name, style: { color: 'var(--text)' } }), ` · ${fmt(l.ts)} · ${tag(l.lang)}${l.user_id ? '' : ' · tamu'}`), h('div', { text: l.text }),
        l.tr_text ? h('div', { style: { fontSize: '13.5px', color: '#047857', fontStyle: 'italic', borderLeft: '2px solid #6ee7b7', paddingLeft: '8px', marginTop: '3px' }, text: `[${tag(l.tr_lang)}] ${l.tr_text}` }) : null))),
    data.retentionDays ? h('small', { class: 'ev-meta', style: { marginTop: '8px' }, text: `Transkrip otomatis dihapus setelah ${data.retentionDays} hari. Unduh untuk arsip.` }) : null);
  const m = modal({ title: `Transkrip — ${room.name}`, wide: true, body, actions: [
    { label: 'Hapus sesi ini', cls: 'btn-ghost', onClick: async () => {
      if (!(await confirmDialog('Hapus transkrip sesi ini?', 'Transkrip yang dihapus tidak dapat dikembalikan.', 'Hapus'))) return false;
      try { await api('DELETE', `/api/rooms/${room.id}/transcripts?session=${session}`); toast('Transkrip dihapus', 'success'); } catch (e) { toast(e.message, 'error'); }
    } },
    { label: 'Salin', onClick: () => { copyText(text(), 'Transkrip tersalin'); return false; } },
    { label: 'Unduh TXT', onClick: () => { saveBlob(new Blob([text()], { type: 'text/plain;charset=utf-8' }), base + '.txt'); return false; } },
    { label: 'Unduh Word', onClick: async () => { try { saveBlob(await transcriptDocx(expInfo()), base + '.docx'); } catch (e) { toast('Gagal membuat Word: ' + e.message, 'error'); } return false; } },
    { label: 'Unduh PDF', cls: 'btn-primary', onClick: async (ev) => {
      ev.target.disabled = true;
      try { saveBlob(await transcriptPdf(expInfo()), base + '.pdf'); } catch (e) { toast('Gagal membuat PDF: ' + e.message, 'error'); }
      ev.target.disabled = false; return false;
    } }] });
}

// ---------- Event ----------
$('#new-event')?.addEventListener('click', () => eventForm().catch(e => toast(e.message, 'error')));
async function loadEvents() {
  try {
    const [{ organized, registered }, inv] = await Promise.all([api('GET', '/api/my/events'), api('GET', '/api/my/invitations').catch(() => ({ invitations: [] }))]);
    $('#my-inv-wrap').hidden = !inv.invitations.length;
    $('#my-inv').replaceChildren(...inv.invitations.map(invItem));
    // Ajakan rating: event yang sudah diikuti & selesai tetapi belum dinilai
    const pend = await api('GET', '/api/my/pending-ratings').catch(() => ({ events: [] }));
    $('#rate-wrap').hidden = !pend.events.length;
    $('#rate-list').replaceChildren(...pend.events.map(e => h('a', { class: 'rate-chip', href: `/event/${e.slug}#rating` }, h('span', { class: 'rt-st', text: '★★★★★' }), h('span', { text: e.title }), icon('chevron-right', 16))));
    $('#ev-org').replaceChildren(...(organized.length ? organized.map(e => eventItem(e, true)) : [emptyState('Anda belum menyelenggarakan event.')]));
    $('#ev-reg').replaceChildren(...(registered.length ? registered.map(e => eventItem(e, false)) : [emptyState('Anda belum mengikuti event apa pun.')]));
  } catch (e) { toast(e.message, 'error'); }
}

function eventItem(e, own) {
  const t = Date.now() / 1000;
  const st = t > e.endsAt ? h('span', { class: 'pill gray', text: 'Selesai' }) : t >= e.startsAt ? h('span', { class: 'pill live', text: 'Berlangsung' }) : h('span', { class: 'pill green', text: 'Akan datang' });
  return h('div', { class: 'room-item' },
    h('div', {}, h('h3', {}, e.title, st, !e.published ? h('span', { class: 'pill gray', text: 'Draf' }) : null),
      h('div', { class: 'meta' }, h('span', {}, icon('calendar', 15), `${fmtDate(e.startsAt)}, ${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}`),
        h('span', {}, icon('users', 15), `${e.registered} peserta`),
        own && e.invites ? h('span', {}, icon('mail', 15), `${e.invites} diundang`) : null,
        e.ratingCount ? h('span', { class: 'rt-chip', title: `${e.ratingCount} ulasan` }, h('b', { class: 'rt-st', text: '★' }), `${e.ratingAvg.toFixed(1)} (${e.ratingCount})`) : null,
        own && e.inviteOnly ? h('span', { class: 'pill invite', text: 'Khusus undangan' }) : null,
        own ? h('span', {}, icon(e.hasPassword ? 'lock' : 'unlock', 15), e.hasPassword ? 'Password: ' : 'Tanpa password', e.hasPassword ? h('b', { text: e.password }) : null) : null,
        !own && e.certCode ? h('span', {}, icon('award', 15), 'Sertifikat tersedia') : null,
        !own && e.attendedMin != null ? h('span', {}, icon('clock', 15), `Hadir ${e.attendedMin} mnt`) : null)),
    h('div', { class: 'acts' },
      h('a', { class: 'btn btn-primary btn-sm', href: `/event/${e.slug}` }, 'Buka'),
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Ubah event', 'aria-label': 'Ubah event', onclick: () => eventForm(e).catch(err => toast(err.message, 'error')) }, icon('pencil', 16)) : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Undang peserta (email & notifikasi aplikasi)', 'aria-label': 'Undang peserta', onclick: () => inviteManager(e, { onClose: (changed) => { if (changed) loadEvents(); } }) }, icon('user-plus', 16), 'Undang') : null,
      own ? h('a', { class: 'btn btn-ghost btn-sm', href: `/poster/${e.id}`, title: 'Rancang & bagikan poster event', 'aria-label': 'Poster event' }, icon('image', 16), 'Poster') : null,
      own && e.ratingCount ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Rating & ulasan peserta', 'aria-label': 'Ulasan peserta', onclick: () => ratingsModal(e) }, icon('message-circle', 16)) : null,
      !own && Date.now() / 1000 > e.startsAt ? h('a', { class: 'btn btn-ghost btn-sm', href: `/event/${e.slug}#rating`, title: 'Beri / lihat rating' }, h('span', { class: 'rt-st', text: '★' }), 'Rating') : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Sertifikat narasumber / pemateri (cetak)', 'aria-label': 'Sertifikat narasumber', onclick: () => speakerCertManager(e) }, icon('award', 16)) : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Bagikan link & password', onclick: () => eventInvite(e) }, icon('link', 16)) : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Peserta', onclick: () => participants(e) }, icon('users', 16)) : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus', onclick: async () => {
        if (!(await confirmDialog('Hapus event?', 'Event, data peserta, dan room-nya akan dihapus permanen. Sertifikat yang sudah terbit tidak bisa diverifikasi lagi.', 'Hapus'))) return;
        try { await api('DELETE', `/api/events/${e.id}`); toast('Event dihapus', 'success'); loadEvents(); } catch (err) { toast(err.message, 'error'); }
      } }, icon('trash', 16)) : null,
      !own && e.certCode ? h('a', { class: 'btn btn-violet btn-sm', href: `/sertifikat/${e.certCode}` }, icon('award', 16), 'Sertifikat') : null));
}


const eventForm = (ev) => eventFormBase(ev, { me, onSaved: () => loadEvents(), onCreated: eventInvite });


/** Kartu "Undangan untuk saya". */
function invItem(e) {
  const t = Date.now() / 1000;
  const st = t > e.endsAt ? h('span', { class: 'pill gray', text: 'Selesai' }) : t >= e.startsAt ? h('span', { class: 'pill live', text: 'Berlangsung' }) : h('span', { class: 'pill invite', text: 'Diundang' });
  return h('div', { class: 'room-item' },
    h('div', {}, h('h3', {}, e.title, st),
      h('div', { class: 'meta' }, h('span', {}, icon('calendar', 15), `${fmtDate(e.startsAt)}, ${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}`),
        e.organizer ? h('span', {}, icon('user', 15), e.organizer) : null,
        e.speaker ? h('span', {}, icon('presentation', 15), e.speaker) : null)),
    h('div', { class: 'acts' },
      e.joinOpen ? h('a', { class: 'btn btn-primary btn-sm', href: `/j/${e.roomId}` }, icon('video', 16), 'Gabung') : h('a', { class: 'btn btn-primary btn-sm', href: `/event/${e.slug}` }, 'Buka'),
      h('a', { class: 'btn btn-ghost btn-sm', href: e.googleCalendarUrl, target: '_blank', rel: 'noopener', title: 'Simpan ke Google Calendar' }, icon('calendar-plus', 16), 'Google Calendar')));
}

/** Link & password untuk dibagikan ke peserta. */
function eventInvite(e) {
  // Link langsung ke ruang meeting; yang belum login/masuk otomatis diarahkan ke halaman gabung (password ditanya di sana)
  const link = `${location.origin}/r/${e.roomId}`;
  const text = `Undangan: ${e.title}\n${fmtDate(e.startsAt)}, ${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}\n\nGabung lewat: ${link}${e.password ? `\nPassword event: ${e.password}` : ''}\n\nSilakan login dengan akun kampus. Room dibuka 30 menit sebelum acara dimulai.`;
  const row = (label, val) => h('div', { class: 'link-row' }, h('label', { text: label }),
    h('div', { class: 'link-box' }, h('code', { text: val }), h('button', { class: 'icon-btn', type: 'button', title: 'Salin', onclick: () => copyText(val) }, icon('copy', 18))));
  modal({ title: 'Bagikan event', body: h('div', { class: 'links' },
    row('Link meeting untuk peserta', link),
    e.password ? row('Password event', e.password) : h('p', { class: 'ev-meta', text: 'Event ini tanpa password: siapa pun yang login dan memiliki link dapat bergabung.' }),
    h('div', { class: 'note-ok' }, icon('info', 18), h('div', {}, h('strong', { text: 'Tanpa pendaftaran' }),
      h('p', { text: 'Peserta cukup login lalu membuka link. Kehadiran dan sertifikat tercatat otomatis saat mereka bergabung.' }))),
    h('a', { class: 'btn btn-violet', href: `/poster/${e.id}`, style: { marginTop: '6px' } }, icon('image', 18), 'Rancang poster & bagikan ke WhatsApp / Instagram / Facebook')),
  actions: [{ label: 'Salin undangan', onClick: () => { copyText(text, 'Undangan tersalin'); return false; } }, { label: 'Tutup', cls: 'btn-primary' }] });
}

async function participants(e) {
  try {
    const { participants: rows } = await api('GET', `/api/events/${e.id}/participants`);
    const body = rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Nama', 'Email', 'Masuk pertama', 'Keluar terakhir', 'Durasi', 'Sertifikat'].map(t => h('th', { text: t })))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', { text: r.name }), h('td', { text: r.email }), h('td', { text: r.first_join ? clock(r.first_join) : '—' }), h('td', { text: r.last_leave ? clock(r.last_leave) : '—' }), h('td', { text: `${Math.floor(r.attended_sec / 60)} mnt` }),
        h('td', {}, r.cert_code ? h('a', { href: `/sertifikat/${r.cert_code}`, target: '_blank', rel: 'noopener', text: r.cert_code }) : '—')))))) : emptyState('Belum ada peserta yang bergabung.', 'users');
    const minMin = e.minAttendMin || 15;
    const ket = (r) => !e.certificate ? 'Hadir' : r.cert_code ? `Memenuhi\n${r.cert_code}` : (r.attended_sec >= minMin * 60 ? 'Memenuhi' : 'Belum memenuhi');
    const hm = (sec) => sec ? clock(sec).slice(0, 5) : '-';
    const ok = rows.filter(r => r.cert_code || r.attended_sec >= minMin * 60).length;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.attended_sec, 0) / rows.length) : 0;
    const base = `daftar-hadir-${slug(e.title)}-${new Date(e.startsAt * 1000).toISOString().slice(0, 10)}`;
    const meta = [['Nama kegiatan', e.title], ['Kategori', e.category], ...(e.speaker ? [['Narasumber', e.speaker]] : []),
      ['Hari, tanggal', dayLong(e.startsAt)], ['Waktu', `${clock(e.startsAt).slice(0, 5)} - ${clock(e.endsAt).slice(0, 5)} WIB`],
      ['Penyelenggara', e.organizer || me.user.name], ['Syarat sertifikat', e.certificate ? `Hadir minimal ${minMin} menit` : 'Tanpa sertifikat']];
    modal({ title: `Peserta — ${e.title}`, wide: true, cls: 'modal-xl', body, actions: [
      { label: 'Unduh Excel', onClick: () => {
        saveBlob(toXlsx({ sheetName: 'Daftar Hadir', titleLines: [`Daftar Hadir — ${e.title}`, ...meta.slice(1).map(([k, v]) => `${k}: ${v}`)],
          headers: ['No', 'Nama', 'Email', 'Masuk pertama', 'Keluar terakhir', 'Durasi (menit)', 'Keterangan', 'Kode sertifikat'],
          rows: rows.map((r, i) => [i + 1, r.name, r.email, hm(r.first_join), hm(r.last_leave), Math.floor(r.attended_sec / 60), ket(r).split('\n')[0], r.cert_code || '']),
          widths: [5, 30, 32, 14, 15, 14, 16, 16] }), base + '.xlsx');
        return false;
      } },
      { label: 'Unduh PDF', cls: 'btn-primary', onClick: async (ev) => {
        ev.target.disabled = true;
        try {
          saveBlob(await attendancePdf({
            app: me.app.name, campus: me.app.campus, title: 'DAFTAR HADIR', subtitle: e.title, info: meta,
            headers: ['No', 'Nama Peserta', 'Email', 'Masuk', 'Keluar', 'Durasi', 'Keterangan'],
            rows: rows.map((r, i) => [i + 1, r.name, r.email, hm(r.first_join), hm(r.last_leave), hms(r.attended_sec), ket(r)]),
            columnStyles: { 1: { cellWidth: 108 }, 3: { halign: 'center', cellWidth: 38 }, 4: { halign: 'center', cellWidth: 40 }, 5: { halign: 'center', cellWidth: 46 }, 6: { halign: 'center', cellWidth: 104, fontSize: 8.5 } },
            statusCol: 6,
            summary: `Jumlah peserta hadir: ${rows.length} orang${e.certificate ? `  |  Memenuhi syarat sertifikat: ${ok} orang` : ''}  |  Rata-rata durasi: ${hms(avg)}`,
            note: 'Masuk = pertama kali bergabung, Keluar = terakhir keluar dari room. Durasi dihitung dari masuk pertama sampai keluar terakhir, dibatasi jadwal event.',
            sign: { date: new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
              title: `${e.signerTitle || me.app.campus},`, name: e.signerName || 'Panitia Penyelenggara' },
          }), base + '.pdf');
        } catch (err) { toast('Gagal membuat PDF: ' + err.message, 'error'); }
        ev.target.disabled = false; return false;
      } },
      { label: 'Tutup', cls: 'btn-primary' }] });
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Sertifikat ----------
async function loadCerts() {
  try {
    const { certificates: certs } = await api('GET', '/api/my/certificates');
    $('#certs').replaceChildren(...(certs.length ? certs.map(c => h('div', { class: 'room-item' },
      h('div', {}, h('h3', {}, c.title, h('span', { class: `pill ${c.kind === 'speaker' ? 'invite' : 'green'}`, text: c.role })),
        h('div', { class: 'meta' }, h('span', {}, icon('calendar', 15), fmtDate(c.startsAt)), h('span', {}, icon('award', 15), c.code),
          c.attendedMin != null ? h('span', {}, icon('clock', 15), `Hadir ${c.attendedMin} mnt`) : null)),
      h('div', { class: 'acts' },
        h('a', { class: 'btn btn-ghost btn-sm', href: `/sertifikat/${c.code}` }, icon('eye', 16), 'Lihat'),
        h('a', { class: 'btn btn-violet btn-sm', href: `/sertifikat/${c.code}?unduh=1` }, icon('download', 16), 'Unduh PDF')))) : [emptyState('Belum ada sertifikat.', 'award')]));
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Akun ----------
function loadAccount() {
  $('#p-name').value = me.user.name; $('#p-email').value = me.user.email;
}
$('#f-profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('PATCH', '/api/me', { name: $('#p-name').value }); await loadMe(true); toast('Profil disimpan', 'success'); } catch (err) { toast(err.message, 'error'); }
});
$('#f-pw').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('POST', '/api/auth/password', formData(e.target)); e.target.reset(); toast('Password diganti', 'success'); } catch (err) { toast(err.message, 'error'); }
});

show();

// ---------- Masukan untuk sistem (teks) ----------
async function loadMyFeedback() {
  const box = $('#my-fb');
  try {
    const { feedback } = await api('GET', '/api/my/feedback');
    box.replaceChildren(...(feedback.length ? feedback.map(f => h('div', { class: 'my-fb-item' },
      h('div', { class: 'muted-sm' }, fmtDateTime(f.createdAt), f.read ? ' · sudah dibaca admin' : ''), h('p', { text: f.text })))
      : [h('p', { class: 'ev-meta', text: 'Belum ada masukan yang Anda kirim.' })]));
  } catch (e) { box.replaceChildren(emptyState(e.message)); }
}
$('#fb-text')?.addEventListener('input', (e) => { $('#fb-count').textContent = e.target.value.length; });
$('#f-fb')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!e.target.reportValidity()) return;
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    await api('POST', '/api/feedback', { text: $('#fb-text').value });
    e.target.reset(); $('#fb-count').textContent = '0';
    toast('Terima kasih, masukan Anda sudah terkirim ke admin.', 'success');
    loadMyFeedback();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
});
