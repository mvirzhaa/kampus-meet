// Breakout room (ruang kelompok).
// Setiap ruang adalah room LiveKit terpisah; pindah ruang = halaman dimuat ulang dengan token ruang tujuan.
// Audio/kamera dipulihkan otomatis, presensi & sertifikat tetap tercatat di room utama.
import { h, icon, toast, modal, confirmDialog } from '../shared/common.js';
import { store, on, emit, isMod, meetApi, allParticipants, roleOf } from './store.js';
import { saveResume } from './controls.js';

const $ = (s) => document.querySelector(s);
const inBo = () => store.meta.bo?.n || 0;
const mainBo = () => (inBo() ? null : store.meta.breakout || null); // tersedia saat berada di ruang utama
const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60); return `${m}:${String(sec % 60).padStart(2, '0')}`; };
const left = (at) => at ? at - Date.now() / 1000 : null;
/** Teks hitung mundur yang diperbarui tiap detik tanpa membangun ulang bilah (tombol tetap bisa diklik). */
const countdown = (at, fmt, cls = 'bo-time') => h('span', { class: cls, dataset: { at: String(at), fmt }, text: fmt.replace('{t}', mmss(left(at))) });
const promptedKey = () => `km:bo-prompted:${store.code}`;
const prompted = () => { try { return new Set(JSON.parse(sessionStorage.getItem(promptedKey()) || '[]')); } catch { return new Set(); } };
const markPrompted = (k) => { const s = prompted(); s.add(k); try { sessionStorage.setItem(promptedKey(), JSON.stringify([...s].slice(-50))); } catch { /* abaikan */ } };

// ==================== Pindah ruang ====================
let switching = false;
export async function goRoom(n, msg) {
  if (switching) return;
  switching = true;
  try { await meetApi('POST', '/breakout/go', { n }); }
  catch (e) { switching = false; toast(e.message, 'error'); return; }
  store.switching = true;                 // jangan kirim "keluar" saat halaman dimuat ulang
  saveResume();
  const ov = $('#overlay'); ov.hidden = false;
  ov.replaceChildren(h('div', { class: 'ov-box' }, h('div', { class: 'spinner' }), h('p', { text: msg || (n ? `Pindah ke ${roomName(n)}…` : 'Kembali ke ruang utama…') })));
  try { await store.room.disconnect(); } catch { /* abaikan */ }
  location.reload();
}
function roomName(n) {
  const b = mainBo(); return b?.rooms?.[n - 1]?.name || (store.meta.bo?.n === n ? store.meta.bo.name : `Ruang ${n}`);
}

