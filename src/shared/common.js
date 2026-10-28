import { icon, hydrateIcons } from './icons.js';
export { icon, hydrateIcons };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Pembuat elemen aman: teks selalu lewat textContent (tidak ada innerHTML dari data pengguna). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

let me = null;
let mePromise = null;
export function loadMe(force) {
  if (!mePromise || force) mePromise = fetch('/api/me', { credentials: 'same-origin' }).then(r => r.json()).then(d => (me = d));
  return mePromise;
}
export const getMe = () => me;

export async function api(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (me?.csrf) headers['X-CSRF-Token'] = me.csrf;
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.blob();
  if (!res.ok) { const e = new Error(data?.error || `Gagal (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ---------- Toast ----------
let toastWrap;
export function toast(msg, type = 'info', ms = 3800) {
  toastWrap ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${type}` }, icon(type === 'error' ? 'alert' : type === 'success' ? 'circle-check' : 'info', 18), h('span', { text: msg }));
  toastWrap.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Modal ----------
export function modal({ title, body, actions = [], wide = false, onClose, closable = true, cls = '' }) {
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape' && closable) close(); };
  const box = h('div', { class: `modal ${wide ? 'modal-wide' : ''} ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    closable ? h('button', { class: 'modal-x', 'aria-label': 'Tutup', onclick: close }, icon('x', 22)) : null,
    title ? h('h3', { class: 'modal-title', text: title }) : null,
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-actions' }, actions.map(a => h('button', {
      class: `btn ${a.cls || 'btn-ghost'}`, type: 'button', onclick: async (e) => { const r = await a.onClick?.(e, close); if (r !== false && !a.keepOpen) close(); },
    }, a.label))) : null);
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back && closable) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', esc);
  setTimeout(() => box.querySelector('input:not([type=hidden]),select,textarea,button.btn-primary')?.focus(), 30);
  return { close, box };
}

export const confirmDialog = (title, text, okLabel = 'Ya, lanjutkan', danger = true) => new Promise(res => {
  let done = false;
  modal({ title, body: h('p', { text }), onClose: () => { if (!done) res(false); }, actions: [
    { label: 'Batal', onClick: () => { done = true; res(false); } },
    { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { done = true; res(true); } },
  ] });
});

export async function copyText(text, label = 'Tersalin ke clipboard') {
  try { await navigator.clipboard.writeText(text); toast(label, 'success', 2000); }
  catch { const ta = h('textarea', {}, text); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(label, 'success', 2000); }
}

// ---------- Format ----------
const dtf = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tf = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (sec) => dtf.format(new Date(sec * 1000));
export const fmtTime = (sec) => tf.format(new Date(sec * 1000)).replace('.', ':');
export const fmtDateTime = (sec) => `${fmtDate(sec)}, ${fmtTime(sec)}`;
export const toLocalInput = (sec) => { const d = new Date(sec * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (v) => v ? Math.floor(new Date(v).getTime() / 1000) : null;
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

// ---------- Navbar & footer bersama ----------
export function logoMark(size = 40) {
  const wrap = h('span', { class: 'logo-mark', style: { width: size + 'px', height: size + 'px' } });
  wrap.append(icon('video', Math.round(size * 0.5)));
  return wrap;
}

export async function initSite() {
  const d = await loadMe();
  document.title = document.title.replace(/APP/g, d.app.name);
  for (const el of $$('[data-app-name]')) el.textContent = d.app.name;
  for (const el of $$('[data-campus-name]')) el.textContent = d.app.campus;
  for (const el of $$('.logo-slot')) el.replaceWith(logoMark(+el.dataset.size || 40));
  const slot = $('#nav-auth');
  if (slot) {
    slot.replaceChildren();
    if (d.user) {
      const menu = h('div', { class: 'dropdown-menu dropdown-right' },
        h('div', { class: 'dd-head' }, h('strong', { text: d.user.name }), h('small', { text: d.user.email })),
        h('a', { href: '/dashboard' }, icon('grid', 16), 'Dasbor'),
        h('a', { href: '/dashboard#event' }, icon('calendar', 16), 'Event Saya'),
        h('a', { href: '/dashboard#sertifikat' }, icon('award', 16), 'Sertifikat Saya'),
        h('a', { href: '/dashboard#akun' }, icon('user-cog', 16), 'Akun'),
        d.user.role === 'admin' ? h('a', { href: '/admin' }, icon('shield-check', 16), 'Panel Admin') : null,
        h('button', { type: 'button', onclick: logout }, icon('log-out', 16), 'Keluar'));
      slot.append(h('div', { class: 'dropdown user-dd' },
        h('button', { class: 'user-btn', type: 'button', 'aria-haspopup': 'true' },
          h('span', { class: 'user-name', text: d.user.name.split(' ')[0] }), h('span', { class: 'avatar' }, icon('user', 18)), icon('chevron-down', 16)), menu));
    } else {
      slot.append(h('a', { class: 'btn btn-login', href: '/login?next=' + encodeURIComponent(location.pathname + location.search) }, 'Login'));
    }
  }
  // Dropdown (klik untuk perangkat sentuh)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.dropdown > button, .dropdown > a.dd-toggle');
    for (const dd of $$('.dropdown.open')) if (!dd.contains(e.target) || (btn && dd !== btn.parentElement)) dd.classList.remove('open');
    if (btn) { e.preventDefault(); btn.parentElement.classList.toggle('open'); }
  });
  $('#nav-toggle')?.addEventListener('click', () => $('.nav-links')?.classList.toggle('show'));
  hydrateIcons();
  return d;
}

export async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch { /* abaikan */ }
  location.href = '/';
}

export function requireLogin() {
  if (!me?.user) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash); return false; }
  return true;
}

/** Buat meeting instan lalu langsung masuk. */
export async function startInstantMeeting() {
  await loadMe();
  if (!me?.user) { location.href = '/login?next=' + encodeURIComponent('/?mulai=1'); return; }
  try {
    const { room } = await api('POST', '/api/rooms', { name: `Meeting ${me.user.name.split(' ')[0]}` });
    location.href = `/j/${room.id}?k=${encodeURIComponent(room.moderatorLink.split('k=')[1])}`;
  } catch (e) { toast(e.message, 'error'); }
}

export function roomLinksModal(room, title = 'Link meeting Anda telah dibuat') {
  const row = (label, val) => h('div', { class: 'link-row' }, h('label', { text: label }),
    h('div', { class: 'link-box' }, h('code', { text: val }), h('button', { class: 'icon-btn', type: 'button', title: 'Salin', onclick: () => copyText(val) }, icon('copy', 18))));
  modal({
    title,
    body: h('div', { class: 'links' },
      row('ID Room', room.id),
      room.password ? row('Password room', room.password) : null,
      row('Link meeting moderator', room.moderatorLink),
      row('Link meeting peserta (tanpa password)', room.attendeeLink),
      h('div', { class: 'note-ok' }, icon('link', 18), h('div', {}, h('strong', { text: 'Link meeting siap digunakan!' }),
        h('p', { text: 'Bagikan link peserta kepada mahasiswa/peserta. Jangan bagikan link moderator. Meeting dapat dimulai kapan saja.' })))),
    actions: [
      { label: 'Salin undangan', onClick: () => { copyText(invitationText(room), 'Undangan tersalin'); return false; } },
      { label: 'Tutup', cls: 'btn-primary' },
    ],
  });
}

export function invitationText(room) {
  const when = room.scheduledAt ? `\nWaktu: ${fmtDateTime(room.scheduledAt)}` : '';
  return `Undangan meeting: ${room.name}${when}\n\nGabung lewat link: ${room.attendeeLink}\n\nAtau buka ${location.origin} lalu masukkan\nID Room: ${room.id}${room.password ? `\nPassword: ${room.password}` : ''}`;
}
