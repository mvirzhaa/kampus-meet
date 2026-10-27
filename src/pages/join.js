import { initSite, $, api, fmtDateTime } from '../shared/common.js';

const me = await initSite();
const code = location.pathname.split('/')[2];
const urlKey = new URLSearchParams(location.search).get('k');
if (urlKey) sessionStorage.setItem(`km:key:${code}`, urlKey);
const key = urlKey || sessionStorage.getItem(`km:key:${code}`) || '';
// Jangan biarkan kunci undangan tersimpan di riwayat/Referer setelah dibaca
if (urlKey) history.replaceState(null, '', `/j/${code}`);
const err = $('#j-err'); const info = $('#j-info');
const showErr = (m) => { err.textContent = m; err.hidden = !m; };

let data;
try { data = await api('GET', `/api/join/${code}${key ? `?k=${encodeURIComponent(key)}` : ''}`); }
catch (e) { showErr(e.message); throw e; }

document.title = `${data.room.name} — Gabung`;
$('.panel-head h1').textContent = data.room.name;
const lines = [];
if (data.room.owner) lines.push(`Penyelenggara: ${data.room.owner}`);
if (data.room.scheduledAt) lines.push(`Jadwal: ${fmtDateTime(data.room.scheduledAt)}`);
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
  (data.needPassword && $('#j-name').value ? $('#j-pw') : $('#j-name')).focus();
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
