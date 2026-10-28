// Panel admin: kategori event, pengguna, serta seluruh meeting & event di sistem.
import { initSite, $, $$, h, icon, api, toast, modal, confirmDialog, fmtDate, fmtDateTime,
  requireLogin } from '../shared/common.js';
import { emptyState } from '../shared/ui.js';

const me = await initSite();
if (!requireLogin()) throw new Error('login');
if (me.user.role !== 'admin') { location.replace('/dashboard'); throw new Error('bukan admin'); }

// ---------- Navigasi seksi ----------
function show() {
  const sec = (location.hash || '#kategori').slice(1);
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== sec;
  for (const a of $$('.side a[data-sec]')) a.classList.toggle('active', a.dataset.sec === sec);
  ({ kategori: loadCats, pengguna: loadUsers, meeting: loadRooms, event: loadEvents })[sec]?.();
}
addEventListener('hashchange', show);

/** Jalankan pencarian setelah pengguna berhenti mengetik, agar tidak membanjiri server. */
function debounce(fn, ms = 350) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const fail = (box, e) => box.replaceChildren(emptyState(e.message, 'alert'));

async function loadOverview() {
  try {
    const o = await api('GET', '/api/admin/overview');
    const tile = (label, value) => h('div', { class: 'stat' }, h('b', { text: String(value) }), label);
    $('#overview').replaceChildren(
      tile('Pengguna', o.users),
      tile('Admin', o.admins),
      tile('Meeting', o.rooms),
      tile('Event', o.events));
    $('#overview').hidden = false;
  } catch { /* ringkasan bersifat tambahan; abaikan bila gagal */ }
}

// ==================== Kategori ====================
async function loadCats() {
  const box = $('#cats');
  try {
    const { categories } = await api('GET', '/api/admin/categories');
    if (!categories.length) return box.replaceChildren(emptyState('Belum ada kategori.', 'list-checks'));
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Kategori' }), h('th', { text: 'Dipakai' }), h('th', { text: 'Status' }), h('th', { text: 'Aksi' }))),
      h('tbody', {}, categories.map(catRow)))));
  } catch (e) { fail(box, e); }
}

