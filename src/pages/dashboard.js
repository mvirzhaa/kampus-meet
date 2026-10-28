import { initSite, $, $$, h, icon, api, toast, modal, confirmDialog, copyText, fmtDateTime, fmtDate, fmtTime, formData,
  toLocalInput, fromLocalInput, requireLogin, roomLinksModal, invitationText, startInstantMeeting, loadMe } from '../shared/common.js';
import { roomFormModal, emptyState } from '../shared/ui.js';
import { toXlsx, toPdf, saveBlob } from '../shared/export.js';

const me = await initSite();
if (!requireLogin()) throw new Error('login');
if (me.user.role === 'admin') { $('#side-int').hidden = false; $('#side-admin').hidden = false; }

// ---------- Navigasi seksi ----------
function show() {
  const sec = (location.hash || '#meeting').slice(1);
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== sec;
  for (const a of $$('.side a')) a.classList.toggle('active', a.dataset.sec === sec);
  ({ meeting: loadRooms, event: loadEvents, sertifikat: loadCerts, akun: loadAccount, integrasi: loadIntegrations })[sec]?.();
}
addEventListener('hashchange', show);

// ---------- Meeting ----------
$('#q-now').addEventListener('click', startInstantMeeting);
$('#q-later').addEventListener('click', () => roomFormModal({ onSaved: loadRooms }));
$('#q-sched').addEventListener('click', () => roomFormModal({ schedule: true, onSaved: loadRooms }));
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

