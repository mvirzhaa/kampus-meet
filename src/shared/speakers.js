// Sertifikat narasumber / pemateri (penyelenggara event & admin): tambah nama + peran, tautkan ke akun
// (opsional, agar muncul di "Sertifikat saya" milik narasumber), lalu lihat/unduh satu per satu atau cetak semua.
import { h, icon, api, toast, modal, confirmDialog } from './common.js';
import { SPEAKER_TEXTS } from './certdesign.js';

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
/** "Dr. A, M.Kom; Prof. B & C" → ["Dr. A, M.Kom", "Prof. B", "C"] (koma setelah gelar tidak memotong nama) */
export function splitSpeakers(s) {
  return String(s || '').split(/\s*(?:;|\s&\s|\sdan\s|\n|,(?=\s*(?:Dr|Prof|Ir|Drs|Dra|H|Hj|KH|Ust|Ustadz|Ustazah|Bapak|Ibu|Bpk)\b\.?))\s*/i)
    .map(x => x.trim()).filter(x => x.length >= 2).slice(0, 10);
}

export async function speakerCertManager(ev, { onClose } = {}) {
  let d;
  try { d = await api('GET', `/api/events/${ev.id}/speaker-certs`); } catch (e) { toast(e.message, 'error'); return; }
  let linked = null;   // { id, name, email } akun yang ditautkan ke baris baru
  let dirty = false;

  const name = h('input', { class: 'input', placeholder: 'Nama lengkap & gelar, mis. Dr. Siti Aminah, M.Kom.', maxlength: 120, 'aria-label': 'Nama narasumber' });
  const roleSel = h('select', { 'aria-label': 'Peran' }, ...d.roles.map(r => h('option', { value: r, text: r })), h('option', { value: '__other', text: 'Lainnya…' }));
  const roleOther = h('input', { class: 'input', placeholder: 'Peran lain', maxlength: 40, hidden: true, 'aria-label': 'Peran lain' });
  const acct = h('input', { type: 'search', class: 'input', placeholder: 'Tautkan ke akun (opsional): cari nama/email…', 'aria-label': 'Tautkan ke akun pengguna' });
  const acctRes = h('div', { class: 'inv-results', hidden: true });
  const acctTag = h('div', { class: 'sp-linked', hidden: true });
  const list = h('div', { class: 'inv-list' });
  const quick = h('div', { class: 'sp-quick' });
  const textIn = h('input', { class: 'input', maxlength: 220, placeholder: SPEAKER_TEXTS.text1, 'aria-label': 'Kalimat sertifikat narasumber' });
  textIn.value = d.speakerText || '';

  const role = () => (roleSel.value === '__other' ? roleOther.value.trim() : roleSel.value) || 'Narasumber';
  roleSel.addEventListener('change', () => { roleOther.hidden = roleSel.value !== '__other'; if (!roleOther.hidden) roleOther.focus(); });

  function setLinked(u) {
    linked = u; acct.value = ''; acctRes.hidden = true;
    acctTag.hidden = !u;
    acctTag.replaceChildren(...(u ? [icon('user-check', 15), h('span', { text: `Ditautkan ke ${u.name} (${u.email})` }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Lepas tautan', onclick: () => setLinked(null) }, icon('x', 16))] : []));
    if (u && !name.value.trim()) name.value = u.name;
  }
  acct.addEventListener('input', debounce(async () => {
    const term = acct.value.trim();
    if (term.length < 2) { acctRes.hidden = true; return; }
    try {
      const { users } = await api('GET', `/api/events/${ev.id}/speaker-candidates?q=${encodeURIComponent(term)}`);
      acctRes.hidden = false;
      acctRes.replaceChildren(...(users.length ? users.map(u => h('button', { type: 'button', class: 'inv-cand', onclick: () => setLinked(u) },
        h('span', { class: 'inv-who' }, h('b', { text: u.name }), h('small', { text: u.email })), h('span', { class: 'inv-add' }, icon('link', 15), 'Tautkan')))
        : [h('p', { class: 'inv-none', text: 'Tidak ditemukan. Narasumber tetap bisa ditambahkan tanpa akun.' })]));
    } catch { acctRes.hidden = true; }
  }, 250));

  const apply = (nd) => { d = nd; dirty = true; render(); };
  async function add(items) {
    try { apply(await api('POST', `/api/events/${ev.id}/speaker-certs`, { items })); toast(`${items.length} sertifikat narasumber dibuat`, 'success'); return true; }
    catch (e) { toast(e.message, 'error'); return false; }
  }
  async function addOne() {
    const n = name.value.trim();
    if (n.length < 2) { name.focus(); return toast('Isi nama narasumber.', 'error'); }
    if (await add([{ name: n, role: role(), userId: linked?.id }])) { name.value = ''; setLinked(null); name.focus(); }
  }
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });

  function render() {
    const have = new Set(d.speakers.map(s => s.name.toLowerCase()));
    const sugg = splitSpeakers(d.eventSpeaker).filter(n => !have.has(n.toLowerCase()));
    quick.hidden = !sugg.length;
    quick.replaceChildren(...(sugg.length ? [h('span', { text: 'Dari kolom narasumber event:' }),
      ...sugg.map(n => h('button', { type: 'button', class: 'chip-btn', onclick: () => add([{ name: n, role: 'Narasumber' }]) }, icon('plus', 14), n)),
      sugg.length > 1 ? h('button', { type: 'button', class: 'chip-btn strong', onclick: () => add(sugg.map(n => ({ name: n, role: 'Narasumber' }))) }, 'Tambah semua') : null] : []));
    if (!d.speakers.length) { list.replaceChildren(h('p', { class: 'inv-empty' }, icon('award', 18), 'Belum ada sertifikat narasumber. Tambahkan nama di atas.')); return; }
    list.replaceChildren(...d.speakers.map(s => h('div', { class: 'inv-row sp-row' },
      h('div', { class: 'inv-who' }, h('b', { text: s.name }), h('small', {}, h('code', { text: s.code }), s.email ? ` · akun ${s.email}` : '')),
      h('div', { class: 'inv-tags' }, h('span', { class: 'pill', text: s.role })),
      h('div', { class: 'sp-acts' },
        h('a', { class: 'icon-btn', href: `/sertifikat/${s.code}`, target: '_blank', rel: 'noopener', title: 'Lihat / cetak', 'aria-label': `Lihat sertifikat ${s.name}` }, icon('eye', 18)),
        h('a', { class: 'icon-btn', href: `/sertifikat/${s.code}?unduh=1`, target: '_blank', rel: 'noopener', title: 'Unduh PDF', 'aria-label': `Unduh PDF ${s.name}` }, icon('download', 18)),
        h('button', { class: 'icon-btn', type: 'button', title: 'Ubah nama / peran', 'aria-label': `Ubah ${s.name}`, onclick: () => edit(s) }, icon('pencil', 17)),
        h('button', { class: 'icon-btn', type: 'button', title: 'Hapus', 'aria-label': `Hapus ${s.name}`, onclick: async () => {
          if (!(await confirmDialog('Hapus sertifikat narasumber?', `Sertifikat ${s.name} (${s.code}) tidak akan bisa diverifikasi lagi.`, 'Hapus'))) return;
          try { apply(await api('DELETE', `/api/events/${ev.id}/speaker-certs/${s.id}`)); } catch (e) { toast(e.message, 'error'); }
        } }, icon('trash', 17))))));
  }
  function edit(s) {
    const n = h('input', { class: 'input', value: s.name, maxlength: 120, 'aria-label': 'Nama' });
    const r = h('input', { class: 'input', value: s.role, maxlength: 40, list: 'sp-roles', 'aria-label': 'Peran' });
    modal({ title: 'Ubah sertifikat narasumber', body: h('div', { class: 'sp-edit' }, h('label', { text: 'Nama' }), n, h('label', { text: 'Peran' }), r,
      h('datalist', { id: 'sp-roles' }, d.roles.map(x => h('option', { value: x }))), h('small', { class: 'ev-meta', text: 'Kode verifikasi tetap sama.' })),
    actions: [{ label: 'Batal' }, { label: 'Simpan', cls: 'btn-primary', onClick: async () => {
      try { apply(await api('PATCH', `/api/events/${ev.id}/speaker-certs/${s.id}`, { name: n.value, role: r.value })); } catch (e) { toast(e.message, 'error'); return false; }
    } }] });
  }

  render();
  const saveText = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
    try { apply(await api('PATCH', `/api/events/${ev.id}/speaker-text`, { text: textIn.value })); toast('Kalimat sertifikat disimpan', 'success'); } catch (e) { toast(e.message, 'error'); }
  } }, 'Simpan kalimat');
  modal({
    title: `Sertifikat narasumber — ${ev.title}`, wide: true, cls: 'modal-xl inv-modal sp-modal',
    body: h('div', { class: 'inv' },
      h('p', { class: 'sp-intro', text: 'Sertifikat untuk narasumber, pemateri, moderator, dan panitia pengisi acara. Tidak bergantung pada durasi kehadiran, memakai desain sertifikat event ini, dan bisa diverifikasi lewat QR seperti sertifikat peserta.' }),
      quick,
      h('div', { class: 'sp-add' }, name, h('div', { class: 'sp-role' }, roleSel, roleOther), h('button', { class: 'btn btn-primary', type: 'button', onclick: addOne }, icon('plus', 16), 'Tambah')),
      h('div', { class: 'inv-search' }, icon('link', 18), acct), acctRes, acctTag,
      h('div', { class: 'inv-head' }, h('h4', { text: 'Daftar sertifikat narasumber' })),
      list,
      h('details', { class: 'sp-text' }, h('summary', { text: 'Ubah kalimat sertifikat narasumber' }),
        h('div', { class: 'sp-text-row' }, textIn, saveText),
        h('small', { class: 'ev-meta', text: 'Placeholder: {peran}, {kategori}, {judul}, {tanggal}. Kosongkan untuk kalimat bawaan.' })),
      h('div', { class: 'inv-send' },
        h('div', { class: 'inv-send-txt' }, h('b', { text: 'Cetak sekaligus' }), h('small', { text: 'Semua sertifikat dalam satu halaman cetak (satu sertifikat per lembar A4 mendatar), atau unduh sebagai satu file PDF.' })),
        h('div', { class: 'inv-send-acts' },
          h('a', { class: 'btn btn-ghost', href: `/cetak-sertifikat/${ev.id}?jenis=peserta`, target: '_blank', rel: 'noopener' }, icon('users', 16), 'Sertifikat peserta'),
          h('a', { class: 'btn btn-primary', href: `/cetak-sertifikat/${ev.id}?jenis=narasumber`, target: '_blank', rel: 'noopener' }, icon('file', 16), 'Cetak semua narasumber')))),
    actions: [{ label: 'Selesai', cls: 'btn-primary' }],
    onClose: () => onClose?.(dirty),
  });
  acctRes.hidden = true;
  setTimeout(() => name.focus(), 40);
}