function catRow(c) {
  return h('tr', {},
    h('td', {}, h('b', { text: c.name })),
    h('td', { text: c.used ? `${c.used} event` : '—' }),
    h('td', {}, c.active ? h('span', { class: 'pill green', text: 'Aktif' }) : h('span', { class: 'pill gray', text: 'Nonaktif' })),
    h('td', {}, h('div', { class: 'acts' },
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Ubah nama', onclick: () => catForm(c) }, icon('pencil', 16)),
      h('button', {
        class: 'btn btn-ghost btn-sm', title: c.active ? 'Nonaktifkan' : 'Aktifkan kembali',
        onclick: () => patchCat(c.id, { active: !c.active }),
      }, icon(c.active ? 'eye-off' : 'eye', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus', onclick: () => removeCat(c) }, icon('trash', 16)))));
}

async function patchCat(id, body) {
  try { await api('PATCH', `/api/admin/categories/${id}`, body); toast('Kategori diperbarui', 'success'); loadCats(); }
  catch (e) { toast(e.message, 'error'); }
}

async function removeCat(c) {
  if (c.used) return toast(`Kategori "${c.name}" masih dipakai ${c.used} event. Nonaktifkan saja.`, 'error', 5000);
  if (!(await confirmDialog('Hapus kategori?', `Kategori "${c.name}" akan dihapus permanen.`, 'Hapus'))) return;
  try { await api('DELETE', `/api/admin/categories/${c.id}`); toast('Kategori dihapus', 'success'); loadCats(); loadOverview(); }
  catch (e) { toast(e.message, 'error'); }
}

function catForm(cat) {
  const f = h('form', { autocomplete: 'off' },
    h('div', { class: 'field' },
      h('label', { text: 'Nama kategori' }),
      h('input', { name: 'name', required: true, minlength: 2, maxlength: 60, value: cat?.name || '', placeholder: 'mis. Kuliah Tamu' }),
      cat?.used ? h('small', { text: `${cat.used} event memakai kategori ini — namanya ikut diperbarui.` }) : null));
  const m = modal({
    title: cat ? 'Ubah Kategori' : 'Tambah Kategori',
    body: f,
    actions: [{ label: 'Batal' }, {
      label: cat ? 'Simpan' : 'Tambah', cls: 'btn-primary', keepOpen: true,
      onClick: async (ev) => {
        if (!f.reportValidity()) return false;
        const name = f.elements.name.value.trim();
        ev.target.disabled = true;
        try {
          cat ? await api('PATCH', `/api/admin/categories/${cat.id}`, { name }) : await api('POST', '/api/admin/categories', { name });
          m.close(); toast('Kategori disimpan', 'success'); loadCats(); loadOverview();
        } catch (err) { toast(err.message, 'error'); ev.target.disabled = false; }
        return false;
      },
    }],
  });
}

$('#cat-new').addEventListener('click', () => catForm());

// ==================== Pengguna ====================
async function loadUsers() {
  const box = $('#users');
  const term = $('#u-q').value.trim();
  try {
    const { users } = await api('GET', `/api/admin/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
    if (!users.length) return box.replaceChildren(emptyState(term ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna.', 'users'));
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Nama' }), h('th', { text: 'Email' }), h('th', { text: 'Peran' }),
        h('th', { text: 'Aktivitas' }), h('th', { text: 'Terdaftar' }), h('th', { text: 'Aksi' }))),
      h('tbody', {}, users.map(userRow)))));
  } catch (e) { fail(box, e); }
}

function userRow(u) {
  const self = u.id === me.user.id;
  const locked = u.lockedUntil > Date.now() / 1000;
  // Super-admin & akun sendiri tidak boleh diubah perannya agar admin tidak mengunci dirinya sendiri
  const frozen = u.superAdmin || self;
  return h('tr', {},
    h('td', {}, h('b', { text: u.name }), self ? h('span', { class: 'pill', text: 'Anda' }) : null),
    h('td', { text: u.email }),
    h('td', {},
      u.superAdmin ? h('span', { class: 'pill' }, icon('crown', 14), 'Super-admin')
        : u.role === 'admin' ? h('span', { class: 'pill' }, icon('shield-check', 14), 'Admin')
          : h('span', { class: 'pill gray', text: 'Pengguna' }),
      u.status === 'disabled' ? h('span', { class: 'pill red', text: 'Nonaktif' }) : null,
      locked ? h('span', { class: 'pill red', text: 'Terkunci' }) : null),
    h('td', { text: `${u.rooms} meeting · ${u.events} event` }),
    h('td', { text: fmtDate(u.createdAt) }),
    h('td', {}, h('div', { class: 'acts' },
      frozen ? null : h('button', {
        class: 'btn btn-ghost btn-sm', title: u.role === 'admin' ? 'Turunkan jadi pengguna biasa' : 'Jadikan admin',
        onclick: () => patchUser(u, { role: u.role === 'admin' ? 'user' : 'admin' },
          u.role === 'admin' ? `Turunkan ${u.name} menjadi pengguna biasa?` : `Jadikan ${u.name} admin? Admin dapat mengelola kategori, pengguna, serta semua meeting dan event.`),
      }, icon(u.role === 'admin' ? 'user-x' : 'shield-check', 16)),
      frozen ? null : h('button', {
        class: 'btn btn-ghost btn-sm', title: u.status === 'active' ? 'Nonaktifkan akun' : 'Aktifkan kembali',
        onclick: () => patchUser(u, { status: u.status === 'active' ? 'disabled' : 'active' },
          u.status === 'active' ? `Nonaktifkan akun ${u.name}? Ia akan langsung dikeluarkan dari semua perangkat dan tidak bisa login.` : `Aktifkan kembali akun ${u.name}?`),
      }, icon(u.status === 'active' ? 'ban' : 'user-check', 16)),
      locked ? h('button', { class: 'btn btn-ghost btn-sm', title: 'Buka kunci login', onclick: () => unlockUser(u) }, icon('unlock', 16)) : null,
      u.superAdmin ? null : h('button', { class: 'btn btn-ghost btn-sm', title: 'Reset password', onclick: () => resetPw(u) }, icon('lock', 16)))));
}

async function patchUser(u, body, question) {
  if (!(await confirmDialog('Ubah pengguna?', question, 'Ya, ubah', body.status === 'disabled' || body.role === 'user'))) return;
  try { await api('PATCH', `/api/admin/users/${u.id}`, body); toast('Pengguna diperbarui', 'success'); loadUsers(); loadOverview(); }
  catch (e) { toast(e.message, 'error'); }
}

async function unlockUser(u) {
  try { await api('POST', `/api/admin/users/${u.id}/unlock`); toast('Kunci login dibuka', 'success'); loadUsers(); }
  catch (e) { toast(e.message, 'error'); }
}

function resetPw(u) {
  const f = h('form', { autocomplete: 'off' },
    h('p', { class: 'ev-meta', text: `Tetapkan password baru untuk ${u.name} (${u.email}). Semua sesi loginnya akan dikeluarkan.` }),
    h('div', { class: 'field' },
      h('label', { text: 'Password baru' }),
      h('input', { name: 'password', type: 'text', required: true, minlength: 8, maxlength: 128, autocomplete: 'new-password' }),
      h('small', { text: 'Minimal 8 karakter, harus mengandung huruf dan angka. Sampaikan ke pemilik akun lewat jalur yang aman dan minta ia segera menggantinya.' })));
  const m = modal({
    title: 'Reset Password',
    body: f,
    actions: [{ label: 'Batal' }, {
      label: 'Reset Password', cls: 'btn-danger', keepOpen: true,
      onClick: async (ev) => {
        if (!f.reportValidity()) return false;
        ev.target.disabled = true;
        try { await api('POST', `/api/admin/users/${u.id}/password`, { password: f.elements.password.value }); m.close(); toast('Password direset', 'success'); loadUsers(); }
        catch (err) { toast(err.message, 'error'); ev.target.disabled = false; }
        return false;
      },
    }],
  });
}

$('#u-q').addEventListener('input', debounce(loadUsers));

// ==================== Semua meeting ====================
async function loadRooms() {
  const box = $('#rooms');
  const term = $('#r-q').value.trim();
  try {
    const { rooms } = await api('GET', `/api/admin/rooms${term ? `?q=${encodeURIComponent(term)}` : ''}`);
    if (!rooms.length) return box.replaceChildren(emptyState(term ? 'Tidak ada meeting yang cocok.' : 'Belum ada meeting.', 'video'));
    box.replaceChildren(...rooms.map(roomItem));
  } catch (e) { fail(box, e); }
}

function roomItem(room) {
  return h('div', { class: 'room-item' },
    h('div', {},
      h('h3', {}, room.name,
        room.live ? h('span', { class: 'pill live', text: `${room.live} peserta online` }) : null,
        room.hasEvent ? h('span', { class: 'pill', text: 'Dipakai event' }) : null),
      h('div', { class: 'meta' },
        h('span', {}, icon('link', 15), 'ID: ', h('b', { text: room.id })),
        h('span', {}, icon('user', 15), `${room.owner} (${room.ownerEmail})`),
        room.scheduledAt ? h('span', {}, icon('calendar', 15), fmtDateTime(room.scheduledAt)) : null,
        h('span', {}, icon('clock', 15), room.lastUsedAt ? `Terakhir dipakai ${fmtDate(room.lastUsedAt)}` : `Dibuat ${fmtDate(room.createdAt)}`))),
    h('div', { class: 'acts' },
      h('button', {
        class: 'btn btn-ghost btn-sm', title: room.hasEvent ? 'Hapus event-nya terlebih dahulu' : 'Hapus meeting',
        disabled: room.hasEvent, onclick: () => removeRoom(room),
      }, icon('trash', 16))));
}

async function removeRoom(room) {
  if (!(await confirmDialog('Hapus meeting?',
    `Room "${room.name}" milik ${room.owner} beserta presentasinya akan dihapus permanen.`, 'Hapus'))) return;
  try { await api('DELETE', `/api/admin/rooms/${room.id}`); toast('Meeting dihapus', 'success'); loadRooms(); loadOverview(); }
  catch (e) { toast(e.message, 'error'); }
}

$('#r-q').addEventListener('input', debounce(loadRooms));

// ==================== Semua event ====================
async function loadEvents() {
  const box = $('#events');
  const term = $('#e-q').value.trim();
  try {
    const { events } = await api('GET', `/api/admin/events${term ? `?q=${encodeURIComponent(term)}` : ''}`);
    if (!events.length) return box.replaceChildren(emptyState(term ? 'Tidak ada event yang cocok.' : 'Belum ada event.', 'calendar'));
    box.replaceChildren(...events.map(eventItem));
  } catch (e) { fail(box, e); }
}

function eventItem(e) {
  const t = Date.now() / 1000;
  return h('div', { class: 'room-item' },
    h('div', {},
      h('h3', {}, e.title,
        h('span', { class: 'pill gray', text: e.category }),
        e.published ? null : h('span', { class: 'pill red', text: 'Draf' }),
        t >= e.startsAt && t <= e.endsAt ? h('span', { class: 'pill live', text: 'Berlangsung' }) : null),
      h('div', { class: 'meta' },
        h('span', {}, icon('user', 15), `${e.owner} (${e.ownerEmail})`),
        h('span', {}, icon('calendar', 15), fmtDateTime(e.startsAt)),
        h('span', {}, icon('users', 15), `${e.registered} terdaftar${e.quota ? ` / ${e.quota}` : ''}`),
        e.speaker ? h('span', {}, icon('mic', 15), e.speaker) : null,
        e.certificate ? h('span', {}, icon('award', 15), 'Bersertifikat') : null)),
    h('div', { class: 'acts' },
      h('a', { class: 'btn btn-ghost btn-sm', title: 'Lihat halaman event', href: `/event/${e.slug}` }, icon('eye', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus event', onclick: () => removeEvent(e) }, icon('trash', 16))));
}

async function removeEvent(e) {
  if (!(await confirmDialog('Hapus event?',
    `Event "${e.title}" milik ${e.owner}, ${e.registered} pendaftar, dan room-nya akan dihapus permanen. Sertifikat yang sudah terbit tidak bisa diverifikasi lagi.`, 'Hapus'))) return;
  try { await api('DELETE', `/api/admin/events/${e.id}`); toast('Event dihapus', 'success'); loadEvents(); loadOverview(); }
  catch (err) { toast(err.message, 'error'); }
}

$('#e-q').addEventListener('input', debounce(loadEvents));

loadOverview();
show();
