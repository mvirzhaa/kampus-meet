// Panel admin: kategori event, pengguna, serta seluruh meeting & event di sistem.
import { initSite, $, $$, h, icon, api, toast, modal, confirmDialog, fmtDate, fmtDateTime,
  requireLogin } from '../shared/common.js';
import { emptyState } from '../shared/ui.js';
import { eventForm } from '../shared/eventform.js';
import { inviteManager } from '../shared/invites.js';
import { speakerCertManager } from '../shared/speakers.js';

const me = await initSite();
if (!requireLogin()) throw new Error('login');
if (me.user.role !== 'admin') { location.replace('/dashboard'); throw new Error('bukan admin'); }

// ---------- Navigasi seksi ----------
function show() {
  const sec = (location.hash || '#statistik').slice(1).split('?')[0];
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== sec;
  for (const a of $$('.side a[data-sec]')) a.classList.toggle('active', a.dataset.sec === sec);
  ({ statistik: loadStats, pengaturan: loadSettings, kategori: loadCats, pengguna: loadUsers, meeting: loadRooms, event: loadEvents,
    sertifikat: loadCerts, masukan: loadFeedback, azan: loadAzan, android: loadApk })[sec]?.();
}
addEventListener('hashchange', show);

// ---------- Aplikasi Android: unggah APK + keterangan pembaruan ----------
const fmtMB = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
let apkBound = false, apkMax = 300, apkFile = null;
async function loadApk() {
  let d;
  try { d = await api('GET', '/api/admin/app-releases'); } catch (e) { return fail($('#apk-list'), e); }
  apkMax = d.maxMb;
  $('#apk-limit').textContent = `File .apk maksimal ${d.maxMb} MB (paket ${d.package}). Dikirim bertahap per ${d.chunkMb} MB sehingga aman untuk file besar dan koneksi lambat.`;
  const rows = d.releases.filter(r => r.status !== 'uploading');
  $('#apk-list').replaceChildren(...(rows.length ? rows.map(r => apkItem(r, r.id === d.latestId)) : [emptyState('Belum ada APK yang diunggah.', 'smartphone')]));
  if (apkBound) return; apkBound = true;
  const pick = (f) => {
    if (!f) return;
    if (!/\.apk$/i.test(f.name)) return toast('Pilih file berekstensi .apk', 'error');
    if (f.size > apkMax * 1048576) return toast(`File terlalu besar (maks. ${apkMax} MB).`, 'error');
    apkFile = f;
    $('#apk-pick').replaceChildren(h('b', { text: f.name }), ` · ${fmtMB(f.size)}`);
    $('#apk-drop').classList.add('has');
  };
  $('#apk-file').addEventListener('change', (e) => { pick(e.target.files[0]); e.target.value = ''; });
  const drop = $('#apk-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
  $('#apk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!apkFile) return toast('Pilih file APK terlebih dahulu.', 'error');
    const notes = $('#apk-notes').value.trim();
    if (notes.length < 3) { $('#apk-notes').focus(); return toast('Tulis keterangan pembaruan.', 'error'); }
    const btn = $('#apk-submit'); btn.disabled = true;
    const bar = $('#apk-bar'), txt = $('#apk-ptext'); $('#apk-progress').hidden = false;
    const prog = (n, label) => { bar.style.width = `${Math.round(n * 100)}%`; txt.textContent = label; };
    try {
      const f = apkFile;
      const s = await api('POST', '/api/admin/app-releases', { size: f.size, fileName: f.name });
      let off = 0, retries = 0;
      while (off < f.size) {
        try {
          const r = await api('PUT', `/api/admin/app-releases/${s.id}/chunk?offset=${off}`, f.slice(off, off + s.chunkSize), { 'Content-Type': 'application/octet-stream' });
          off = r.received; retries = 0;
        } catch (err) {
          // Koneksi putus / posisi tidak cocok: tanyakan posisi terakhir di server lalu lanjutkan
          if (++retries > 5) throw err;
          await new Promise(res => setTimeout(res, 1500 * retries));
          if (err.status === 409) { const r = await fetch(`/api/admin/app-releases/${s.id}/chunk?offset=-1`, { method: 'PUT', headers: { 'X-CSRF-Token': me.csrf }, body: new Blob([]) }).then(x => x.json()).catch(() => ({})); if (Number.isFinite(r.received)) off = r.received; }
        }
        prog(off / f.size * 0.97, `Mengunggah… ${fmtMB(off)} dari ${fmtMB(f.size)}`);
      }
      prog(0.98, 'Memeriksa APK & membaca versi…');
      const r = await api('POST', `/api/admin/app-releases/${s.id}/finish`, {
        notes, publish: $('#apk-pub').checked, version: $('#apk-ver').value.trim(), versionCode: $('#apk-code').value,
      });
      prog(1, `Selesai: versi ${r.release.version} (versionCode ${r.release.versionCode}).`);
      toast(`APK versi ${r.release.version} ${r.release.status === 'published' ? 'diterbitkan' : 'tersimpan (belum diterbitkan)'}.`, 'success', 6000);
      if (r.warning) toast(r.warning, 'error', 14000);
      apkFile = null; $('#apk-form').reset(); $('#apk-drop').classList.remove('has');
      $('#apk-pick').replaceChildren(h('b', { text: 'Pilih file APK' }), ' atau tarik ke sini');
      loadApk();
    } catch (err) { toast(err.message, 'error', 9000); txt.textContent = `Gagal: ${err.message}`; }
    finally { btn.disabled = false; }
  });
}
function apkItem(r, latest) {
  const st = r.status === 'published' ? (latest ? h('span', { class: 'pill green', text: 'Terbaru · tampil' }) : h('span', { class: 'pill gray', text: 'Terbit (versi lama)' })) : h('span', { class: 'pill red', text: 'Disembunyikan' });
  return h('div', { class: 'room-item apk-item' },
    h('div', {},
      h('h3', {}, `Versi ${r.version}`, h('span', { class: 'pill', text: `versionCode ${r.versionCode}` }), st),
      h('div', { class: 'meta' },
        h('span', {}, icon('calendar', 15), fmtDateTime(r.publishedAt || r.createdAt)),
        h('span', {}, icon('download', 15), `${fmtMB(r.size)} · diunduh ${r.downloads}×`),
        r.minSdk ? h('span', {}, icon('smartphone', 15), `Android ${({ 21: '5.0', 22: '5.1', 23: '6', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' })[r.minSdk] || `API ${r.minSdk}`}+`) : null,
        r.uploadedBy ? h('span', {}, icon('user', 15), r.uploadedBy) : null,
        h('span', { title: 'SHA-256' }, icon('shield-check', 15), h('code', { text: (r.sha256 || '').slice(0, 16) + '…' }))),
      h('p', { class: 'apk-notes', text: r.notes })),
    h('div', { class: 'acts' },
      h('a', { class: 'btn btn-ghost btn-sm', href: `/api/admin/app-releases/${r.id}/file`, title: 'Unduh file APK ini' }, icon('download', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Ubah keterangan pembaruan', onclick: () => editApkNotes(r) }, icon('pencil', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: r.status === 'published' ? 'Sembunyikan dari halaman depan & aplikasi' : 'Terbitkan', onclick: async () => {
        try { await api('PATCH', `/api/admin/app-releases/${r.id}`, { published: r.status !== 'published' }); loadApk(); } catch (e) { toast(e.message, 'error'); }
      } }, icon(r.status === 'published' ? 'eye-off' : 'eye', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus rilis', onclick: async () => {
        if (!(await confirmDialog(`Hapus versi ${r.version}?`, 'File APK dihapus dari server. Pengguna tidak bisa lagi mengunduh versi ini.', 'Hapus'))) return;
        try { await api('DELETE', `/api/admin/app-releases/${r.id}`); toast('Rilis dihapus', 'success'); loadApk(); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash', 16))));
}
function editApkNotes(r) {
  const ta = h('textarea', { rows: 8, maxlength: 4000, 'aria-label': 'Keterangan pembaruan' }); ta.value = r.notes;
  modal({ title: `Keterangan pembaruan — versi ${r.version}`, body: ta, actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async () => {
    try { await api('PATCH', `/api/admin/app-releases/${r.id}`, { notes: ta.value }); toast('Keterangan disimpan', 'success'); loadApk(); } catch (e) { toast(e.message, 'error'); return false; }
  } }] });
}

// ---------- Notifikasi azan (rekaman takbir pembuka) ----------
let azanBound = false;
async function loadAzan() {
  const az = await import('../shared/azan.js');
  const nx = az.nextPrayer();
  $('#azan-today').replaceChildren(...az.prayerTimes().map(p => h('div', { class: 'azan-t' + (p.at.getTime() === nx.at.getTime() ? ' next' : '') }, h('span', { text: p.name }), h('b', { text: p.time }))));
  const st = await api('GET', '/api/admin/azan-audio').catch(() => ({ exists: false }));
  $('#azan-audio-state').textContent = st.exists
    ? `Rekaman terpasang${st.name ? `: ${st.name}` : ''} (${Math.max(1, Math.round(st.size / 1024))} KB).`
    : 'Belum ada rekaman — saat ini yang diputar adalah bunyi lonceng.';
  $('#azan-del').hidden = !st.exists;
  if (azanBound) return; azanBound = true;
  $('#azan-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return toast('Ukuran file maksimal 3 MB.', 'error');
    try { await api('POST', '/api/admin/azan-audio', f, { 'Content-Type': f.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name) }); toast('Suara azan tersimpan', 'success'); az.resetAzanAudio(); loadAzan(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#azan-play').addEventListener('click', async () => { az.resetAzanAudio(); if (!(await az.playAzan())) toast('Browser memblokir suara. Coba klik lagi.', 'info'); });
  $('#azan-del').addEventListener('click', async () => {
    if (!(await confirmDialog('Hapus rekaman azan?', 'Pengingat akan memakai bunyi lonceng sampai rekaman baru diunggah.', 'Hapus'))) return;
    await api('DELETE', '/api/admin/azan-audio'); az.resetAzanAudio(); toast('Rekaman dihapus', 'success'); loadAzan();
  });
}

/** Jalankan pencarian setelah pengguna berhenti mengetik, agar tidak membanjiri server. */
function debounce(fn, ms = 350) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const fail = (box, e) => box.replaceChildren(emptyState(e.message, 'alert'));

// ==================== Daftar berhalaman (dipakai semua tabel) ====================
/**
 * Muat satu halaman dari endpoint admin, render isinya, lalu tampilkan navigasi halaman di bawahnya.
 * params(): filter saat ini (q, role, status, …). Mengubah filter → kembali ke halaman 1.
 */
function pagedList({ box, url, params, render, empty, onData, per = 20 }) {
  const st = { page: 1, per, seq: 0 };
  const list = h('div'); const pager = h('nav', { class: 'pager', 'aria-label': 'Navigasi halaman' });
  box.replaceChildren(list, pager);
  async function load(page = st.page) {
    st.page = page; const my = ++st.seq;
    const sp = new URLSearchParams({ page: String(st.page), per: String(st.per) });
    for (const [k, v] of Object.entries(params?.() || {})) if (v !== '' && v != null && v !== false) sp.set(k, String(v));
    list.classList.add('loading');
    let d;
    try { d = await api('GET', `${url}?${sp}`); } catch (e) { if (my === st.seq) { list.classList.remove('loading'); fail(list, e); pager.replaceChildren(); } return; }
    if (my !== st.seq) return;
    list.classList.remove('loading');
    if (d.page > d.pages && d.total) return load(d.pages);
    onData?.(d);
    const filtered = Object.values(params?.() || {}).some(v => v !== '' && v != null && v !== false);
    list.replaceChildren(d.rows.length ? render(d.rows, d) : emptyState(filtered ? 'Tidak ada data yang cocok dengan pencarian/filter.' : empty[0], empty[1]));
    drawPager(d);
  }
  function drawPager(d) {
    if (!d.total) { pager.replaceChildren(); return; }
    const from = (d.page - 1) * d.per + 1; const to = Math.min(d.total, d.page * d.per);
    const btn = (label, page, opts = {}) => h('button', { type: 'button', class: `pg-btn ${opts.cur ? 'cur' : ''}`, disabled: opts.disabled || opts.cur, 'aria-current': opts.cur ? 'page' : null, 'aria-label': opts.aria || null, onclick: () => load(page) }, label);
    const nums = []; const P = d.pages; const c = d.page;
    const set = new Set([1, P, c - 1, c, c + 1].filter(x => x >= 1 && x <= P));
    let prev = 0;
    for (const n of [...set].sort((a, b) => a - b)) { if (n - prev > 1) nums.push(h('span', { class: 'pg-gap', text: '…' })); nums.push(btn(String(n), n, { cur: n === c, aria: `Halaman ${n}` })); prev = n; }
    const perSel = h('select', { 'aria-label': 'Baris per halaman', onchange: (e) => { st.per = +e.target.value; load(1); } },
      [10, 20, 50, 100].map(n => h('option', { value: n, selected: n === d.per, text: `${n} / halaman` })));
    pager.replaceChildren(
      h('span', { class: 'pg-info', text: `Menampilkan ${from}–${to} dari ${d.total.toLocaleString('id-ID')}` }),
      h('div', { class: 'pg-nums' }, btn(icon('chevron-left', 16), c - 1, { disabled: c <= 1, aria: 'Halaman sebelumnya' }), ...nums, btn(icon('chevron-right', 16), c + 1, { disabled: c >= P, aria: 'Halaman berikutnya' })),
      perSel);
  }
  return { load, reload: () => load(st.page), first: () => load(1) };
}
/** Pasang input pencarian (debounce) + select filter agar memuat ulang dari halaman 1. */
function bindFilters(pl, ...els) {
  for (const el of els) {
    if (!el) continue;
    if (el.type === 'search' || el.type === 'text') el.addEventListener('input', debounce(() => pl.first()));
    else el.addEventListener('change', () => pl.first());
  }
}
const table = (heads, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
  h('thead', {}, h('tr', {}, heads.map(t => h('th', { text: t })))), h('tbody', {}, rows)));

async function loadOverview() {
  try {
    const o = await api('GET', '/api/admin/overview');
    const tile = (label, value) => h('div', { class: 'stat' }, h('b', { text: String(value) }), label);
    $('#overview').replaceChildren(
      tile('Pengguna', o.users),
      tile('Meeting', o.rooms),
      tile('Event', o.events),
      tile('Sertifikat terbit', o.certificates ?? 0));
    $('#overview').hidden = false;
    const fb = $('#fb-badge'); fb.hidden = !o.feedbackUnread; fb.textContent = o.feedbackUnread > 99 ? '99+' : String(o.feedbackUnread || '');
  } catch { /* ringkasan bersifat tambahan; abaikan bila gagal */ }
}


// ==================== Pengaturan ====================
// Empat saklar "boleh membuat". Dosen/staf/admin tidak pernah terpengaruh.
const SETTING_GROUPS = [
  {
    judul: 'Mahasiswa & peran belum ditentukan',
    catatan: 'Berlaku untuk akun E-Portal berperan mahasiswa, dan akun yang perannya belum dikategorikan (user).',
    kunci: { allow_student_meeting: 'Boleh membuat meeting', allow_student_event: 'Boleh membuat event' },
  },
  {
    judul: 'Pendaftar luar',
    catatan: 'Akun yang mendaftar sendiri di UIKA Meet, tanpa akun E-Portal — misalnya narasumber atau peserta event umum.',
    kunci: { allow_external_meeting: 'Boleh membuat meeting', allow_external_event: 'Boleh membuat event' },
  },
];

function settingRow(key, label, on) {
  const input = h('input', {
    type: 'checkbox', checked: on,
    onchange: (e) => saveSetting(key, e.target.checked, e.target),
  });
  return h('tr', {},
    h('td', { text: label }),
    h('td', {}, h('label', { class: 'switch plain' }, input, h('i', {}))));
}

function settingCard(g, flags) {
  const rows = Object.entries(g.kunci).map(([key, label]) => settingRow(key, label, flags[key]));
  return h('div', { class: 'section-card' },
    h('h3', { text: g.judul }),
    h('p', { class: 'ev-meta', text: g.catatan }),
    h('table', { class: 'lock-table' }, h('tbody', {}, rows)));
}

async function loadSettings() {
  const box = $('#settings');
  try {
    const { flags } = await api('GET', '/api/admin/settings');
    box.replaceChildren(...SETTING_GROUPS.map(g => settingCard(g, flags)));
  } catch (e) { fail(box, e); }
}

async function saveSetting(key, value, input) {
  input.disabled = true;
  try { await api('PATCH', '/api/admin/settings', { [key]: value }); toast('Pengaturan disimpan', 'success', 2000); }
  catch (e) { toast(e.message, 'error'); input.checked = !value; }
  finally { input.disabled = false; }
}

// ==================== Kategori ====================
let catPL;
function loadCats() {
  if (!catPL) {
    catPL = pagedList({ box: $('#cats'), url: '/api/admin/categories', params: () => ({ q: $('#c-q').value.trim() }),
      render: (rows) => table(['Kategori', 'Dipakai', 'Status', 'Aksi'], rows.map(catRow)), empty: ['Belum ada kategori.', 'list-checks'] });
    bindFilters(catPL, $('#c-q'));
  }
  return catPL.reload();
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
let userPL;
function loadUsers() {
  if (!userPL) {
    userPL = pagedList({ box: $('#users'), url: '/api/admin/users',
      params: () => ({ q: $('#u-q').value.trim(), role: $('#u-role').value, status: $('#u-status').value }),
      render: (rows) => table(['Nama', 'Email', 'Peran', 'Aktivitas', 'Terdaftar', 'Aksi'], rows.map(userRow)), empty: ['Belum ada pengguna.', 'users'] });
    bindFilters(userPL, $('#u-q'), $('#u-role'), $('#u-status'));
  }
  return userPL.reload();
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
      u.ssoLinked ? h('span', { class: 'pill', title: `Peran E-Portal: ${u.institutionalRole || 'tidak diketahui'}` }, icon('shield-check', 14), 'E-Portal') : null,
      // Dua jalur masuk sekaligus: layak dilihat admin (lihat catatan risiko di README)
      u.ssoLinked && u.hasLocalPassword ? h('span', { class: 'pill red', title: 'Akun ini punya password lokal DAN tautan E-Portal' }, icon('alert', 14), 'Dua jalur') : null,
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


// ==================== Semua meeting ====================
let roomPL;
function loadRooms() {
  if (!roomPL) {
    roomPL = pagedList({ box: $('#rooms'), url: '/api/admin/rooms', params: () => ({ q: $('#r-q').value.trim() }),
      render: (rows) => h('div', { class: 'room-list' }, rows.map(roomItem)), empty: ['Belum ada meeting.', 'video'] });
    bindFilters(roomPL, $('#r-q'));
  }
  return roomPL.reload();
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


// ==================== Semua event ====================
let eventPL;
function loadEvents() {
  if (!eventPL) {
    eventPL = pagedList({ box: $('#events'), url: '/api/admin/events', params: () => ({ q: $('#e-q').value.trim(), when: $('#e-when').value }),
      render: (rows) => h('div', { class: 'room-list' }, rows.map(eventItem)), empty: ['Belum ada event.', 'calendar'] });
    bindFilters(eventPL, $('#e-q'), $('#e-when'));
  }
  return eventPL.reload();
}

/** Admin dapat mengubah event milik siapa pun (form yang sama dengan Dasbor penyelenggara). */
async function editEvent(e) {
  try {
    const { event } = await api('GET', `/api/events/${encodeURIComponent(e.slug)}`);
    await eventForm(event, { me, onSaved: () => { loadEvents(); loadOverview(); } });
  } catch (err) { toast(err.message, 'error'); }
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
        h('span', {}, icon('users', 15), `${e.registered} peserta${e.quota ? ` / ${e.quota}` : ''}`),
        e.speaker ? h('span', {}, icon('mic', 15), e.speaker) : null,
        e.certificate ? h('span', {}, icon('award', 15), `Bersertifikat${e.certs ? ` · ${e.certs} terbit` : ''}`) : null)),
    h('div', { class: 'acts' },
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Ubah event', 'aria-label': `Ubah event ${e.title}`, onclick: () => editEvent(e) }, icon('pencil', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Undangan peserta (email & notifikasi aplikasi)', 'aria-label': `Undangan event ${e.title}`, onclick: () => inviteManager(e) }, icon('user-plus', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Sertifikat narasumber / pemateri (cetak)', 'aria-label': `Sertifikat narasumber ${e.title}`, onclick: () => speakerCertManager(e) }, icon('award', 16)),
      e.registered ? h('a', { class: 'btn btn-ghost btn-sm', title: 'Lihat peserta & sertifikat', 'aria-label': 'Lihat peserta & sertifikat', href: `#sertifikat?event=${e.id}` }, icon('award', 16)) : null,
      h('a', { class: 'btn btn-ghost btn-sm', title: 'Lihat halaman event', href: `/event/${e.slug}` }, icon('eye', 16)),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hapus event', onclick: () => removeEvent(e) }, icon('trash', 16))));
}

async function removeEvent(e) {
  if (!(await confirmDialog('Hapus event?',
    `Event "${e.title}" milik ${e.owner}, ${e.registered} peserta, dan room-nya akan dihapus permanen. Sertifikat yang sudah terbit tidak bisa diverifikasi lagi.`, 'Hapus'))) return;
  try { await api('DELETE', `/api/admin/events/${e.id}`); toast('Event dihapus', 'success'); loadEvents(); loadOverview(); }
  catch (err) { toast(err.message, 'error'); }
}


// ==================== Statistik ====================
let statPeriod = 'day';
const P_NAME = { day: '30 hari terakhir', week: '12 minggu terakhir', month: '12 bulan terakhir' };
const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} mnt` : `${m} mnt`;
async function loadStats() {
  const box = $('#stats');
  box.classList.add('loading');
  let d;
  try { d = await api('GET', `/api/admin/stats?period=${statPeriod}`); } catch (e) { box.classList.remove('loading'); return fail(box, e); }
  box.classList.remove('loading');
  const charts = await import('../shared/charts.js');
  const labels = d.buckets.map(b => b.label); const full = d.buckets.map(b => b.full);
  const tile = (label, value, note) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-l', text: label }), h('b', { class: 'kpi-v', text: value.toLocaleString('id-ID') }), note ? h('small', { text: note }) : null);
  const c1 = h('div'), c2 = h('div'), c3 = h('div');
  box.replaceChildren(
    h('div', { class: 'kpis' },
      tile('Event dibuat', d.totals.events, P_NAME[statPeriod]),
      tile('Meeting dibuat', d.totals.rooms, 'di luar room event'),
      tile('Pengguna mengakses', d.totals.users, 'akun unik: login / masuk meeting'),
      tile('Peserta meeting', d.totals.people, `${d.totals.guests.toLocaleString('id-ID')} di antaranya tamu`)),
    h('div', { class: 'section-card cv-card' }, h('h3', { text: 'Event & meeting yang dibuat' }), h('p', { class: 'cv-sub', text: `Jumlah per ${statPeriod === 'day' ? 'hari' : statPeriod === 'week' ? 'minggu' : 'bulan'}, ${P_NAME[statPeriod]}` }), c1),
    h('div', { class: 'section-card cv-card' }, h('h3', { text: 'Pengguna yang mengakses' }), h('p', { class: 'cv-sub', text: 'Pengguna unik per periode: akun yang login/membuka situs atau masuk meeting, dan semua peserta meeting termasuk tamu' }), c2),
    h('div', { class: 'section-card cv-card' }, h('h3', { text: 'Pengguna paling aktif' }), h('p', { class: 'cv-sub', text: `Total waktu di dalam meeting, ${P_NAME[statPeriod]}` }), c3,
      d.top.length ? table(['#', 'Nama', 'Waktu di meeting', 'Sesi diikuti', 'Sebagai moderator', 'Meeting dibuat', 'Event dibuat', 'Login'],
        d.top.map((u, i) => h('tr', {}, h('td', { class: 'num', text: String(i + 1) }), h('td', {}, h('b', { text: u.name }), h('div', { class: 'muted-sm', text: u.email })),
          h('td', { class: 'num', text: fmtMin(u.minutes) }), h('td', { class: 'num', text: String(u.sessions) }), h('td', { class: 'num', text: String(u.hosted || 0) }),
          h('td', { class: 'num', text: String(u.rooms) }), h('td', { class: 'num', text: String(u.events) }), h('td', { class: 'num', text: String(u.logins) })))) : null));
  charts.timeChart(c1, { labels, full, kind: 'column', ariaLabel: 'Grafik event dan meeting yang dibuat',
    series: [{ name: 'Event dibuat', values: d.series.events }, { name: 'Meeting dibuat', values: d.series.rooms }] });
  charts.timeChart(c2, { labels, full, kind: 'line', ariaLabel: 'Grafik pengguna yang mengakses',
    series: [{ name: 'Pengguna (akun)', values: d.series.users }, { name: 'Peserta meeting (termasuk tamu)', values: d.series.people }] });
  if (d.top.length) charts.hbarChart(c3, { items: d.top.map(u => ({ label: u.name, value: u.minutes, tip: 'menit di meeting' })), unit: 'mnt', ariaLabel: 'Pengguna paling aktif berdasarkan waktu di meeting' });
  else c3.replaceChildren(emptyState('Belum ada aktivitas meeting pada periode ini.', 'users'));
}
for (const b of $$('#st-period [data-p]')) b.addEventListener('click', () => {
  statPeriod = b.dataset.p;
  for (const x of $$('#st-period [data-p]')) x.setAttribute('aria-checked', String(x === b));
  loadStats();
});

// ==================== Sertifikat peserta ====================
let certPL; let certEventsLoaded = false;
function certParams() { return { q: $('#ce-q').value.trim(), event: $('#ce-event').value, status: $('#ce-status').value }; }
function syncCsv() {
  const sp = new URLSearchParams({ format: 'csv' });
  for (const [k, v] of Object.entries(certParams())) if (v) sp.set(k, v);
  $('#cert-csv').href = `/api/admin/certificates?${sp}`;
}
async function loadCerts() {
  // Tautan dari daftar event: #sertifikat?event=12
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('event');
  if (!certEventsLoaded) {
    certEventsLoaded = true;
    try {
      const { events } = await api('GET', '/api/admin/certificates/events');
      $('#ce-event').append(...events.map(e => h('option', { value: e.id, text: `${e.title} — ${fmtDate(e.startsAt)}` })));
    } catch { /* filter event bersifat tambahan */ }
  }
  if (want) $('#ce-event').value = want;
  if (!certPL) {
    certPL = pagedList({ box: $('#certs'), url: '/api/admin/certificates', params: certParams,
      onData: (d) => {
        const s = d.summary;
        $('#cert-sum').replaceChildren(
          h('span', { class: 'pill' }, icon('users', 14), `${s.attendees.toLocaleString('id-ID')} peserta hadir`),
          h('span', { class: 'pill green' }, icon('award', 14), `${s.certs.toLocaleString('id-ID')} sertifikat terbit`),
          s.attendees - s.certs ? h('span', { class: 'pill gray', text: `${(s.attendees - s.certs).toLocaleString('id-ID')} belum memenuhi syarat` }) : null);
      },
      render: (rows) => table(['Peserta', 'Event', 'Kehadiran', 'Sertifikat'], rows.map(certRow)), empty: ['Belum ada peserta yang hadir di event.', 'award'] });
    bindFilters(certPL, $('#ce-q'), $('#ce-event'), $('#ce-status'));
    for (const el of [$('#ce-q'), $('#ce-event'), $('#ce-status')]) el.addEventListener(el.type === 'search' ? 'input' : 'change', syncCsv);
  }
  syncCsv();
  return certPL.first();
}
function certRow(c) {
  const ok = !!c.certCode;
  return h('tr', {},
    h('td', {}, h('b', { text: c.name }), h('div', { class: 'muted-sm', text: c.email })),
    h('td', {}, h('a', { href: `/event/${c.eventSlug}`, text: c.eventTitle }), h('div', { class: 'muted-sm', text: fmtDateTime(c.startsAt) })),
    h('td', {}, h('b', { text: `${c.attendedMin} menit` }), h('div', { class: 'muted-sm', text: `syarat ${c.minMinutes} menit${c.firstJoin ? ` · ${fmtTimeShort(c.firstJoin)}–${fmtTimeShort(c.lastLeave)}` : ''}` })),
    h('td', {}, ok
      ? h('div', { class: 'acts' }, h('code', { class: 'cert-code', text: c.certCode }),
        h('a', { class: 'btn btn-ghost btn-sm', href: `/sertifikat/${c.certCode}`, target: '_blank', rel: 'noopener', title: 'Buka sertifikat' }, icon('award', 15)),
        h('a', { class: 'btn btn-ghost btn-sm', href: `/verifikasi/${c.certCode}`, target: '_blank', rel: 'noopener', title: 'Halaman verifikasi' }, icon('shield-check', 15)))
      : h('span', { class: 'pill gray', text: c.certificateEnabled ? 'Belum memenuhi durasi' : 'Event tanpa sertifikat' })));
}
const fmtTimeShort = (t) => new Date(t * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');

// ==================== Masukan ====================
let fbPL;
const stars = (n) => h('span', { class: 'stars', 'aria-label': `${n} dari 5 bintang` }, [1, 2, 3, 4, 5].map(i => h('i', { class: i <= n ? 'on' : '', text: '★' })));
function loadFeedback() {
  if (!fbPL) {
    fbPL = pagedList({ box: $('#fbs'), url: '/api/admin/feedback',
      params: () => ({ q: $('#fb-q').value.trim(), source: $('#fb-source').value, rating: $('#fb-rating').value, unread: $('#fb-unread').checked ? 1 : '' }),
      onData: (d) => fbSummary(d.summary),
      render: (rows) => h('div', { class: 'fb-list' }, rows.map(fbItem)), empty: ['Belum ada masukan.', 'message-circle'] });
    bindFilters(fbPL, $('#fb-q'), $('#fb-source'), $('#fb-rating'), $('#fb-unread'));
    $('#fb-readall').addEventListener('click', async () => {
      try { await api('POST', '/api/admin/feedback-read-all'); toast('Semua masukan ditandai dibaca', 'success'); fbPL.reload(); loadOverview(); } catch (e) { toast(e.message, 'error'); }
    });
  }
  return fbPL.reload();
}
function fbSummary(s) {
  const total = s.dist.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...s.dist);
  $('#fb-sum').replaceChildren(h('div', { class: 'fb-sum' },
    h('div', { class: 'fb-avg' }, h('b', { text: s.avg != null ? s.avg.toFixed(1).replace('.', ',') : '–' }), stars(Math.round(s.avg || 0)),
      h('small', { text: `${total.toLocaleString('id-ID')} rating dari chatbot` })),
    h('div', { class: 'fb-dist', role: 'list', 'aria-label': 'Sebaran rating' }, [5, 4, 3, 2, 1].map(k => h('div', { class: 'fb-drow', role: 'listitem', title: `${k} bintang: ${s.dist[k - 1]}` },
      h('span', { text: `${k} ★` }), h('div', { class: 'fb-bar' }, h('i', { style: { width: `${(s.dist[k - 1] / max) * 100}%` } })), h('b', { text: String(s.dist[k - 1]) })))),
    h('div', { class: 'fb-counts' },
      h('div', {}, h('b', { text: String(s.chatbot) }), 'dari chatbot'),
      h('div', {}, h('b', { text: String(s.user) }), 'dari pengguna login'),
      h('div', {}, h('b', { text: String(s.unread) }), 'belum dibaca'))));
}
function fbItem(f) {
  const el = h('div', { class: `fb-item ${f.read ? '' : 'unread'}` },
    h('div', { class: 'fb-head' },
      f.source === 'chatbot' ? h('span', { class: 'pill' }, icon('message-circle', 13), 'Chatbot') : h('span', { class: 'pill green' }, icon('user', 13), 'Pengguna'),
      f.rating ? stars(f.rating) : null,
      h('b', { text: f.name || (f.source === 'chatbot' ? 'Tamu' : '—') }), f.email ? h('span', { class: 'muted-sm', text: f.email }) : null,
      h('span', { class: 'muted-sm fb-date', text: fmtDateTime(f.createdAt) }), f.read ? null : h('span', { class: 'fb-new', text: 'Baru' })),
    h('p', { class: 'fb-text', text: f.text || (f.source === 'chatbot' ? '(tanpa komentar)' : '') }),
    h('div', { class: 'acts' },
      f.hasChat ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => fbDetail(f) }, icon('message-square', 15), 'Lihat percakapan') : null,
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: f.read ? 'Tandai belum dibaca' : 'Tandai dibaca', onclick: async () => {
        try { await api('PATCH', `/api/admin/feedback/${f.id}`, { read: !f.read }); fbPL.reload(); loadOverview(); } catch (e) { toast(e.message, 'error'); }
      } }, icon(f.read ? 'eye-off' : 'check', 15), f.read ? 'Belum dibaca' : 'Dibaca'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Hapus', 'aria-label': 'Hapus masukan', onclick: async () => {
        if (!(await confirmDialog('Hapus masukan?', 'Masukan ini akan dihapus permanen.', 'Hapus'))) return;
        try { await api('DELETE', `/api/admin/feedback/${f.id}`); toast('Masukan dihapus', 'success'); fbPL.reload(); loadOverview(); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash', 15))));
  return el;
}
async function fbDetail(f) {
  try {
    const { feedback } = await api('GET', `/api/admin/feedback/${f.id}`);
    modal({ title: 'Percakapan chatbot', wide: true, body: h('div', {},
      h('div', { class: 'fb-head', style: { marginBottom: '10px' } }, stars(feedback.rating || 0), h('b', { text: feedback.name || 'Tamu' }), h('span', { class: 'muted-sm', text: fmtDateTime(feedback.createdAt) }),
        h('span', { class: 'pill gray', text: feedback.lang === 'en' ? 'English' : 'Indonesia' })),
      feedback.text ? h('p', { class: 'fb-text', text: feedback.text }) : null,
      h('div', { class: 'fb-chat' }, feedback.chat.map(m => h('div', { class: `fb-msg ${m.r === 'u' ? 'u' : 'b'}` }, h('small', { text: m.r === 'u' ? 'Pengguna' : 'Asisten' }), h('div', { text: m.t }))))),
    actions: [{ label: 'Tutup', cls: 'btn-primary' }] });
    fbPL.reload(); loadOverview();
  } catch (e) { toast(e.message, 'error'); }
}

loadOverview();
show();
