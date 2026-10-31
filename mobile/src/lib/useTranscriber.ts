// Transkripsi ucapan saya dengan pengenal suara Android (SpeechRecognizer).
// Berjalan hanya saat transkripsi room aktif, mikrofon saya menyala, dan saya tidak menonaktifkannya.
// Android menghentikan pengenalan secara berkala — hook ini menyalakannya lagi otomatis.
import { useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

export type SrStatus = 'off' | 'listening' | 'starting' | 'error' | 'unavailable';

export function useTranscriber(o: { enabled: boolean; lang: 'id-ID' | 'en-US'; onInterim: (t: string, lang: string) => void; onFinal: (t: string, lang: string) => void }) {
  const [status, setStatus] = useState<SrStatus>('off');
  const [errMsg, setErrMsg] = useState('');
  const want = useRef(false);
  const running = useRef(false);
  const fails = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(o); cb.current = o;
  const langRef = useRef(o.lang);

  const start = async () => {
    if (running.current || !want.current) return;
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) { setStatus('unavailable'); setErrMsg('Pengenal suara tidak tersedia. Pasang/aktifkan aplikasi Google atau "Speech Recognition & Synthesis".'); return; }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setStatus('error'); setErrMsg('Izin mikrofon/pengenal suara ditolak.'); want.current = false; return; }
    running.current = true; setStatus('starting'); langRef.current = cb.current.lang;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: cb.current.lang, interimResults: true, continuous: true, maxAlternatives: 1, addsPunctuation: true,
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1500, EXTRA_MASK_OFFENSIVE_WORDS: false },
      });
    } catch { running.current = false; retry(); }
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) { try { ExpoSpeechRecognitionModule.abort(); } catch { /* abaikan */ } }
    running.current = false; setStatus('off');
  };
  const retry = () => {
    if (!want.current) return;
    if (timer.current) clearTimeout(timer.current);
    const wait = fails.current ? Math.min(10000, 600 * 2 ** Math.min(fails.current, 4)) : 250;
    timer.current = setTimeout(start, wait);
  };

  useSpeechRecognitionEvent('start', () => { setStatus('listening'); setErrMsg(''); });
  useSpeechRecognitionEvent('result', (e) => {
    const text = (e.results[0]?.transcript || '').trim();
    if (!text) return;
    fails.current = 0;
    if (e.isFinal) cb.current.onFinal(text, langRef.current); else cb.current.onInterim(text, langRef.current);
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (e.error === 'no-speech' || e.error === 'speech-timeout' || e.error === 'aborted') return;
    if (e.error === 'not-allowed') { want.current = false; setStatus('error'); setErrMsg('Izin mikrofon/pengenal suara ditolak.'); return; }
    if (e.error === 'language-not-supported') { want.current = false; setStatus('error'); setErrMsg('Bahasa ini belum didukung pengenal suara perangkat. Unduh paket bahasa di Pengaturan Google › Suara.'); return; }
    fails.current++;
    if (fails.current >= 3) { setStatus('error'); setErrMsg(e.error === 'network' ? 'Pengenal suara butuh koneksi internet.' : `Pengenal suara bermasalah (${e.error}). Mencoba lagi…`); }
  });
  useSpeechRecognitionEvent('end', () => { running.current = false; if (want.current) retry(); else setStatus('off'); });

  // Nyalakan/matikan sesuai kondisi; ganti bahasa = mulai ulang
  useEffect(() => {
    want.current = o.enabled;
    if (!o.enabled) { stop(); return; }
    if (running.current && langRef.current !== o.lang) { stop(); want.current = true; }
    fails.current = 0;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.enabled, o.lang]);
  useEffect(() => () => { want.current = false; stop(); }, []);

  return { status, errMsg };
}
