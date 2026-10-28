// Integrasi LiveKit (SFU WebRTC) tanpa SDK: JWT HS256 + Twirp JSON API.
import crypto from 'node:crypto';
import { config } from './config.js';

const { apiKey, apiSecret, url } = config.livekit;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signJwt(claims, ttlSec = 600) {
  const t = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ iss: apiKey, nbf: t - 5, exp: t + ttlSec, ...claims }));
  const sig = crypto.createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function verifyJwt(token) {
  const parts = String(token || '').replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', apiSecret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== sig.length || !crypto.timingSafeEqual(given, sig)) return null;
  let claims; try { claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { return null; }
  const t = Math.floor(Date.now() / 1000);
  if (claims.iss !== apiKey || (claims.exp && claims.exp < t - 30) || (claims.nbf && claims.nbf > t + 30)) return null;
  return claims;
}

/** Verifikasi webhook LiveKit: JWT di header Authorization + hash sha256 isi body. */
export function verifyWebhook(rawBody, authHeader) {
  const claims = verifyJwt(authHeader);
  if (!claims) return false;
  const hash = crypto.createHash('sha256').update(rawBody).digest('base64');
  return claims.sha256 === hash;
}

/** Izin publish sesuai peran & kunci (lock viewers). */
export function publishSources({ role, isPresenter, locks, isSpotlight }) {
  if (role === 'moderator') return ['camera', 'microphone', 'screen_share', 'screen_share_audio'];
  const s = [];
  // Peserta yang sedang disorot moderator tetap boleh kamera & mikrofon walau peserta dikunci.
  if (!locks?.webcam || isSpotlight) s.push('camera');
  if (!locks?.mic || isSpotlight) s.push('microphone');
  if (isPresenter) s.push('screen_share', 'screen_share_audio', ...(s.includes('camera') ? [] : ['camera']), ...(s.includes('microphone') ? [] : ['microphone']));
  return s;
}

/** Token akses peserta. Peserta TIDAK boleh mengubah metadata/atribut sendiri (peran tidak bisa dipalsukan). */
export function participantToken({ room, identity, name, role, sources, uid }) {
  return signJwt({
    sub: identity,
    name,
    attributes: { role, ...(uid ? { uid: String(uid) } : {}) },
    video: {
      room, roomJoin: true, canSubscribe: true, canPublishData: true,
      canPublish: sources.length > 0, canPublishSources: sources,
      canUpdateOwnMetadata: false,
    },
  }, 10 * 60); // 10 menit: token bocor/lama cepat kedaluwarsa; LiveKit me-refresh otomatis selama terhubung
}

const adminToken = (room) => signJwt({ video: { roomAdmin: true, roomCreate: true, roomList: true, roomRecord: true, ...(room ? { room } : {}) } }, 120);

async function twirp(method, body, room, service = 'RoomService', base = url) {
  const res = await fetch(`${base}/twirp/livekit.${service}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken(room)}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`LiveKit ${method} ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status; throw err;
  }
  return text ? JSON.parse(text) : {};
}

const SRC_ENUM = { camera: 'CAMERA', microphone: 'MICROPHONE', screen_share: 'SCREEN_SHARE', screen_share_audio: 'SCREEN_SHARE_AUDIO' };

export const lk = {
  createRoom: (name, { maxParticipants, metadata } = {}) =>
    twirp('CreateRoom', { name, empty_timeout: 300, departure_timeout: 30, max_participants: maxParticipants || 0, metadata: metadata || '' }),
  listRooms: (names) => twirp('ListRooms', names ? { names } : {}),
  deleteRoom: (room) => twirp('DeleteRoom', { room }, room),
  listParticipants: async (room) => (await twirp('ListParticipants', { room }, room)).participants || [],
  removeParticipant: (room, identity) => twirp('RemoveParticipant', { room, identity }, room),
  muteTrack: (room, identity, trackSid) => twirp('MutePublishedTrack', { room, identity, track_sid: trackSid, muted: true }, room),
  updateRoomMetadata: (room, metadata) => twirp('UpdateRoomMetadata', { room, metadata }, room),
  /** Pesan data dari server (tanpa pengirim peserta) — klien mempercayai topik 'km-srv' hanya dari server. */
  sendData: (room, obj, topic = 'km-srv') => twirp('SendData', { room, data: Buffer.from(JSON.stringify(obj)).toString('base64'), kind: 'RELIABLE', topic }, room),

  // ===== Egress (perekaman di server) =====
  startRoomCompositeEgress: ({ room, customBaseUrl, filepath, rec }) => twirp('StartRoomCompositeEgress', {
    room_name: room,
    custom_base_url: customBaseUrl,
    file_outputs: [{ file_type: 'MP4', filepath }],
    advanced: {
      width: rec.width, height: rec.height, depth: 24, framerate: rec.fps,
      audio_codec: 'AAC', audio_bitrate: rec.audioKbps, audio_frequency: 44100,
      video_codec: 'H264_MAIN', video_bitrate: rec.videoKbps, key_frame_interval: 4,
    },
  }, room, 'Egress', config.egressApiUrl),
  stopEgress: (egressId) => twirp('StopEgress', { egress_id: egressId }, null, 'Egress', config.egressApiUrl),

  updateParticipant: (room, identity, { attributes, sources }) => twirp('UpdateParticipant', {
    room, identity,
    ...(attributes ? { attributes } : {}),
    ...(sources ? { permission: { can_subscribe: true, can_publish: sources.length > 0, can_publish_data: true, can_update_metadata: false, can_publish_sources: sources.map(s => SRC_ENUM[s]) } } : {}),
  }, room),
};
