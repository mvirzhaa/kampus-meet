// Kartu rating event: ringkasan bintang + formulir (opsional) untuk peserta yang sudah mengikuti event.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, T } from '@/components/ui';
import { getRating, LABELS, sendRating, type RatingInfo } from '@/lib/rating';
import { C, F } from '@/lib/theme';

export function Stars({ value, onChange, size = 32 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="adjustable" accessibilityLabel={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(n)} hitSlop={4} accessibilityLabel={`${n} bintang`}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? '#F5B301' : '#B9C9C2'} />
        </Pressable>
      ))}
    </View>
  );
}

export function RatingCard({ eventId, highlight }: { eventId: number; highlight?: boolean }) {
  const [d, setD] = useState<RatingInfo | null>(null);
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(0);
  const [sp, setSp] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getRating(eventId); setD(r);
      setVal(r.mine?.rating || 0); setSp(r.mine?.speakers || {}); setNote(r.mine?.comment || '');
    } catch { /* offline */ }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (highlight && d?.can.ok && !d.mine) setEdit(true); }, [highlight, d]);

  if (!d) return <Card><ActivityIndicator color={C.primary} /></Card>;
  const s = d.summary;
  if (!s.count && !d.can.ok) return null;

  async function send() {
    if (!val) { setErr('Pilih bintang 1–5 dulu.'); return; }
    setBusy(true); setErr('');
    try { const r = await sendRating(eventId, { rating: val, comment: note.trim(), speakers: sp }); setD({ ...d!, summary: r.summary, mine: { rating: val, comment: note.trim(), at: Date.now() / 1000, speakers: sp } }); setEdit(false); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card style={[{ gap: 12 }, highlight && edit ? { borderColor: '#F5D77A', borderWidth: 2 } : null]}>
      <T w="bold" size={16}>Rating & ulasan</T>
      {s.count ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T w="extrabold" size={34}>{(s.avg || 0).toFixed(1)}</T>
          <View style={{ gap: 2 }}><Stars value={Math.round(s.avg || 0)} size={18} /><T size={12.5} color={C.muted}>{s.count} ulasan</T></View>
        </View>
      ) : null}
      {s.speakers.length ? <T size={13} color={C.muted}>{s.speakers.map(x => `🎙️ ${x.name}: ${x.avg.toFixed(1)}★ (${x.count})`).join('   ')}</T> : null}

      {d.can.ok && d.mine && !edit ? (
        <View style={st.mine}>
          <Ionicons name="checkmark-circle" size={20} color={C.primary} />
          <View style={{ flex: 1, gap: 2 }}><Stars value={d.mine.rating} size={16} />{d.mine.comment ? <T size={13} color={C.muted} numberOfLines={2}>“{d.mine.comment}”</T> : null}</View>
          <Button small variant="ghost" title="Ubah" onPress={() => setEdit(true)} />
        </View>
      ) : null}
      {d.can.ok && (!d.mine || edit) ? (
        edit || !d.mine ? (
          <View style={st.form}>
            <T w="semibold">{d.mine ? 'Ubah rating Anda' : 'Beri rating untuk event ini (tidak wajib)'}</T>
            <Stars value={val} onChange={(n) => { setVal(n); setErr(''); }} size={36} />
            <T size={13} color={C.muted}>{val ? LABELS[val - 1] : 'Ketuk bintang untuk menilai'}</T>
            {d.speakers.length ? (
              <View style={{ gap: 6 }}>
                <T w="semibold" size={13} color={C.muted}>Penilaian narasumber (opsional)</T>
                {d.speakers.map(name => (
                  <View key={name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <T size={14} style={{ flex: 1 }} numberOfLines={2}>{name}</T>
                    <Stars value={sp[name] || 0} onChange={(n) => setSp(p => ({ ...p, [name]: n }))} size={22} />
                  </View>
                ))}
              </View>
            ) : null}
            <TextInput value={note} onChangeText={setNote} placeholder="Komentar atau saran untuk penyelenggara (opsional)" placeholderTextColor="#90A49C"
              multiline maxLength={1500} style={st.input} />
            {err ? <T size={13} color={C.danger}>{err}</T> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {d.mine ? <Button small variant="ghost" title="Batal" style={{ flex: 1 }} onPress={() => setEdit(false)} /> : null}
              <Button small title={d.mine ? 'Simpan perubahan' : 'Kirim rating'} style={{ flex: 1.4 }} loading={busy} onPress={send} />
            </View>
          </View>
        ) : null
      ) : null}
      {!d.can.ok && d.can.reason !== 'owner' && d.can.reason !== 'login' ? <T size={13} color={C.muted}>{d.can.message}</T> : null}

      {d.recent.length ? (
        <View style={{ gap: 10 }}>
          {d.recent.slice(0, 4).map((r, i) => (
            <View key={i} style={st.item}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><T w="bold" size={13.5}>{r.name}</T><Stars value={r.rating} size={13} /></View>
              <T size={13.5} color="#33413D">{r.comment}</T>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  mine: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.soft, borderRadius: 12, padding: 10 },
  form: { gap: 10, backgroundColor: '#F6FAF8', borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12 },
  input: { minHeight: 70, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: F.regular, fontSize: 14.5, color: C.text, backgroundColor: '#fff', textAlignVertical: 'top' },
  item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 8, gap: 2 },
});
