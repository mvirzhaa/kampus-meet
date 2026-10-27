// Perekaman di sisi klien: merekam tab meeting + campuran audio semua peserta → file .webm di komputer moderator.
// Tidak ada beban encoding di server.
import { Track } from 'livekit-client';
import { toast } from '../shared/common.js';
import { store, on } from './store.js';
import { remoteAudioTracks } from './media.js';

let rec = null;
export const isRecording = () => !!rec;

export async function startRecording() {
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) throw new Error('Browser ini tidak mendukung perekaman. Gunakan Chrome atau Edge versi terbaru.');
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15, width: { ideal: 1920 }, height: { ideal: 1080 }, displaySurface: 'browser' },
    audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
  });
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const sources = new Map();
  const add = (track) => {
    const mst = track?.mediaStreamTrack; if (!mst || sources.has(mst.id)) return;
    try { const s = ctx.createMediaStreamSource(new MediaStream([mst])); s.connect(dest); sources.set(mst.id, s); } catch (e) { console.warn(e); }
  };
  for (const t of remoteAudioTracks()) add(t);
  add(store.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track);
  const off1 = on('audio-track', add);
  const off2 = on('local-tracks', () => add(store.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track));

  const stream = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 });
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { mr.onstop = res; });
  mr.start(2000);
  rec = { mr, display, ctx, chunks, done, off: () => { off1(); off2(); }, mime, started: Date.now() };
  display.getVideoTracks()[0].addEventListener('ended', () => stopRecording(), { once: true });
  return rec;
}

export async function stopRecording() {
  if (!rec) return;
  const r = rec; rec = null;
  try { r.mr.state !== 'inactive' && r.mr.stop(); } catch { /* abaikan */ }
  await r.done;
  r.display.getTracks().forEach(t => t.stop()); r.off(); r.ctx.close();
  const ext = r.mime?.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(r.chunks, { type: r.mime || 'video/webm' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rekaman-${store.code}-${new Date(r.started).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Rekaman disimpan (${(blob.size / 1048576).toFixed(1)} MB)`, 'success', 6000);
  store.onRecordingStopped?.();
}
