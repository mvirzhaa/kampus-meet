// Editor visual desain sertifikat (di form tambah/ubah event).
// Penyelenggara memilih template, menggeser tiap elemen dengan mouse/jari, serta mengatur ukuran, lebar,
// perataan, warna, isi teks, dan menyembunyikan elemen. Yang disimpan hanya perubahan dari bawaan template.
import { h, icon, modal, toast, logoMark, confirmDialog } from './common.js';
import { qrSvg } from './qr.js';
import { renderCertDesign, resolveLayout, defaultLayout, CERT_TEMPLATES, CERT_ELEMENTS, DEFAULT_TEXTS, PLACEHOLDER_HELP } from './certdesign.js';

const clone = (o) => JSON.parse(JSON.stringify(o || {}));
const round = (n) => Math.round(n * 10) / 10;

/**
 * @param {object} o
 * @param {object|null} o.design   desain tersimpan { template, els }
 * @param {string|null} o.bgUrl    latar tersimpan (template gambar)
 * @param {object} o.sample        data contoh untuk pratinjau
 * @param {(design: object, bg: {file?: File, remove?: boolean}|null) => void} o.onSave
 */
export function openCertEditor({ design, bgUrl, sample, onSave }) {
  const st = { template: design?.template || 'klasik', els: clone(design?.els) };
  let bg = { url: bgUrl || null, file: null, remove: false };
  let sel = 'name';
  const root = h('div', { class: 'cd' });
  const stage = h('div', { class: 'cde-stage' }, root);
  const side = h('div', { class: 'cde-side' });
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Gunakan gambar PNG, JPG, atau WebP.', 'error');
    if (f.size > 6 * 1024 * 1024) return toast('Ukuran gambar maksimal 6 MB.', 'error');
    if (bg.file && bg.url?.startsWith('blob:')) URL.revokeObjectURL(bg.url);
    bg = { url: URL.createObjectURL(f), file: f, remove: false };
    st.template = 'gambar'; draw();
  } });

  const L = () => resolveLayout(st).els;
  const setProp = (id, k, v) => { st.els[id] = { ...(st.els[id] || {}), [k]: v }; draw(); };
  const resetEl = (id) => { delete st.els[id]; draw(); };

  function drawStage() {
    renderCertDesign(root, st, sample, {
      bgUrl: bg.url, editable: true, selected: sel,
      logoMark: () => logoMark(34), qrSvg: (t) => qrSvg(t, { label: 'QR verifikasi (contoh)' }),
    });
    if (st.template === 'gambar' && !bg.url) root.append(h('div', { class: 'cd-el cd-ph', style: { left: '50%', top: '50%', fontSize: '1.6cqw', background: '#fff' } }, 'Unggah gambar latar di panel kanan'));
  }

  function drawSide() {
    const els = L(); const cur = els[sel]; const def = CERT_ELEMENTS.find(e => e.id === sel);
    const seg = (key, opts) => h('div', { class: 'seg' }, opts.map(([v, label]) => h('button', { type: 'button', class: cur[key] === v ? 'on' : '', onclick: () => setProp(sel, key, v) }, label)));
    const range = (label, key, min, max, step, fmt = (v) => v) => {
      const out = h('span', { text: String(fmt(cur[key])) });
      const r = h('input', { type: 'range', min, max, step, value: cur[key], oninput: (e) => { out.textContent = fmt(+e.target.value); live(sel, key, +e.target.value); }, onchange: (e) => setProp(sel, key, +e.target.value) });
      return h('div', { class: 'row' }, h('span', { text: label }), r, out);
    };
    const isText = def.kind === 'text';
    const sizeLabel = def.kind === 'qr' ? null : def.kind === 'sponsors' ? 'Tinggi logo' : 'Ukuran huruf';
    side.replaceChildren(
      h('div', {}, h('h4', { text: 'Template dasar' }),
        h('div', { class: 'cde-tpls' }, Object.entries(CERT_TEMPLATES).map(([k, t]) => h('button', { type: 'button', class: `cde-tpl${st.template === k ? ' active' : ''}`, dataset: { t: k }, title: t.desc,
          onclick: () => { st.template = k; if (k === 'gambar' && !bg.url) fileIn.click(); draw(); } }, h('i'), t.name))),
        st.template === 'gambar' ? h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => fileIn.click() }, icon('upload', 15), bg.url ? 'Ganti gambar latar' : 'Unggah gambar latar'),
          bg.url ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { bg = { url: null, file: null, remove: true }; draw(); } }, icon('trash', 15), 'Hapus') : null,
          h('small', { class: 'cde-hint', text: 'Desain latar A4 mendatar (mis. 3508×2480 px). Teks & QR tetap diatur di atasnya.' })) : null),
      h('div', {}, h('h4', { text: 'Elemen (klik untuk memilih, geser di pratinjau)' }),
        h('div', { class: 'cde-els' }, CERT_ELEMENTS.map(e => h('button', { type: 'button', class: e.id === sel ? 'active' : '', onclick: () => { sel = e.id; draw(); } },
          e.label, els[e.id].hidden ? h('span', { class: 'off', text: 'disembunyikan' }) : null)))),
      h('div', { class: 'cde-props' },
        h('b', { text: def.label }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !cur.hidden, onchange: (e) => setProp(sel, 'hidden', !e.target.checked) }), 'Tampilkan di sertifikat'),
        isText ? h('div', {}, h('input', { value: cur.text ?? DEFAULT_TEXTS[sel], maxlength: 220, onchange: (e) => setProp(sel, 'text', e.target.value) }),
          h('small', { class: 'cde-hint', text: `Bisa memakai: ${PLACEHOLDER_HELP}` })) : null,
        sizeLabel ? range(sizeLabel, 'fs', 0.6, def.kind === 'sponsors' ? 9 : 10, 0.05, (v) => round(v)) : null,
        range(def.kind === 'qr' ? 'Ukuran QR' : 'Lebar area', 'w', def.kind === 'qr' ? 4 : 8, def.kind === 'qr' ? 30 : 100, 0.5, (v) => round(v) + '%'),
        range('Posisi X', 'x', 0, 100, 0.1, (v) => round(v)),
        range('Posisi Y', 'y', 0, 100, 0.1, (v) => round(v)),
        def.kind !== 'qr' ? h('div', { class: 'row' }, h('span', { text: 'Rata' }), seg('align', [['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan']]), h('span')) : null,
        def.kind !== 'qr' ? h('div', { class: 'row' }, h('span', { text: 'Warna' }),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('input', { type: 'color', value: cur.color || '#111111', onchange: (e) => setProp(sel, 'color', e.target.value) }),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { const o = { ...(st.els[sel] || {}) }; delete o.color; st.els[sel] = o; draw(); } }, 'Bawaan')), h('span')) : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => resetEl(sel) }, icon('refresh', 15), 'Kembalikan elemen ini')),
      h('p', { class: 'cde-hint', text: 'Tips: geser elemen langsung di pratinjau (muncul garis merah saat pas di tengah). Tombol panah menggeser 0,2% (Shift: 1%).' }),
      fileIn);
  }
  // Ubah tampilan langsung saat slider digeser (tanpa membangun ulang panel)
  function live(id, key, v) {
    const el = root.querySelector(`.cd-el[data-id="${id}"]`); if (!el) return;
    if (key === 'x') el.style.left = v + '%'; else if (key === 'y') el.style.top = v + '%';
    else if (key === 'w') el.style.width = v + '%'; else if (key === 'fs') el.style.setProperty('--fs', String(v));
  }
  function draw() { drawStage(); drawSide(); }

  // ----- Geser dengan mouse/jari -----
  let drag = null; const guideV = h('div', { class: 'cd-guide' }); const guideH = h('div', { class: 'cd-guide h' });
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cd-el[data-id]'); if (!el) return;
    e.preventDefault();
    const id = el.dataset.id; const cur = L()[id];
    if (sel !== id) { sel = id; drawSide(); for (const n of root.querySelectorAll('.cd-el')) n.classList.toggle('selected', n.dataset.id === id); }
    const r = root.getBoundingClientRect();
    drag = { id, el, sx: e.clientX, sy: e.clientY, x: cur.x, y: cur.y, r, cx: defaultLayout(st.template).heading.x, moved: false };
    el.classList.add('dragging'); root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    let x = drag.x + (e.clientX - drag.sx) / drag.r.width * 100;
    let y = drag.y + (e.clientY - drag.sy) / drag.r.height * 100;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2) drag.moved = true;
    x = Math.min(100, Math.max(0, x)); y = Math.min(100, Math.max(0, y));
    const snapX = [50, drag.cx].find(c => Math.abs(x - c) < 0.9); if (snapX !== undefined) x = snapX;
    const snapY = Math.abs(y - 50) < 0.9 ? 50 : undefined; if (snapY !== undefined) y = snapY;
    drag.nx = round(x); drag.ny = round(y);
    drag.el.style.left = drag.nx + '%'; drag.el.style.top = drag.ny + '%';
    if (snapX !== undefined) { guideV.style.left = snapX + '%'; root.append(guideV); } else guideV.remove();
    if (snapY !== undefined) { guideH.style.top = '50%'; root.append(guideH); } else guideH.remove();
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; guideV.remove(); guideH.remove(); d.el.classList.remove('dragging');
    if (d.moved && d.nx !== undefined) { st.els[d.id] = { ...(st.els[d.id] || {}), x: d.nx, y: d.ny }; draw(); }
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  const onKey = (e) => {
    if (!document.body.contains(root) || e.target.closest('input, textarea, select')) return;
    const step = e.shiftKey ? 1 : 0.2; const cur = L()[sel];
    const map = { ArrowLeft: ['x', -step], ArrowRight: ['x', step], ArrowUp: ['y', -step], ArrowDown: ['y', step] };
    const m = map[e.key]; if (!m) return;
    e.preventDefault(); setProp(sel, m[0], round(Math.min(100, Math.max(0, cur[m[0]] + m[1]))));
  };
  document.addEventListener('keydown', onKey);

  draw();
  const m = modal({
    title: 'Desain sertifikat', wide: true, cls: 'modal-xl cde-modal',
    body: h('div', { class: 'cde' }, stage, side),
    onClose: () => document.removeEventListener('keydown', onKey),
    actions: [
      { label: 'Atur ulang semua', cls: 'btn-ghost', onClick: async () => {
        if (await confirmDialog('Atur ulang desain?', 'Semua posisi, ukuran, warna, dan teks kembali ke bawaan template.', 'Atur ulang', false)) { st.els = {}; draw(); }
        return false;
      } },
      { label: 'Batal' },
      { label: 'Simpan desain', cls: 'btn-primary', onClick: () => {
        if (st.template === 'gambar' && !bg.url) { toast('Unggah gambar latar untuk template "Gambar sendiri", atau pilih template lain.', 'error', 5000); return false; }
        onSave({ template: st.template, els: clone(st.els) }, bg.file ? { file: bg.file, url: bg.url } : bg.remove ? { remove: true } : null);
      } },
    ],
  });
  return m;
}
