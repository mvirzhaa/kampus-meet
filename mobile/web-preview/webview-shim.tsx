// Pratinjau browser saja: react-native-webview tidak tersedia di web, jadi diganti <iframe>.
// postMessage diteruskan ke halaman di dalam iframe; begitu iframe selesai dimuat dianggap "ready".
import React, { forwardRef, useImperativeHandle, useRef } from 'react';

type Props = { source?: { uri?: string }; onMessage?: (e: { nativeEvent: { data: string } }) => void; onLoadStart?: () => void; style?: unknown };
export const WebView = forwardRef<{ postMessage: (m: string) => void }, Props>(function WebView({ source, onMessage, onLoadStart }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(ref, () => ({ postMessage: (m: string) => frame.current?.contentWindow?.postMessage(m, '*') }), []);
  return (
    <iframe ref={frame} src={source?.uri} title="Presentasi" style={{ border: 0, width: '100%', height: '100%', background: '#0A1A15' }}
      onLoad={() => { onLoadStart?.(); setTimeout(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ t: 'ready' }) } }), 0); }} />
  );
});
export default WebView;
