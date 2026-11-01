// Undangan event: penyelenggara (pembuat event) atau admin memilih pengguna terdaftar yang boleh hadir,
// lalu dengan satu tombol mengirim email undangan (+ tautan Google Calendar & lampiran .ics) dan push
// notification ke aplikasi. Penjadwal mengirim pengingat otomatis (push + email) 30 menit sebelum mulai.
import { config } from './config.js';
import { q, now, tx } from './db.js';
import { HttpError, json, readJson } from './http.js';
import { requireUser, requireAdmin, requireCsrf } from './auth.js';
import { clean, limiters } from './security.js';
import { queueMail, sendMail, mailConfigured, outboxStats, lastMailError, parseAddr } from './mailer.js';
import { pushToUsers, pushConfigured, registerToken, removeToken, tokenCount } from './push.js';

const MAX_INVITES = 3000;
const REMIND = () => Math.max(5, config.reminderMinutes) * 60;

// ---------- Utilitas ----------
export const isInvited = (eventId, userId) => !!userId && !!q('SELECT 1 FROM event_invites WHERE event_id = ? AND user_id = ?').get(eventId, userId);
export const inviteCount = (eventId) => q('SELECT COUNT(*) AS n FROM event_invites WHERE event_id = ?').get(eventId).n;
/** Dipanggil saat jadwal event berubah: pengingat dikirim ulang sesuai jadwal baru, undangan ditandai perlu dikirim ulang. */
export function scheduleChanged(eventId) {
  q('UPDATE events SET reminded_at = NULL WHERE id = ?').run(eventId);
  q('UPDATE event_invites SET reminded_at = NULL, notified_at = NULL WHERE event_id = ?').run(eventId);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t * 1000));
