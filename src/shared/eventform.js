// Form Buat/Ubah Event (judul, jadwal, password, sponsor, desain sertifikat), dipakai di Dasbor dan Panel Admin.
import { h, icon, api, toast, modal, formData, toLocalInput, fromLocalInput, fmtDate } from './common.js';
import { renderCertDesign, CERT_TEMPLATES } from './certdesign.js';

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

const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O dan 1/I agar tidak tertukar
const randomEventPw = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => PW_CHARS[b % PW_CHARS.length]).join('');
const SPONSOR_POS = { tl: ['Kiri atas'], tr: ['Kanan atas'], br: ['Kanan bawah', 'Di bawah tulisan "Didukung oleh"'] };

export async function eventForm(ev, { me, onSaved, onCreated } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const catField = await categorySelect(ev?.category);
  const start = ev?.startsAt || (Math.ceil(now / 3600) + 24) * 3600;

  // ----- Password event (opsional, 6 karakter acak) -----
  const pwOn = h('input', { type: 'checkbox', checked: !!ev?.hasPassword });
  const pwInput = h('input', { name: 'password', value: ev?.password || randomEventPw(), maxlength: 6, minlength: 6, pattern: '[A-Za-z0-9]{6}', autocomplete: 'off',
    style: { fontFamily: 'ui-monospace, Consolas, monospace', letterSpacing: '.25em', textTransform: 'uppercase', fontWeight: 700 } });
  const pwRow = h('div', { style: { display: 'flex', gap: '8px' } }, pwInput,
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Buat password acak baru', onclick: () => { pwInput.value = randomEventPw(); } }, icon('refresh', 16), 'Acak'));
  const syncPw = () => { pwRow.hidden = !pwOn.checked; pwInput.required = pwOn.checked; };
  pwOn.addEventListener('change', syncPw); syncPw();

  // ----- Sponsor (opsional, beberapa logo per posisi) -----
  const spOn = h('input', { type: 'checkbox', checked: !!ev?.sponsorsEnabled });
  const existing = (ev?.sponsors || []).map(x => ({ ...x }));
  const removed = new Set();
  const pending = { tl: [], tr: [], br: [] };
  const thumbs = {};
  const drawThumbs = (pos) => thumbs[pos].replaceChildren(
    ...existing.filter(x => x.position === pos && !removed.has(x.id)).map(x => h('span', { class: 'sp-thumb' }, h('img', { src: x.url, alt: x.name || 'logo' }),
      h('button', { type: 'button', title: 'Hapus logo', onclick: () => { removed.add(x.id); drawThumbs(pos); } }, icon('x', 14)))),
    ...pending[pos].map((file, i) => h('span', { class: 'sp-thumb new' }, h('img', { src: URL.createObjectURL(file), alt: file.name }),
      h('button', { type: 'button', title: 'Batalkan', onclick: () => { pending[pos].splice(i, 1); drawThumbs(pos); } }, icon('x', 14)))));
  const spRows = h('div', { class: 'sp-rows' }, Object.entries(SPONSOR_POS).map(([pos, label]) => {
    thumbs[pos] = h('div', { class: 'sp-thumbs' });
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, onchange: () => {
      for (const file of input.files) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast(`${file.name}: hanya PNG, JPG, atau WebP`, 'error'); continue; }
        if (file.size > 2 * 1024 * 1024) { toast(`${file.name}: maksimal 2 MB`, 'error'); continue; }
        pending[pos].push(file);
      }
      input.value = ''; drawThumbs(pos);
    } });
    drawThumbs(pos);
    return h('div', { class: 'sp-row' }, h('div', { class: 'sp-label' }, h('b', { text: label[0] }), label[1] ? h('small', { text: label[1] }) : null), thumbs[pos],
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => input.click() }, icon('upload', 15), 'Tambah logo'), input);
  }));
  const syncSp = () => { spRows.hidden = !spOn.checked; };
  spOn.addEventListener('change', syncSp); syncSp();

  // ----- Desain sertifikat (template + posisi teks), disunting di editor visual -----
  let certDesign = ev?.certDesign || null;
  let certBg = { url: ev?.certBgUrl || null, file: null, remove: false };
  const certPrev = h('div', { class: 'cd' });
  const certTpl = h('b');
  const sampleData = () => {
    const v = (n) => f.querySelector(`[name="${n}"]`)?.value?.trim() || '';
    const startVal = v('startsAt');
    return {
      name: 'Nama Peserta Contoh', title: v('title') || 'Judul Event Anda', category: catField.querySelector('select')?.value || catField.value || 'Seminar',
      speaker: v('speaker'), dateText: startVal ? fmtDate(fromLocalInput(startVal)) : fmtDate(start), durationText: '1 jam 30 menit',
      signerName: v('signerName') || 'Panitia Penyelenggara', signerTitle: v('signerTitle') || me.app.campus,
      code: 'CERT-ABCD-1234', verifyUrl: `${location.origin}/verifikasi/CERT-ABCD-1234`, app: me.app.name, campus: me.app.campus,
      sponsors: spOn.checked ? [...existing.filter(x => !removed.has(x.id)), ...Object.entries(pending).flatMap(([pos, files]) => files.map(file => ({ position: pos, url: URL.createObjectURL(file), name: file.name })))] : [],
    };
  };
  const drawCertPrev = () => {
    renderCertDesign(certPrev, certDesign, sampleData(), { bgUrl: certBg.url, logoMark: () => logoMarkImg() });
    certTpl.textContent = CERT_TEMPLATES[certDesign?.template || 'klasik'].name;
  };
  const certBox = h('div', { class: 'cd-mini' }, h('div', { class: 'cd-mini-prev' }, certPrev),
    h('div', {}, h('div', { class: 'ev-meta' }, 'Template: ', certTpl),
      h('p', { class: 'ev-meta', text: 'Pilih template atau unggah desain latar sendiri, lalu geser posisi nama, judul, QR, tanda tangan, dan teks lainnya.' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
        const { openCertEditor } = await import('../shared/certeditor.js');
        openCertEditor({ design: certDesign, bgUrl: certBg.url, sample: sampleData(), onSave: (d, bgAct) => {
          certDesign = d;
          if (bgAct?.file) certBg = { url: bgAct.url, file: bgAct.file, remove: false };
          else if (bgAct?.remove) certBg = { url: null, file: null, remove: true };
          drawCertPrev(); toast('Desain sertifikat diperbarui. Klik Simpan untuk menyimpan event.', 'success');
        } });
      } }, icon('pen', 15), 'Atur desain sertifikat')));

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
    h('div', { class: 'field' }, h('label', { class: 'check' }, pwOn, 'Gunakan password event'), pwRow,
      h('small', { text: 'Peserta yang sudah login dan membuka link event langsung bisa bergabung tanpa mendaftar. Bila password diaktifkan, password ditanyakan sekali saat pertama kali bergabung.' })),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { text: 'Nama penanda tangan sertifikat' }), h('input', { name: 'signerName', maxlength: 100, value: ev?.signerName || '', placeholder: 'mis. Dr. H. Ahmad Fauzi, M.Kom.' })),
      h('div', { class: 'field' }, h('label', { text: 'Jabatan penanda tangan' }), h('input', { name: 'signerTitle', maxlength: 120, value: ev?.signerTitle || '', placeholder: 'mis. Dekan Fakultas Teknik dan Sains' }))),
    h('small', { class: 'ev-meta', style: { display: 'block', marginTop: '-10px', marginBottom: '14px' }, text: 'Bila dikosongkan, sertifikat menampilkan "Panitia Penyelenggara" dan nama kampus.' }),
    h('div', { class: 'field' }, h('label', { text: 'Deskripsi' }), h('textarea', { name: 'description', rows: 4, maxlength: 4000 }, ev?.description || '')),
    h('div', { class: 'field' }, h('label', { class: 'check' }, spOn, 'Tampilkan logo sponsor di sertifikat'), spRows,
      h('small', { text: 'PNG, JPG, atau WebP, maks. 2 MB per logo, hingga 8 logo per posisi. Disarankan latar transparan.' })),
    h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'certificate', checked: ev ? ev.certificate : true }), 'Terbitkan sertifikat otomatis')),
    h('div', { class: 'field' }, h('label', { text: 'Desain sertifikat' }), certBox),
    h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'published', checked: ev ? ev.published : true }), 'Publikasikan (tampil di halaman Event)')));

  drawCertPrev();
  for (const n of ['title', 'speaker', 'signerName', 'signerTitle', 'startsAt']) f.querySelector(`[name="${n}"]`)?.addEventListener('change', drawCertPrev);
  const m = modal({ title: ev ? 'Ubah Event' : 'Buat Event', body: f, wide: true, actions: [{ label: 'Batal' }, { label: ev ? 'Simpan' : 'Buat Event', cls: 'btn-primary', keepOpen: true, onClick: async (e) => {
    if (!f.reportValidity()) return false;
    const d = formData(f); d.startsAt = fromLocalInput(d.startsAt); d.endsAt = fromLocalInput(d.endsAt);
    d.password = pwOn.checked ? pwInput.value.trim().toUpperCase() : '';
    d.sponsorsEnabled = spOn.checked;
    if (certDesign) d.certDesign = certDesign;
    e.target.disabled = true;
    try {
      const { event: saved } = ev ? await api('PATCH', `/api/events/${ev.id}`, d) : await api('POST', '/api/events', d);
      // Sponsor: hapus yang ditandai, lalu unggah logo baru satu per satu
      for (const id of removed) await api('DELETE', `/api/events/${saved.id}/sponsors/${id}`);
      let failed = 0;
      for (const [pos, files] of Object.entries(pending)) for (const file of files) {
        try { await api('POST', `/api/events/${saved.id}/sponsors`, file, { 'Content-Type': file.type, 'X-Position': pos, 'X-Filename': encodeURIComponent(file.name) }); }
        catch (err) { failed++; toast(`${file.name}: ${err.message}`, 'error', 6000); }
      }
      // Latar sertifikat (template "Gambar sendiri")
      try {
        if (certBg.file) await api('POST', `/api/events/${saved.id}/cert-bg`, certBg.file, { 'Content-Type': certBg.file.type });
        else if (certBg.remove && ev?.certBgUrl) await api('DELETE', `/api/events/${saved.id}/cert-bg`);
      } catch (err) { failed++; toast('Latar sertifikat: ' + err.message, 'error', 6000); }
      m.close(); toast(failed ? 'Event disimpan, sebagian file gagal diunggah' : 'Event disimpan', failed ? 'error' : 'success'); onSaved?.(saved);
      if (!ev) onCreated?.(saved);
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    return false;
  } }] });
}

export const logoMarkImg = () => h('img', { class: 'logo-mark-img', src: '/img/uika-meet-mark.svg', width: 34, height: 34, alt: '' });
