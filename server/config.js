// Konfigurasi dibaca dari environment (.env dimuat oleh `node --env-file`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (k, d) => (process.env[k] ?? '').trim() || d;
const bool = (k, d) => { const v = env(k, ''); return v ? /^(1|true|yes|on)$/i.test(v) : d; };
const int = (k, d) => { const n = parseInt(env(k, ''), 10); return Number.isFinite(n) ? n : d; };

export const config = {
  root,
  isProd: env('NODE_ENV', 'development') === 'production',
  port: int('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  // URL publik aplikasi (dipakai untuk pengecekan Origin & link undangan)
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),
  trustProxy: bool('TRUST_PROXY', false),

  appName: env('APP_NAME', 'UIKA Meet'),
  campusName: env('CAMPUS_NAME', 'Universitas Ibn Khaldun Bogor'),
  // Kosongkan untuk mengizinkan semua domain email saat pendaftaran
  allowedEmailDomains: env('ALLOWED_EMAIL_DOMAINS', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  allowRegistration: bool('ALLOW_REGISTRATION', true),
  // Super-admin tetap: akun dengan email ini selalu berperan admin dan tidak bisa
  // diturunkan/dinonaktifkan oleh siapa pun (termasuk admin lain).
  adminEmail: env('ADMIN_EMAIL', '').toLowerCase(),

  dataDir: path.resolve(root, env('DATA_DIR', 'data')),
  maxUploadMb: int('MAX_UPLOAD_MB', 30),
  sessionDays: int('SESSION_DAYS', 7),

  livekit: {
    // URL internal (server → LiveKit API), mis. http://livekit:7880
    url: env('LIVEKIT_URL', 'http://127.0.0.1:7880').replace(/\/$/, ''),
    // URL publik untuk browser, mis. wss://media.kampus.ac.id
    publicUrl: env('LIVEKIT_PUBLIC_URL', 'ws://localhost:7880'),
    apiKey: env('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: env('LIVEKIT_API_SECRET', 'devsecret_please_change_me_0123456789'),
  },
  // API Egress (bawaan: sama dengan server LiveKit, yang meneruskan ke layanan Egress lewat Redis)
  egressApiUrl: env('EGRESS_API_URL', '').replace(/\/$/, ''),
  maxParticipantsDefault: int('MAX_PARTICIPANTS', 300),
  timezone: env('APP_TIMEZONE', 'Asia/Jakarta'),
  // Sertifikat hanya untuk peserta dengan durasi (masuk pertama → keluar terakhir) minimal sekian menit
  certMinMinutes: int('CERT_MIN_MINUTES', 15),
  recording: {
    // egress = direkam di server (LiveKit Egress) lalu diunggah ke Google Drive; local = direkam di browser moderator; off = nonaktif
    mode: env('RECORDING_MODE', 'local'),
    // Folder tempat Egress menulis MP4 sementara (di dalam container egress) dan folder yang sama dilihat dari aplikasi
    egressDir: env('EGRESS_OUTPUT_DIR', '/out'),
    localDir: path.resolve(root, env('RECORDINGS_DIR', 'data/recordings')),
    // URL aplikasi yang dibuka headless Chrome milik Egress (jaringan internal), dan URL LiveKit dari sisi Egress
    templateBase: env('RECORDING_TEMPLATE_BASE', 'http://127.0.0.1:3000').replace(/\/$/, ''),
    egressWsUrl: env('EGRESS_WS_URL', 'ws://127.0.0.1:7880'),
    width: int('REC_WIDTH', 1280), height: int('REC_HEIGHT', 720),
    fps: int('REC_FPS', 15), videoKbps: int('REC_VIDEO_KBPS', 800), audioKbps: int('REC_AUDIO_KBPS', 64),
    keepFailedDays: int('REC_KEEP_FAILED_DAYS', 7),
  },
  google: {
    clientId: env('GOOGLE_CLIENT_ID', ''),
    clientSecret: env('GOOGLE_CLIENT_SECRET', ''),
    driveFolderId: env('GDRIVE_FOLDER_ID', ''),
    // Hanya untuk pengujian (server tiruan); biarkan kosong di production
    apiBase: env('GOOGLE_API_BASE', 'https://www.googleapis.com').replace(/\/$/, ''),
    tokenUrl: env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    authUrl: env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
  },
  // Transkrip otomatis dihapus setelah sekian hari (0 = simpan selamanya)
  transcriptRetentionDays: int('TRANSCRIPT_RETENTION_DAYS', 180),
  // URL model segmentasi (virtual background). Bisa di-host sendiri: /vendor/mediapipe/selfie_segmenter.tflite
  segmenterModelUrl: env('SEGMENTER_MODEL_URL', 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'),
};

config.egressApiUrl ||= config.livekit.url;
if (!['egress', 'local', 'off'].includes(config.recording.mode)) config.recording.mode = 'local';

if (config.isProd) {
  const weak = !process.env.LIVEKIT_API_SECRET || config.livekit.apiSecret.length < 32 || config.livekit.apiSecret.startsWith('devsecret');
  if (weak) {
    console.error('[FATAL] LIVEKIT_API_SECRET wajib diisi (min. 32 karakter acak) di production.');
    process.exit(1);
  }
}