const fmtTime = (t) => new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t * 1000)).replace('.', ':');
const tzLabel = () => ({ 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' }[config.timezone] || config.timezone);
const utcStamp = (t) => new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const joinUrl = (ev) => `${config.publicUrl}/j/${ev.room_id}`;
const eventUrl = (ev) => `${config.publicUrl}/event/${ev.slug}`;

export function googleCalendarUrl(ev) {
  const details = [ev.speaker ? `Narasumber: ${ev.speaker}` : '', (ev.description || '').slice(0, 900), '', `Gabung: ${joinUrl(ev)}`, `Info event: ${eventUrl(ev)}`]
    .filter((x, i) => x || i === 2).join('\n');
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${utcStamp(ev.starts_at)}/${utcStamp(ev.ends_at)}`, details, location: joinUrl(ev), ctz: config.timezone });
  return `https://calendar.google.com/calendar/render?${p}`;
}

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsFold = (line) => { const out = []; let b = Buffer.from(line, 'utf8'); while (b.length > 74) { let n = 74; while ((b[n] & 0xC0) === 0x80) n--; out.push(b.subarray(0, n).toString('utf8')); b = b.subarray(n); } out.push(b.toString('utf8')); return out.join('\r\n '); };
export function eventIcs(ev) {
  const host = new URL(config.publicUrl).hostname;
  const desc = [ev.speaker ? `Narasumber: ${ev.speaker}` : '', (ev.description || '').slice(0, 1500), `Gabung: ${joinUrl(ev)}`].filter(Boolean).join('\n\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${config.appName}//ID`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:event-${ev.id}@${host}`, `DTSTAMP:${utcStamp(now())}`, `DTSTART:${utcStamp(ev.starts_at)}`, `DTEND:${utcStamp(ev.ends_at)}`,
    `SUMMARY:${icsText(ev.title)}`, `DESCRIPTION:${icsText(desc)}`, `LOCATION:${icsText(joinUrl(ev))}`, `URL:${eventUrl(ev)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(ev.title)}`, `TRIGGER:-PT${Math.round(REMIND() / 60)}M`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', ''].map(icsFold).join('\r\n');
}

/** Isi email undangan / pengingat (HTML berstyle inline agar rapi di Gmail/Outlook + versi teks). */
function eventEmail(ev, user, kind, organizer) {
  const reminder = kind === 'reminder';
  const when = `${fmtDate(ev.starts_at)}, ${fmtTime(ev.starts_at)}–${fmtTime(ev.ends_at)} ${tzLabel()}`;
  const mins = Math.max(1, Math.round((ev.starts_at - now()) / 60));
  const subject = reminder ? `Pengingat: "${ev.title}" dimulai ${mins <= 60 ? `${mins} menit lagi` : `pukul ${fmtTime(ev.starts_at)} ${tzLabel()}`}` : `Undangan: ${ev.title}`;
  const greet = `Assalamualaikum, ${user.name}.`;
  const lead = reminder
    ? `Ini pengingat bahwa event yang Anda ikuti akan segera dimulai. Ruang meeting sudah dibuka 30 menit sebelum acara.`
    : `Anda diundang${organizer ? ` oleh ${organizer}` : ''} untuk menghadiri event berikut di ${config.appName}.`;
  const gcal = googleCalendarUrl(ev);
  // Password event tidak dicantumkan: peserta undangan masuk tanpa password (dan email bisa diteruskan ke orang lain)
  const rows = [['Waktu', when], ev.speaker ? ['Narasumber', ev.speaker] : null, ev.category ? ['Kategori', ev.category] : null].filter(Boolean);
  const btn = (href, label, primary) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:11px 18px;border-radius:10px;font-weight:600;font-size:14px;text-decoration:none;${primary ? 'background:#047857;color:#ffffff;' : 'background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;'}">${esc(label)}</a>`;
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f4;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a27;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f4;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe7e4;">
<tr><td style="background:#047857;padding:18px 24px;color:#ffffff;font-size:16px;font-weight:700;">${esc(config.appName)} <span style="font-weight:400;opacity:.85;font-size:13px;">· ${esc(config.campusName)}</span></td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#059669;">${reminder ? 'Pengingat event' : 'Undangan event'}</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#064e3b;">${esc(ev.title)}</h1>
<p style="margin:0 0 6px;font-size:15px;">${esc(greet)}</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">${esc(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f6faf8;border-radius:12px;padding:6px 14px;margin:0 0 18px;">
${rows.map(([k, v]) => `<tr><td style="padding:7px 0;font-size:13px;color:#5b6b66;width:130px;vertical-align:top;">${esc(k)}</td><td style="padding:7px 0;font-size:14px;font-weight:600;">${esc(v)}</td></tr>`).join('')}
</table>
<div style="margin:0 0 14px;">${btn(joinUrl(ev), 'Gabung ke meeting', true)}${reminder ? '' : btn(gcal, 'Simpan ke Google Calendar', false)}</div>
${reminder ? `<p style="margin:0 0 6px;font-size:13px;color:#5b6b66;">Atau <a href="${esc(gcal)}" style="color:#047857;">simpan ke Google Calendar</a>.</p>` : `<p style="margin:0 0 6px;font-size:13px;color:#5b6b66;line-height:1.5;">Kalender lain (Outlook, Apple Calendar): buka lampiran <b>undangan.ics</b>.</p>`}
<p style="margin:0 0 6px;font-size:13px;color:#5b6b66;line-height:1.5;">Masuk dengan akun ${esc(config.appName)} Anda (${esc(user.email)}). Di HP Android, tautan terbuka di aplikasi ${esc(config.appName)} bila sudah terpasang.</p>
${ev.description && !reminder ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;white-space:pre-line;color:#33413d;">${esc(ev.description.slice(0, 1200))}</p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e6eeeb;font-size:12px;color:#7a8a85;line-height:1.5;">Detail event: <a href="${esc(eventUrl(ev))}" style="color:#047857;">${esc(eventUrl(ev))}</a><br>Email ini dikirim otomatis oleh ${esc(config.appName)}; mohon tidak membalas.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [greet, '', lead, '', ev.title, `Waktu: ${when}`, ev.speaker ? `Narasumber: ${ev.speaker}` : '',
    '', `Gabung ke meeting: ${joinUrl(ev)}`, `Simpan ke Google Calendar: ${gcal}`, `Detail event: ${eventUrl(ev)}`, '', `— ${config.appName}, ${config.campusName}`]
    .filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { subject, html, text, ics: reminder ? null : eventIcs(ev) };
}

function pushMsg(ev, kind) {
  const reminder = kind === 'reminder';
  const mins = Math.max(1, Math.round((ev.starts_at - now()) / 60));
  return {
    title: reminder ? `Event dimulai ${mins} menit lagi` : 'Undangan event baru',
    body: reminder ? `${ev.title} · pukul ${fmtTime(ev.starts_at)} ${tzLabel()}. Ketuk untuk bergabung.` : `${ev.title} · ${fmtDate(ev.starts_at)}, ${fmtTime(ev.starts_at)} ${tzLabel()}`,
    data: { type: kind, eventId: ev.id, slug: ev.slug, room: ev.room_id, startsAt: ev.starts_at, tag: `ev-${ev.id}-${kind}` },
  };
}

/** Kirim undangan ke daftar pengguna (email diantrikan, push dikirim di latar). */
function deliver(ev, users, kind) {
  const organizer = q('SELECT name FROM users WHERE id = ?').get(ev.owner_id)?.name || '';
  let emails = 0;
  for (const u of users) {
    const m = eventEmail(ev, u, kind, organizer);
    if (mailConfigured() && queueMail({ to: u.email, toName: u.name, ...m, kind, ref: `${ev.id}:${u.id}` })) emails++;
  }
  const ids = users.map(u => u.id);
  const pushing = pushConfigured() ? pushToUsers(ids, pushMsg(ev, kind)).catch(e => { console.warn('[push]', e.message); return 0; }) : Promise.resolve(0);
  return { emails, pushing };
}

// ---------- Pengingat otomatis ----------
async function remindTick() {
  const t = now();
  const due = q('SELECT * FROM events WHERE published = 1 AND starts_at > ? AND starts_at - ? <= ?').all(t, REMIND(), t);
  for (const ev of due) {
    const users = q(`SELECT u.id, u.name, u.email FROM event_invites i JOIN users u ON u.id = i.user_id
                     WHERE i.event_id = ? AND i.reminded_at IS NULL AND u.status = 'active'`).all(ev.id);
    // Penyelenggara juga diingatkan (sekali per jadwal)
    if (!ev.reminded_at) { const o = q('SELECT id, name, email FROM users WHERE id = ?').get(ev.owner_id); if (o && !users.some(u => u.id === o.id)) users.push(o); }
    q('UPDATE events SET reminded_at = ? WHERE id = ?').run(t, ev.id);
    if (!users.length) continue;
    q('UPDATE event_invites SET reminded_at = ? WHERE event_id = ? AND reminded_at IS NULL').run(t, ev.id);
    const r = deliver(ev, users, 'reminder');
    const pushed = await r.pushing;
    console.log(`[pengingat] "${ev.title}": ${users.length} peserta, ${r.emails} email diantrikan, ${pushed} push terkirim`);
  }
}
let ticking = false;
setInterval(() => { if (ticking) return; ticking = true; remindTick().catch(e => console.warn('[pengingat]', e.message)).finally(() => { ticking = false; }); }, 60 * 1000).unref();
setTimeout(() => remindTick().catch(() => {}), 8000).unref();

// ---------- Rute ----------
export function registerInviteRoutes(r) {
  const managed = (req, id) => {
    const u = requireUser(req);
    const e = q('SELECT * FROM events WHERE id = ?').get(parseInt(id, 10));
    if (!e) throw new HttpError(404, 'Event tidak ditemukan.');
    if (e.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Hanya pembuat event yang dapat mengelola undangan.');
    return { u, e };
  };
  // Akun yang boleh diundang: aktif, bukan admin, bukan super-admin
  const eligibleSql = `u.status = 'active' AND u.role <> 'admin'${config.adminEmail ? ' AND lower(u.email) <> ?' : ''}`;
  const eligibleArgs = config.adminEmail ? [config.adminEmail] : [];

  const listView = (e) => {
    const rows = q(`SELECT i.user_id, i.invited_at, i.notified_at, i.reminded_at, u.name, u.email,
                      EXISTS(SELECT 1 FROM event_regs r WHERE r.event_id = i.event_id AND r.user_id = i.user_id) AS joined,
                      (SELECT COUNT(*) FROM push_tokens p WHERE p.user_id = i.user_id) AS devices
                    FROM event_invites i JOIN users u ON u.id = i.user_id WHERE i.event_id = ? ORDER BY u.name COLLATE NOCASE`).all(e.id);
    return {
      inviteOnly: !!e.invite_only,
      invites: rows.map(x => ({ userId: x.user_id, name: x.name, email: x.email, invitedAt: x.invited_at, notifiedAt: x.notified_at, remindedAt: x.reminded_at, joined: !!x.joined, app: x.devices > 0 })),
      pending: rows.filter(x => !x.notified_at).length,
      mail: mailConfigured(), push: pushConfigured(), reminderMinutes: Math.round(REMIND() / 60),
      googleCalendarUrl: googleCalendarUrl(e),
    };
  };

  r.get('/api/events/:id/invites', (req, res, { id }) => {
    const { e } = managed(req, id);
    json(res, 200, listView(e));
  });

  r.get('/api/events/:id/invite-candidates', (req, res, { id }) => {
    const { e } = managed(req, id);
    const term = clean(new URL(req.url, 'http://x').searchParams.get('q'), 80).replace(/[%_]/g, '');
    if (term.length < 2) return json(res, 200, { users: [] });
    const l = `%${term}%`;
    const users = q(`SELECT u.id, u.name, u.email FROM users u
                     WHERE ${eligibleSql} AND u.id <> ? AND (u.name LIKE ? OR u.email LIKE ?)
                       AND NOT EXISTS (SELECT 1 FROM event_invites i WHERE i.event_id = ? AND i.user_id = u.id)
                     ORDER BY (u.name LIKE ?) DESC, u.name COLLATE NOCASE LIMIT 20`).all(...eligibleArgs, e.owner_id, l, l, e.id, `${term}%`);
    json(res, 200, { users });
  });

  r.post('/api/events/:id/invites', async (req, res, { id }) => {
    const { u, e } = managed(req, id); requireCsrf(req);
    const b = await readJson(req, 64 * 1024);
    const ids = [...new Set((Array.isArray(b.userIds) ? b.userIds : []).map(n => parseInt(n, 10)).filter(n => n > 0))].slice(0, 500);
    if (!ids.length) throw new HttpError(400, 'Pilih minimal satu pengguna.');
    if (inviteCount(e.id) + ids.length > MAX_INVITES) throw new HttpError(400, `Maksimal ${MAX_INVITES} undangan per event.`);
    const ok = q(`SELECT u.id FROM users u WHERE ${eligibleSql} AND u.id IN (${ids.map(() => '?').join(',')})`).all(...eligibleArgs, ...ids).map(x => x.id);
    let added = 0;
    tx(() => {
      // Pengelolaan undangan pertama kali → event otomatis menjadi "khusus undangan" (bisa dimatikan)
      if (!inviteCount(e.id) && b.inviteOnly !== false) q('UPDATE events SET invite_only = 1 WHERE id = ?').run(e.id);
      for (const uid of ok) if (uid !== e.owner_id) added += Number(q('INSERT OR IGNORE INTO event_invites (event_id, user_id, invited_at, invited_by) VALUES (?,?,?,?)').run(e.id, uid, now(), u.id).changes);
    });
    json(res, 200, { added, skipped: ids.length - added, ...listView(q('SELECT * FROM events WHERE id = ?').get(e.id)) });
  });

  r.delete('/api/events/:id/invites/:uid', (req, res, { id, uid }) => {
    const { e } = managed(req, id); requireCsrf(req);
    q('DELETE FROM event_invites WHERE event_id = ? AND user_id = ?').run(e.id, parseInt(uid, 10));
    json(res, 200, listView(e));
  });

  r.patch('/api/events/:id/invite-only', async (req, res, { id }) => {
    const { e } = managed(req, id); requireCsrf(req);
    const b = await readJson(req);
    q('UPDATE events SET invite_only = ? WHERE id = ?').run(b.inviteOnly ? 1 : 0, e.id);
    json(res, 200, listView(q('SELECT * FROM events WHERE id = ?').get(e.id)));
  });

  // Satu tombol: kirim email + push undangan ke semua peserta yang belum dikirimi (all=true: kirim ulang ke semua)
  r.post('/api/events/:id/invites/send', async (req, res, { id }) => {
    const { e } = managed(req, id); requireCsrf(req);
    const b = await readJson(req);
    if (e.ends_at < now()) throw new HttpError(400, 'Event sudah berakhir.');
    if (!mailConfigured() && !pushConfigured()) throw new HttpError(503, 'Email (SMTP) dan push notification belum dikonfigurasi di server. Hubungi admin.');
    const wait = limiters.inviteSend.take('ev:' + e.id);
    if (wait) throw new HttpError(429, `Undangan baru saja dikirim. Coba lagi dalam ${wait} detik.`);
    const users = q(`SELECT u.id, u.name, u.email FROM event_invites i JOIN users u ON u.id = i.user_id
                     WHERE i.event_id = ? AND u.status = 'active' ${b.all ? '' : 'AND i.notified_at IS NULL'}`).all(e.id);
    if (!users.length) throw new HttpError(400, b.all ? 'Belum ada peserta undangan.' : 'Semua peserta sudah dikirimi undangan.');
    const t = now();
    q(`UPDATE event_invites SET notified_at = ? WHERE event_id = ? AND user_id IN (${users.map(() => '?').join(',')})`).run(t, e.id, ...users.map(x => x.id));
    const r = deliver(e, users, 'invite');
    // Tunggu push sebentar agar jumlahnya bisa dilaporkan; sisanya tetap berjalan di latar
    const pushed = await Promise.race([r.pushing, new Promise(res2 => setTimeout(() => res2(null), 8000))]);
    json(res, 200, { recipients: users.length, emails: r.emails, pushes: pushed, mail: mailConfigured(), push: pushConfigured(), ...listView(q('SELECT * FROM events WHERE id = ?').get(e.id)) });
  });

  // Undangan milik pengguna yang login (web dashboard & aplikasi)
  r.get('/api/my/invitations', (req, res) => {
    const u = requireUser(req);
    const rows = q(`SELECT e.*, i.invited_at, i.notified_at, (SELECT name FROM users WHERE id = e.owner_id) AS organizer
                    FROM event_invites i JOIN events e ON e.id = i.event_id
                    WHERE i.user_id = ? AND e.ends_at >= ? ORDER BY e.starts_at LIMIT 100`).all(u.id, now() - 86400);
    const t = now();
    json(res, 200, {
      push: pushConfigured(), reminderMinutes: Math.round(REMIND() / 60),
      invitations: rows.map(e => ({
        id: e.id, slug: e.slug, title: e.title, speaker: e.speaker, category: e.category, startsAt: e.starts_at, endsAt: e.ends_at,
        organizer: e.organizer || '', roomId: e.room_id, invitedAt: e.invited_at, hasPassword: !!e.password_enc, inviteOnly: !!e.invite_only,
        joinOpen: t >= e.starts_at - 1800 && t <= e.ends_at + 3600, googleCalendarUrl: googleCalendarUrl(e),
      })),
    });
  });

  // Token push perangkat (aplikasi Android)
  r.post('/api/push/register', async (req, res) => {
    const u = requireUser(req); requireCsrf(req);
    const b = await readJson(req);
    const token = clean(b.token, 4096);
    if (token.length < 20) throw new HttpError(400, 'Token push tidak valid.');
    registerToken(u.id, token, ['android', 'ios'].includes(b.platform) ? b.platform : 'android');
    json(res, 200, { ok: true, push: pushConfigured(), reminderMinutes: Math.round(REMIND() / 60) });
  });
  r.post('/api/push/unregister', async (req, res) => {
    const b = await readJson(req);
    const token = clean(b.token, 4096);
    if (token) removeToken(token);
    json(res, 200, { ok: true });
  });
  r.get('/api/push/status', (req, res) => json(res, 200, { push: pushConfigured(), reminderMinutes: Math.round(REMIND() / 60) }));

  // Admin: status integrasi email/push + email uji
  r.get('/api/admin/notify-status', (req, res) => {
    requireAdmin(req);
    const stats = Object.fromEntries(outboxStats().map(x => [x.status, x.n]));
    json(res, 200, {
      mail: { configured: mailConfigured(), host: config.mail.host, port: config.mail.port, from: parseAddr(config.mail.from).addr, queued: stats.queued || 0, sent: stats.sent || 0, failed: stats.failed || 0, lastError: lastMailError() },
      push: { configured: pushConfigured(), devices: tokenCount() },
      reminderMinutes: Math.round(REMIND() / 60),
    });
  });
  r.post('/api/admin/test-email', async (req, res) => {
    const me = requireAdmin(req); requireCsrf(req);
    if (!mailConfigured()) throw new HttpError(503, 'SMTP belum dikonfigurasi (isi SMTP_HOST, SMTP_FROM, dst. di .env lalu restart).');
    const wait = limiters.inviteSend.take('test:' + me.id);
    if (wait) throw new HttpError(429, `Tunggu ${wait} detik sebelum mengirim email uji lagi.`);
    try {
      await sendMail({ to: me.email, toName: me.name, subject: `Email uji ${config.appName}`,
        text: `Assalamualaikum, ${me.name}.\n\nPengaturan email ${config.appName} sudah berfungsi.\n\n${config.publicUrl}`,
        html: `<p>Assalamualaikum, ${esc(me.name)}.</p><p>Pengaturan email <b>${esc(config.appName)}</b> sudah berfungsi. ✅</p><p><a href="${esc(config.publicUrl)}">${esc(config.publicUrl)}</a></p>` });
    } catch (e) { throw new HttpError(502, `Gagal mengirim: ${e.message}`); }
    json(res, 200, { ok: true, to: me.email });
  });
}

