// Fitri — asisten virtual UIKA Meet di aplikasi. Memakai otak yang sama dengan chatbot web (/api/chatbot):
// menjawab seputar aplikasi (ID/EN), dan untuk pengguna login memberikan daftar undangan + tautan gabungnya.
// Tautan dari Fitri dibuka di dalam aplikasi (gabung meeting, detail event, sertifikat).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api, getServer } from '@/lib/api';
import { C, F } from '@/lib/theme';

type Link = { label: string; href: string };
type Msg = { r: 'u' | 'b'; t: string; links?: Link[]; suggestions?: string[] | null };
const AVATAR = require('../../assets/fitri.png');

// Percakapan disimpan selama aplikasi berjalan (kembali ke layar ini tidak mengulang dari awal)
let saved: { msgs: Msg[]; lang: 'id' | 'en'; asked: boolean; rated: boolean } | null = null;

/** Buka tautan dari Fitri: tautan meeting/event/sertifikat di dalam aplikasi, sisanya di browser. */
function openLink(href: string) {
  const server = getServer();
  const rel = href.startsWith(server) ? href.slice(server.length) || '/' : href;
  const j = rel.match(/^\/[jr]\/([a-z0-9-]{3,40})(?:\?(?:.*&)?k=([\w-]+))?/i);
  if (j) return router.push({ pathname: '/join', params: { code: j[1].toLowerCase(), ...(j[2] ? { k: j[2] } : {}), auto: '1' } });
  const ev = rel.match(/^\/event\/([\w-]{3,80})\/?$/);
  if (ev) return router.push(`/event/${ev[1]}`);
  if (rel === '/event') return router.push('/(tabs)/events');
  if (rel.startsWith('/dashboard#sertifikat') || rel.startsWith('/sertifikat-saya')) return router.push('/sertifikat');
  if (rel === '/login') return router.push('/login');
  if (rel === '/') return router.push('/(tabs)');
  return Linking.openURL(/^https?:/.test(href) ? href : server + href);
}

