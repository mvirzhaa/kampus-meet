// Editor poster event (penyelenggara/admin): pratinjau langsung 1080×1350, tema warna (bawaan hijau UIKA Meet),
// narasumber + foto, benefit, kontak, keterangan posting; simpan → gambar PNG diterbitkan untuk tautan share.
import { initSite, $, h, icon, api, toast, copyText, requireLogin } from '../shared/common.js';
import { renderPoster, posterToBlob, shareLinks, nativeShare } from '../shared/poster.js';
import { saveBlob } from '../shared/export.js';

const me = await initSite();
if (!requireLogin()) throw new Error('login');
const id = location.pathname.split('/')[2];
let d;
try { d = await api('GET', `/api/events/${encodeURIComponent(id)}/poster-edit`); }
catch (e) { $('#pe-form').replaceChildren(h('div', { class: 'note-ok' }, icon('alert', 18), h('div', {}, h('strong', { text: 'Tidak dapat membuka poster' }), h('p', { text: e.message })))); throw e; }
if (me.user.role === 'admin' && document.referrer.includes('/admin')) $('.pe-head a').href = '/admin#event';
let p = structuredClone(d.poster);
let dirty = !d.saved;      // poster belum pernah disimpan → tombol simpan menonjol
$('#pe-sub').textContent = d.event.title;
document.title = `Poster — ${d.event.title}`;

// ---------- Pratinjau ----------
const posterEl = $('#pe-poster');
const data = () => ({ ...d, poster: p });
let tmr = 0;
const preview = () => { clearTimeout(tmr); tmr = setTimeout(() => renderPoster(posterEl, data()), 120); };
preview();
const changed = () => { dirty = true; $('#pe-save').classList.add('pulse'); preview(); };

// ---------- Form ----------
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { text: label }), input, hint ? h('small', { text: hint }) : null);
const text = (val, on, opt = {}) => { const el = h(opt.area ? 'textarea' : 'input', { maxlength: opt.max || 160, rows: opt.rows || 3, placeholder: opt.ph || '' }); el.value = val || ''; el.addEventListener('input', () => { on(el.value); changed(); }); return el; };
const sec = (title, ...kids) => h('details', { class: 'pe-sec', open: true }, h('summary', { text: title }), h('div', { class: 'pe-sec-body' }, ...kids));

function themeBox() {
  const custom = h('input', { type: 'color', value: p.color, 'aria-label': 'Warna sendiri' });
  const sw = Object.entries(d.themes).map(([k, t]) => h('button', { type: 'button', class: `pe-sw${p.theme === k ? ' on' : ''}`, title: t.name, 'aria-label': t.name, style: { background: t.color },
    onclick: () => { p.theme = k; p.color = t.color; custom.value = t.color; render(); changed(); } }));
  custom.addEventListener('input', () => { p.theme = 'custom'; p.color = custom.value; for (const b of document.querySelectorAll('.pe-sw')) b.classList.remove('on'); changed(); });
  return h('div', { class: 'pe-themes' }, ...sw, h('label', { class: `pe-sw custom${p.theme === 'custom' ? ' on' : ''}`, title: 'Warna sendiri' }, custom, icon('palette', 16)));
}

function speakersBox() {
  const box = h('div', { class: 'pe-speakers' });
  const draw = () => box.replaceChildren(...p.speakers.map((s, i) => {
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      if (f.size > 5 * 1024 * 1024) return toast('Foto maksimal 5 MB.', 'error');
      try { const r = await api('POST', `/api/events/${d.event.id}/poster/photo`, f, { 'Content-Type': f.type || 'application/octet-stream' }); s.photo = r.photo; s.photoUrl = r.photoUrl; draw(); changed(); }
      catch (e) { toast(e.message, 'error'); }
    });
    return h('div', { class: 'pe-spk' },
      h('div', { class: 'pe-spk-ph' }, s.photoUrl ? h('img', { src: s.photoUrl, alt: '' }) : icon('user', 26)),
      h('div', { class: 'pe-spk-f' },
        text(s.name, v => { s.name = v; }, { max: 90, ph: 'Nama & gelar narasumber' }),
        text(s.title, v => { s.title = v; }, { max: 90, ph: 'Jabatan, mis. Ka Biro BPPSI' }),
        h('div', { class: 'pe-spk-a' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => file.click() }, icon('image', 15), s.photoUrl ? 'Ganti foto' : 'Unggah foto'),
          s.photoUrl ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { s.photo = null; s.photoUrl = null; draw(); changed(); } }, 'Hapus foto') : null,
          h('button', { type: 'button', class: 'icon-btn', title: 'Hapus narasumber', 'aria-label': `Hapus ${s.name}`, onclick: () => { p.speakers.splice(i, 1); draw(); changed(); } }, icon('trash', 16)))),
      file);
  }), p.speakers.length < 4 ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { p.speakers.push({ name: '', title: '', photo: null, photoUrl: null }); draw(); } }, icon('plus', 15), 'Tambah narasumber') : null);
  draw();
  return box;
}

