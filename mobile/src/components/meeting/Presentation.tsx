// Presentasi PDF + whiteboard di aplikasi. Slide dirender oleh halaman web kampus (/m/pres, pdf.js) di dalam WebView;
// aplikasi meneruskan slide aktif dan anotasi whiteboard yang diterimanya lewat LiveKit. Penampil ini hanya menampilkan
// (tidak mengirim data ke peserta lain), sehingga tidak menambah koneksi media baru.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/components/ui';
import type { Pres, Shape } from '@/lib/useMeeting';
import { C } from '@/lib/theme';

// Deklarasi tipe WebView (kelas generik dengan P = undefined) tidak cocok dengan @types/react 19 → dibungkus
type WebViewHandle = { postMessage: (message: string) => void };
const WebView = RNWebView as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

type Props = {
  server: string; code: string; seat: string; pres: Pres | null; name: string; shapes: Shape[]; ver: number;
  style?: StyleProp<ViewStyle>; interactive?: boolean; pad?: number;
};

/** Satu WebView penampil. interactive=false: sentuhan diteruskan ke halaman induk (geser antar-halaman). */
function Viewer({ server, code, seat, pres, name, shapes, ver, style, interactive, pad = 0 }: Props) {
  const ref = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const origin = server.replace(/\/+$/, '');

  // Kursi meeting dikirim lewat postMessage (bukan URL) agar tidak tercatat di riwayat/log
  useEffect(() => { if (ready) ref.current?.postMessage(JSON.stringify({ t: 'init', code, seat })); }, [ready, code, seat]);
  useEffect(() => {
    if (!ready) return;
    ref.current?.postMessage(JSON.stringify({ t: 'state', pres, page: pres?.page || 1, name, shapes, pad }));
  }, [ready, pres?.id, pres?.page, name, ver, shapes, pad]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { t?: string; message?: string } = {}; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.t === 'ready') { setReady(true); setErr(''); }
    else if (m.t === 'error') setErr(m.message || 'Gagal memuat presentasi');
    else if (m.t === 'rendered') setErr('');
  };

  return (
    <View style={[s.box, style]} pointerEvents={interactive ? 'auto' : 'none'}>
      <WebView
        ref={ref}
        source={{ uri: `${origin}/m/pres` }}
        originWhitelist={[origin]}
        onShouldStartLoadWithRequest={(r) => r.url.startsWith(origin + '/m/pres')}
        onMessage={onMessage}
        onLoadStart={() => setReady(false)}
        onError={() => setErr('Tidak dapat memuat presentasi. Periksa koneksi internet.')}
        onHttpError={(e) => setErr(`Server mengembalikan ${e.nativeEvent.statusCode}`)}
        javaScriptEnabled
        domStorageEnabled={false}
        incognito
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures={false}
        scalesPageToFit={!!interactive}
        setBuiltInZoomControls={!!interactive}
        setDisplayZoomControls={false}
        scrollEnabled={!!interactive}
        overScrollMode="never"
        style={s.web}
        containerStyle={{ backgroundColor: '#0A1A15' }}
      />
      {!ready ? <View style={s.loading}><ActivityIndicator color="#fff" /></View> : null}
      {err ? <View style={s.err}><T size={12.5} color="#fff" style={{ textAlign: 'center' }}>{err}</T></View> : null}
    </View>
  );
}

/**
 * Halaman presentasi di ruang meeting: penampil + tombol layar penuh (bisa diperbesar dengan dua jari)
 * + navigasi slide untuk presenter/moderator.
 */
export function PresentationStage(props: Props & { canPresent: boolean; onGoto: (n: number) => void; presenterName?: string }) {
  const { pres, canPresent, onGoto, presenterName } = props;
  const [full, setFull] = useState(false);
  const insets = useSafeAreaInsets();
  const nav = canPresent && pres && pres.pages > 1 ? (
    <View style={s.nav}>
      <Pressable hitSlop={8} style={[s.navBtn, pres.page <= 1 && { opacity: 0.35 }]} disabled={pres.page <= 1} onPress={() => onGoto(pres.page - 1)} accessibilityLabel="Slide sebelumnya">
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>
      <T w="semibold" size={13} color="#fff">{pres.page} / {pres.pages}</T>
      <Pressable hitSlop={8} style={[s.navBtn, pres.page >= pres.pages && { opacity: 0.35 }]} disabled={pres.page >= pres.pages} onPress={() => onGoto(pres.page + 1)} accessibilityLabel="Slide berikutnya">
        <Ionicons name="chevron-forward" size={22} color="#fff" />
      </Pressable>
    </View>
  ) : null;
  return (
    <View style={[{ flex: 1 }, props.style]}>
      <Viewer {...props} style={{ flex: 1 }} interactive={false} />
      <View style={s.head} pointerEvents="box-none">
        <View style={s.chip}>
          <Ionicons name={pres ? 'document-text-outline' : 'easel-outline'} size={14} color={C.gold} />
          <T size={12} color="#fff" numberOfLines={1} style={{ flexShrink: 1 }}>
            {pres ? `${pres.name}${pres.pages > 1 ? ` · slide ${pres.page}/${pres.pages}` : ''}` : 'Whiteboard'}{presenterName ? ` · ${presenterName}` : ''}
          </T>
        </View>
        <Pressable style={s.fullBtn} onPress={() => setFull(true)} hitSlop={8} accessibilityLabel="Layar penuh (bisa diperbesar)">
          <Ionicons name="expand" size={18} color="#fff" />
        </Pressable>
      </View>
      {nav}
      <Modal visible={full} onRequestClose={() => setFull(false)} animationType="fade" supportedOrientations={['portrait', 'landscape']} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#0A1A15', paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <Viewer {...props} style={{ flex: 1 }} interactive />
          <View style={[s.head, { top: insets.top + 8 }]} pointerEvents="box-none">
            <View style={s.chip}><T size={12} color="#fff">Cubit dengan dua jari untuk memperbesar</T></View>
            <Pressable style={s.fullBtn} onPress={() => setFull(false)} hitSlop={8} accessibilityLabel="Tutup layar penuh">
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
          {nav ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 12 }}>{nav}</View> : null}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  box: { overflow: 'hidden', borderRadius: 12, backgroundColor: '#0A1A15' },
  web: { flex: 1, backgroundColor: '#0A1A15' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  err: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 8 },
  head: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginRight: 'auto' },
  fullBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  nav: { alignSelf: 'center', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  navBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