/** Teks dengan tautan http(s) yang bisa diketuk. */
function RichText({ text, color }: { text: string; color: string }) {
  const parts: React.ReactNode[] = []; let last = 0; let i = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const url = m[0].replace(/[.,]+$/, '');
    if ((m.index || 0) > last) parts.push(text.slice(last, m.index));
    parts.push(<T key={i++} w="semibold" size={14.5} color={C.primary} style={{ textDecorationLine: 'underline' }} onPress={() => openLink(url)}>{url.replace(/^https?:\/\//, '')}</T>);
    last = (m.index || 0) + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <T size={14.5} color={color} style={{ lineHeight: 21 }}>{parts}</T>;
}

export default function Fitri() {
  const { me } = useAuth();
  const first = me?.user?.name?.split(' ')[0] || '';
  const greeting: Msg = {
    r: 'b',
    t: `Assalamualaikum, Kak${first ? ` ${first}` : ''}! 👋 Saya Fitri, asisten virtual UIKA Meet. Ada yang bisa saya bantu seputar meeting, event, sertifikat, atau aplikasinya?${me?.user ? '\n\nKetuk "Undangan saya" untuk melihat undangan & tautan meeting Kakak.' : ''}\n\n(You can also ask me in English.)`,
    suggestions: [...(me?.user ? ['Undangan saya'] : []), 'Cara bergabung ke meeting', 'Sertifikat event', 'Event mendatang', 'Transkripsi & terjemahan'],
  };
  const [msgs, setMsgs] = useState<Msg[]>(saved?.msgs?.length ? saved.msgs : [greeting]);
  const [lang, setLang] = useState<'id' | 'en'>(saved?.lang || 'id');
  const [asked, setAsked] = useState(saved?.asked || false);
  const [rated, setRated] = useState(saved?.rated || false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => { saved = { msgs, lang, asked, rated }; }, [msgs, lang, asked, rated]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); }, [msgs.length, asked, busy]);

  async function ask(text: string) {
    text = text.trim().slice(0, 1000);
    if (!text || busy) return;
    if (rated) { setRated(false); setAsked(false); }
    const next: Msg[] = [...msgs, { r: 'u', t: text }];
    setMsgs(next); setInput(''); setBusy(true);
    try {
      const d = await api<{ reply: string; lang: 'id' | 'en'; links?: Link[]; suggestions?: string[]; end?: boolean }>('POST', '/api/chatbot',
        { messages: next.slice(-12).map(m => ({ r: m.r, t: m.t })), lang });
      setLang(d.lang === 'en' ? 'en' : 'id');
      setMsgs(m => [...m, { r: 'b' as const, t: d.reply, links: d.links || [], suggestions: d.suggestions || null }].slice(-60));
      if (d.end) setAsked(true);
    } catch (e) {
      const st = (e as { status?: number }).status;
      setMsgs(m => [...m, { r: 'b', t: st === 429 ? (e as Error).message : st === 0 ? 'Maaf Kak, sepertinya HP sedang offline. Coba lagi setelah tersambung internet ya.' : 'Maaf Kak, Fitri sedang tidak dapat dihubungi. Coba lagi sebentar lagi ya.' }]);
    } finally { setBusy(false); }
  }

  const last = msgs[msgs.length - 1];
  return (
    <>
      <Stack.Screen options={{
        headerTitle: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={AVATAR} style={s.headAv} />
            <View><T w="bold" size={16.5}>Fitri</T><T size={12} color={C.muted}>Asisten UIKA Meet · Online</T></View>
          </View>
        ),
        headerRight: () => (msgs.some(m => m.r === 'u') && !asked && !rated
          ? <Pressable onPress={() => setAsked(true)} hitSlop={8} style={s.endBtn}><Ionicons name="checkmark-circle-outline" size={17} color={C.primaryDark} /><T w="semibold" size={13} color={C.primaryDark}>Selesai</T></Pressable>
          : null),
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          {msgs.map((m, i) => (
            <View key={i} style={[s.row, m.r === 'u' && { justifyContent: 'flex-end' }]}>
              {m.r === 'b' ? <Image source={AVATAR} style={s.av} /> : null}
              <View style={{ maxWidth: '82%', gap: 6 }}>
                <View style={[s.bubble, m.r === 'u' ? s.me : s.bot]}>
                  {m.r === 'u' ? <T size={14.5} color="#fff" style={{ lineHeight: 21 }}>{m.t}</T> : <RichText text={m.t} color={C.text} />}
                </View>
                {m.links?.length ? m.links.map((l, k) => (
                  <Pressable key={k} onPress={() => openLink(l.href)} style={({ pressed }) => [s.link, pressed && { opacity: 0.8 }]}>
                    <Ionicons name={/^\/[jr]\//.test(l.href) ? 'videocam' : 'arrow-forward-circle-outline'} size={16} color={C.primary} />
                    <T w="semibold" size={13.5} color={C.primaryDark} numberOfLines={1} style={{ flexShrink: 1 }}>{l.label}</T>
                  </Pressable>
                )) : null}
              </View>
            </View>
          ))}
          {busy ? <View style={s.row}><Image source={AVATAR} style={s.av} /><View style={[s.bubble, s.bot]}><ActivityIndicator color={C.primary} size="small" /></View></View> : null}
          {!busy && !asked && last?.r === 'b' && last.suggestions?.length ? (
            <View style={s.chips}>
              {last.suggestions.map(c => <Pressable key={c} onPress={() => ask(c)} style={({ pressed }) => [s.chip, pressed && { backgroundColor: '#DDF2E8' }]}><T w="semibold" size={13} color={C.primaryDark}>{c}</T></Pressable>)}
            </View>
          ) : null}
          {asked && !rated ? <RatingCard lang={lang} msgs={msgs} onDone={(t) => { setRated(true); setMsgs(m => [...m, { r: 'b', t }]); }} /> : null}
        </ScrollView>
        <View style={s.bar}>
          <TextInput value={input} onChangeText={setInput} placeholder={lang === 'en' ? 'Type your question, Kakak…' : 'Tulis pertanyaan Kakak…'} placeholderTextColor="#90A49C"
            style={s.input} multiline maxLength={1000} onSubmitEditing={() => ask(input)} submitBehavior="submit" returnKeyType="send" />
          <Pressable onPress={() => ask(input)} disabled={!input.trim() || busy} style={[s.send, (!input.trim() || busy) && { opacity: 0.5 }]} accessibilityLabel="Kirim">
            <Ionicons name="send" size={19} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function RatingCard({ lang, msgs, onDone }: { lang: 'id' | 'en'; msgs: Msg[]; onDone: (thanks: string) => void }) {
  const en = lang === 'en';
  const [val, setVal] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const labels = en ? ['Very poor', 'Poor', 'Okay', 'Good', 'Very good'] : ['Sangat buruk', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'];
  async function send() {
    if (!val) { setErr(en ? 'Please choose 1–5 stars first, Kakak.' : 'Pilih bintang 1–5 dulu ya, Kak.'); return; }
    setBusy(true);
    try {
      await api('POST', '/api/chatbot/feedback', { rating: val, text: note.trim(), lang, chat: msgs.map(m => ({ r: m.r, t: m.t })) });
      onDone(en ? 'Thank you for your rating and feedback, Kakak! 🙏 Wassalamualaikum.' : 'Terima kasih atas penilaian dan masukannya, Kak! 🙏 Semoga membantu. Wassalamualaikum.');
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <View style={s.rate}>
      <T w="bold" size={14.5}>{en ? 'How was your chat with Fitri?' : 'Bagaimana pengalaman Kakak ngobrol dengan Fitri?'}</T>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable key={n} onPress={() => { setVal(n); setErr(''); }} hitSlop={4} accessibilityLabel={`${n} bintang`}>
            <Ionicons name={n <= val ? 'star' : 'star-outline'} size={32} color={n <= val ? '#F5B301' : '#B9C9C2'} />
          </Pressable>
        ))}
      </View>
      {val ? <T size={13} color={C.muted}>{labels[val - 1]}</T> : null}
      <TextInput value={note} onChangeText={setNote} placeholder={en ? 'What could we improve? (optional)' : 'Masukan untuk kami (opsional)'} placeholderTextColor="#90A49C" multiline maxLength={2000} style={[s.input, { minHeight: 64, backgroundColor: '#fff' }]} />
      {err ? <T size={13} color={C.danger}>{err}</T> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small variant="ghost" title={en ? 'Skip' : 'Lewati'} style={{ flex: 1 }} onPress={() => onDone(en ? "Alright, Kakak. If you have more questions, I'm here to help. Wassalamualaikum." : 'Baik, Kak. Kalau ada pertanyaan lagi, Fitri siap membantu. Wassalamualaikum.')} />
        <Button small title={en ? 'Send rating' : 'Kirim penilaian'} style={{ flex: 1.4 }} loading={busy} onPress={send} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  headAv: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E7F7EF' },
  endBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: C.soft },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  av: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E7F7EF' },
  bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  bot: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  me: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#BFE0D0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, maxWidth: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 38 },
  chip: { borderWidth: 1, borderColor: '#BFE0D0', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  rate: { gap: 10, backgroundColor: '#F6FAF8', borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, marginLeft: 38 },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, backgroundColor: '#fff' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: F.regular, fontSize: 15, color: C.text, backgroundColor: C.bg },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
});
