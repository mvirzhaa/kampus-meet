// Dipakai workflow GitHub: ganti tanda tangan rilis dari keystore debug ke keystore milik kampus.
const fs = require('fs');
const f = 'android/app/build.gradle';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('UIKA_STORE_FILE')) {
  s = s.replace(/signingConfigs\s*\{/, `signingConfigs {
        uika {
            storeFile file(UIKA_STORE_FILE)
            storePassword UIKA_STORE_PASSWORD
            keyAlias UIKA_KEY_ALIAS
            keyPassword UIKA_KEY_PASSWORD
        }`);
  s = s.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.uika');
  fs.writeFileSync(f, s);
  console.log('Keystore rilis kampus dipakai.');
}
