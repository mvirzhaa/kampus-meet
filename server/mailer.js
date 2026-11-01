// Pengiriman email tanpa dependensi: klien SMTP mini (TLS langsung di port 465 atau STARTTLS di 587/25),
// AUTH PLAIN/LOGIN, pesan MIME multipart (teks + HTML + lampiran .ics), dan antrean keluar di SQLite
// yang dikirim berurutan dengan percobaan ulang.
//
// Contoh Google Workspace kampus: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=meet@kampus.ac.id
// SMTP_PASS=<sandi aplikasi 16 huruf> SMTP_FROM="UIKA Meet <meet@kampus.ac.id>"
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config.js';
import { q, now } from './db.js';

const M = config.mail;
export const mailConfigured = () => !!(M.host && M.from);

// ---------- Klien SMTP ----------
function smtpSession({ host, port, secure, user, pass, startTls = true, timeout = 30000 }) {
  let sock; let buf = ''; let waiter = null;
  const onData = (d) => {
    buf += d.toString('utf8');
    // Balasan lengkap: baris terakhir "NNN spasi teks"
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const block = lines.slice(0, i + 1);
        buf = lines.slice(i + 1).join('\r\n');
        const code = +block[i].slice(0, 3);
        const w = waiter; waiter = null;
        w?.resolve({ code, text: block.join('\n') });
        return onData('');
      }
    }
  };
  const read = () => new Promise((resolve, reject) => { waiter = { resolve, reject }; if (buf) onData(''); });
  const fail = (e) => { const w = waiter; waiter = null; w?.reject(e); };
  const attach = (s) => { sock = s; s.setTimeout(timeout, () => { fail(new Error('SMTP timeout')); s.destroy(); }); s.on('data', onData); s.on('error', fail); s.on('close', () => fail(new Error('Koneksi SMTP tertutup'))); };
  const send = async (line, expect) => {
    if (line != null) sock.write(line + '\r\n');
    const r = await read();
    const ok = Array.isArray(expect) ? expect.includes(r.code) : r.code === expect;
    if (!ok) throw new Error(`SMTP ${line ? line.split(' ')[0] : 'greeting'}: ${r.text.slice(0, 200)}`);
    return r;
  };
  return {
    async open() {
      await new Promise((resolve, reject) => {
        const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
        s.once(secure ? 'secureConnect' : 'connect', resolve); s.once('error', reject); attach(s);
      });
      await send(null, 220);
      const name = os.hostname() || 'localhost';
      let ehlo = await send(`EHLO ${name}`, 250);
      if (!secure && startTls && /STARTTLS/i.test(ehlo.text)) {
        await send('STARTTLS', 220);
        sock.removeAllListeners('data');
        await new Promise((resolve, reject) => { const s = tls.connect({ socket: sock, servername: host }, resolve); s.once('error', reject); attach(s); });
        ehlo = await send(`EHLO ${name}`, 250);
      }
      if (user) {
        if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) await send('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'), 235);
        else { await send('AUTH LOGIN', 334); await send(Buffer.from(user).toString('base64'), 334); await send(Buffer.from(pass).toString('base64'), 235); }
      }
    },
    async mail(from, to, data) {
      await send(`MAIL FROM:<${from}>`, 250);
      await send(`RCPT TO:<${to}>`, [250, 251]);
      await send('DATA', 354);
      // Titik di awal baris harus digandakan (dot-stuffing)
      sock.write(data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n');
      await send(null, 250);
    },
    async close() { try { await send('QUIT', 221); } catch { /* abaikan */ } sock?.end(); },
  };
}

// ---------- Pembuat pesan MIME ----------
const b64wrap = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const encWord = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
/** "Nama <alamat>" → { name, addr } */
export function parseAddr(s) {
  const m = String(s || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), addr: m[2].trim() } : { name: '', addr: String(s || '').trim() };
}
const safeHeader = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

