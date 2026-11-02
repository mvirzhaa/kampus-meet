// Widget "Fitri" — asisten virtual UIKA Meet di halaman depan (tamu maupun pengguna login).
// Pengguna login bisa menanyakan "undangan saya" untuk mendapat daftar undangan beserta tautan gabungnya.
// • Membuka percakapan dengan "Assalamualaikum" dan menyapa pengguna "Kakak".
// • Menjawab dalam Bahasa Indonesia atau English (mengikuti bahasa pertanyaan).
// • Di akhir percakapan (ucapan terima kasih/penutup, tombol Selesai, atau saat menutup widget)
//   meminta rating bintang 1–5 dan masukan, lalu mengirimkannya ke admin.
import { h, icon, api, getMe } from './common.js';

const KEY = 'km:chatbot';
const T = {
  id: {
    title: 'Fitri', sub: 'Asisten UIKA Meet · Online', placeholder: 'Tulis pertanyaan Kakak…', send: 'Kirim',
    end: 'Selesai', close: 'Tutup', launcher: 'Tanya Fitri',
    rateTitle: 'Bagaimana pengalaman Kakak ngobrol dengan Fitri?', rateNote: 'Masukan untuk kami (opsional)', ratePh: 'Apa yang bisa kami perbaiki?',
    rateSend: 'Kirim penilaian', rateSkip: 'Lewati', rateNeed: 'Pilih bintang 1–5 dulu ya, Kak.',
    thanks: 'Terima kasih atas penilaian dan masukannya, Kak! 🙏 Semoga membantu. Wassalamualaikum.',
    skipped: 'Baik, Kak. Kalau ada pertanyaan lagi, saya siap membantu. Wassalamualaikum.',
    error: 'Maaf Kak, asisten sedang tidak dapat dihubungi. Coba lagi sebentar lagi ya.',
    star: (n) => `${n} bintang`, labels: ['Sangat buruk', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'],
  },
  en: {
    title: 'Fitri', sub: 'UIKA Meet Assistant · Online', placeholder: 'Type your question, Kakak…', send: 'Send',
    end: 'Finish', close: 'Close', launcher: 'Ask Fitri',
    rateTitle: 'How was your chat with Fitri?', rateNote: 'Suggestions for us (optional)', ratePh: 'What could we improve?',
    rateSend: 'Send rating', rateSkip: 'Skip', rateNeed: 'Please choose 1–5 stars first, Kakak.',
    thanks: 'Thank you for your rating and feedback, Kakak! 🙏 Have a great day. Wassalamualaikum.',
    skipped: "Alright, Kakak. If you have more questions, I'm here to help. Wassalamualaikum.",
    error: 'Sorry Kakak, the assistant cannot be reached right now. Please try again shortly.',
    star: (n) => `${n} star${n > 1 ? 's' : ''}`, labels: ['Very poor', 'Poor', 'Okay', 'Good', 'Very good'],
  },
};
const GREETING = (name) => `Assalamualaikum, Kak${name ? ` ${name}` : ''}! 👋 Saya Fitri, asisten virtual UIKA Meet. Ada yang bisa saya bantu seputar meeting, event, sertifikat, atau aplikasinya?${name ? '\n\nKetik "undangan saya" untuk melihat undangan & tautan meeting Kakak.' : ''}\n\n(You can also ask me in English.)`;

const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = (st) => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* abaikan */ } };

