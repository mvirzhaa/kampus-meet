// Rilis aplikasi Android: admin mengunggah APK terbaru (dicicil per potongan agar tidak terbentur batas ukuran
// request di reverse proxy / batas waktu request), versi & versionCode dibaca langsung dari AndroidManifest.xml
// di dalam APK, lalu catatan pembaruan ditulis admin. Halaman depan & aplikasi mengambil rilis terbaru dari sini.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError, json, readJson, readBody } from './http.js';
import { requireAdmin, requireCsrf } from './auth.js';
import { clean, cleanMultiline } from './security.js';

const dir = path.join(config.dataDir, 'uploads', 'apk');
fs.mkdirSync(dir, { recursive: true });
const MAX = Math.max(10, config.apkMaxMb) * 1024 * 1024;
const CHUNK_MAX = 8 * 1024 * 1024 + 1024;
const fileOf = (id, part = false) => path.join(dir, `${parseInt(id, 10)}.${part ? 'part' : 'apk'}`);

// ---------- Membaca APK (ZIP) ----------
function readAt(fd, pos, len) { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.subarray(0, n); }

/** Ambil isi satu entri ZIP berdasarkan nama (tanpa membaca seluruh file ke memori). */
function zipEntry(file, wanted) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22 || readAt(fd, 0, 4).readUInt32LE(0) !== 0x04034b50) throw new Error('bukan file ZIP/APK');
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('direktori ZIP tidak ditemukan (file rusak/terpotong)');
    const cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (cdOff + cdSize > size) throw new Error('direktori ZIP tidak valid');
    const cd = readAt(fd, cdOff, cdSize);
    const names = [];
    let hit = null;
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32), lho = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nl);
      names.push(name);
      if (name === wanted) hit = { method, csize, usize, lho };
      p += 46 + nl + xl + cl;
    }
    if (!hit) return { names, data: null };
    const lh = readAt(fd, hit.lho, 30);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('entri ZIP tidak valid');
    const start = hit.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    if (hit.usize > 8 * 1024 * 1024 || hit.csize > 8 * 1024 * 1024) throw new Error('manifest terlalu besar');
    const raw = readAt(fd, start, hit.csize);
    const data = hit.method === 0 ? raw : hit.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 8 * 1024 * 1024 }) : null;
    if (!data) throw new Error('metode kompresi manifest tidak didukung');
    return { names, data };
  } finally { fs.closeSync(fd); }
}

// ---------- AndroidManifest.xml biner (AXML) ----------
const ATTR_ID = { 0x0101021b: 'versionCode', 0x0101021c: 'versionName', 0x0101020c: 'minSdkVersion' };
/** Baca atribut elemen <manifest> (package, versionCode, versionName) dan minSdkVersion dari <uses-sdk>. */
export function parseManifest(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) throw new Error('AndroidManifest.xml bukan format biner Android');
  let strings = [], resMap = [];
  const out = {};
  const str = (i) => (i >= 0 && i < strings.length ? strings[i] : null);
  for (let p = buf.readUInt16LE(2); p + 8 <= buf.length;) {
    const type = buf.readUInt16LE(p), hsize = buf.readUInt16LE(p + 2), size = buf.readUInt32LE(p + 4);
    if (size < 8 || p + size > buf.length) break;
    if (type === 0x0001) {                                    // String pool
      const count = buf.readUInt32LE(p + 8), flags = buf.readUInt32LE(p + 16), sStart = buf.readUInt32LE(p + 20);
      const utf8 = !!(flags & 0x100);
      strings = [];
      for (let i = 0; i < count; i++) {
        let o = p + sStart + buf.readUInt32LE(p + hsize + i * 4);
        if (utf8) {
          o += buf[o] & 0x80 ? 2 : 1;                         // panjang UTF-16 (diabaikan)
          let n = buf[o]; if (n & 0x80) { n = ((n & 0x7f) << 8) | buf[o + 1]; o += 2; } else o += 1;
          strings.push(buf.toString('utf8', o, o + n));
        } else {
          let n = buf.readUInt16LE(o); if (n & 0x8000) { n = ((n & 0x7fff) << 16) | buf.readUInt16LE(o + 2); o += 4; } else o += 2;
          strings.push(buf.toString('utf16le', o, o + n * 2));
        }
      }
    } else if (type === 0x0180) {                             // Peta ID resource atribut
      resMap = []; for (let o = p + hsize; o + 4 <= p + size; o += 4) resMap.push(buf.readUInt32LE(o));
    } else if (type === 0x0102) {                             // Awal elemen
      const ext = p + hsize;
      const el = str(buf.readUInt32LE(ext + 4));
      if (el === 'manifest' || el === 'uses-sdk') {
        const aStart = buf.readUInt16LE(ext + 8), aSize = buf.readUInt16LE(ext + 10), aCount = buf.readUInt16LE(ext + 12);
        for (let i = 0; i < aCount; i++) {
          const a = ext + aStart + i * aSize;
          const ni = buf.readUInt32LE(a + 4);
          const name = ATTR_ID[resMap[ni]] || str(ni);
          const raw = buf.readInt32LE(a + 8), dtype = buf[a + 15], data = buf.readUInt32LE(a + 16);
          const val = dtype === 0x03 ? str(data) : raw >= 0 ? str(raw) : (dtype >= 0x10 && dtype <= 0x1f ? data : null);
          if (['package', 'versionCode', 'versionName', 'minSdkVersion'].includes(name) && val != null) out[name] = val;
        }
        if (el === 'manifest' && out.minSdkVersion !== undefined) break;
      }
    }
    p += size;
  }
  if (out.versionCode !== undefined) out.versionCode = parseInt(out.versionCode, 10);
  if (out.minSdkVersion !== undefined) out.minSdkVersion = parseInt(out.minSdkVersion, 10);
  return out;
}