// ==================== Bilah status ====================
let tick = 0;
function renderBar() {
  const bar = $('#bo-bar');
  const app = document.getElementById('app');
  const n = inBo();
  app.classList.toggle('in-bo', !!n);
  let content = null; let cls = '';
  if (n) {
    const bo = store.meta.bo;
    const closing = left(bo.closingAt);
    if (closing != null && closing > -5) {
      cls = 'warn';
      content = [icon('clock', 16), countdown(bo.closingAt, 'Ruang kelompok ditutup dalam {t}. Anda akan kembali otomatis ke ruang utama.', ''),
        h('span', { class: 'bo-sp' }), h('button', { class: 'btn btn-sm btn-primary', onclick: () => goRoom(0) }, 'Kembali sekarang')];
    } else {
      const rest = left(bo.endsAt);
      content = [icon('users', 16), h('b', { text: bo.name }), h('span', { class: 'bo-sub', text: `· ${bo.mainName}` }),
        rest != null ? countdown(bo.endsAt, 'sisa {t}') : null,
        h('span', { class: 'bo-sp' }),
        isMod() ? h('button', { class: 'btn btn-sm btn-ghost', onclick: manageModal }, icon('settings', 15), 'Kelola') : h('button', { class: 'btn btn-sm btn-ghost', onclick: askHelp }, icon('hand', 15), 'Minta bantuan'),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => goRoom(0) }, icon('log-out', 15), 'Kembali ke ruang utama')];
    }
  } else {
    const bo = mainBo();
    if (bo?.active) {
      const rest = left(bo.endsAt);
      const mine = bo.assign?.[store.identity] || 0;
      const time = rest != null ? countdown(bo.endsAt, 'sisa {t}') : null;
      if (isMod()) content = [icon('users', 16), h('span', { text: `Ruang kelompok berjalan · ${bo.rooms.length} ruang` }), time, h('span', { class: 'bo-sp' }),
        h('button', { class: 'btn btn-sm btn-primary', onclick: manageModal }, icon('settings', 15), 'Kelola ruang kelompok')];
      else if (mine) content = [icon('users', 16), h('span', {}, 'Anda ditempatkan di ', h('b', { text: roomName(mine) })), time, h('span', { class: 'bo-sp' }),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => goRoom(mine) }, 'Gabung ke ruang')];
      else if (bo.allowChoose) content = [icon('users', 16), h('span', { text: 'Ruang kelompok dibuka. Silakan pilih ruang.' }), time, h('span', { class: 'bo-sp' }),
        h('button', { class: 'btn btn-sm btn-primary', onclick: chooseModal }, 'Pilih ruang')];
      else content = [icon('users', 16), h('span', { text: 'Ruang kelompok sedang berjalan. Tunggu moderator menempatkan Anda.' }), time];
    } else if (bo && bo.closingAt && isMod()) {
      cls = 'warn'; content = [icon('clock', 16), countdown(bo.closingAt, 'Ruang kelompok ditutup dalam {t}; peserta sedang kembali.', '')];
    }
  }
  bar.hidden = !content; bar.className = 'bo-bar ' + cls;
  if (content) bar.replaceChildren(...content.filter(Boolean));
}
function onTick() {
  for (const el of document.querySelectorAll('#bo-bar [data-at]')) el.textContent = el.dataset.fmt.replace('{t}', mmss(left(+el.dataset.at)));
  // Hanya di dalam ruang kelompok yang sedang ditutup (inBo() bernilai 0 di ruang utama — jangan dibandingkan sebagai waktu)
  const bo = store.meta.bo;
  if (inBo() && bo?.closingAt && left(bo.closingAt) <= 0) goRoom(0, 'Ruang kelompok ditutup. Kembali ke ruang utama…');
}

// ==================== Undangan otomatis (ruang utama) ====================
let inviteOpen = null;
function maybeInvite() {
  const bo = mainBo();
  if (inBo() || !bo?.active || isMod()) return;
  const n = bo.assign?.[store.identity];
  if (!n) return;
  const key = `${bo.id}:${n}`;
  if (prompted().has(key) || inviteOpen === key) return;
  inviteOpen = key;
  let sec = 10;
  const label = h('span', { text: `Gabung sekarang (${sec})` });
  const m = modal({
    title: 'Ruang kelompok dibuka', closable: true, onClose: () => { clearInterval(t); inviteOpen = null; markPrompted(key); },
    body: h('div', { class: 'bo-invite' }, icon('users', 40), h('p', {}, 'Moderator menempatkan Anda di ', h('b', { text: roomName(n) }), '.'),
      bo.endsAt ? h('p', { class: 'ev-meta', text: `Durasi sekitar ${Math.round((bo.endsAt - Date.now() / 1000) / 60)} menit. Audio & kamera Anda ikut dipindahkan.` }) : null),
    actions: [{ label: 'Nanti' }, { label, cls: 'btn-primary', onClick: () => { goRoom(n); } }],
  });
  const t = setInterval(() => { sec--; label.textContent = `Gabung sekarang (${sec})`; if (sec <= 0) { clearInterval(t); m.close(); goRoom(n); } }, 1000);
}