function csvDownload(name, rows) {
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; // cegah CSV injection
  const blob = new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
      try { saveBlob(await toPdf({ title: titleLines[0], subtitleLines: titleLines.slice(1), headers, rows: rows.map(line), footer: room.id }), base + '.pdf'); }
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
  const g = d.gdrive;
  const row = (k, v) => h('tr', {}, h('th', { text: k, style: { width: '34%' } }), h('td', {}, v));
  box.replaceChildren(
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
  const text = () => `Transkrip otomatis — ${room.name}\nRoom: ${room.id}\nSesi: ${fmtDateTime(data.lines[0]?.ts || session)}\n\n` + data.lines.map(l => `[${fmt(l.ts)}] ${l.name}${l.user_id ? '' : ' (tamu)'}: ${l.text}`).join('\n');
  const speakers = [...new Set(data.lines.map(l => l.name))];
  const body = h('div', {},
    h('div', { class: 'field' }, h('label', { text: 'Sesi meeting' }), sel),
    h('p', { class: 'ev-meta', text: `${data.lines.length} kalimat · ${speakers.length} pembicara: ${speakers.join(', ')}` }),
    h('div', { style: { maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--border-2)', borderRadius: '10px', padding: '12px 14px', display: 'grid', gap: '10px' } },
      data.lines.map(l => h('div', {}, h('div', { style: { fontSize: '13px', color: 'var(--muted)' } }, h('b', { text: l.name, style: { color: 'var(--text)' } }), ` · ${fmt(l.ts)} · ${l.lang === 'en-US' ? 'EN' : 'ID'}${l.user_id ? '' : ' · tamu'}`), h('div', { text: l.text })))),
    data.retentionDays ? h('small', { class: 'ev-meta', style: { marginTop: '8px' }, text: `Transkrip otomatis dihapus setelah ${data.retentionDays} hari. Unduh untuk arsip.` }) : null);
  const m = modal({ title: `Transkrip — ${room.name}`, wide: true, body, actions: [
    { label: 'Hapus sesi ini', cls: 'btn-ghost', onClick: async () => {
      if (!(await confirmDialog('Hapus transkrip sesi ini?', 'Transkrip yang dihapus tidak dapat dikembalikan.', 'Hapus'))) return false;
      try { await api('DELETE', `/api/rooms/${room.id}/transcripts?session=${session}`); toast('Transkrip dihapus', 'success'); } catch (e) { toast(e.message, 'error'); }
    } },
    { label: 'Salin', onClick: () => { copyText(text(), 'Transkrip tersalin'); return false; } },
    { label: 'Unduh TXT', cls: 'btn-primary', onClick: () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' })), download: `transkrip-${room.id}-${new Date(session * 1000).toISOString().slice(0, 10)}.txt` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return false;
    } }] });
}

// ---------- Event ----------
$('#new-event').addEventListener('click', () => eventForm().catch(e => toast(e.message, 'error')));
async function loadEvents() {
  try {
    const { organized, registered } = await api('GET', '/api/my/events');
    $('#ev-org').replaceChildren(...(organized.length ? organized.map(e => eventItem(e, true)) : [emptyState('Anda belum menyelenggarakan event.')]));
    $('#ev-reg').replaceChildren(...(registered.length ? registered.map(e => eventItem(e, false)) : [emptyState('Anda belum mendaftar event apa pun.')]));
  } catch (e) { toast(e.message, 'error'); }
}

function eventItem(e, own) {
  const t = Date.now() / 1000;
  const st = t > e.endsAt ? h('span', { class: 'pill gray', text: 'Selesai' }) : t >= e.startsAt ? h('span', { class: 'pill live', text: 'Berlangsung' }) : h('span', { class: 'pill green', text: 'Akan datang' });
  return h('div', { class: 'room-item' },
    h('div', {}, h('h3', {}, e.title, st, !e.published ? h('span', { class: 'pill gray', text: 'Draf' }) : null),
      h('div', { class: 'meta' }, h('span', {}, icon('calendar', 15), `${fmtDate(e.startsAt)}, ${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}`),
        h('span', {}, icon('users', 15), `${e.registered} terdaftar`),
        !own && e.certCode ? h('span', {}, icon('award', 15), 'Sertifikat tersedia') : null,
        !own && e.attendedMin != null ? h('span', {}, icon('clock', 15), `Hadir ${e.attendedMin} mnt`) : null)),
    h('div', { class: 'acts' },
      h('a', { class: 'btn btn-primary btn-sm', href: `/event/${e.slug}` }, 'Buka'),
      own ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => eventForm(e).catch(err => toast(err.message, 'error')) }, icon('pencil', 16)) : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Peserta', onclick: () => participants(e) }, icon('users', 16)) : null,
      own ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus', onclick: async () => {
        if (!(await confirmDialog('Hapus event?', 'Event, pendaftar, dan room-nya akan dihapus permanen. Sertifikat yang sudah terbit tidak bisa diverifikasi lagi.', 'Hapus'))) return;
        try { await api('DELETE', `/api/events/${e.id}`); toast('Event dihapus', 'success'); loadEvents(); } catch (err) { toast(err.message, 'error'); }
      } }, icon('trash', 16)) : null,
      !own && e.certCode ? h('a', { class: 'btn btn-violet btn-sm', href: `/sertifikat/${e.certCode}` }, icon('award', 16), 'Sertifikat') : null));
}

/** Kategori dikelola admin di /admin, jadi daftarnya diambil dari server (di-cache sekali). */
let catsCache;
async function categorySelect(selected) {
  if (!catsCache) {
    try { catsCache = (await api('GET', '/api/categories')).categories; }
    catch { catsCache = []; }
  }
  // Event lama bisa memakai kategori yang sudah dinonaktifkan — tetap tampilkan agar tidak berubah diam-diam
  const list = selected && !catsCache.includes(selected) ? [selected, ...catsCache] : catsCache;
  return h('select', { name: 'category' }, list.map(c => h('option', { value: c, selected: selected === c }, c)));
}