/** Periksa APK hasil unggahan: ZIP valid, berisi manifest & kode aplikasi; kembalikan info versinya. */
export function inspectApk(file) {
  const { names, data } = zipEntry(file, 'AndroidManifest.xml');
  if (!data) throw new Error('AndroidManifest.xml tidak ada — file ini bukan APK');
  if (!names.some(n => /^classes\d*\.dex$/.test(n))) throw new Error('APK tidak berisi kode aplikasi (classes.dex)');
  let info = {};
  try { info = parseManifest(data); } catch (e) { info = { error: e.message }; }
  return info;
}
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// ---------- Data ----------
const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}([-+][0-9A-Za-z.]{1,20})?$/;
export const latestRelease = () => q("SELECT * FROM app_releases WHERE status = 'published' ORDER BY version_code DESC, published_at DESC LIMIT 1").get() || null;
const publicView = (r) => r && ({
  id: r.id, version: r.version, versionCode: r.version_code, notes: r.notes, size: r.size, sha256: r.sha256,
  minSdk: r.min_sdk, publishedAt: r.published_at, url: '/unduh/android', fileName: apkName(r),
});
const adminView = (r) => ({ ...publicView(r), status: r.status, downloads: r.downloads, originalName: r.original_name, createdAt: r.created_at,
  uploadedBy: r.uploaded_by ? q('SELECT name FROM users WHERE id = ?').get(r.uploaded_by)?.name || '' : '', received: r.status === 'uploading' ? partSize(r.id) : r.size,
  package: r.package });
const apkName = (r) => `${config.appName.replace(/[^\w-]+/g, '-')}-${r.version || r.id}.apk`;
const partSize = (id) => { try { return fs.statSync(fileOf(id, true)).size; } catch { return 0; } };
/** Alamat unduhan untuk halaman lain (banner buka aplikasi, chatbot): rilis yang diunggah, atau ANDROID_APP_URL. */
export const androidDownloadUrl = () => (latestRelease() ? `${config.publicUrl}/unduh/android` : config.android.downloadUrl || null);

// Bersihkan unggahan yang terbengkalai (> 1 hari)
setInterval(() => {
  for (const r of q("SELECT id FROM app_releases WHERE status = 'uploading' AND created_at < ?").all(now() - 86400)) {
    fs.rmSync(fileOf(r.id, true), { force: true }); q('DELETE FROM app_releases WHERE id = ?').run(r.id);
  }
}, 3600 * 1000).unref();

