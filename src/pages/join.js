import { initSite, $, api, fmtDateTime, fmtTime, h, icon } from '../shared/common.js';

const me = await initSite();
const code = location.pathname.split('/')[2];
const sp = new URLSearchParams(location.search);
const urlKey = sp.get('k');
if (urlKey) sessionStorage.setItem(`km:key:${code}`, urlKey);
const key = urlKey || sessionStorage.getItem(`km:key:${code}`) || '';
// ?web=1 → pengguna (atau Chrome, bila aplikasi belum terpasang) memilih lanjut di browser
if (sp.has('web')) sessionStorage.setItem('km:web', '1');
// Jangan biarkan kunci undangan tersimpan di riwayat/Referer setelah dibaca
if (urlKey || sp.has('web')) history.replaceState(null, '', `/j/${code}`);
openInAppFirst();

/**
 * HP Android: arahkan ke aplikasi UIKA Meet lebih dulu. Dicoba otomatis sekali per sesi; bila aplikasi belum
 * terpasang, Chrome membuka browser_fallback_url (halaman ini dengan ?web=1) sehingga peserta tetap bisa
 * bergabung lewat browser. Spanduk "Buka di aplikasi" tetap tersedia untuk dicoba manual.
 */
function openInAppFirst() {
  const android = me?.app?.android;
  if (!android?.package || !/Android/i.test(navigator.userAgent) || sessionStorage.getItem('km:web')) return;
  const q = key ? `?k=${encodeURIComponent(key)}` : '';
  const fallback = `${location.origin}/j/${code}?web=1${key ? `&k=${encodeURIComponent(key)}` : ''}`;
  const intent = `intent://${location.host}/j/${encodeURIComponent(code)}${q}#Intent;scheme=https;package=${android.package};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  const banner = h('div', { class: 'app-open' },
    h('img', { src: '/img/uika-meet-mark.svg', width: 40, height: 40, alt: '' }),
    h('div', { class: 'app-open-txt' }, h('b', { text: 'Buka di aplikasi UIKA Meet' }),
      h('span', { text: 'Lebih stabil di HP: transkripsi, terjemahan, dan berbagi layar.' })),
    h('a', { class: 'btn btn-primary btn-sm', href: intent }, icon('smartphone', 16), 'Buka aplikasi'),
    h('div', { class: 'app-open-alt' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); sessionStorage.setItem('km:web', '1'); banner.remove(); }, text: 'Lanjutkan di browser' }),
      android.downloadUrl ? h('a', { href: android.downloadUrl, rel: 'noopener', text: 'Belum punya aplikasinya? Unduh' }) : null));
  // Di HP, tampilkan paling atas agar langsung terlihat
  banner.classList.add('container');
  $('main.page').prepend(banner);
  // Coba otomatis hanya di browser yang pasti mendukung intent:// + browser_fallback_url (Chrome, Edge,
  // Samsung Internet); bukan di WebView aplikasi lain ("; wv)") atau Firefox. Tombol di atas tetap bisa dipakai.
  const ua = navigator.userAgent;
  const autoOk = /Chrome\/\d+/.test(ua) && !/; wv\)|Firefox|FxiOS/.test(ua);
  const tried = `km:app-tried:${code}`;
  if (autoOk && !sessionStorage.getItem(tried)) { sessionStorage.setItem(tried, '1'); location.href = intent; }
}
const err = $('#j-err'); const info = $('#j-info');
const showErr = (m) => { err.textContent = m; err.hidden = !m; };

let data;
try { data = await api('GET', `/api/join/${code}${key ? `?k=${encodeURIComponent(key)}` : ''}`); }
catch (e) { showErr(e.message); throw e; }

const ev = data.event;
document.title = `${ev?.title || data.room.name} — Gabung`;
$('.panel-head h1').textContent = ev?.title || data.room.name;
const lines = [];
if (data.room.owner) lines.push(`Penyelenggara: ${data.room.owner}`);
if (ev) lines.push(`Jadwal: ${fmtDateTime(ev.startsAt)} – ${fmtTime(ev.endsAt)}`);
else if (data.room.scheduledAt) lines.push(`Jadwal: ${fmtDateTime(data.room.scheduledAt)}`);
if (ev && !ev.open && data.role !== 'moderator') {
  showErr(Date.now() / 1000 < ev.opensAt ? `Room event dibuka ${fmtDateTime(ev.opensAt)} (30 menit sebelum acara).` : 'Event sudah berakhir.');
}
if (ev) {
  $('label[for=j-pw]').textContent = 'Password Event';
  $('#j-pw').placeholder = '6 karakter dari panitia';
  $('#j-pw').maxLength = 6;
  $('#j-pw').classList.add('pw-event');
  $('#j-desc').textContent = 'Event ini dilindungi password. Masukkan password dari panitia (cukup sekali).';
}
if (data.role === 'moderator') lines.push('Anda masuk sebagai moderator.');
if (lines.length) { info.textContent = lines.join(' · '); info.hidden = false; }

if (data.needLogin) {
  $('#j-login').hidden = false;
  $('#j-login-btn').href = '/login?next=' + encodeURIComponent(`/j/${code}${key ? `?k=${key}` : ''}`);
} else {
  const form = $('#j-form');
  form.hidden = false;
  $('#j-name').value = localStorage.getItem('km:name') || me.user?.name || '';
  if (!data.needPassword) { $('#pw-field').remove(); $('#j-desc').textContent = 'Silakan mengisi nama yang akan ditampilkan ketika meeting berlangsung.'; }
  // Jangan fokus otomatis saat ada ajakan buka aplikasi: di HP fokus menggulir halaman sehingga ajakan tidak terlihat
  if (!$('.app-open')) (data.needPassword && $('#j-name').value ? $('#j-pw') : $('#j-name')).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = $('#j-btn'); btn.disabled = true; showErr('');
    try {
      const name = $('#j-name').value.trim();
      const res = await api('POST', `/api/join/${code}`, { name, password: $('#j-pw')?.value || '', key });
      try { localStorage.setItem('km:name', name); } catch { /* abaikan */ }
      sessionStorage.setItem(`km:join:${code}`, JSON.stringify({ ...res, key, at: Date.now() }));
      location.href = `/r/${code}`;
    } catch (e2) { showErr(e2.message); btn.disabled = false; }
  });
}
