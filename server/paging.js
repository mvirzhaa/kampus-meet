// Halaman (pagination) + kata kunci pencarian untuk semua tabel admin.
import { clean } from './security.js';

/** ?page=1&per=20&q=… → batas aman untuk LIMIT/OFFSET. */
export function paging(req, { per = 20, max = 100 } = {}) {
  const sp = new URL(req.url, 'http://x').searchParams;
  const page = Math.max(1, Math.min(100000, parseInt(sp.get('page'), 10) || 1));
  const pp = Math.min(max, Math.max(5, parseInt(sp.get('per'), 10) || per));
  return { sp, page, per: pp, offset: (page - 1) * pp, term: clean(sp.get('q'), 80) };
}

/** Bentuk jawaban seragam: { rows, total, page, per, pages } */
export const paged = (rows, total, p) => ({ rows, total, page: p.page, per: p.per, pages: Math.max(1, Math.ceil(total / p.per)) });

/** Pola LIKE yang aman dari wildcard pengguna. */
export const like = (term) => `%${String(term).replace(/[%_\\]/g, '')}%`;
