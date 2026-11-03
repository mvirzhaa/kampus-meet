// Poster event: rancangan poster (JSON di events.poster) yang datanya ditarik dari isian event, foto narasumber,
// gambar poster hasil render (PNG, diunggah editor di browser), keterangan siap-posting, dan satu tautan share
// /p/:slug berisi meta Open Graph sehingga WhatsApp/Facebook menampilkan gambar poster sebagai pratinjau.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError, json, readJson, readBody } from './http.js';
import { currentUser, requireUser, requireCsrf } from './auth.js';
import { clean, cleanMultiline, limiters } from './security.js';
import { sponsorsOf } from './events.js';

const dir = path.join(config.dataDir, 'uploads', 'poster');
fs.mkdirSync(dir, { recursive: true });
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
export const THEMES = {
  hijau: { name: 'Hijau UIKA Meet', color: '#047857' },
  biru: { name: 'Biru', color: '#1d4ed8' },
  marun: { name: 'Marun', color: '#8f1d3a' },
  ungu: { name: 'Ungu', color: '#5b21b6' },
  jingga: { name: 'Jingga', color: '#c2410c' },
  gelap: { name: 'Gelap', color: '#111827' },
};
const ROLE_SPEAKER = /narasumber|pemateri|keynote|pembicara|panelis|speaker/i;
const hhmm = (t) => new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t * 1000)).replace(':', '.');
const dayDate = (t) => new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t * 1000));
const tzLabel = () => ({ 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' }[config.timezone] || '');
const host = () => new URL(config.publicUrl).host;
export const shareUrl = (e) => `${config.publicUrl}/p/${e.slug}`;
const photoUrl = (f) => (f ? `/api/posters/photo/${f}` : null);
const imageFile = (e) => { for (const x of ['png', 'jpg']) { const f = path.join(dir, `${e.id}.${x}`); if (fs.existsSync(f)) return { file: f, mime: EXT_MIME[x] }; } return null; };
export const posterImageUrl = (e, abs = false) => (e.poster_ver && imageFile(e) ? `${abs ? config.publicUrl : ''}/api/posters/${e.id}/image?v=${e.poster_ver}` : null);

/** "Dr. A, M.Kom; Prof. B & C" → nama-nama narasumber (koma sebelum gelar tidak memotong nama). */
export function splitSpeakers(s) {
  return String(s || '').split(/\s*(?:;|\s&\s|\sdan\s|\n|,(?=\s*(?:Dr|Prof|Ir|Drs|Dra|H|Hj|KH|Ust|Ustadz|Ustazah|Bapak|Ibu|Bpk)\b\.?))\s*/i)
    .map(x => x.trim()).filter(x => x.length >= 2).slice(0, 10);
}
/** Nama narasumber event: dari sertifikat narasumber (peran narasumber/pemateri), atau kolom narasumber. */
export function eventSpeakers(e) {
  const sc = q('SELECT name, role FROM speaker_certs WHERE event_id = ? ORDER BY sort, id').all(e.id).filter(s => ROLE_SPEAKER.test(s.role)).map(s => s.name);
  return sc.length ? sc : splitSpeakers(e.speaker);
}

function defaults(e) {
  return {
    theme: 'hijau', color: THEMES.hijau.color,
    series: e.category && !/^lain/i.test(e.category) ? e.category : 'Webinar',
    headline: e.title,
    summary: (e.description || '').slice(0, 520),
    speakers: eventSpeakers(e).slice(0, 4).map(name => ({ name, title: '', photo: null })),
    benefits: [e.certificate ? 'E-Sertifikat' : null, 'Materi Webinar', 'Pengetahuan & Wawasan Baru', 'Kesempatan Bertanya Langsung kepada Narasumber'].filter(Boolean),
    platform: `Online melalui ${config.appName}`,
    contact: { name: '', phone: '' },
    link: { label: 'Virtual Background', url: '' },
    footer: { email: '', website: host(), whatsapp: '', instagram: '' },
    showQr: true,
    caption: '',
  };
}
const url = (v) => { const s = clean(v, 300); return !s || /^https?:\/\/[^\s<>"]+$/i.test(s) ? s : ''; };
const ownPhoto = (e, f) => (typeof f === 'string' && new RegExp(`^${e.id}-[A-Za-z0-9_-]{6,40}\\.(png|jpg|webp)$`).test(f) && fs.existsSync(path.join(dir, f)) ? f : null);
function sanitize(e, b) {
  const d = defaults(e);
  const o = { ...d };
  if (b && typeof b === 'object') {
    if (THEMES[b.theme] || b.theme === 'custom') o.theme = b.theme;
    if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) o.color = b.color.toLowerCase();
    if (o.theme !== 'custom') o.color = THEMES[o.theme].color;
    if (b.series !== undefined) o.series = clean(b.series, 60);
    if (b.headline !== undefined) o.headline = clean(b.headline, 160) || d.headline;
    if (b.summary !== undefined) o.summary = cleanMultiline(b.summary, 700);
    if (Array.isArray(b.speakers)) o.speakers = b.speakers.slice(0, 4).map(s => ({ name: clean(s?.name, 90), title: clean(s?.title, 90), photo: ownPhoto(e, s?.photo) })).filter(s => s.name);
    if (Array.isArray(b.benefits)) o.benefits = b.benefits.map(x => clean(x, 70)).filter(Boolean).slice(0, 6);
    if (b.platform !== undefined) o.platform = clean(b.platform, 70);
    if (b.contact) o.contact = { name: clean(b.contact.name, 60), phone: clean(b.contact.phone, 30) };
    if (b.link) o.link = { label: clean(b.link.label, 40) || 'Tautan', url: url(b.link.url) };
    if (b.footer) o.footer = { email: clean(b.footer.email, 80), website: clean(b.footer.website, 80), whatsapp: clean(b.footer.whatsapp, 30), instagram: clean(b.footer.instagram, 50) };
    if (b.showQr !== undefined) o.showQr = !!b.showQr;
    if (b.caption !== undefined) o.caption = cleanMultiline(b.caption, 4000);
  }
  return o;
}
export function posterOf(e) {
  let saved = null; try { saved = e.poster ? JSON.parse(e.poster) : null; } catch { /* rusak → bawaan */ }
  return { poster: sanitize(e, saved), saved: !!saved };
}

/** Keterangan siap-posting (WhatsApp/Instagram/Facebook), gaya pengumuman webinar. */
export function autoCaption(e, p) {
  const L = [];
  if (p.series) L.push(`🚀 ${p.series.toUpperCase()}`, '');
  L.push(`📊 ${p.headline || e.title}`, '');
  if (p.summary) L.push(p.summary.trim(), '');
  if (p.speakers.length) {
    L.push(`🎙️ Narasumber`);
    for (const s of p.speakers) { L.push(s.name); if (s.title) L.push(s.title); }
    L.push('');
  }
  const sameDay = dayDate(e.starts_at) === dayDate(e.ends_at);
  L.push(`🗓️ ${dayDate(e.starts_at)}${sameDay ? '' : ` – ${dayDate(e.ends_at)}`}`, `🕘 ${hhmm(e.starts_at)}–${hhmm(e.ends_at)} ${tzLabel()}`.trim());
  if (p.platform) L.push(`💻 ${p.platform}`);
  L.push('');
  if (p.benefits.length) { L.push('🎁 Benefit Peserta', ...p.benefits.map(b => `✅ ${b}`), ''); }
  if (p.link?.url) L.push(`🎨 ${p.link.label || 'Tautan'}:`, p.link.url, '');
  L.push('📝 Info & daftar/gabung:', shareUrl(e));
  if (p.contact?.phone || p.contact?.name) L.push('', `📞 Contact Person: ${[p.contact.name, p.contact.phone].filter(Boolean).join(' – ')}`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function publicData(e) {
  const { poster, saved } = posterOf(e);
  const organizer = q('SELECT name FROM users WHERE id = ?').get(e.owner_id)?.name || '';
  return {
    event: {
      id: e.id, slug: e.slug, title: e.title, category: e.category, description: e.description, speaker: e.speaker,
      startsAt: e.starts_at, endsAt: e.ends_at, certificate: !!e.certificate, organizer, published: !!e.published,
      sponsors: sponsorsOf(e), dateText: dayDate(e.starts_at), timeText: `${hhmm(e.starts_at)} – ${hhmm(e.ends_at)} ${tzLabel()}`.trim(),
    },
    poster: { ...poster, speakers: poster.speakers.map(s => ({ ...s, photoUrl: photoUrl(s.photo) })) },
    saved,
    caption: poster.caption || autoCaption(e, poster),
    autoCaption: autoCaption(e, poster),
    shareUrl: shareUrl(e),
    imageUrl: posterImageUrl(e),
    app: { name: config.appName, campus: config.campusName, host: host() },
    themes: THEMES,
  };
}

// ---------- Halaman share /p/:slug (meta Open Graph diisi server) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tpl = null;
export function sendPosterPage(req, res, slug) {
  const e = q('SELECT * FROM events WHERE slug = ?').get(slug);
  const u = currentUser(req);
  if (!e || (!e.published && !(u && (u.id === e.owner_id || u.role === 'admin')))) throw new HttpError(404, 'Event tidak ditemukan.');
  if (!tpl || !config.isProd) tpl = fs.readFileSync(path.join(config.root, 'public', 'posterview.html'), 'utf8');
  const { poster } = posterOf(e);
  const desc = `${dayDate(e.starts_at)}, ${hhmm(e.starts_at)}–${hhmm(e.ends_at)} ${tzLabel()} · ${poster.speakers.map(s => s.name).join(', ') || config.appName}`.slice(0, 280);
  const img = posterImageUrl(e, true) || `${config.publicUrl}/app-icon-512.png`;
  const og = [
    `<title>${esc(e.title)} — ${esc(config.appName)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="${esc(config.appName)}">`,
    `<meta property="og:title" content="${esc(e.title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(shareUrl(e))}">`, `<meta property="og:image" content="${esc(img)}">`,
    posterImageUrl(e) ? '<meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">' : '',
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">`,
  ].join('\n');
  const body = tpl.replace(/<title>[^<]*<\/title>/, '').replace('<!--OG-->', og);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------- Rute ----------
export function registerPosterRoutes(r) {
  const managed = (req, id) => {
    const u = requireUser(req);
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    if (e.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Hanya penyelenggara event atau admin yang dapat mengubah poster.');
    return e;
  };

  // Data poster publik (halaman share & aplikasi)
  r.get('/api/events/:slug/poster', (req, res, { slug }) => {
    const e = q('SELECT * FROM events WHERE slug = ?').get(slug);
    const u = currentUser(req);
    const own = !!u && !!e && (u.id === e.owner_id || u.role === 'admin');
    if (!e || (!e.published && !own)) throw new HttpError(404, 'Event tidak ditemukan.');
    json(res, 200, { ...publicData(e), canEdit: own });
  });
  // Editor (pemilik/admin)
  r.get('/api/events/:id/poster-edit', (req, res, { id }) => json(res, 200, { ...publicData(managed(req, id)), canEdit: true }));
  r.put('/api/events/:id/poster', async (req, res, { id }) => {
    const e = managed(req, id); requireCsrf(req);
    const p = sanitize(e, await readJson(req, 64 * 1024));
    q('UPDATE events SET poster = ? WHERE id = ?').run(JSON.stringify(p), e.id);
    // Foto narasumber yang tidak dipakai lagi dibersihkan
    const used = new Set(p.speakers.map(s => s.photo).filter(Boolean));
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`${e.id}-`) && !used.has(f)) {
      const st = fs.statSync(path.join(dir, f)); if (Date.now() - st.mtimeMs > 3600_000) fs.rmSync(path.join(dir, f), { force: true });
    }
    json(res, 200, publicData(q('SELECT * FROM events WHERE id = ?').get(e.id)));
  });
  // Foto narasumber
  r.post('/api/events/:id/poster/photo', async (req, res, { id }) => {
    const e = managed(req, id); requireCsrf(req);
    if (limiters.upload.take('pp:' + e.id)) throw new HttpError(429, 'Terlalu banyak unggahan. Tunggu sebentar.');
    const buf = await readBody(req, 5 * 1024 * 1024);
    const mime = sniff(buf);
    if (!mime) throw new HttpError(415, 'Foto harus berupa gambar PNG, JPG, atau WebP (maks. 5 MB).');
    const f = `${e.id}-${crypto.randomBytes(9).toString('base64url')}.${MIME_EXT[mime]}`;
    await fs.promises.writeFile(path.join(dir, f), buf, { mode: 0o644 });
    json(res, 201, { photo: f, photoUrl: photoUrl(f) });
  });
  r.get('/api/posters/photo/:file', (req, res, { file }) => {
    if (!/^\d+-[A-Za-z0-9_-]{6,40}\.(png|jpg|webp)$/.test(file)) throw new HttpError(404, 'Foto tidak ditemukan.');
    const p = path.join(dir, file); let st; try { st = fs.statSync(p); } catch { throw new HttpError(404, 'Foto tidak ditemukan.'); }
    res.writeHead(200, { 'Content-Type': EXT_MIME[file.split('.').pop()], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
  });
  // Gambar poster hasil render (PNG/JPEG dari editor)
  r.post('/api/events/:id/poster/image', async (req, res, { id }) => {
    const e = managed(req, id); requireCsrf(req);
    if (limiters.upload.take('pi:' + e.id)) throw new HttpError(429, 'Terlalu banyak unggahan. Tunggu sebentar.');
    const buf = await readBody(req, 12 * 1024 * 1024);
    const mime = sniff(buf);
    if (mime !== 'image/png' && mime !== 'image/jpeg') throw new HttpError(415, 'Gambar poster harus PNG atau JPG.');
    for (const x of ['png', 'jpg']) fs.rmSync(path.join(dir, `${e.id}.${x}`), { force: true });
    await fs.promises.writeFile(path.join(dir, `${e.id}.${MIME_EXT[mime]}`), buf, { mode: 0o644 });
    q('UPDATE events SET poster_ver = ? WHERE id = ?').run(now(), e.id);
    json(res, 201, { imageUrl: posterImageUrl(q('SELECT * FROM events WHERE id = ?').get(e.id)), shareUrl: shareUrl(e) });
  });
  r.get('/api/posters/:id/image', (req, res, { id }) => {
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    const u = currentUser(req);
    if (!e || (!e.published && !(u && (u.id === e.owner_id || u.role === 'admin')))) throw new HttpError(404, 'Poster tidak ditemukan.');
    const img = imageFile(e);
    if (!img) throw new HttpError(404, 'Poster belum dibuat.');
    const st = fs.statSync(img.file);
    const dl = new URL(req.url, 'http://x').searchParams.has('unduh');
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': st.size, 'Cache-Control': 'public, max-age=300', ETag: `"p${e.id}-${e.poster_ver}"`,
      ...(dl ? { 'Content-Disposition': `attachment; filename="Poster-${e.slug}.${img.mime === 'image/png' ? 'png' : 'jpg'}"` } : {}) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(img.file).on('error', () => res.destroy()).pipe(res);
  });
}
