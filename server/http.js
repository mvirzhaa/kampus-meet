// Kerangka HTTP mini: router, parser body, cookie, header keamanan, file statis.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const lkOrigins = (() => {
  try {
    const u = new URL(config.livekit.publicUrl);
    const httpProto = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${u.protocol}//${u.host} ${httpProto}//${u.host}`;
  } catch { return ''; }
})();
// Halaman perekam dibuka oleh Egress dan tersambung ke LiveKit lewat URL internal
const recOrigins = (() => { try { const u = new URL(config.recording.egressWsUrl); return `${u.protocol}//${u.host} ${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`; } catch { return ''; } })();
const modelOrigin = (() => { try { return new URL(config.segmenterModelUrl).origin; } catch { return ''; } })();

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${lkOrigins} ${modelOrigin} ${config.recording.mode === 'egress' ? recOrigins : ''}`.replace(/\s+/g, ' ').trim(),
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), autoplay=(self), geolocation=(), payment=(), usb=()');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* abaikan */ }
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  const secure = config.isProd || config.publicUrl.startsWith('https://');
  const c = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) c.push('HttpOnly');
  if (secure) c.push('Secure');
  if (maxAge !== undefined) c.push(`Max-Age=${maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), c.join('; ')]);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = +req.headers['content-length'] || 0;
    if (len > limit) { req.resume(); return reject(new HttpError(413, 'Ukuran data terlalu besar.')); }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Ukuran data terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 32 * 1024) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Content-Type harus application/json.');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* lanjut */ }
  throw new HttpError(400, 'JSON tidak valid.');
}

export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/** Tolak permintaan lintas situs untuk metode yang mengubah data. */
export function checkOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new HttpError(403, 'Permintaan lintas situs ditolak.');
    return;
  }
  let host; try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Origin tidak valid.'); }
  const reqHost = config.trustProxy ? (req.headers['x-forwarded-host'] || req.headers.host) : req.headers.host;
  if (host !== reqHost && origin !== new URL(config.publicUrl).origin) throw new HttpError(403, 'Origin tidak diizinkan.');
}

// ---------- Router ----------
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); } post(p, h) { this.add('POST', p, h); }
  patch(p, h) { this.add('PATCH', p, h); } delete(p, h) { this.add('DELETE', p, h); }
  match(method, pathname) {
    let allowed = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname); if (!m) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { allowed = true; continue; }
      const params = {}; r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = ''; } });
      return { handler: r.handler, params };
    }
    return allowed ? 'method' : null;
  }
}

// ---------- File statis ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.tflite': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const publicDir = path.join(config.root, 'public');
const statCache = new Map();

function statFile(p) {
  if (statCache.has(p) && config.isProd) return statCache.get(p);
  let st = null; try { const s = fs.statSync(p); if (s.isFile()) st = s; } catch { /* tidak ada */ }
  if (config.isProd) statCache.set(p, st);
  return st;
}

export function serveStatic(req, res, pathname) {
  let rel; try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel.includes('\0')) return false;
  const file = path.join(publicDir, path.normalize(rel));
  if (!file.startsWith(publicDir + path.sep)) return false;
  const st = statFile(file); if (!st) return false;
  const ext = path.extname(file);
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Cache-Control': ext === '.html' ? 'no-cache' : (/\/assets\//.test(rel) && /-[A-Z0-9]{8}\./i.test(rel)) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  // Pakai file terkompresi yang dibuat saat build (tanpa kompresi on-the-fly → hemat CPU)
  const ae = String(req.headers['accept-encoding'] || '');
  let sendPath = file, size = st.size;
  for (const [enc, suf] of [['br', '.br'], ['gzip', '.gz']]) {
    if (ae.includes(enc)) { const s2 = statFile(file + suf); if (s2) { sendPath = file + suf; size = s2.size; headers['Content-Encoding'] = enc; break; } }
  }
  headers['Content-Length'] = size;
  res.writeHead(res.statusCode || 200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(sendPath).pipe(res);
  return true;
}

export function sendHtml(req, res, name, status = 200) {
  const file = path.join(publicDir, name);
  const st = statFile(file);
  if (!st) { res.writeHead(404); res.end('Not found'); return; }
  res.statusCode = status;
  serveStatic(req, res, '/' + name);
}