function listBox(arr, max, ph) {
  const box = h('div', { class: 'pe-list' });
  const draw = () => box.replaceChildren(...arr.map((v, i) => h('div', { class: 'pe-li' },
    text(v, nv => { arr[i] = nv; }, { max: 70, ph }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hapus', onclick: () => { arr.splice(i, 1); draw(); changed(); } }, icon('x', 16)))),
    arr.length < max ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { arr.push(''); draw(); } }, icon('plus', 15), 'Tambah') : null);
  draw();
  return box;
}

function captionBox() {
  const auto = h('input', { type: 'checkbox' }); auto.checked = !p.caption;
  const ta = h('textarea', { rows: 12, maxlength: 4000, class: 'pe-caption' });
  const sync = () => { ta.readOnly = auto.checked; ta.value = auto.checked ? d.autoCaption : (p.caption || d.autoCaption); };
  auto.addEventListener('change', () => { p.caption = auto.checked ? '' : ta.value; sync(); dirty = true; });
  ta.addEventListener('input', () => { p.caption = ta.value; dirty = true; });
  sync();
  return h('div', {}, h('label', { class: 'check' }, auto, 'Keterangan dibuat otomatis dari data event & poster'),
    ta, h('small', { class: 'ev-meta', text: 'Dipakai saat membagikan ke WhatsApp/Instagram/Facebook. Keterangan otomatis diperbarui setiap kali poster disimpan.' }));
}

function render() {
  $('#pe-form').replaceChildren(
    sec('Tema warna', themeBox(), h('small', { class: 'ev-meta', text: 'Bawaan: hijau UIKA Meet.' })),
    sec('Logo sponsor', h('small', { class: 'ev-meta', text: d.event.sponsors?.length
      ? `${d.event.sponsors.length} logo sponsor dari pengaturan event ikut tampil: kiri/kanan atas di bar logo atas, "Didukung oleh" di bawah poster.`
      : 'Event ini belum memiliki logo sponsor. Tambahkan lewat Dasbor → Event → Ubah → Logo sponsor; logonya otomatis ikut tampil di poster.' })),
    sec('Judul & ringkasan',
      field('Label seri / jenis kegiatan', text(p.series, v => { p.series = v; }, { max: 60, ph: 'mis. Webinar Edu Tech #10' })),
      field('Judul poster', text(p.headline, v => { p.headline = v; }, { max: 160, area: true, rows: 2 })),
      field('Ringkasan', text(p.summary, v => { p.summary = v; }, { max: 700, area: true, rows: 5 }), 'Ditarik dari deskripsi event; dipotong otomatis bila terlalu panjang.')),
    sec('Narasumber', speakersBox(), h('small', { class: 'ev-meta', text: 'Foto potret tegak (latar polos) terlihat paling bagus. Maksimal 4 narasumber.' })),
    sec('Benefit peserta', listBox(p.benefits, 6, 'mis. E-Sertifikat')),
    sec('Detail & tautan',
      field('Media', text(p.platform, v => { p.platform = v; }, { max: 70 })),
      field('Tautan tambahan (opsional)', h('div', { class: 'grid-2' },
        text(p.link.label, v => { p.link.label = v; }, { max: 40, ph: 'Label, mis. Virtual Background' }),
        text(p.link.url, v => { p.link.url = v; }, { max: 300, ph: 'https://…' }))),
      h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = p.showQr; c.addEventListener('change', () => { p.showQr = c.checked; changed(); }); return c; })(), 'Tampilkan QR code pendaftaran'),
      field('Contact person (opsional)', h('div', { class: 'grid-2' },
        text(p.contact.name, v => { p.contact.name = v; }, { max: 60, ph: 'Nama' }),
        text(p.contact.phone, v => { p.contact.phone = v; }, { max: 30, ph: '08xx-xxxx-xxxx' })))),
    sec('Footer (opsional)', h('div', { class: 'grid-2' },
      field('Email', text(p.footer.email, v => { p.footer.email = v; }, { max: 80 })),
      field('Situs web', text(p.footer.website, v => { p.footer.website = v; }, { max: 80 })),
      field('WhatsApp', text(p.footer.whatsapp, v => { p.footer.whatsapp = v; }, { max: 30 })),
      field('Instagram', text(p.footer.instagram, v => { p.footer.instagram = v; }, { max: 50 })))),
    sec('Keterangan untuk posting', captionBox()));
}
render();

