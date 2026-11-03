// Halaman share /p/:slug — poster + keterangan event, tombol gabung, dan tombol bagikan (WhatsApp, Facebook,
// Instagram). Meta Open Graph diisi server sehingga tautan ini tampil dengan gambar poster di WhatsApp/Facebook.
import { initSite, $, h, icon, api, toast, copyText } from '../shared/common.js';
import { renderPoster, posterToBlob, shareLinks, nativeShare } from '../shared/poster.js';
import { saveBlob } from '../shared/export.js';

await initSite();
document.getElementById('yr') && (document.getElementById('yr').textContent = new Date().getFullYear());
const slug = location.pathname.split('/')[2];
let d;
try { d = await api('GET', `/api/events/${encodeURIComponent(slug)}/poster`); }
catch (e) { $('#pv').replaceChildren(h('div', { class: 'empty', text: e.message })); throw e; }

const t = Date.now() / 1000;
const ended = t > d.event.endsAt + 3600;
let blobP = null;
const getBlob = async () => {
  if (d.imageUrl) { const r = await fetch(d.imageUrl); if (r.ok) return r.blob(); }
  return (blobP ??= posterToBlob(d));
};
const L = shareLinks(d);

const visual = d.imageUrl
  ? h('img', { class: 'pv-img', src: d.imageUrl, alt: `Poster ${d.event.title}`, width: 1080, height: 1350 })
  : (() => { const w = h('div', { class: 'pst-wrap' }); renderPoster(w, d); return w; })();

$('#pv').replaceChildren(h('div', { class: 'pv-grid' },
  h('div', { class: 'pv-left' }, visual),
  h('div', { class: 'pv-right' },
    h('span', { class: 'pill', text: d.event.category }),
    h('h1', { class: 'pv-title', text: d.event.title }),
    h('div', { class: 'pv-meta' },
      h('span', {}, icon('calendar', 17), d.event.dateText), h('span', {}, icon('clock', 17), d.event.timeText),
      d.poster.speakers.length ? h('span', {}, icon('mic', 17), d.poster.speakers.map(s => s.name).join(', ')) : null,
      d.event.organizer ? h('span', {}, icon('building', 17), `Penyelenggara: ${d.event.organizer}`) : null),
    h('div', { class: 'pv-cta' },
      ended ? h('span', { class: 'pill gray', text: 'Event telah selesai' })
        : h('a', { class: 'btn btn-primary', href: `/event/${d.event.slug}` }, icon('door', 18), 'Daftar / Gabung ke event'),
      d.canEdit ? h('a', { class: 'btn btn-ghost', href: `/poster/${d.event.id}` }, icon('pencil', 18), 'Ubah poster') : null),
    h('h3', { text: 'Bagikan' }),
    h('div', { class: 'pe-share-btns' },
      h('a', { class: 'btn sh-wa', href: L.whatsapp, target: '_blank', rel: 'noopener' }, icon('message-circle', 18), 'WhatsApp'),
      h('a', { class: 'btn sh-fb', href: L.facebook, target: '_blank', rel: 'noopener' }, icon('globe', 18), 'Facebook'),
      h('button', { type: 'button', class: 'btn sh-ig', onclick: async () => {
        try { const b = await getBlob(); if (await nativeShare(b, d)) return; saveBlob(b, `Poster-${d.event.slug}.png`); }
        catch { /* dibatalkan */ }
        copyText(d.caption, 'Keterangan tersalin');
        toast('Poster terunduh & keterangan tersalin. Unggah poster di Instagram lalu tempel keterangannya.', 'info', 9000);
      } }, icon('image', 18), 'Instagram'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => copyText(d.shareUrl, 'Tautan tersalin') }, icon('link', 18), 'Salin tautan'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => { try { saveBlob(await getBlob(), `Poster-${d.event.slug}.png`); } catch (e) { toast(e.message, 'error'); } } }, icon('download', 18), 'Unduh poster')),
    h('div', { class: 'pv-caption' },
      h('div', { class: 'pv-cap-head' }, h('b', { text: 'Keterangan' }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(d.caption, 'Keterangan tersalin') }, icon('copy', 15), 'Salin')),
      h('pre', { text: d.caption })))));
