// Konfigurasi dinamis di atas app.json:
// • google-services.json (Firebase) dipakai bila ada → push notification undangan & pengingat event.
//   Tanpa file ini aplikasi tetap jalan; pengingat event memakai notifikasi lokal.
// • APP_VERSION_CODE (mis. nomor run GitHub Actions) menaikkan android.versionCode otomatis, karena
//   Android hanya menganggap APK sebagai "pembaruan" bila versionCode-nya lebih besar.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const android = { ...config.android };
  const gs = process.env.GOOGLE_SERVICES_FILE || './google-services.json';
  if (fs.existsSync(path.resolve(__dirname, gs))) android.googleServicesFile = gs;
  const code = parseInt(process.env.APP_VERSION_CODE || '', 10);
  if (code > (android.versionCode || 0)) android.versionCode = code;
  return { ...config, android };
};
