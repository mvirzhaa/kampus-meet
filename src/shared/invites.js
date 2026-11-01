// Kelola undangan event (pembuat event / admin): cari pengguna terdaftar, tambah/hapus peserta,
// atur "khusus undangan", lalu kirim email + push notification ke semua peserta dengan satu tombol.
import { h, icon, api, toast, modal, confirmDialog, fmtDateTime } from './common.js';

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export async function inviteManager(ev, { onChange, onClose } = {}) {
  let d;
  try { d = await api('GET', `/api/events/${ev.id}/invites`); } catch (e) { toast(e.message, 'error'); return; }

  const summary = h('div', { class: 'inv-summary' });
  const status = h('div', { class: 'inv-status' });
  const only = h('input', { type: 'checkbox', id: 'inv-only' });
  const results = h('div', { class: 'inv-results', role: 'listbox', 'aria-label': 'Hasil pencarian pengguna' });
  const search = h('input', { type: 'search', class: 'input', placeholder: 'Cari nama atau email pengguna terdaftar…', autocomplete: 'off', 'aria-label': 'Cari pengguna' });
  const filter = h('input', { type: 'search', class: 'input inv-filter', placeholder: 'Saring daftar…', 'aria-label': 'Saring daftar undangan' });
  const list = h('div', { class: 'inv-list' });
  const sendBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('send', 16), h('span'));
  const resendBtn = h('button', { class: 'btn btn-ghost', type: 'button', title: 'Kirim ulang email & notifikasi ke semua peserta undangan' }, icon('refresh', 16), 'Kirim ulang ke semua');

  let dirty = false;
  function apply(nd) { d = nd; dirty = true; render(); onChange?.(d); }

  function render() {
    const n = d.invites.length;
    summary.replaceChildren(
      h('span', { class: 'pill' }, icon('users', 14), `${n} diundang`),
      d.pending ? h('span', { class: 'pill red' }, icon('mail', 14), `${d.pending} belum dikirimi undangan`) : n ? h('span', { class: 'pill green' }, icon('mail-check', 14), 'Semua sudah dikirimi undangan') : null,
      n ? h('span', { class: 'pill gray' }, icon('user-check', 14), `${d.invites.filter(i => i.joined).length} sudah bergabung`) : null);
    only.checked = d.inviteOnly;
    status.replaceChildren(
      h('span', { class: `pill ${d.mail ? 'green' : 'gray'}` }, icon('mail', 14), d.mail ? 'Email aktif' : 'Email belum diatur admin'),
      h('span', { class: `pill ${d.push ? 'green' : 'gray'}` }, icon('bell', 14), d.push ? 'Notifikasi aplikasi aktif' : 'Notifikasi aplikasi belum diatur admin'),
      h('span', { class: 'pill gray' }, icon('clock', 14), `Pengingat otomatis ${d.reminderMinutes} menit sebelum mulai`));
    sendBtn.lastChild.textContent = d.pending ? `Kirim undangan (${d.pending})` : 'Kirim undangan';
    sendBtn.disabled = !d.pending;
    resendBtn.disabled = !n;
    filter.hidden = n < 8;
    renderList();
  }

  function renderList() {
    const term = filter.value.trim().toLowerCase();
    const rows = d.invites.filter(i => !term || i.name.toLowerCase().includes(term) || i.email.toLowerCase().includes(term));
    if (!d.invites.length) { list.replaceChildren(h('p', { class: 'inv-empty' }, icon('user-plus', 18), 'Belum ada peserta. Cari pengguna di atas lalu klik untuk menambahkan.')); return; }
    list.replaceChildren(...rows.map(i => h('div', { class: 'inv-row' },
      h('div', { class: 'inv-who' }, h('b', { text: i.name }), h('small', { text: i.email })),
      h('div', { class: 'inv-tags' },
        i.notifiedAt ? h('span', { class: 'pill green', title: `Undangan dikirim ${fmtDateTime(i.notifiedAt)}` }, icon('mail-check', 13), 'Terkirim')
          : h('span', { class: 'pill gray' }, 'Belum dikirim'),
        i.remindedAt ? h('span', { class: 'pill', title: `Pengingat dikirim ${fmtDateTime(i.remindedAt)}` }, icon('bell', 13), 'Diingatkan') : null,
        i.app ? h('span', { class: 'pill', title: 'Memakai aplikasi Android (menerima push notification)' }, icon('smartphone', 13), 'Aplikasi') : null,
        i.joined ? h('span', { class: 'pill green' }, icon('user-check', 13), 'Hadir') : null),
      h('button', { class: 'icon-btn', type: 'button', title: `Hapus ${i.name} dari undangan`, 'aria-label': `Hapus ${i.name}`, onclick: async () => {
        try { apply(await api('DELETE', `/api/events/${ev.id}/invites/${i.userId}`)); } catch (e) { toast(e.message, 'error'); }
      } }, icon('x', 18)))));
  }

  let lastUsers = [];
  async function add(ids) {
    try {
      const r = await api('POST', `/api/events/${ev.id}/invites`, { userIds: ids });
      apply(r);
      toast(r.added ? `${r.added} peserta ditambahkan` : 'Tidak ada yang ditambahkan', r.added ? 'success' : 'info');
      runSearch();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function runSearch() {
    const term = search.value.trim();
    if (term.length < 2) { results.replaceChildren(); results.hidden = true; return; }
    try {
      const { users } = await api('GET', `/api/events/${ev.id}/invite-candidates?q=${encodeURIComponent(term)}`);
      if (search.value.trim() !== term) return;
      lastUsers = users;
      results.hidden = false;
      results.replaceChildren(...(users.length ? [
        ...users.map(u => h('button', { type: 'button', class: 'inv-cand', role: 'option', onclick: () => add([u.id]) },
          h('span', { class: 'inv-who' }, h('b', { text: u.name }), h('small', { text: u.email })), h('span', { class: 'inv-add' }, icon('plus', 16), 'Tambah'))),
        users.length > 1 ? h('button', { type: 'button', class: 'inv-cand all', onclick: () => add(lastUsers.map(x => x.id)) }, icon('user-plus', 16), `Tambah semua (${users.length})`) : null,
      ] : [h('p', { class: 'inv-none', text: 'Tidak ada pengguna yang cocok (atau semuanya sudah diundang).' })]));
    } catch (e) { toast(e.message, 'error'); }
  }
  search.addEventListener('input', debounce(runSearch, 250));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (lastUsers.length === 1) add([lastUsers[0].id]); } });
  filter.addEventListener('input', renderList);
  only.addEventListener('change', async () => {
    try { apply(await api('PATCH', `/api/events/${ev.id}/invite-only`, { inviteOnly: only.checked })); toast(only.checked ? 'Hanya peserta undangan yang dapat bergabung' : 'Semua pengguna login dengan link dapat bergabung', 'success'); }
    catch (e) { only.checked = !only.checked; toast(e.message, 'error'); }
  });
  async function send(all) {
    if (all && !(await confirmDialog('Kirim ulang ke semua?', `Email dan notifikasi undangan akan dikirim lagi ke ${d.invites.length} peserta.`, 'Kirim ulang', false))) return;
    sendBtn.disabled = resendBtn.disabled = true;
    try {
      const r = await api('POST', `/api/events/${ev.id}/invites/send`, { all });
      apply(r);
      const parts = [r.mail ? `${r.emails} email diantrikan` : null, r.push ? `${r.pushes ?? 'beberapa'} notifikasi aplikasi terkirim` : null].filter(Boolean);
      toast(`Undangan dikirim ke ${r.recipients} peserta${parts.length ? ` (${parts.join(', ')})` : ''}.`, 'success', 6000);
    } catch (e) { toast(e.message, 'error', 6000); render(); }
  }
  sendBtn.addEventListener('click', () => send(false));
  resendBtn.addEventListener('click', () => send(true));

  render();
  modal({
    title: `Undangan — ${ev.title}`, wide: true, cls: 'modal-xl inv-modal',
    body: h('div', { class: 'inv' },
      summary,
      h('label', { class: 'check inv-only', for: 'inv-only' }, only,
        h('span', {}, h('b', { text: 'Khusus peserta undangan' }),
          h('small', { text: 'Bila aktif, hanya pengguna di daftar ini (serta Anda dan admin) yang dapat bergabung. Peserta undangan masuk tanpa password event.' }))),
      h('div', { class: 'inv-search' }, icon('search', 18), search), results,
      h('p', { class: 'inv-hint', text: 'Hanya pengguna yang sudah terdaftar di UIKA Meet. Akun admin tidak ditampilkan.' }),
      h('div', { class: 'inv-head' }, h('h4', { text: 'Daftar peserta undangan' }), filter),
      list,
      h('div', { class: 'inv-send' }, h('div', { class: 'inv-send-txt' },
        h('b', { text: 'Kirim undangan ke semua peserta' }),
        h('small', { text: 'Email berisi tautan gabung, tombol "Simpan ke Google Calendar", dan lampiran .ics. Peserta yang memakai aplikasi Android juga menerima push notification.' })),
        h('div', { class: 'inv-send-acts' }, resendBtn, sendBtn)),
      status,
      h('a', { class: 'inv-gcal', href: d.googleCalendarUrl, target: '_blank', rel: 'noopener' }, icon('calendar-plus', 16), 'Simpan event ini ke Google Calendar saya')),
    actions: [{ label: 'Selesai', cls: 'btn-primary' }],
    onClose: () => onClose?.(dirty),
  });
  results.hidden = true;
  setTimeout(() => search.focus(), 40);
}