export function initChatbot() {
  if (document.getElementById('kb-launch')) return;
  const me = getMe();
  const first = me?.user?.name?.split(' ')[0] || '';
  let st = load() || { msgs: [], lang: 'id', rated: false, asked: false, open: false };
  let busy = false;
  const t = () => T[st.lang] || T.id;

  const log = h('div', { class: 'kb-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const input = h('textarea', { class: 'kb-input', rows: 1, maxlength: 1000, 'aria-label': 'Pertanyaan' });
  const sendBtn = h('button', { class: 'kb-send', type: 'submit' }, icon('send', 18));
  const form = h('form', { class: 'kb-form', autocomplete: 'off' }, input, sendBtn);
  const endBtn = h('button', { class: 'kb-hbtn', type: 'button' }, icon('circle-check', 16), h('span'));
  const closeBtn = h('button', { class: 'kb-hbtn icon', type: 'button' }, icon('x', 18));
  const title = h('b'); const sub = h('small');
  const panel = h('section', { class: 'kb-panel', id: 'kb-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'kb-title', hidden: true },
    h('header', { class: 'kb-head' },
      h('span', { class: 'kb-avatar fitri' }, h('img', { src: '/img/fitri.svg', width: 40, height: 40, alt: '' })),
      h('div', { class: 'kb-ttl', id: 'kb-title' }, title, sub), endBtn, closeBtn),
    log, form);
  const launch = h('button', { class: 'kb-launch', id: 'kb-launch', type: 'button', 'aria-controls': 'kb-panel', 'aria-expanded': 'false' },
    h('img', { class: 'kb-launch-av', src: '/img/fitri.svg', width: 34, height: 34, alt: '' }), h('span'));
  document.body.append(panel, launch);

  function labels() {
    title.textContent = t().title; sub.textContent = t().sub;
    input.placeholder = t().placeholder; sendBtn.setAttribute('aria-label', t().send); sendBtn.title = t().send;
    endBtn.lastChild.textContent = t().end; endBtn.title = t().end;
    closeBtn.setAttribute('aria-label', t().close); closeBtn.title = t().close;
    launch.lastChild.textContent = t().launcher; launch.setAttribute('aria-label', t().launcher);
  }

  // ---------- Pesan ----------
  /** Teks biasa + tautan http(s) yang bisa diklik (tanpa HTML dari server). */
  function rich(t) {
    const out = []; let last = 0;
    for (const mm of String(t).matchAll(/https?:\/\/[^\s)]+/g)) {
      if (mm.index > last) out.push(t.slice(last, mm.index));
      const url = mm[0].replace(/[.,]+$/, '');
      out.push(h('a', { href: url, rel: 'noopener', target: url.startsWith(location.origin) ? '_self' : '_blank', text: url.replace(/^https?:\/\//, '') }));
      last = mm.index + url.length;
    }
    if (last < t.length) out.push(t.slice(last));
    return out;
  }
  function bubble(m) {
    const el = h('div', { class: `kb-msg ${m.r === 'u' ? 'u' : 'b'}` }, h('div', { class: 'kb-text' }, ...(m.r === 'u' ? [m.t] : rich(m.t))));
    if (m.links?.length) el.append(h('div', { class: 'kb-links' }, m.links.map(l => h('a', { href: l.href, class: 'kb-link' }, l.label, icon('chevron-right', 14)))));
    return el;
  }
  function chips(list) {
    if (!list?.length) return null;
    return h('div', { class: 'kb-chips' }, list.map(c => h('button', { type: 'button', class: 'kb-chip', onclick: (e) => { e.currentTarget.parentElement.remove(); ask(c); } }, c)));
  }
  function render() {
    log.replaceChildren(...st.msgs.map(bubble));
    const last = st.msgs[st.msgs.length - 1];
    if (last?.r === 'b' && last.suggestions && !st.asked) log.append(chips(last.suggestions));
    if (st.asked && !st.rated) log.append(ratingCard());
    log.scrollTop = log.scrollHeight;
  }
  function push(m) { st.msgs.push(m); st.msgs = st.msgs.slice(-60); save(st); }
  function start() {
    if (st.msgs.length) return;
    push({ r: 'b', t: GREETING(first), suggestions: [...(me?.user ? ['Undangan saya'] : []), 'Cara bergabung ke meeting', 'Cara membuat meeting', 'Sertifikat event', 'Event mendatang', 'How do I join a meeting?'] });
  }

  async function ask(text) {
    text = String(text || '').trim().slice(0, 1000);
    if (!text || busy) return;
    if (st.rated) { st.rated = false; st.asked = false; }   // percakapan baru setelah penilaian
    push({ r: 'u', t: text });
    render();
    busy = true; sendBtn.disabled = true;
    const typing = h('div', { class: 'kb-msg b typing', 'aria-label': '…' }, h('span'), h('span'), h('span'));
    log.append(typing); log.scrollTop = log.scrollHeight;
    try {
      const d = await api('POST', '/api/chatbot', { messages: st.msgs.slice(-12).map(m => ({ r: m.r, t: m.t })), lang: st.lang });
      st.lang = d.lang === 'en' ? 'en' : 'id'; labels();
      push({ r: 'b', t: d.reply, links: d.links || [], suggestions: d.suggestions || null });
      if (d.end) st.asked = true;
    } catch (e) {
      push({ r: 'b', t: e.status === 429 ? e.message : t().error });
    } finally {
      busy = false; sendBtn.disabled = false; save(st); render();
    }
  }

  // ---------- Rating 1–5 + masukan ----------
  function ratingCard() {
    let val = 0;
    const msg = h('small', { class: 'kb-rate-msg' });
    const starBtns = [1, 2, 3, 4, 5].map(n => h('button', { type: 'button', class: 'kb-star', role: 'radio', 'aria-checked': 'false', 'aria-label': t().star(n), title: t().labels[n - 1],
      onclick: () => { val = n; paint(); msg.textContent = t().labels[n - 1]; } }, '★'));
    const paint = () => starBtns.forEach((b, i) => { b.classList.toggle('on', i < val); b.setAttribute('aria-checked', String(i + 1 === val)); });
    const note = h('textarea', { class: 'kb-note', rows: 3, maxlength: 2000, placeholder: t().ratePh, 'aria-label': t().rateNote });
    const send = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
      if (!val) { msg.textContent = t().rateNeed; return; }
      send.disabled = true;
      try {
        await api('POST', '/api/chatbot/feedback', { rating: val, text: note.value.trim(), lang: st.lang, chat: st.msgs.map(m => ({ r: m.r, t: m.t })) });
        st.rated = true; push({ r: 'b', t: t().thanks }); save(st); render();
      } catch (e) { msg.textContent = e.message; send.disabled = false; }
    } }, t().rateSend);
    const skip = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { st.rated = true; push({ r: 'b', t: t().skipped }); save(st); render(); } }, t().rateSkip);
    return h('div', { class: 'kb-rate' }, h('b', { text: t().rateTitle }),
      h('div', { class: 'kb-stars', role: 'radiogroup', 'aria-label': t().rateTitle }, starBtns), msg,
      h('label', { class: 'kb-rate-l', text: t().rateNote }), note, h('div', { class: 'kb-rate-acts' }, skip, send));
  }
  function askRating() {
    if (st.rated || st.asked) return false;
    if (!st.msgs.some(m => m.r === 'u')) return false;
    st.asked = true; save(st); render();
    log.querySelector('.kb-star')?.focus();
    return true;
  }

  // ---------- Buka / tutup ----------
  function open() {
    start(); st.open = true; save(st);
    panel.hidden = false; launch.setAttribute('aria-expanded', 'true'); launch.classList.add('on');
    labels(); render();
    setTimeout(() => input.focus(), 50);
  }
  function close() {
    // Percakapan yang belum dinilai: minta rating sekali sebelum widget ditutup
    if (askRating()) return;
    st.open = false; save(st);
    panel.hidden = true; launch.setAttribute('aria-expanded', 'false'); launch.classList.remove('on');
    launch.focus();
  }
  launch.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);
  endBtn.addEventListener('click', () => { if (!askRating() && !st.msgs.some(m => m.r === 'u')) close(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; autoGrow(); ask(v); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  const autoGrow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  input.addEventListener('input', autoGrow);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  labels();
  if (st.open) open();
}