// ---------- Simpan / unduh / bagikan ----------
let blobCache = null;
async function save() {
  const btn = $('#pe-save'); btn.disabled = true; const label = btn.lastChild.textContent; btn.lastChild.textContent = 'Menyimpan…';
  try {
    d = { ...d, ...(await api('PUT', `/api/events/${d.event.id}/poster`, p)) };
    p = structuredClone(d.poster);
    btn.lastChild.textContent = 'Membuat gambar…';
    blobCache = await posterToBlob(data());
    const r = await api('POST', `/api/events/${d.event.id}/poster/image`, blobCache, { 'Content-Type': 'image/png' });
    d.imageUrl = r.imageUrl; dirty = false; btn.classList.remove('pulse');
    render(); preview(); shareBox();
    toast('Poster tersimpan & siap dibagikan', 'success');
    return true;
  } catch (e) { toast(e.message, 'error', 7000); return false; }
  finally { btn.disabled = false; btn.lastChild.textContent = label; }
}
async function blob() { return blobCache && !dirty ? blobCache : (blobCache = await posterToBlob(data())); }
$('#pe-save').addEventListener('click', save);
$('#pe-dl').addEventListener('click', async () => {
  const b = $('#pe-dl'); b.disabled = true;
  try { saveBlob(await blob(), `Poster-${d.event.slug}.png`); } catch (e) { toast(`Gagal membuat gambar: ${e.message}`, 'error'); }
  finally { b.disabled = false; }
});
const ensureSaved = async () => (!dirty && d.imageUrl) || (await save());

function shareBox() {
  const L = shareLinks(d);
  const go = (fn) => async () => { if (await ensureSaved()) await fn(); };
  const canNative = !!navigator.canShare;
  $('#pe-share').replaceChildren(
    h('h3', {}, icon('send', 18), ' Bagikan poster'),
    h('p', { class: 'ev-meta', text: 'Satu tautan berisi poster + keterangan event. Di WhatsApp dan Facebook tautan ini tampil dengan gambar poster.' }),
    h('div', { class: 'link-box' }, h('code', { text: d.shareUrl }), h('button', { class: 'icon-btn', type: 'button', title: 'Salin tautan', onclick: () => copyText(d.shareUrl, 'Tautan share tersalin') }, icon('copy', 18))),
    h('div', { class: 'pe-share-btns' },
      h('button', { type: 'button', class: 'btn sh-wa', onclick: go(() => open(L.whatsapp, '_blank', 'noopener')) }, icon('message-circle', 18), 'WhatsApp'),
      h('button', { type: 'button', class: 'btn sh-fb', onclick: go(() => open(L.facebook, '_blank', 'noopener,width=640,height=560')) }, icon('globe', 18), 'Facebook'),
      h('button', { type: 'button', class: 'btn sh-ig', onclick: go(async () => {
        const b = await blob();
        try { if (await nativeShare(b, d)) return; } catch { /* dibatalkan */ }
        // Instagram tidak menerima tautan share dari web: unduh gambar + salin keterangan, lalu unggah di Instagram
        saveBlob(b, `Poster-${d.event.slug}.png`); copyText(d.caption, 'Keterangan tersalin');
        toast('Poster terunduh & keterangan tersalin. Unggah poster di Instagram lalu tempel keterangannya.', 'info', 9000);
        open(L.instagram, '_blank', 'noopener');
      }) }, icon('image', 18), 'Instagram'),
      canNative ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: go(async () => { try { if (!(await nativeShare(await blob(), d))) toast('Perangkat ini tidak mendukung berbagi gambar langsung.', 'info'); } catch { /* dibatalkan */ } }) }, icon('send', 18), 'Bagikan…') : null,
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => copyText(d.caption, 'Keterangan tersalin') }, icon('copy', 18), 'Salin keterangan'),
      h('a', { class: 'btn btn-ghost', href: d.shareUrl, target: '_blank', rel: 'noopener' }, icon('eye', 18), 'Buka halaman share')));
}
shareBox();
addEventListener('beforeunload', (e) => { if (dirty && d.saved) { e.preventDefault(); e.returnValue = ''; } });
