// Cetak massal sertifikat satu event (khusus penyelenggara/admin): narasumber atau peserta.
// Setiap sertifikat satu halaman A4 mendatar; bisa dicetak langsung atau diunduh sebagai satu file PDF.
import { $, $$, h, api, hydrateIcons, fmtDate, logoMark, toast } from '../shared/common.js';
import { qrSvg } from '../shared/qr.js';
import { renderCertDesign } from '../shared/certdesign.js';
import { certsToPdf, safeFileName } from '../shared/certpdf.js';
hydrateIcons();
const id = location.pathname.split('/')[2];
const sp = new URLSearchParams(location.search);
let kind = sp.get('jenis') === 'peserta' ? 'participant' : 'speaker';
if (document.referrer.includes('/admin')) $('#back').href = '/admin#event';
const dur = (min) => { const j = Math.floor(min / 60), m = min % 60; return j ? `${j} jam${m ? ` ${m} menit` : ''}` : `${m} menit`; };
let data = null;

async function load() {
  for (const b of $$('.seg button')) b.setAttribute('aria-selected', String(b.dataset.kind === kind));
  $('#print').disabled = $('#pdf').disabled = true;
  try { data = await api('GET', `/api/events/${encodeURIComponent(id)}/cert-batch?kind=${kind}`); }
  catch (e) { $('#certs').replaceChildren(h('div', { class: 'cert' }, h('div', { class: 'cert-inner' }, h('h1', { text: e.status === 401 ? 'Silakan login' : 'Tidak dapat dibuka', style: { color: '#b23a3a' } }), h('p', { text: e.message })))); return; }
  document.title = `Sertifikat ${kind === 'speaker' ? 'narasumber' : 'peserta'} — ${data.event.title}`;
  $('#b-title').textContent = data.event.title;
  $('#b-sub').textContent = `${data.certificates.length} sertifikat ${kind === 'speaker' ? 'narasumber / pemateri' : 'peserta'}`;
  if (!data.certificates.length) {
    $('#certs').replaceChildren(h('div', { class: 'batch-empty' }, h('p', { text: kind === 'speaker'
      ? 'Belum ada narasumber. Tambahkan lewat Dasbor → Event → tombol Sertifikat narasumber.'
      : 'Belum ada peserta yang memenuhi syarat sertifikat.' })));
    return;
  }
  $('#certs').replaceChildren(...data.certificates.map(c => {
    const box = h('div', {});
    renderCertDesign(box, c.design, {
      name: c.name, title: c.title, category: c.category, speaker: c.speaker, dateText: fmtDate(c.startsAt),
      durationText: dur(c.attendedMin || 0), signerName: c.signerName, signerTitle: c.signerTitle,
      code: c.code, verifyUrl: c.verifyUrl, app: c.app, campus: c.campus, sponsors: c.sponsors || [],
      kind: c.kind, role: c.role, speakerText: c.speakerText,
    }, { bgUrl: c.bgUrl, logoMark: () => logoMark(34), qrSvg: (t) => qrSvg(t, { label: `QR verifikasi sertifikat ${c.code}` }) });
    return h('div', { class: 'batch-item' }, box);   // renderCertDesign mengganti kelas box menjadi "cd …"
  }));
  $('#print').disabled = $('#pdf').disabled = false;
}

for (const b of $$('.seg button')) b.addEventListener('click', () => { if (b.dataset.kind === kind) return; kind = b.dataset.kind; history.replaceState(null, '', `?jenis=${kind === 'speaker' ? 'narasumber' : 'peserta'}`); load(); });
$('#print').addEventListener('click', () => print());
$('#pdf').addEventListener('click', async () => {
  const btn = $('#pdf'); btn.disabled = true; const label = btn.lastChild.textContent;
  try {
    await certsToPdf($$('#certs .batch-item > .cd'), `Sertifikat-${kind === 'speaker' ? 'Narasumber' : 'Peserta'}-${safeFileName(data.event.title)}`,
      (i, n) => { btn.lastChild.textContent = i < n ? `Menyiapkan ${i + 1}/${n}…` : 'Menyimpan…'; });
    toast('PDF sertifikat terunduh', 'success');
  } catch (e) { toast(`Gagal membuat PDF: ${e.message}`, 'error', 8000); }
  finally { btn.disabled = false; btn.lastChild.textContent = label; }
});
load();
