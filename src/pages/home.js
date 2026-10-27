import { initSite, $, api, toast, startInstantMeeting, getMe } from '../shared/common.js';
import { eventCard, emptyState, roomFormModal } from '../shared/ui.js';

const me = await initSite();

/** Terima ID room ("abc-defg-hij"), atau link lengkap /j/... */
function parseRoomInput(v) {
  v = v.trim();
  try { const u = new URL(v); const m = u.pathname.match(/^\/[jr]\/([a-z-]+)/); if (m) return { code: m[1], k: u.searchParams.get('k') }; } catch { /* bukan URL */ }
  const code = v.toLowerCase().replace(/\s+/g, '').replace(/[^a-z-]/g, '');
  return /^[a-z]{3}-?[a-z]{4}-?[a-z]{3}$/.test(code) ? { code: code.replace(/^(\w{3})-?(\w{4})-?(\w{3})$/, '$1-$2-$3') } : null;
}

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const r = parseRoomInput($('#room-id').value);
  if (!r) return toast('Format ID room tidak valid. Contoh: abc-defg-hij', 'error');
  location.href = `/j/${r.code}${r.k ? `?k=${encodeURIComponent(r.k)}` : ''}`;
});

const needLogin = (next) => { if (!getMe()?.user) { location.href = '/login?next=' + encodeURIComponent(next); return true; } return false; };
$('#nm-now').addEventListener('click', startInstantMeeting);
$('#nm-later').addEventListener('click', () => { if (!needLogin('/?nanti=1')) roomFormModal({}); });
$('#nm-schedule').addEventListener('click', () => { if (!needLogin('/?jadwal=1')) roomFormModal({ schedule: true }); });

const sp = new URLSearchParams(location.search);
if (me.user) {
  if (sp.has('mulai')) startInstantMeeting();
  else if (sp.has('nanti')) roomFormModal({});
  else if (sp.has('jadwal')) roomFormModal({ schedule: true });
  if (sp.size) history.replaceState(null, '', '/');
}

try {
  const { events } = await api('GET', '/api/events');
  const list = $('#ev-list');
  list.replaceChildren(...(events.length ? events.slice(0, 6).map(eventCard) : [emptyState('Belum ada event yang dijadwalkan. Nantikan event berikutnya!')]));
} catch { $('#ev-list').replaceChildren(emptyState('Gagal memuat event.')); }
document.getElementById('yr').textContent = new Date().getFullYear();