// ==================== Peserta memilih ruang ====================
async function chooseModal() {
  let data; try { data = (await meetApi('GET', '/breakout')).breakout; } catch (e) { return toast(e.message, 'error'); }
  if (!data?.active) return toast('Ruang kelompok tidak tersedia.', 'error');
  const m = modal({ title: 'Pilih ruang kelompok', body: h('div', { class: 'bo-choose' },
    data.rooms.map(r => h('button', { type: 'button', class: 'bo-pick', onclick: () => { m.close(); goRoom(r.n); } },
      h('b', { text: r.name }), h('span', { text: `${r.count} orang` }), icon('chevron-right', 18)))) });
}

// ==================== Moderator: buat ruang ====================
export function setupModal() {
  if (mainBo()?.active || (mainBo()?.closingAt && left(mainBo().closingAt) > 0)) return manageModal();
  if (inBo()) return toast('Kembali ke ruang utama untuk membuat ruang kelompok.', 'info');
  const people = allParticipants().filter(p => roleOf(p.identity) !== 'moderator');
  const count = h('input', { type: 'number', min: 1, max: 50, value: Math.min(10, Math.max(2, Math.ceil(people.length / 4))) });
  const minutes = h('input', { type: 'number', min: 1, max: 480, value: 15 });
  const noLimit = h('input', { type: 'checkbox' });
  const allow = h('input', { type: 'checkbox' });
  const allowLabel = h('label', { class: 'check' }, allow, 'Izinkan peserta pindah ruang sendiri');
  const hint = h('small', { class: 'ev-meta' });
  let mode = 'auto';
  const modeBtns = h('div', { class: 'bo-modes' }, [['auto', 'Otomatis (acak)', 'shuffle'], ['manual', 'Manual', 'pointer'], ['choose', 'Peserta memilih', 'hand']].map(([k, l]) =>
    h('label', { class: 'bo-mode' }, h('input', { type: 'radio', name: 'bo-mode', value: k, checked: k === mode, onchange: () => { mode = k; draw(); } }), h('span', { text: l }))));
  const manualBox = h('div', { class: 'bo-manual' });
  const picks = new Map(); // identity -> n
  const draw = () => {
    const c = Math.min(50, Math.max(1, +count.value || 1));
    hint.textContent = people.length ? `${people.length} peserta (di luar moderator) · ± ${Math.ceil(people.length / c)} orang per ruang` : 'Belum ada peserta selain moderator; ruang tetap bisa dibuat.';
    minutes.disabled = noLimit.checked;
    allowLabel.hidden = mode === 'choose';
    manualBox.hidden = mode !== 'manual';
    if (mode === 'manual') {
      people.forEach((p, i) => { if (!picks.has(p.identity) || picks.get(p.identity) > c) picks.set(p.identity, (i % c) + 1); });
      manualBox.replaceChildren(
        people.length ? h('div', { class: 'bo-mtable' }, people.map(p => h('div', { class: 'bo-mrow' }, h('span', { text: p.name }),
          h('select', { onchange: (e) => picks.set(p.identity, +e.target.value) },
            Array.from({ length: c }, (_, i) => h('option', { value: i + 1, selected: picks.get(p.identity) === i + 1, text: `Ruang ${i + 1}` })))))) : h('p', { class: 'ev-meta', text: 'Belum ada peserta untuk ditempatkan.' }));
    }
  };
  count.addEventListener('input', draw); noLimit.addEventListener('change', draw);
  draw();
  modal({
    title: 'Buat ruang kelompok (breakout room)', wide: true,
    body: h('div', { class: 'bo-setup' },
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', { text: 'Jumlah ruang' }), count, hint),
        h('div', { class: 'field' }, h('label', { text: 'Durasi (menit)' }), minutes,
          h('label', { class: 'check', style: { marginTop: '6px' } }, noLimit, 'Tanpa batas waktu (ditutup manual)'))),
      h('div', { class: 'field' }, h('label', { text: 'Cara membagi peserta' }), modeBtns),
      manualBox,
      allowLabel,
      h('p', { class: 'ev-meta', text: 'Saat waktu habis, peserta mendapat hitung mundur 60 detik lalu kembali otomatis ke ruang utama. Kehadiran di ruang kelompok tetap dihitung untuk presensi & sertifikat. Rekaman hanya berjalan di ruang utama.' })),
    actions: [{ label: 'Batal' }, { label: 'Buka ruang kelompok', cls: 'btn-primary', keepOpen: true, onClick: async (e, close) => {
      e.target.disabled = true;
      try {
        await meetApi('POST', '/mod/breakout/open', {
          count: +count.value, minutes: noLimit.checked ? 0 : +minutes.value, mode, allowChoose: allow.checked,
          assign: mode === 'manual' ? Object.fromEntries(picks) : undefined,
        });
        close(); toast('Ruang kelompok dibuka. Peserta mendapat undangan untuk bergabung.', 'success', 5000);
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      return false;
    } }],
  });
}

