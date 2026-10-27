import { h, icon, fmtDate, fmtTime, api, modal, toast, formData, toLocalInput, fromLocalInput, roomLinksModal } from './common.js';

export function eventCard(e) {
  const t = Date.now() / 1000;
  const status = t > e.endsAt ? h('span', { class: 'pill gray', text: 'Selesai' })
    : t >= e.startsAt ? h('span', { class: 'pill live', text: 'Berlangsung' })
      : h('span', { class: 'pill green', text: 'Pendaftaran dibuka' });
  return h('a', { class: 'ev-card', href: `/event/${e.slug}` },
    h('div', { class: 'ev-cover' }, h('span', { class: 'cat', text: e.category }),
      h('span', { class: 'date' }, icon('calendar', 16), `${fmtDate(e.startsAt)}`)),
    h('div', { class: 'ev-body' },
      status,
      h('h3', { text: e.title }),
      e.speaker ? h('div', { class: 'ev-meta' }, icon('user', 15), e.speaker) : null,
      h('div', { class: 'ev-meta' }, icon('clock', 15), `${fmtTime(e.startsAt)} – ${fmtTime(e.endsAt)}`),
      h('div', { class: 'ev-meta' }, icon('users', 15), `${e.registered} terdaftar${e.quota ? ` / ${e.quota}` : ''}`),
      e.certificate ? h('div', { class: 'ev-meta' }, icon('award', 15), 'Bersertifikat') : null));
}

export function emptyState(text, ic = 'calendar') {
  return h('div', { class: 'empty' }, icon(ic, 40), h('p', { text }));
}

/** Form buat/ubah room (dipakai di beranda & dasbor). */
export function roomFormModal({ room, schedule = false, onSaved } = {}) {
  const isEdit = !!room;
  const now = Math.floor(Date.now() / 1000);
  const form = h('form', { autocomplete: 'off' },
    h('div', { class: 'field' }, h('label', { for: 'rf-name', text: 'Nama meeting' }),
      h('input', { id: 'rf-name', name: 'name', required: true, maxlength: 100, value: room?.name || '', placeholder: 'mis. Kuliah Jaringan Komputer — Kelas A' })),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { for: 'rf-pw', text: 'Password room' }),
        h('input', { id: 'rf-pw', name: 'password', maxlength: 32, value: isEdit ? (room.password || '') : '', placeholder: isEdit ? 'Kosong = tanpa password' : 'Otomatis (6 digit)' }),
        h('small', { text: 'Kosongkan saat mengubah untuk menghapus password.' })),
      h('div', { class: 'field' }, h('label', { for: 'rf-max', text: 'Maks. peserta' }),
        h('input', { id: 'rf-max', name: 'maxParticipants', type: 'number', min: 2, max: 1000, value: room?.maxParticipants || 300 }))),
    (schedule || room?.scheduledAt) ? h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { for: 'rf-at', text: 'Jadwal' }),
        h('input', { id: 'rf-at', name: 'scheduledAt', type: 'datetime-local', value: toLocalInput(room?.scheduledAt || now + 3600) })),
      h('div', { class: 'field' }, h('label', { for: 'rf-dur', text: 'Durasi (menit)' }),
        h('input', { id: 'rf-dur', name: 'durationMin', type: 'number', min: 5, max: 1440, value: room?.durationMin || 90 }))) : null,
    h('div', { class: 'field' }, h('label', { for: 'rf-wel', text: 'Pesan sambutan (opsional)' }),
      h('textarea', { id: 'rf-wel', name: 'welcome', maxlength: 500, rows: 2, placeholder: 'Ditampilkan di chat saat peserta masuk' }, room?.welcome || '')),
    h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'allowGuests', checked: room ? room.allowGuests : true }), 'Izinkan tamu tanpa akun (dengan password/link)')),
    h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'muteOnJoin', checked: room ? room.muteOnJoin : true }), 'Mikrofon peserta mati saat bergabung')),
    isEdit ? h('div', { class: 'field' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'regenerateLinks' }), 'Buat ulang link undangan (link lama tidak berlaku)')) : null,
  );
  const m = modal({
    title: isEdit ? 'Ubah Meeting' : schedule ? 'Jadwalkan Meeting' : 'Buat Meeting', body: form, wide: false,
    actions: [{ label: 'Batal' }, {
      label: isEdit ? 'Simpan' : 'Buat Meeting', cls: 'btn-primary', keepOpen: true, onClick: async (e) => {
        if (!form.reportValidity()) return false;
        const d = formData(form);
        const body = { name: d.name, maxParticipants: d.maxParticipants, welcome: d.welcome, allowGuests: d.allowGuests, muteOnJoin: d.muteOnJoin };
        if (isEdit) { body.password = d.password; body.regenerateLinks = d.regenerateLinks; } else if (d.password) body.password = d.password;
        if (d.scheduledAt !== undefined) { body.scheduledAt = fromLocalInput(d.scheduledAt); body.durationMin = d.durationMin; }
        e.target.disabled = true;
        try {
          const res = isEdit ? await api('PATCH', `/api/rooms/${room.id}`, body) : await api('POST', '/api/rooms', body);
          m.close();
          toast(isEdit ? 'Perubahan disimpan' : 'Meeting dibuat', 'success');
          onSaved?.(res.room);
          if (!isEdit) roomLinksModal(res.room);
        } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
        return false;
      },
    }],
  });
}