async function eventForm(ev) {
  const now = Math.floor(Date.now() / 1000);
  const catField = await categorySelect(ev?.category);
  const start = ev?.startsAt || (Math.ceil(now / 3600) + 24) * 3600;
  const f = h('form', {},
    h('div', { class: 'field' }, h('label', { text: 'Judul event' }), h('input', { name: 'title', required: true, minlength: 4, maxlength: 140, value: ev?.title || '' })),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { text: 'Kategori' }), catField),
      h('div', { class: 'field' }, h('label', { text: 'Narasumber' }), h('input', { name: 'speaker', maxlength: 200, value: ev?.speaker || '' }))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { text: 'Mulai' }), h('input', { name: 'startsAt', type: 'datetime-local', required: true, value: toLocalInput(start) })),
      h('div', { class: 'field' }, h('label', { text: 'Selesai' }), h('input', { name: 'endsAt', type: 'datetime-local', required: true, value: toLocalInput(ev?.endsAt || start + 7200) }))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { text: 'Kuota peserta (0 = tanpa batas)' }), h('input', { name: 'quota', type: 'number', min: 0, value: ev?.quota ?? 0 })),
      h('div', { class: 'field' }, h('label', { text: 'Minimal durasi untuk sertifikat (menit, min. 15)' }), h('input', { name: 'minAttendMin', type: 'number', min: 15, value: ev?.minAttendMin ?? 15 }))),
    h('div', { class: 'field' }, h('label', { text: 'Deskripsi' }), h('textarea', { name: 'description', rows: 4, maxlength: 4000 }, ev?.description || '')),
    h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'certificate', checked: ev ? ev.certificate : true }), 'Terbitkan sertifikat otomatis')),
    h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'published', checked: ev ? ev.published : true }), 'Publikasikan (tampil di halaman Event)')));
  const m = modal({ title: ev ? 'Ubah Event' : 'Buat Event', body: f, wide: true, actions: [{ label: 'Batal' }, { label: ev ? 'Simpan' : 'Buat Event', cls: 'btn-primary', keepOpen: true, onClick: async (e) => {
    if (!f.reportValidity()) return false;
    const d = formData(f); d.startsAt = fromLocalInput(d.startsAt); d.endsAt = fromLocalInput(d.endsAt);
    e.target.disabled = true;
    try { ev ? await api('PATCH', `/api/events/${ev.id}`, d) : await api('POST', '/api/events', d); m.close(); toast('Event disimpan', 'success'); loadEvents(); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    return false;
  } }] });
}

async function participants(e) {
  try {
    const { participants: rows } = await api('GET', `/api/events/${e.id}/participants`);
    const body = rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Nama', 'Email', 'Masuk pertama', 'Keluar terakhir', 'Durasi', 'Sertifikat'].map(t => h('th', { text: t })))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', { text: r.name }), h('td', { text: r.email }), h('td', { text: r.first_join ? clock(r.first_join) : '—' }), h('td', { text: r.last_leave ? clock(r.last_leave) : '—' }), h('td', { text: `${Math.floor(r.attended_sec / 60)} mnt` }),
        h('td', {}, r.cert_code ? h('a', { href: `/sertifikat/${r.cert_code}`, target: '_blank', rel: 'noopener', text: r.cert_code }) : '—')))))) : emptyState('Belum ada pendaftar.', 'users');
    modal({ title: `Peserta — ${e.title}`, wide: true, body, actions: [
      { label: 'Unduh CSV', onClick: () => { csvDownload(`peserta-${e.slug}.csv`, [['Nama', 'Email', 'Terdaftar', 'Hadir (menit)', 'Kode Sertifikat'],
        ...rows.map(r => [r.name, r.email, new Date(r.registered_at * 1000).toLocaleString('id-ID'), Math.floor(r.attended_sec / 60), r.cert_code || ''])]); return false; } },
      { label: 'Tutup', cls: 'btn-primary' }] });
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Sertifikat ----------
async function loadCerts() {
  try {
    const { registered } = await api('GET', '/api/my/events');
    const certs = registered.filter(e => e.certCode);
    $('#certs').replaceChildren(...(certs.length ? certs.map(e => h('div', { class: 'room-item' },
      h('div', {}, h('h3', { text: e.title }), h('div', { class: 'meta' }, h('span', {}, icon('calendar', 15), fmtDate(e.startsAt)), h('span', {}, icon('award', 15), e.certCode))),
      h('div', { class: 'acts' }, h('a', { class: 'btn btn-violet btn-sm', href: `/sertifikat/${e.certCode}` }, icon('download', 16), 'Lihat / Unduh')))) : [emptyState('Belum ada sertifikat.', 'award')]));
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