export function buildMessage({ from, to, toName, subject, text, html, ics, icsName = 'undangan.ics' }) {
  const f = parseAddr(from);
  const id = crypto.randomBytes(12).toString('hex');
  const domain = f.addr.split('@')[1] || 'localhost';
  const mixed = 'mx_' + id, alt = 'al_' + id;
  const head = [
    `From: ${f.name ? `${encWord(safeHeader(f.name))} ` : ''}<${f.addr}>`,
    `To: ${toName ? `${encWord(safeHeader(toName))} ` : ''}<${safeHeader(to)}>`,
    `Subject: ${encWord(safeHeader(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const parts = [
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64wrap(text),
    `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64wrap(html),
    `--${alt}--`,
  ];
  if (ics) parts.push(`--${mixed}`, `Content-Type: text/calendar; charset=UTF-8; method=PUBLISH; name="${icsName}"`,
    `Content-Disposition: attachment; filename="${icsName}"`, 'Content-Transfer-Encoding: base64', '', b64wrap(ics));
  parts.push(`--${mixed}--`, '');
  return { envelopeFrom: f.addr, data: head.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') };
}

/** Kirim satu email langsung (dipakai antrean & tombol uji). */
export async function sendMail(msg) {
  if (!mailConfigured()) throw new Error('SMTP belum dikonfigurasi (SMTP_HOST, SMTP_FROM).');
  const { envelopeFrom, data } = buildMessage({ from: M.from, ...msg });
  const s = smtpSession({ host: M.host, port: M.port, secure: M.secure, user: M.user, pass: M.pass, startTls: M.startTls });
  try { await s.open(); await s.mail(envelopeFrom, msg.to, data); }
  finally { await s.close(); }
}

// ---------- Antrean ----------
/** Masukkan email ke antrean; dikirim di latar oleh pekerja di bawah. */
export function queueMail({ to, toName = '', subject, html, text, ics = null, kind = '', ref = null }) {
  if (!to || !/^[^\s@<>]+@[^\s@<>]+$/.test(to)) return false;
  q('INSERT INTO email_outbox (to_addr, to_name, subject, html, text, ics, kind, ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(to, toName, subject, html, text, ics, kind, ref, now());
  setImmediate(processOutbox);
  return true;
}
let busy = false;
export async function processOutbox() {
  if (busy || !mailConfigured()) return;
  busy = true;
  try {
    let r;
    while ((r = q("SELECT * FROM email_outbox WHERE status = 'queued' AND next_try <= ? ORDER BY id LIMIT 1").get(now()))) {
      try {
        await sendMail({ to: r.to_addr, toName: r.to_name, subject: r.subject, html: r.html, text: r.text, ics: r.ics });
        q("UPDATE email_outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(now(), r.id);
      } catch (e) {
        const attempts = r.attempts + 1;
        // Alamat ditolak permanen (5xx pada RCPT) → tidak perlu dicoba ulang
        const permanent = /^SMTP RCPT: 5\d\d/.test(e.message);
        q('UPDATE email_outbox SET status = ?, attempts = ?, next_try = ?, error = ? WHERE id = ?')
          .run(permanent || attempts >= 6 ? 'failed' : 'queued', attempts, now() + Math.min(3600, 60 * 2 ** attempts), String(e.message).slice(0, 300), r.id);
        console.warn(`[email] gagal ke ${r.to_addr} (percobaan ${attempts}):`, e.message);
      }
      await new Promise(res => setTimeout(res, M.gapMs));     // jeda kecil agar tidak dianggap spam
    }
  } finally { busy = false; }
}
setInterval(() => {
  processOutbox();
  q("DELETE FROM email_outbox WHERE status = 'sent' AND sent_at < ?").run(now() - 30 * 86400);   // simpan riwayat 30 hari
}, 60 * 1000).unref();
setTimeout(processOutbox, 5000).unref();

export const outboxStats = () => q('SELECT status, COUNT(*) AS n FROM email_outbox GROUP BY status').all();
export const lastMailError = () => q("SELECT error, created_at FROM email_outbox WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1").get() || null;
