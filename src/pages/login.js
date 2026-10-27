import { initSite, $, $$, api, loadMe, formData } from '../shared/common.js';

const me = await initSite();
const params = new URLSearchParams(location.search);
const rawNext = params.get('next') || '/dashboard';
// Hanya izinkan redirect ke path internal (cegah open redirect)
const next = /^\/(?!\/|\\)/.test(rawNext) ? rawNext : '/dashboard';
if (me.user) location.replace(next);

const err = $('#auth-err');
const showErr = (m) => { err.textContent = m; err.hidden = !m; };

function setTab(tab) {
  for (const b of $$('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  $('#f-login').hidden = tab !== 'login';
  $('#f-register').hidden = tab !== 'register';
  $('#auth-title').textContent = tab === 'login' ? 'Masuk ke akun Anda' : 'Buat akun baru';
  showErr('');
  history.replaceState(null, '', (tab === 'login' ? '/login' : '/daftar') + location.search);
}
for (const b of $$('.tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
if (!me.app.allowRegistration) $('#tab-reg').remove();
else if (location.pathname.startsWith('/daftar')) setTab('register');
if (me.app.domains.length) $('#domain-hint').textContent = 'Gunakan email kampus: ' + me.app.domains.map(d => '@' + d).join(', ');

for (const t of $$('.pw-toggle')) t.addEventListener('click', () => {
  const inp = t.parentElement.querySelector('input'); inp.type = inp.type === 'password' ? 'text' : 'password';
});

async function submit(form, path) {
  if (!form.reportValidity()) return;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; showErr('');
  try {
    await api('POST', path, formData(form));
    await loadMe(true);
    location.replace(next);
  } catch (e) { showErr(e.message); btn.disabled = false; }
}
$('#f-login').addEventListener('submit', (e) => { e.preventDefault(); submit(e.target, '/api/auth/login'); });
$('#f-register').addEventListener('submit', (e) => { e.preventDefault(); submit(e.target, '/api/auth/register'); });
