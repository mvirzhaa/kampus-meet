# UIKA Meet — Aplikasi Android

Aplikasi Android (React Native + Expo SDK 58) untuk UIKA Meet. Aplikasi ini memakai server, akun, room, dan event yang sama dengan versi web.

## Fitur

- **Tampilan ala Zoom mobile**
  - Beranda dengan empat tombol besar: *Meeting Baru*, *Gabung*, *Jadwalkan*, dan *Jadwal Salat*.
  - Tab Meeting, Jadwal, Event, dan Akun.
- **Ruang meeting**
  - Tampilan pembicara; geser ke kiri untuk melihat galeri (4 peserta per halaman).
  - Kamera sendiri tampil kecil (PiP) di pojok layar.
  - Bilah bawah berisi Bisukan, Video, Peserta, Chat, dan Lainnya. Ketuk layar untuk menyembunyikan bilah.
  - Ganti kamera depan/belakang, dan pilih audio keluaran (speaker, earpiece, headset, atau Bluetooth).
  - Angkat tangan, reaksi, chat, dan daftar peserta.
  - Untuk moderator: bisukan semua, bisukan atau keluarkan peserta, dan akhiri meeting untuk semua.
  - Ruang kelompok (breakout): gabung ke ruang, kembali ke ruang utama, dan pindah otomatis bila dipindahkan moderator.
- **Transkripsi & terjemahan Indonesia ⇄ Inggris**
  - Lewat *Lainnya → Transkripsi & terjemahan*, pilih bahasa asal dan bahasa tujuan.
  - Ucapan Anda dikenali oleh pengenal suara Android, lalu diterjemahkan di perangkat dengan Google ML Kit (offline setelah model bahasa ±30 MB terunduh).
  - Teks langsung (CC) menampilkan teks asli beserta terjemahannya.
  - Transkrip tersimpan di server dan ikut masuk ke ekspor PDF/Word serta ke rekaman.
- **Pengingat azan 5 waktu** (wilayah Jakarta, WIB)
  - Notifikasi muncul tepat waktu walaupun aplikasi ditutup.
  - Disertai suara takbir pembuka azan, *"Allahu akbar, Allahu akbar"*.
  - Pengingat bisa dimatikan per waktu salat.
- **Tautan undangan langsung ke aplikasi**: `https://meet.uika-bogor.ac.id/j/...` dan `/r/...` terbuka di aplikasi.

## ⚠️ Sebelum membangun: ganti suara azan

File `assets/sounds/azan_takbir.wav` saat ini berisi **bunyi lonceng sementara**, karena rekaman azan tidak bisa diunduh saat aplikasi dibuat. Ganti dengan potongan rekaman takbir pembuka azan:

1. Siapkan rekaman berdurasi ±10–20 detik yang hak pakainya dimiliki kampus, misalnya rekaman muazin masjid kampus.
2. Simpan dalam format **WAV**, dengan nama file **yang sama** (`azan_takbir.wav`).
3. Bangun ulang APK.

Suara ini dipakai untuk notifikasi saat aplikasi tertutup. Bila aplikasi sedang terbuka, yang diputar adalah rekaman yang diunggah admin di **Panel Admin → Notifikasi Azan** (versi web). Bila admin belum mengunggah rekaman, aplikasi memutar file bawaan.

## Membangun APK

Pilih salah satu cara berikut.

### A. GitHub Actions (tanpa memasang apa pun)

1. Unggah seluruh folder `kampusmeet` ke repositori GitHub.
2. Buka tab **Actions → Android APK → Run workflow**.
3. Setelah ±15–25 menit, unduh APK dari bagian **Artifacts**.

APK ini ditandatangani dengan kunci debug: cocok untuk dipasang langsung (sideload), tetapi tidak untuk Play Store.

Untuk Play Store, isi secret berikut di repositori: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, dan `ANDROID_KEY_PASSWORD`.

### B. EAS Build (layanan cloud Expo)

```bash
cd mobile
npm ci
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview      # APK
npx eas-cli@latest build -p android --profile production   # AAB untuk Play Store
```

### C. Android Studio di komputer sendiri

Butuh Node 22, JDK 17, dan Android SDK.

```bash
cd mobile
npm ci
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# hasil: android/app/build/outputs/apk/release/app-release.apk
```

Untuk mencoba langsung di ponsel lewat kabel USB: `npx expo run:android`.

> Aplikasi ini memakai modul native (LiveKit WebRTC, pengenal suara, ML Kit), jadi **tidak bisa dijalankan di Expo Go**. Gunakan APK hasil build atau *development build*.

## Pengaturan

- **Alamat server** bawaan: `https://meet.uika-bogor.ac.id`. Ubah di `app.json → expo.extra.defaultServer`, atau dari layar Masuk → *Pengaturan server*.
- **Domain tautan undangan**: `app.json → android.intentFilters`. Sesuaikan bila domain kampus berbeda.
- **Nama paket**: `id.ac.uikabogor.meet`.

## Catatan teknis

- **Pengenal suara.** Membutuhkan aplikasi Google, atau *Speech Recognition & Synthesis* di Android 13 ke atas. Pengenalan suara online membutuhkan internet; untuk offline, unduh paket bahasa di pengaturan Google.
- **Model terjemahan.** Model ML Kit diunduh otomatis saat terjemahan pertama kali dipakai (sekali per pasangan bahasa).
- **Pengingat azan tepat menit.** Di Android 14 ke atas, izinkan *Alarm & pengingat* untuk UIKA Meet di pengaturan aplikasi. Tanpa izin ini, notifikasi bisa terlambat beberapa menit.
- **Mikrofon bersamaan.** Transkripsi memakai pengenal suara Android bersamaan dengan mikrofon meeting. Ini sudah didukung di Android 10 ke atas, tetapi sebaiknya diuji di beberapa merek ponsel yang dipakai sivitas. Bila transkrip tidak muncul di ponsel tertentu, peserta tetap bisa membaca teks & terjemahan dari pembicara lain.
- **Presentasi/whiteboard PDF** tampil di versi web. Di aplikasi, muncul pemberitahuan saat moderator menampilkan presentasi. Berbagi layar dari web tetap tampil di aplikasi.

## Struktur

```
mobile/
├─ src/app/                 layar (Expo Router): beranda, gabung, jadwal, event, akun, jadwal salat, meeting
├─ src/lib/                 API, sesi meeting, useMeeting (LiveKit + protokol data), transkripsi, terjemahan, azan
├─ src/components/          komponen UI & ubin video
├─ modules/uika-translate/  modul native Kotlin: terjemahan ML Kit di perangkat
├─ assets/                  ikon, splash, suara azan
└─ web-preview/             shim untuk pratinjau tampilan di browser (tidak ikut ke APK)
```
