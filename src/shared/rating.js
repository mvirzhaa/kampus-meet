// Rating & komentar event (tidak wajib): bintang 1–5, komentar, dan bintang untuk tiap narasumber.
// Dipakai di halaman event, layar "Anda telah keluar dari meeting", dan dasbor.
import { h, icon, api, toast, modal, fmtDateTime } from './common.js';

const LABELS = ['Sangat buruk', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'];
/** Lima tombol bintang. */
export function starInput(value, onChange, { size = 30, label = 'Rating' } = {}) {
  let v = value || 0;
  const box = h('div', { class: 'rt-stars', role: 'radiogroup', 'aria-label': label });
  const paint = () => [...box.children].forEach((b, i) => { b.classList.toggle('on', i < v); b.setAttribute('aria-checked', String(i + 1 === v)); });
  for (let n = 1; n <= 5; n++) box.append(h('button', { type: 'button', role: 'radio', class: 'rt-star', style: { fontSize: size + 'px' }, title: LABELS[n - 1], 'aria-label': `${n} bintang — ${LABELS[n - 1]}`,
    onclick: () => { v = n; paint(); onChange(n); } }, '★'));
  paint();
  return box;
}
export const starsText = (avg) => '★★★★★'.slice(0, Math.round(avg || 0)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(avg || 0));
const summaryEl = (s) => h('div', { class: 'rt-sum' },
  h('div', { class: 'rt-avg' }, h('b', { text: s.count ? s.avg.toFixed(1) : '–' }), h('span', { class: 'rt-st', text: starsText(s.avg) }), h('small', { text: `${s.count} ulasan` })),
  s.count ? h('div', { class: 'rt-dist' }, ...[5, 4, 3, 2, 1].map(n => h('div', { class: 'rt-bar' }, h('span', { text: `${n}★` }),
    h('i', {}, h('em', { style: { width: `${Math.round((s.dist[n - 1] / s.count) * 100)}%` } })), h('small', { text: String(s.dist[n - 1]) })))) : null);

/**
 * Widget rating untuk satu event. compact = hanya formulir (layar keluar meeting).
 * Mengembalikan elemen (kosong bila tidak ada yang perlu ditampilkan pada mode compact).
 */
export async function ratingWidget(eventId, { compact = false, onDone } = {}) {
  const root = h('div', { class: `rt${compact ? ' compact' : ''}` });
  let d;
  try { d = await api('GET', `/api/events/${eventId}/rating`); } catch { return root; }
  const draw = () => {
    const kids = [];
    if (!compact) kids.push(h('h3', { text: 'Rating & ulasan' }), summaryEl(d.summary));
    if (!compact && d.summary.speakers?.length) kids.push(h('div', { class: 'rt-spk' }, ...d.summary.speakers.map(s => h('span', {}, icon('mic', 14), `${s.name}: `, h('b', { text: `${s.avg.toFixed(1)}★` }), ` (${s.count})`))));
    if (d.can.ok) kids.push(d.mine && !root.dataset.edit ? mineEl() : formEl());
    else if (!compact && d.can.reason !== 'owner') kids.push(h('p', { class: 'rt-note' }, icon('info', 15), d.can.message));
    if (!compact && d.recent.length) kids.push(h('div', { class: 'rt-list' }, ...d.recent.map(r => h('div', { class: 'rt-item' },
      h('div', {}, h('b', { text: r.name }), h('span', { class: 'rt-st', text: starsText(r.rating) }), h('small', { text: fmtDateTime(r.at) })), h('p', { text: r.comment })))));
    root.replaceChildren(...kids);
  };
  const mineEl = () => h('div', { class: 'rt-mine' }, icon('circle-check', 18),
    h('span', {}, 'Rating Anda: ', h('b', { class: 'rt-st', text: starsText(d.mine.rating) }), d.mine.comment ? ` — “${d.mine.comment.slice(0, 120)}${d.mine.comment.length > 120 ? '…' : ''}”` : ''),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { root.dataset.edit = '1'; draw(); } }, 'Ubah'));
  const formEl = () => {
    let val = d.mine?.rating || 0;
    const sp = { ...(d.mine?.speakers || {}) };
    const msg = h('small', { class: 'rt-msg', text: val ? LABELS[val - 1] : 'Tidak wajib — ketuk bintang untuk menilai' });
    const note = h('textarea', { rows: compact ? 2 : 3, maxlength: 1500, placeholder: 'Komentar atau saran untuk penyelenggara (opsional)', 'aria-label': 'Komentar' });
    note.value = d.mine?.comment || '';
    const send = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
      if (!val) { msg.textContent = 'Pilih bintang 1–5 dulu.'; return; }
      send.disabled = true;
      try {
        const r = await api('POST', `/api/events/${eventId}/rating`, { rating: val, comment: note.value.trim(), speakers: sp });
        d.summary = r.summary; d.mine = { rating: val, comment: note.value.trim(), speakers: sp };
        delete root.dataset.edit; toast('Terima kasih atas penilaiannya!', 'success'); draw(); onDone?.(d);
      } catch (e) { msg.textContent = e.message; send.disabled = false; }
    } }, d.mine ? 'Simpan perubahan' : 'Kirim rating');
    return h('div', { class: 'rt-form' },
      h('b', { text: compact ? 'Bagaimana event ini? Beri rating (opsional)' : (d.mine ? 'Ubah rating Anda' : 'Beri rating untuk event ini (opsional)') }),
      starInput(val, (n) => { val = n; msg.textContent = LABELS[n - 1]; }, { size: compact ? 34 : 32, label: 'Rating event' }), msg,
      d.speakers.length ? h('div', { class: 'rt-sp-in' }, h('small', { text: 'Penilaian narasumber (opsional)' }),
        ...d.speakers.map(name => h('div', { class: 'rt-sp-row' }, h('span', { text: name }), starInput(sp[name] || 0, (n) => { sp[name] = n; }, { size: 20, label: `Rating ${name}` })))) : null,
      note, h('div', { class: 'rt-acts' }, d.mine ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { delete root.dataset.edit; draw(); } }, 'Batal') : null, send));
  };
  if (compact && (!d.can.ok || d.mine)) return root;   // layar keluar: tampil hanya bila boleh & belum menilai
  draw();
  return root;
}

