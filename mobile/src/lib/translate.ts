// Terjemahan Indonesia ⇄ Inggris. Utama: Google ML Kit di perangkat (offline setelah model diunduh).
// Cadangan: layanan terjemahan server kampus (bila admin mengaktifkan TRANSLATE_URL).
import UikaTranslate from '../../modules/uika-translate';
import { api } from './api';

export type Lang2 = 'id' | 'en';
export const SHORT: Record<string, Lang2> = { 'id-ID': 'id', 'en-US': 'en' };
export const OTHER: Record<string, Lang2> = { 'id-ID': 'en', 'en-US': 'id' };
export const hasDeviceTranslate = !!UikaTranslate;

const cache = new Map<string, string>();
const preparing = new Map<string, Promise<boolean>>();

/** Unduh model bahasa (±30 MB) bila belum ada. */
export function prepareTranslate(from: Lang2, to: Lang2, wifiOnly = false): Promise<boolean> {
  if (!UikaTranslate || from === to) return Promise.resolve(false);
  const k = `${from}>${to}`;
  if (!preparing.has(k)) {
    const p = UikaTranslate.prepare(from, to, wifiOnly).catch(() => { preparing.delete(k); return false; });
    preparing.set(k, p);
  }
  return preparing.get(k)!;
}

export async function translate(text: string, from: Lang2, to: Lang2, opt: { code?: string; seat?: string; server?: boolean } = {}): Promise<string | null> {
  if (!text || from === to) return null;
  const key = `${from}|${to}|${text}`;
  const hit = cache.get(key); if (hit) return hit;
  let out: string | null = null;
  if (UikaTranslate) {
    try { out = await UikaTranslate.translate(text, from, to); } catch { out = null; }
  }
  if (out == null && opt.server && opt.code && opt.seat) {
    try { out = (await api<{ text: string }>('POST', `/api/meet/${opt.code}/translate`, { text, from, to }, { 'X-Seat': opt.seat })).text; }
    catch { out = null; }
  }
  if (out) { cache.set(key, out); if (cache.size > 600) cache.delete(cache.keys().next().value as string); }
  return out;
}
