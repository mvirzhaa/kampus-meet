// Konfigurasi Metro. Untuk Android tidak ada yang diubah.
// Khusus pratinjau di browser (npx expo start --web): modul native LiveKit diganti shim web
// agar tampilan aplikasi bisa dicoba tanpa ponsel. Lihat web-preview/README.md.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const shim = path.join(__dirname, 'web-preview/livekit-shim.tsx');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (platform === 'web' && name === '@livekit/react-native') return { type: 'sourceFile', filePath: shim };
  if (platform === 'web' && name === 'react-native-webview') return { type: 'sourceFile', filePath: path.join(__dirname, 'web-preview/webview-shim.tsx') };
  if (platform === 'web' && name === '@livekit/components-react') {
    return ctx.resolveRequest({ ...ctx, originModulePath: path.join(__dirname, 'node_modules/@livekit/react-native/package.json') }, name, platform);
  }
  return upstream ? upstream(ctx, name, platform) : ctx.resolveRequest(ctx, name, platform);
};
module.exports = config;
