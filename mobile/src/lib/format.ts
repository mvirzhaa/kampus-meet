// Format tanggal/jam dalam WIB (server menyimpan detik Unix).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const wib = (sec: number) => new Date(sec * 1000 + 7 * 3600_000);
export const fmtTime = (sec: number) => { const d = wib(sec); return `${String(d.getUTCHours()).padStart(2, '0')}.${String(d.getUTCMinutes()).padStart(2, '0')}`; };
export const fmtDay = (sec: number) => { const d = wib(sec); return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const fmtDateTime = (sec: number) => `${fmtDay(sec)} ${wib(sec).getUTCFullYear()} · ${fmtTime(sec)} WIB`;
export const fmtClock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
