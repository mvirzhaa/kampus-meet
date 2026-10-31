import http from 'node:http';
import { config } from './config.js';
import './db.js';
import { Router, HttpError, json, securityHeaders, serveStatic, sendHtml, checkOrigin, clientIp } from './http.js';
import { registerAuthRoutes } from './auth.js';
import { registerRoomRoutes, createRoomRecord, uploadsDir, resumeBreakouts } from './rooms.js';
import { registerEventRoutes } from './events.js';
import { registerAdminRoutes } from './admin.js';
import { registerSsoRoutes } from './sso.js';
import { limiters } from './security.js';

const api = new Router();
registerAuthRoutes(api);
registerRoomRoutes(api);
resumeBreakouts();
registerEventRoutes(api, { createRoomRecord });
registerAdminRoutes(api, { uploadsDir });
registerSsoRoutes(api);
api.get('/api/health', (req, res) => json(res, 200, { ok: true }));

// Halaman (clean URL → file HTML statis)
const pages = [
  [/^\/$/, 'index.html'], [/^\/(login|daftar)\/?$/, 'login.html'], [/^\/dashboard\/?$/, 'dashboard.html'], [/^\/admin\/?$/, 'admin.html'],
  [/^\/j\/[a-z-]{6,20}\/?$/, 'join.html'], [/^\/r\/[a-z-]{6,20}\/?$/, 'room.html'], [/^\/rec\/[a-z-]{6,20}\/?$/, 'room.html'],
  [/^\/event\/?$/, 'events.html'], [/^\/event\/[\w-]{3,80}\/?$/, 'event.html'],
  [/^\/sertifikat\/[\w-]{4,40}\/?$/, 'certificate.html'], [/^\/verifikasi\/[\w-]{4,40}\/?$/, 'verify.html'], [/^\/panduan\/?$/, 'guide.html'], [/^\/m\/pres\/?$/, 'mpres.html'],
];

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/') || pathname.startsWith('/sso/')) {
      checkOrigin(req);
      if (pathname !== '/api/livekit/webhook') {
        const wait = limiters.api.take(clientIp(req));
        if (wait) throw new HttpError(429, 'Terlalu banyak permintaan.');
      }
      const m = api.match(req.method, pathname);
      if (m === 'method') throw new HttpError(405, 'Metode tidak diizinkan.');
      if (!m) throw new HttpError(404, 'Endpoint tidak ditemukan.');
      await m.handler(req, res, m.params);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Metode tidak diizinkan.');
    // Android App Links: membuktikan domain ini milik aplikasi, sehingga tautan undangan langsung terbuka di aplikasi
    if (pathname === '/.well-known/assetlinks.json') {
      if (!config.android.certSha256.length) throw new HttpError(404, 'Not found');
      const body = JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: config.android.package, sha256_cert_fingerprints: config.android.certSha256 } }]);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Content-Length': Buffer.byteLength(body) });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    for (const [re, file] of pages) if (re.test(pathname)) return sendHtml(req, res, file);
    if (serveStatic(req, res, pathname)) return;
    res.statusCode = 404;
    return sendHtml(req, res, '404.html', 404);
  } catch (err) {
    if (res.headersSent) { res.destroy(); return; }
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${pathname}`, err);
    if (err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
    if (pathname.startsWith('/api/')) json(res, status, { error: status >= 500 ? 'Terjadi kesalahan pada server.' : err.message });
    else { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(status >= 500 ? 'Terjadi kesalahan pada server.' : err.message); }
  }
});

// Batas waktu untuk mencegah koneksi lambat menahan sumber daya (slowloris)
server.headersTimeout = 15000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;

server.listen(config.port, config.host, () => {
  console.log(`${config.appName} berjalan di ${config.publicUrl} (port ${config.port}, ${config.isProd ? 'production' : 'development'})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