/** Semua ulasan satu event (penyelenggara/admin). */
export async function ratingsModal(ev) {
  let d; try { d = await api('GET', `/api/events/${ev.id}/ratings`); } catch (e) { toast(e.message, 'error'); return; }
  const s = d.summary;
  modal({ title: `Ulasan — ${ev.title}`, wide: true, cls: 'modal-xl',
    body: h('div', { class: 'rt' }, summaryEl(s),
      h('p', { class: 'rt-note' }, icon('users', 15), `${s.count} dari ${d.attended} peserta memberi rating.`),
      s.speakers?.length ? h('div', { class: 'rt-spk' }, ...s.speakers.map(x => h('span', {}, icon('mic', 14), `${x.name}: `, h('b', { text: `${x.avg.toFixed(1)}★` }), ` (${x.count})`))) : null,
      d.ratings.length ? h('div', { class: 'rt-list' }, ...d.ratings.map(r => h('div', { class: 'rt-item' },
        h('div', {}, h('b', { text: r.name }), h('span', { class: 'rt-st', text: starsText(r.rating) }), h('small', { text: `${r.email} · ${fmtDateTime(r.at)}` })),
        r.comment ? h('p', { text: r.comment }) : null,
        Object.keys(r.speakers || {}).length ? h('small', { class: 'rt-spx', text: Object.entries(r.speakers).map(([k, v]) => `${k}: ${v}★`).join(' · ') }) : null)))
        : h('p', { class: 'ev-meta', text: 'Belum ada ulasan.' })),
    actions: [{ label: 'Tutup', cls: 'btn-primary' }] });
}
