// Build frontend: bundel + minify (esbuild), sisipkan partial HTML, salin vendor, pra-kompresi br/gzip.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const pub = path.join(root, 'public');
const out = path.join(pub, 'assets');
const r = (...p) => path.join(root, ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const pages = fs.readdirSync(path.join(src, 'pages')).filter(f => f.endsWith('.js'));
const entryPoints = {
  ...Object.fromEntries(pages.map(f => [path.basename(f, '.js'), path.join(src, 'pages', f)])),
  room: path.join(src, 'room', 'main.js'),
  site: path.join(src, 'css', 'site.css'),
  roomcss: path.join(src, 'css', 'room.css'),
};

const result = await esbuild.build({
  entryPoints, outdir: out, bundle: true, splitting: true, format: 'esm', minify: true, sourcemap: false,
  entryNames: '[name]-[hash]', chunkNames: 'c-[hash]', assetNames: '[name]-[hash]',
  target: ['es2022', 'chrome100', 'firefox100', 'safari15.4'], metafile: true, legalComments: 'none',
  logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' },
});

const built = {};
for (const [file, info] of Object.entries(result.metafile.outputs)) {
  if (!info.entryPoint) continue;
  const name = Object.entries(entryPoints).find(([, p]) => path.resolve(p) === path.resolve(root, info.entryPoint))?.[0];
  if (name) built[name] = '/' + path.relative(pub, path.resolve(root, file)).split(path.sep).join('/');
}

// ---------- HTML ----------
const partial = (n) => fs.readFileSync(path.join(src, 'html', 'partials', n), 'utf8');
const parts = { NAV: partial('nav.html'), FOOTER: partial('footer.html'), HERO: partial('hero-art.svg') };
for (const f of fs.readdirSync(path.join(src, 'html')).filter(f => f.endsWith('.html'))) {
  let html = fs.readFileSync(path.join(src, 'html', f), 'utf8');
  html = html.replace(/<!--(NAV|FOOTER|HERO)-->/g, (_, k) => parts[k]);
  html = html.replace(/<!--CSS:(\w+)-->/g, (_, n) => { if (!built[n]) throw new Error('CSS tidak ada: ' + n); return `<link rel="stylesheet" href="${built[n]}">`; });
  html = html.replace(/<!--JS:(\w+)-->/g, (_, n) => { if (!built[n]) throw new Error('JS tidak ada: ' + n); return `<script type="module" src="${built[n]}"></script>`; });
  fs.writeFileSync(path.join(pub, f), html);
}

// ---------- Vendor (di-host sendiri, tanpa CDN) ----------
const vendor = path.join(pub, 'vendor');
fs.mkdirSync(path.join(vendor, 'mediapipe'), { recursive: true });
fs.copyFileSync(r('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), path.join(vendor, 'pdf.worker.min.mjs'));
fs.cpSync(r('node_modules/pdfjs-dist/standard_fonts'), path.join(vendor, 'standard_fonts'), { recursive: true });
fs.cpSync(r('node_modules/pdfjs-dist/cmaps'), path.join(vendor, 'cmaps'), { recursive: true });
const mpWasm = r('node_modules/@mediapipe/tasks-vision/wasm');
fs.cpSync(mpWasm, path.join(vendor, 'mediapipe', 'wasm'), { recursive: true });
fs.copyFileSync(path.join(src, 'html', 'partials', 'hero-art.svg'), path.join(pub, 'hero.svg'));

// ---------- Pra-kompresi ----------
let count = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(br|gz)$/.test(p)) { fs.rmSync(p); continue; }
    if (!/\.(js|mjs|css|html|svg|json|wasm|txt|webmanifest)$/.test(p)) continue;
    const buf = fs.readFileSync(p);
    if (buf.length < 1024) continue;
    fs.writeFileSync(p + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
    fs.writeFileSync(p + '.gz', zlib.gzipSync(buf, { level: 9 }));
    count++;
  }
}
walk(pub);

const sizes = Object.entries(built).map(([n, p]) => {
  const f = path.join(pub, p); const s = fs.statSync(f).size; const b = fs.existsSync(f + '.br') ? fs.statSync(f + '.br').size : s;
  return `${n.padEnd(12)} ${(s / 1024).toFixed(1).padStart(7)} KB  (br ${(b / 1024).toFixed(1)} KB)`;
});
console.log('Build selesai:\n' + sizes.join('\n') + `\n${count} file dikompresi.`);