// ==================== Moderator: kelola ruang ====================
let manageOpen = null;
export async function manageModal() {
  if (manageOpen) return;
  const body = h('div', { class: 'bo-manage' }, h('p', { text: 'Memuat…' }));
  let timer;
  const m = modal({ title: 'Kelola ruang kelompok', wide: true, cls: 'modal-xl', body, onClose: () => { clearInterval(timer); manageOpen = null; },
    actions: [
      { label: 'Kirim pengumuman', onClick: () => { broadcastModal(); return false; } },
      { label: 'Tutup semua ruang', cls: 'btn-danger', onClick: async () => {
        if (!(await confirmDialog('Tutup semua ruang kelompok?', 'Peserta mendapat hitung mundur 60 detik lalu kembali otomatis ke ruang utama.', 'Tutup ruang'))) return false;
        try { await meetApi('POST', '/mod/breakout/close', {}); toast('Ruang kelompok ditutup dalam 60 detik', 'success'); } catch (e) { toast(e.message, 'error'); }
        return false;
      } },
    ] });
  manageOpen = m;
  const load = async () => {
    let d; try { d = (await meetApi('GET', '/breakout')).breakout; } catch (e) { body.replaceChildren(h('p', { class: 'ev-meta', text: e.message })); return; }
    if (!d) { m.close(); return; }
    const moveSel = (p, cur) => h('select', { class: 'bo-move', title: 'Pindahkan ke…', onchange: async (e) => {
      const n = +e.target.value;
      try { await meetApi('POST', '/mod/breakout/move', { identity: p.identity, n }); toast(`${p.name} dipindahkan ke ${n ? d.rooms[n - 1].name : 'ruang utama'}`, 'success'); load(); }
      catch (err) { toast(err.message, 'error'); }
    } }, [h('option', { value: 0, text: 'Ruang utama', selected: cur === 0 }), ...d.rooms.map(r => h('option', { value: r.n, text: r.name, selected: cur === r.n }))]);
    const person = (p, cur) => h('li', {}, h('span', { class: 'nm', text: p.name + (p.role === 'moderator' ? ' (moderator)' : '') }),
      p.role === 'moderator' ? null : moveSel(p, p.assigned || cur));
    const rest = left(d.endsAt); const closing = left(d.closingAt);
    body.replaceChildren(
      h('div', { class: 'bo-head' },
        h('span', { text: d.active ? (rest != null ? `Sisa waktu ${mmss(rest)}` : 'Tanpa batas waktu') : `Ditutup dalam ${mmss(closing || 0)}` }),
        h('span', { text: `${d.rooms.reduce((a, r) => a + r.count, 0)} orang di ruang kelompok · ${d.main.length} di ruang utama` }),
        inBo() ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => goRoom(0) }, 'Kembali ke ruang utama') : null),
      h('div', { class: 'bo-grid' }, d.rooms.map(r => h('div', { class: 'bo-card' + (inBo() === r.n ? ' here' : '') },
        h('div', { class: 'bo-card-h' }, h('b', { text: r.name }), h('span', { class: 'pill', text: `${r.count} orang` }),
          inBo() === r.n ? h('span', { class: 'pill green', text: 'Anda di sini' }) : h('button', { class: 'btn btn-sm btn-ghost', onclick: () => goRoom(r.n) }, 'Masuk')),
        r.people?.length ? h('ul', {}, r.people.map(p => person(p, r.n))) : h('p', { class: 'ev-meta', text: 'Belum ada yang bergabung.' }),
        unjoined(d, r.n).length ? h('p', { class: 'ev-meta bo-wait', text: `Belum bergabung: ${unjoined(d, r.n).map(p => p.name).join(', ')}` }) : null))),
      h('div', { class: 'bo-card main' }, h('div', { class: 'bo-card-h' }, h('b', { text: 'Ruang utama' }), h('span', { class: 'pill', text: `${d.main.length} orang` })),
        d.main.length ? h('ul', {}, d.main.map(p => person(p, 0))) : h('p', { class: 'ev-meta', text: 'Kosong.' })));
  };
  await load();
  timer = setInterval(load, 5000);
}
const unjoined = (d, n) => d.main.filter(p => p.assigned === n && p.role !== 'moderator');

