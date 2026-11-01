import { initSite, $, h, api, toast, startInstantMeeting, getMe, fmtDate } from '../shared/common.js';
import { eventCard, emptyState, roomFormModal } from '../shared/ui.js';

const me = await initSite();
import('../shared/chatbot.js').then(m => m.initChatbot()).catch(() => {});

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

// ---------- Unduh aplikasi Android (APK terbaru dari admin) ----------
const mb = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
const noteLines = (t) => String(t || '').split('\n').map(s => s.replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean);
try {
  const [{ latest, externalUrl }, { releases }] = await Promise.all([api('GET', '/api/app/latest'), api('GET', '/api/app/releases').catch(() => ({ releases: [] }))]);
  if (latest || externalUrl) {
    const sec = $('#aplikasi'); sec.hidden = false;
    const url = latest ? latest.url : externalUrl;
    $('#app-dl-btn').href = url;
    if (latest) {
      $('#app-dl-btn').setAttribute('download', latest.fileName);
      $('#app-dl-meta').replaceChildren(
        h('span', {}, h('b', { text: `Versi ${latest.version}` })), h('span', { text: mb(latest.size) }),
        h('span', { text: `Diperbarui ${fmtDate(latest.publishedAt)}` }),
        latest.minSdk >= 21 ? h('span', { text: `Android ${({ 21: '5', 22: '5.1', 23: '6', 24: '7', 25: '7.1', 26: '8', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12', 33: '13', 34: '14', 35: '15', 36: '16' })[latest.minSdk] || '7'} ke atas` }) : null);
      $('#app-dl-nt').textContent = `Yang baru di versi ${latest.version}`;
      $('#app-dl-list').replaceChildren(...noteLines(latest.notes).map(l => h('li', { text: l })));
      $('#app-dl-notes').hidden = false;
      const older = releases.filter(r => r.id !== latest.id).slice(0, 5);
      if (older.length) {
        $('#app-dl-hist').hidden = false;
        $('#app-dl-older').replaceChildren(...older.map(r => h('div', { class: 'app-dl-old' }, h('b', { text: `Versi ${r.version}` }), h('small', { text: fmtDate(r.publishedAt) }),
          h('ul', {}, noteLines(r.notes).map(l => h('li', { text: l }))))));
      }
    }
    // Pengunjung dari laptop: pindai QR untuk mengunduh langsung di HP
    const { qrSvg } = await import('../shared/qr.js');
    const abs = new URL(url, location.origin).href;
    $('#app-dl-qr').append(h('div', { class: 'qr-box' }, qrSvg(abs, { label: 'QR unduh aplikasi Android' })), h('small', { text: 'Pindai dengan kamera HP untuk mengunduh' }));
    if (location.hash === '#aplikasi') sec.scrollIntoView();
  }
} catch { /* bagian unduhan tetap tersembunyi */ }
