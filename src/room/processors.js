// Efek kamera di sisi klien (tidak membebani server): kecerahan & latar virtual/blur (dimuat sesuai kebutuhan).
import { store } from './store.js';

/** Prosesor kecerahan ringan berbasis canvas (filter CSS di GPU). */
export class BrightnessProcessor {
  constructor(value) { this.name = 'brightness'; this.value = value; }
  async init({ track }) {
    this.source = track;
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true;
    this.video.srcObject = new MediaStream([track]);
    await this.video.play().catch(() => {});
    const s = track.getSettings();
    this.canvas = document.createElement('canvas');
    this.canvas.width = s.width || 640; this.canvas.height = s.height || 360;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.processedTrack = this.canvas.captureStream(s.frameRate || 24).getVideoTracks()[0];
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      if (vw && (this.canvas.width !== vw || this.canvas.height !== vh)) { this.canvas.width = vw; this.canvas.height = vh; }
      this.ctx.filter = `brightness(${1 + this.value / 100})`;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(loop); else setTimeout(loop, 40);
    };
    loop();
  }
  async restart(opts) { await this.destroy(); await this.init(opts); }
  async destroy() { this.running = false; this.processedTrack?.stop(); if (this.video) this.video.srcObject = null; }
}

let bgModule = null;
/** Buat prosesor latar (blur/gambar). Mengembalikan null bila browser tidak mendukung. */
export async function backgroundProcessor(mode, imagePath) {
  bgModule ??= await import('@livekit/track-processors');
  if (!bgModule.supportsBackgroundProcessors()) return null;
  return bgModule.BackgroundProcessor({
    ...(mode === 'blur' ? { mode: 'background-blur', blurRadius: 12 } : { mode: 'virtual-background', imagePath }),
    assetPaths: { tasksVisionFileSet: '/vendor/mediapipe/wasm', modelAssetPath: store.segmenterModelUrl },
  });
}

/** Gambar latar virtual dibuat secara prosedural (tanpa file aset). */
export function makeBackgrounds() {
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; draw(c.getContext('2d'), 1280, 720); return c.toDataURL('image/jpeg', 0.85); };
  return [
    { id: 'aurora', name: 'Aurora', url: mk((x, w, hh) => {
      const g = x.createLinearGradient(0, 0, w, hh); g.addColorStop(0, '#0f2027'); g.addColorStop(0.5, '#2c5364'); g.addColorStop(1, '#6b5cf3');
      x.fillStyle = g; x.fillRect(0, 0, w, hh);
      for (let i = 0; i < 5; i++) { x.fillStyle = `rgba(${120 + i * 20},${200 - i * 20},255,0.12)`; x.beginPath(); x.ellipse(w * (0.2 + i * 0.15), hh * 0.35, 260, 90 + i * 20, -0.3, 0, Math.PI * 2); x.fill(); }
    }) },
    { id: 'kampus', name: 'Biru', url: mk((x, w, hh) => {
      const g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, '#dbe9fb'); g.addColorStop(1, '#6f9ce0'); x.fillStyle = g; x.fillRect(0, 0, w, hh);
      x.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 7; i++) x.fillRect(80 + i * 170, hh * 0.45 - (i % 3) * 40, 110, hh);
    }) },
    { id: 'ruang', name: 'Ruang', url: mk((x, w, hh) => {
      x.fillStyle = '#e9e4dc'; x.fillRect(0, 0, w, hh); x.fillStyle = '#cfc5b6'; x.fillRect(0, hh * 0.72, w, hh);
      x.fillStyle = '#8a6f52'; for (let i = 0; i < 4; i++) x.fillRect(120 + i * 70, hh * 0.25, 50, hh * 0.47);
      x.fillStyle = '#5b8c5a'; x.beginPath(); x.arc(w * 0.82, hh * 0.55, 70, 0, Math.PI * 2); x.fill(); x.fillStyle = '#7a5c3e'; x.fillRect(w * 0.81, hh * 0.6, 22, hh * 0.15);
      x.fillStyle = '#fff'; x.fillRect(w * 0.45, hh * 0.18, 300, 180); x.strokeStyle = '#b9ad9c'; x.lineWidth = 8; x.strokeRect(w * 0.45, hh * 0.18, 300, 180);
    }) },
    { id: 'abu', name: 'Abu', url: mk((x, w, hh) => { const g = x.createRadialGradient(w / 2, hh / 2, 50, w / 2, hh / 2, w * 0.7); g.addColorStop(0, '#6b7280'); g.addColorStop(1, '#1f2937'); x.fillStyle = g; x.fillRect(0, 0, w, hh); }) },
  ];
}

// ---------- Latar unggahan peserta (hanya disimpan di perangkat ini, tidak dikirim ke server) ----------
const CUSTOM_KEY = 'km:bg-custom';
const MAX_CUSTOM = 4;
export function customBackgrounds() {
  try { const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); return Array.isArray(v) ? v.filter(b => b && /^c-[\w-]+$/.test(b.id) && /^data:image\/jpeg;base64,/.test(b.url)) : []; }
  catch { return []; }
}
export const allBackgrounds = () => [...makeBackgrounds(), ...customBackgrounds()];

/** Ubah gambar unggahan menjadi 1280x720 (dipotong rapi, JPEG) lalu simpan. */
export async function addCustomBackground(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Gunakan gambar PNG, JPG, atau WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 15 MB.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Gambar tidak dapat dibaca.'); });
  const W = 1280, H = 720;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const sc = Math.max(W / bmp.width, H / bmp.height);
  const dw = bmp.width * sc, dh = bmp.height * sc;
  x.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
  bmp.close?.();
  let url = c.toDataURL('image/jpeg', 0.82);
  if (url.length > 600_000) url = c.toDataURL('image/jpeg', 0.65);
  const list = customBackgrounds();
  const item = { id: 'c-' + Date.now().toString(36), name: (file.name || 'Gambar saya').replace(/\.[^.]+$/, '').slice(0, 40), url };
  const next = [...list, item].slice(-MAX_CUSTOM);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); }
  catch { throw new Error('Penyimpanan browser penuh. Hapus salah satu latar unggahan lalu coba lagi.'); }
  return item;
}
export function removeCustomBackground(id) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customBackgrounds().filter(b => b.id !== id))); } catch { /* abaikan */ }
}