function broadcastModal() {
  const ta = h('textarea', { rows: 3, maxlength: 300, placeholder: 'mis. Waktu diskusi tinggal 5 menit, siapkan ringkasan kelompok.' });
  modal({ title: 'Pengumuman ke semua ruang kelompok', body: h('div', { class: 'field' }, ta), actions: [{ label: 'Batal' }, { label: 'Kirim', cls: 'btn-primary', keepOpen: true, onClick: async (e, close) => {
    if (!ta.value.trim()) return false;
    try { await meetApi('POST', '/mod/breakout/broadcast', { text: ta.value.trim() }); close(); toast('Pengumuman terkirim ke semua ruang', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    return false;
  } }] });
}

async function askHelp() {
  try { await meetApi('POST', '/breakout/help', {}); toast('Permintaan bantuan terkirim ke moderator', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

// ==================== Pesan dari server ====================
on('srv:bo-msg', (m) => {
  if (!inBo()) return;
  const text = String(m.text || '').slice(0, 300); const from = String(m.from || 'Moderator').slice(0, 60);
  const ann = $('#bo-ann');
  ann.replaceChildren(icon('message-circle', 18), h('div', {}, h('b', { text: `Pengumuman dari ${from}` }), h('p', { text })),
    h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: () => { ann.hidden = true; } }, icon('x', 16)));
  ann.hidden = false;
  clearTimeout(ann._t); ann._t = setTimeout(() => { ann.hidden = true; }, 20000);
  emit('sys-chat', `Pengumuman dari ${from}: ${text}`);
});
on('srv:bo-help', (m) => {
  if (inBo() || !isMod()) return;
  const n = parseInt(m.n, 10) || 0; if (!n) return;
  modal({ title: 'Permintaan bantuan', body: h('p', {}, h('b', { text: String(m.name || 'Peserta').slice(0, 60) }), ` di ${String(m.room || `Ruang ${n}`).slice(0, 40)} meminta bantuan moderator.`),
    actions: [{ label: 'Nanti' }, { label: `Masuk ke ${String(m.room || `Ruang ${n}`).slice(0, 40)}`, cls: 'btn-primary', onClick: () => goRoom(n) }] });
});
on('srv:bo-move', (m) => {
  if (m.identity !== store.identity) return;
  const n = parseInt(m.n, 10) || 0;
  if (n === inBo()) return;
  toast(n ? `Moderator memindahkan Anda ke ${roomName(n)}` : 'Moderator memindahkan Anda ke ruang utama', 'info', 3000);
  setTimeout(() => goRoom(n), 1500);
});

// ==================== Inisialisasi ====================
export function initBreakout() {
  $('#m-breakout')?.addEventListener('click', setupModal);
  on('meta', () => { renderBar(); maybeInvite(); });
  clearInterval(tick);
  tick = setInterval(onTick, 1000);
  renderBar(); maybeInvite();
}