// ---------- Rute ----------
export function registerApkRoutes(r) {
  // Publik: rilis terbaru + riwayat singkat (halaman depan & cek pembaruan di aplikasi)
  r.get('/api/app/latest', (req, res) => {
    const l = latestRelease();
    res.setHeader('Cache-Control', 'no-cache');
    json(res, 200, { latest: publicView(l), externalUrl: l ? null : config.android.downloadUrl || null, package: config.android.package });
  });
  r.get('/api/app/releases', (req, res) => {
    const rows = q("SELECT * FROM app_releases WHERE status = 'published' ORDER BY version_code DESC, published_at DESC LIMIT 10").all();
    json(res, 200, { releases: rows.map(publicView) });
  });

  // Admin
  r.get('/api/admin/app-releases', (req, res) => {
    requireAdmin(req);
    const rows = q("SELECT * FROM app_releases ORDER BY CASE status WHEN 'uploading' THEN 0 ELSE 1 END, COALESCE(published_at, created_at) DESC LIMIT 100").all();
    const l = latestRelease();
    json(res, 200, { releases: rows.map(adminView), latestId: l?.id || null, maxMb: Math.round(MAX / 1048576), chunkMb: 8, package: config.android.package });
  });
  // 1) Mulai unggah
  r.post('/api/admin/app-releases', async (req, res) => {
    const me = requireAdmin(req); requireCsrf(req);
    const b = await readJson(req);
    const size = parseInt(b.size, 10);
    if (!(size > 1024)) throw new HttpError(400, 'Ukuran file tidak valid.');
    if (size > MAX) throw new HttpError(413, `File APK maksimal ${Math.round(MAX / 1048576)} MB.`);
    const name = clean(b.fileName, 120);
    if (!/\.apk$/i.test(name)) throw new HttpError(400, 'Pilih file berekstensi .apk.');
    const info = q("INSERT INTO app_releases (status, size, original_name, created_at, uploaded_by) VALUES ('uploading', ?, ?, ?, ?)").run(size, name, now(), me.id);
    const id = Number(info.lastInsertRowid);
    fs.writeFileSync(fileOf(id, true), '');
    json(res, 201, { id, chunkSize: 8 * 1024 * 1024 });
  });
  // 2) Kirim potongan berurutan (offset harus sama dengan jumlah yang sudah diterima → bisa dilanjutkan bila putus)
  r.put('/api/admin/app-releases/:id/chunk', async (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const rel = q("SELECT * FROM app_releases WHERE id = ? AND status = 'uploading'").get(parseInt(id, 10));
    if (!rel) throw new HttpError(404, 'Sesi unggah tidak ditemukan. Mulai ulang unggahan.');
    const offset = parseInt(new URL(req.url, 'http://x').searchParams.get('offset'), 10);
    const have = partSize(rel.id);
    if (offset !== have) return json(res, 409, { error: 'Posisi potongan tidak cocok.', received: have });
    const buf = await readBody(req, CHUNK_MAX);
    if (!buf.length) throw new HttpError(400, 'Potongan kosong.');
    if (have + buf.length > rel.size) throw new HttpError(400, 'Data melebihi ukuran file yang diumumkan.');
    await fs.promises.appendFile(fileOf(rel.id, true), buf);
    json(res, 200, { received: have + buf.length });
  });
  // 3) Selesai: periksa APK, baca versi, simpan catatan pembaruan, terbitkan
  r.post('/api/admin/app-releases/:id/finish', async (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const rel = q("SELECT * FROM app_releases WHERE id = ? AND status = 'uploading'").get(parseInt(id, 10));
    if (!rel) throw new HttpError(404, 'Sesi unggah tidak ditemukan.');
    const b = await readJson(req, 64 * 1024);
    const part = fileOf(rel.id, true);
    if (partSize(rel.id) !== rel.size) throw new HttpError(400, 'Unggahan belum lengkap.');
    let info;
    try { info = inspectApk(part); }
    catch (e) { fs.rmSync(part, { force: true }); q('DELETE FROM app_releases WHERE id = ?').run(rel.id); throw new HttpError(400, `File tidak valid: ${e.message}.`); }
    if (info.package && config.android.package && info.package !== config.android.package) {
      fs.rmSync(part, { force: true }); q('DELETE FROM app_releases WHERE id = ?').run(rel.id);
      throw new HttpError(400, `APK ini milik aplikasi lain (${info.package}), bukan ${config.android.package}.`);
    }
    // Versi dari manifest diutamakan; isian manual hanya dipakai bila manifest tidak terbaca
    const version = info.versionName && VERSION_RE.test(info.versionName) ? info.versionName : clean(b.version, 30);
    const code = info.versionCode > 0 ? info.versionCode : parseInt(b.versionCode, 10);
    if (!VERSION_RE.test(version || '')) throw new HttpError(400, 'Versi aplikasi tidak terbaca dari APK. Isi versi (mis. 1.2.0) secara manual.');
    if (!(code > 0)) throw new HttpError(400, 'versionCode tidak terbaca dari APK. Isi versionCode (angka) secara manual.');
    const notes = cleanMultiline(b.notes, 4000);
    if (notes.length < 3) throw new HttpError(400, 'Tulis keterangan pembaruan (minimal 3 karakter).');
    const prev = latestRelease();
    const sha = await sha256File(part);
    fs.renameSync(part, fileOf(rel.id));
    const publish = b.publish !== false;
    q('UPDATE app_releases SET status = ?, version = ?, version_code = ?, notes = ?, sha256 = ?, package = ?, min_sdk = ?, published_at = ? WHERE id = ?')
      .run(publish ? 'published' : 'hidden', version, code, notes, sha, info.package || null, info.minSdkVersion || null, publish ? now() : null, rel.id);
    const warn = prev && code <= prev.version_code
      ? `versionCode APK ini (${code}) tidak lebih besar dari rilis sebelumnya (${prev.version_code}). Android hanya menganggapnya pembaruan bila versionCode lebih besar — naikkan android.versionCode sebelum build berikutnya.`
      : null;
    json(res, 200, { release: adminView(q('SELECT * FROM app_releases WHERE id = ?').get(rel.id)), detected: { version: info.versionName || null, versionCode: info.versionCode || null, package: info.package || null }, warning: warn });
  });
  // Ubah catatan / sembunyikan / terbitkan ulang
  r.patch('/api/admin/app-releases/:id', async (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const rel = q("SELECT * FROM app_releases WHERE id = ? AND status <> 'uploading'").get(parseInt(id, 10));
    if (!rel) throw new HttpError(404, 'Rilis tidak ditemukan.');
    const b = await readJson(req, 64 * 1024);
    if (b.notes !== undefined) { const n = cleanMultiline(b.notes, 4000); if (n.length < 3) throw new HttpError(400, 'Keterangan pembaruan minimal 3 karakter.'); q('UPDATE app_releases SET notes = ? WHERE id = ?').run(n, rel.id); }
    if (b.published !== undefined) q('UPDATE app_releases SET status = ?, published_at = COALESCE(published_at, ?) WHERE id = ?').run(b.published ? 'published' : 'hidden', now(), rel.id);
    json(res, 200, { release: adminView(q('SELECT * FROM app_releases WHERE id = ?').get(rel.id)) });
  });
  r.delete('/api/admin/app-releases/:id', (req, res, { id }) => {
    requireAdmin(req); requireCsrf(req);
    const rel = q('SELECT id FROM app_releases WHERE id = ?').get(parseInt(id, 10));
    if (rel) { fs.rmSync(fileOf(rel.id), { force: true }); fs.rmSync(fileOf(rel.id, true), { force: true }); q('DELETE FROM app_releases WHERE id = ?').run(rel.id); }
    json(res, 200, { ok: true });
  });
  // Unduh versi tertentu (admin, termasuk yang disembunyikan)
  r.get('/api/admin/app-releases/:id/file', (req, res, { id }) => {
    requireAdmin(req);
    const rel = q("SELECT * FROM app_releases WHERE id = ? AND status <> 'uploading'").get(parseInt(id, 10));
    if (!rel) throw new HttpError(404, 'Rilis tidak ditemukan.');
    sendApk(req, res, rel, false);
  });
}

/** Kirim file APK (mendukung Range agar unduhan di HP bisa dilanjutkan). */
export function sendApk(req, res, rel, count = true) {
  const file = fileOf(rel.id);
  let st; try { st = fs.statSync(file); } catch { throw new HttpError(404, 'File APK tidak ditemukan di server.'); }
  const headers = {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${apkName(rel)}"`,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    ETag: `"${rel.sha256 || rel.id}"`,
  };
  const m = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
  if (m) {
    const start = +m[1], end = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
  if (count && req.method === 'GET') q('UPDATE app_releases SET downloads = downloads + 1 WHERE id = ?').run(rel.id);
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
