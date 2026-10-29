# UIKA Meet — Video Conference Kampus

Aplikasi video conference untuk kuliah daring, seminar bersertifikat, dan rapat kampus. Tampilan halaman depan terinspirasi Tampil.id, ruang meeting mengikuti alur yang sudah dikenal (gaya BigBlueButton): pilih audio, atur kamera, presentasi + whiteboard, chat, catatan bersama, polling, dan kunci peserta.

Nama aplikasi, nama kampus, dan domain email bisa diganti lewat `.env` (`APP_NAME`, `CAMPUS_NAME`, `ALLOWED_EMAIL_DOMAINS`).

## Fitur

**Halaman depan & akun**
- Beranda: gabung dengan ID room, *Buat Meeting Baru* (mulai sekarang / buat untuk nanti / jadwalkan), daftar event mendatang, tata cara mengikuti event.
- Login & daftar (bisa dibatasi ke email kampus). Pengguna pertama yang mendaftar otomatis menjadi **admin**; satu akun bisa dikunci sebagai **super-admin** lewat `ADMIN_EMAIL` di `.env`.
- **Panel Admin** (`/admin`, khusus admin): kelola **kategori event** (tambah/ubah nama/nonaktifkan/hapus — tanpa perlu ubah kode), kelola **pengguna** (cari, jadikan admin atau turunkan, nonaktifkan akun, reset password, buka kunci login), serta lihat & hapus **seluruh meeting dan event** milik siapa pun.
- Dasbor: daftar meeting (ID, password, link moderator & peserta, salin undangan, ubah, rekap kehadiran + unduh CSV, hapus), event, sertifikat, akun.
- Event: buat event (jadwal, kuota, narasumber, durasi minimum hadir), pendaftaran peserta, kehadiran tercatat otomatis, **sertifikat digital otomatis** dengan halaman verifikasi publik dan siap cetak/PDF.

**Ruang meeting** (sesuai fitur di video referensi)
- Halaman *Join Meeting Room*: nama tampilan + password room; link moderator/peserta tanpa password.
- Dialog *Bagaimana Anda ingin bergabung ke audio?* → **Mikrofon** (dengan cek level & pilih speaker) atau **Hanya mendengar**.
- *Pengaturan kamera*: pilih kamera, kualitas (180p/360p/720p), **latar virtual & blur**, kecerahan, cermin.
- **Presentasi PDF** (unggah, pilih, izinkan unduh, hapus), navigasi slide tersinkron, zoom, sesuaikan lebar.
- **Whiteboard**: pointer, geser, pena, penghapus, kotak, lingkaran, garis, panah, teks, warna, ketebalan, urungkan, hapus semua; mode *whiteboard bersama*.
- **Chat publik** (tautan aman, simpan/salin/hapus), **chat privat**, **catatan bersama**, **polling** (Ya/Tidak, Benar/Salah, A–D, kustom) dengan publikasi hasil.
- Daftar pengguna: indikator moderator/presenter/mikrofon/kamera/bicara/angkat tangan; menu per peserta (chat privat, jadikan presenter/moderator, matikan mikrofon, keluarkan, keluarkan & blokir).
- Menu moderator: matikan mikrofon semua (atau kecuali presenter), **Kunci peserta (lock viewers)** — kamera, melihat kamera lain, mikrofon, chat publik, chat privat, catatan, daftar pengguna — turunkan semua tangan, simpan daftar nama.
- Berbagi layar (presenter/moderator), angkat tangan, reaksi emoji, status koneksi, timer, layar penuh, pintasan keyboard, akhiri meeting untuk semua.
- **Transkripsi otomatis (Bahasa Indonesia / English)** dengan nama pembicara: teks langsung (CC) di layar, panel Transkrip, dan notulen tersimpan per sesi di Dasbor (lihat, salin, unduh TXT, hapus).
- **Rekam di server** (LiveKit Egress): MP4 H.264 **720p 15 fps** (±0,4 GB/jam) berisi presentasi/whiteboard, layar, kamera, suara, dan teks CC; otomatis diunggah ke **folder Google Drive** (satu subfolder per rekaman), lalu dihapus dari server. Status & tautan di Dasbor → Rekaman. Mode cadangan `RECORDING_MODE=local` merekam di browser moderator.
- **Presensi otomatis**: setiap masuk/keluar tercatat; laporan per sesi berisi masuk pertama, keluar terakhir, durasi (keluar terakhir − masuk pertama), waktu aktif, jumlah masuk — unduh **Excel (.xlsx)** atau **PDF**.
- **Sertifikat** hanya untuk peserta dengan durasi minimal **15 menit** (`CERT_MIN_MINUTES`).
- Responsif untuk ponsel.

## Arsitektur (fokus: ringan di server)

```
Browser ──HTTPS──▶ Caddy ──▶ App Node.js (halaman, login, API, SQLite)      ← sangat ringan
   │
   └──WebRTC (UDP)──▶ LiveKit SFU (meneruskan audio/video tanpa transcoding)
```

Kenapa ringan:
- **SFU, bukan MCU**: server hanya meneruskan paket, tidak mendekode/mengencode video. Jauh lebih hemat CPU dibanding BigBlueButton (yang butuh ≥16 GB RAM).
- **Simulcast + dynacast + adaptive stream**: video dikirim dalam beberapa lapisan; lapisan yang tidak ditonton tidak dikirim, dan tiap peserta menerima resolusi sesuai ukuran ubin di layarnya. Video peserta yang tidak tampil di halaman ubin tidak dilanggan sama sekali.
- **Chat, whiteboard, catatan, polling, angkat tangan lewat data channel** — tidak melewati server aplikasi.
- **Rekaman** memakai Egress (2–6 core per rekaman berjalan); jalankan di server terpisah bila sering merekam banyak kelas bersamaan. File hanya singgah sementara lalu diunggah ke Google Drive.
- **PDF dirender di browser** (pdf.js) — server cuma menyimpan file.
- **Transkripsi di browser pembicara** (Web Speech API): tiap orang hanya mengenali mikrofonnya sendiri, sehingga nama pembicara selalu tepat tanpa proses pemisahan suara; server hanya menerima teks final (beberapa ratus byte per kalimat).
- **Server aplikasi tanpa dependensi runtime**: hanya modul bawaan Node.js 22 (`http`, `crypto`, `node:sqlite`). Tidak perlu `npm install` di server, tanpa database terpisah, tanpa Redis.
- Aset statis di-minify dan **dipra-kompresi (brotli/gzip) saat build**, di-cache dengan nama berhash. JS halaman ruang ≈ 21 KB (br) + pustaka WebRTC yang dimuat sekali.
- Mode **hemat data** & **hanya mendengar** untuk mahasiswa dengan sinyal lemah.

Perkiraan kapasitas (1 server 4 vCPU / 8 GB, uplink 1 Gbps): ±10–15 kelas paralel × 40 mahasiswa dengan 2–4 kamera aktif, atau seminar 300 peserta dengan 1–2 kamera pembicara. Bandwidth adalah batas utama, bukan CPU.

## Keamanan

- Password akun: **scrypt** (salt acak), perbandingan waktu-konstan, penguncian akun 15 menit setelah 10 gagal login, respons seragam untuk email tak terdaftar.
- Sesi: token acak 256-bit di cookie `HttpOnly; SameSite=Lax; Secure` (prefix `__Host-` di production), hanya hash-nya yang disimpan di database; ganti password mencabut semua sesi lain.
- **CSRF**: token per sesi + pemeriksaan header `Origin` untuk semua permintaan yang mengubah data.
- **Rate limit** (memori) untuk login, daftar, join room (anti tebak password), unggah, dan API umum.
- Header keamanan: CSP ketat (tanpa skrip inline, tanpa CDN), `X-Frame-Options: DENY`, HSTS, `Permissions-Policy`, `nosniff`, COOP/CORP.
- **Super-admin** (`ADMIN_EMAIL`): perannya dipaksa ulang setiap server start, dan tidak bisa diturunkan, dinonaktifkan, atau di-reset passwordnya lewat panel — sehingga akses admin tidak bisa hilang karena salah klik atau admin lain yang nakal. Admin juga tidak bisa mengubah peran/status akunnya sendiri.
- Menonaktifkan akun langsung mencabut seluruh sesinya di semua perangkat; reset password oleh admin juga memaksa login ulang.
- Room: kode acak (±10¹⁴ kombinasi), password room terenkripsi AES-256-GCM, link moderator & peserta dengan kunci acak terpisah (bisa dibuat ulang), opsi khusus pengguna login, event hanya untuk peserta terdaftar.
- **Peran ditandatangani server**: peran (moderator/peserta) disimpan di token LiveKit sebagai atribut yang tidak bisa diubah peserta. Semua aksi moderator dieksekusi di server. Lock mikrofon/kamera/berbagi layar ditegakkan oleh izin publish di SFU; pesan data dari peserta yang dikunci diabaikan oleh klien lain.
- Keluarkan & blokir (24 jam) berdasarkan akun atau perangkat. Token media berumur **10 menit** (diperbarui otomatis oleh LiveKit selama terhubung); halaman ruang selalu meminta token baru ke server, dan webhook LiveKit mengeluarkan siapa pun yang mencoba masuk memakai token lama milik peserta yang diblokir. Saat peserta tersambung ulang, peran dan izinnya disamakan lagi dengan data server.
- Percobaan password room yang salah juga dibatasi **per room** (dari semua IP), sehingga tebakan dari banyak IP/botnet tetap tertahan.
- Peserta tanpa akun ditandai **"Tamu (tanpa akun)"** di daftar pengguna agar tidak bisa menyamar sebagai dosen.
- Kursi peserta (sesi meeting) disimpan ter-hash di database, sehingga restart server tidak memutus hak moderator.
- Unggahan: hanya PDF (dicek *magic bytes*), batas ukuran, nama file acak, disajikan dengan `Content-Disposition: attachment` + CSP `sandbox`, hanya untuk peserta room.
- Media terenkripsi di jalur (DTLS-SRTP wajib di WebRTC), seluruh situs lewat HTTPS. Webhook LiveKit diverifikasi tanda tangannya.
- Konten pengguna selalu dirender sebagai teks (tanpa `innerHTML`), ekspor CSV terlindung dari *CSV injection*.

**Webhook LiveKit wajib aktif** (`deploy/livekit.template.yaml` → `webhook.urls`) karena dipakai untuk penegakan blokir, sinkronisasi izin, dan kehadiran/sertifikat.

## Instalasi (Docker — direkomendasikan)

Kebutuhan: server Linux dengan IP publik, Docker + Docker Compose, dua subdomain yang mengarah ke server, misalnya `meet.uika-bogor.ac.id` dan `media.meet.uika-bogor.ac.id`.

```bash
# 1. Salin folder proyek ke server, lalu:
sh scripts/gen-env.sh meet.uika-bogor.ac.id media.meet.uika-bogor.ac.id
nano .env                      # cek APP_NAME, CAMPUS_NAME, ALLOWED_EMAIL_DOMAINS

# 2. Jalankan
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

### Konfigurasi container: template vs. hasil generate

Berkas yang dibaca container **berisi rahasia**, jadi tidak boleh dilacak git. Pemisahannya:

| Berkas | Dilacak git | Isi |
| --- | --- | --- |
| `deploy/livekit.template.yaml`, `deploy/egress.template.yaml` | ya | placeholder `__LIVEKIT_API_SECRET__`, `__NODE_IP__`, … |
| `deploy/livekit.generated.yaml`, `deploy/egress.generated.yaml` | tidak (`.gitignore`) | rahasia asli; inilah yang di-mount ke container |

`scripts/gen-env.sh` memanggil `scripts/render-config.sh` untuk membuat berkas hasil generate.

> **Setelah setiap `git pull`** (atau setiap mengubah `.env`), jalankan ulang:
>
> ```bash
> sh scripts/render-config.sh
> docker compose -f deploy/docker-compose.yml --env-file .env up -d
> ```
>
> Skrip ini aman diulang: mengisi rahasia + `rtc.node_ip`, menolak jalan bila ada placeholder
> yang belum terisi, dan menyamakan kepemilikan berkas dengan uid di dalam container
> (Egress berjalan non-root — tanpa ini ia gagal start dengan `permission denied`).
>
> Karena `git pull` hanya menyentuh template, konfigurasi yang sedang dipakai container
> tidak pernah tertimpa.

Buka firewall: **TCP 80, 443, 7881**, **UDP 443, 7882, 3478, 30000–31000** (relay TURN).
Port 3000, 6379, 7880, 8081 cukup lokal (jangan dibuka).

> **Server di belakang NAT** (IP lokal 10.x/172.x/192.168.x): semua port di atas harus
> *di-forward* dari IP publik ke server, dan `NODE_IP` di `.env` harus berisi
> **IP masuk** (IP pada record A domain). Pada banyak jaringan kampus IP keluar berbeda dengan
> IP masuk, sehingga deteksi otomatis LiveKit salah — lihat bagian troubleshooting di bawah.

**Google Drive untuk rekaman** (sekali saja):
1. [console.cloud.google.com](https://console.cloud.google.com) → buat proyek → aktifkan **Google Drive API**.
2. *OAuth consent screen*: pilih **Internal** bila kampus memakai Google Workspace; bila *External*, ubah status ke **In production** (status *Testing* membuat izin kedaluwarsa tiap 7 hari).
3. *Credentials* → *OAuth client ID* → **Web application**, Redirect URI `https://<domain>/api/admin/gdrive/callback`.
4. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GDRIVE_FOLDER_ID` di `.env`, restart aplikasi.
5. Login sebagai admin → **Dasbor → Integrasi → Hubungkan Google Drive** dengan akun yang punya akses **Editor** ke folder tujuan.

Google tidak menerima unggahan anonim walaupun folder dibagikan publik; file tersimpan atas nama dan kuota akun yang dihubungkan.

3. Buka `https://meet.uika-bogor.ac.id`, **daftar akun pertama** (otomatis admin), lalu buat meeting.

### Terjemahan transkrip di server (opsional)

Chrome/Edge desktop menerjemahkan transkrip di perangkat masing-masing tanpa server. Peserta
di HP, Firefox, atau Safari tidak punya penerjemah bawaan — untuk mereka, sediakan
LibreTranslate sebagai cadangan:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env --profile translate up -d
```

Tunggu sampai siap, lalu uji:

```bash
curl -s http://127.0.0.1:5000/languages                       # harus memuat en dan id
curl -s -X POST http://127.0.0.1:5000/translate -H 'Content-Type: application/json'   -d '{"q":"selamat pagi","source":"id","target":"en","format":"text"}'
```

Setelah terbukti jalan, isi `TRANSLATE_URL=http://127.0.0.1:5000` di `.env` lalu:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --force-recreate app
```

`--force-recreate` perlu karena perubahan `.env` saja tidak selalu dianggap compose sebagai
perubahan konfigurasi.

> **`LT_UPDATE_MODELS` sengaja `"false"`.** Bila `"true"`, LibreTranslate menghubungi
> repositori model setiap start. Pada jaringan yang tidak bisa menjangkau domain itu,
> prosesnya **menggantung tanpa timeout** — layanan tidak pernah siap meski model sudah
> ada di volume. Gejalanya: log berhenti di `Booting...`, CPU 0%, dan tidak ada yang
> mendengarkan di port 5000. Perbarui model secara sengaja saja bila memang perlu.

> **Layanan ini memakai Docker profile.** `docker compose up -d` biasa tidak akan
> menjalankannya, tetapi juga tidak menghentikan yang sudah jalan — jadi alur deploy rutin
> aman. Hindari `--remove-orphans`: perilakunya terhadap layanan berprofil tidak konsisten
> antar versi compose dan bisa menghapus container ini.

## Mengatasi "Gagal terhubung ke server media"

Halaman ruang terbuka dan spinner *Menghubungkan ke meeting…* berputar lalu gagal → halaman aplikasi
(port 443) sudah benar, yang gagal adalah jalur **media** ke LiveKit. Jalankan di server:

```bash
sh scripts/diagnose.sh
```

Skrip memeriksa berurutan penyebab tersering:

1. **Record DNS `MEDIA_DOMAIN` belum dibuat.** Subdomain media (mis. `media.meet.uika-bogor.ac.id`)
   harus punya record A ke IP server, terpisah dari domain aplikasi. Tanpa itu Caddy gagal menerbitkan
   sertifikat dan `wss://` dari browser langsung putus.
2. **IP yang diumumkan LiveKit salah (paling sering di jaringan kampus).** LiveKit menaruh
   `rtc.node_ip` di kandidat ICE yang dikirim ke browser. Pada server di belakang NAT, IP **keluar**
   (yang dideteksi STUN) sering berbeda dari IP **masuk** (record A domain) — browser lalu mencoba
   alamat yang tidak bisa dihubungi dan gagal setelah beberapa puluh detik. Bandingkan baris `nodeIP`
   pada `docker compose logs livekit` dengan `dig +short $APP_DOMAIN`; bila berbeda, set
   `NODE_IP=<IP masuk>` di `.env`, jalankan `sh scripts/render-config.sh`, lalu `docker compose restart livekit`.
3. **Firewall / NAT menutup port media.** Forward **TCP 7881** dan **UDP 7882, 3478, 30000–31000**
   dari IP publik ke server, dan buka juga di `ufw`/`firewalld` bila aktif. Hanya 80/443 yang terbuka =
   signaling jalan tetapi ICE tidak pernah tersambung — gejalanya sama.
4. **`LIVEKIT_PUBLIC_URL` tidak sama dengan `wss://$MEDIA_DOMAIN`**, atau `deploy/*.generated.yaml`
   belum dibuat/masih berisi placeholder (jalankan `sh scripts/render-config.sh`).

### Rekaman gagal: `Start signal not received`

Gejala: rekaman tampak mulai lalu berhenti sendiri setelah ±20 detik, tidak ada file MP4, dan
`error` pada tabel `recordings` berbunyi *Start signal not received*.

Egress menjalankan Chrome **di dalam server yang sama** dan menyambung ke LiveKit seperti peserta
biasa. Bila `rtc.node_ip` hanya berisi IP publik dan NAT tidak mendukung *hairpin*, Chrome itu tidak
bisa menghubungi IP publik servernya sendiri → ICE gagal → halaman perekam melempar error dan
memanggil `END_RECORDING` sebelum sempat mengirim `START_RECORDING`.

Buktinya terlihat di log LiveKit — cari baris `removing participant without connection` untuk
peserta ber-identity `EG_...`:

```
publisherCandidates: [udp4 host <IP-PUBLIK>:7882, tcp4 host <IP-PUBLIK>:7881]
connectionType: "unknown"   sessionDuration: "0s"
```

Perbaikannya ada di `deploy/livekit.template.yaml` (sudah menjadi bawaan): `rtc.advertise_internal_ip: true`,
sehingga LiveKit mengumumkan IP internal server berdampingan dengan IP publik.

### Egress crash-loop: `open /etc/egress.yaml: permission denied`

Konfigurasi berisi rahasia dibuat `chmod 600`, tetapi container Egress membacanya sebagai
**pengguna non-root** (uid 1001 pada image resmi). Bila berkas itu dimiliki root, Egress gagal start
berulang kali. `scripts/render-config.sh` sudah menyamakan kepemilikan dengan uid di dalam
container; bila berkas pernah di-`chmod`/`chown` manual, cukup jalankan ulang:

```bash
sh scripts/render-config.sh
docker compose -f deploy/docker-compose.yml --env-file .env restart egress
```

Bila firewall kampus benar-benar hanya mengizinkan 443, satu-satunya jalan adalah TURN/TLS
(lihat catatan di bawah) — menambah port lain tidak akan membantu.

> Jaringan kampus/kantor yang sangat ketat (hanya port 443): aktifkan TURN/TLS LiveKit dengan subdomain dan sertifikat tersendiri (`turn.tls_port: 5349` + `turn.domain` + `cert_file/key_file`), lihat dokumentasi LiveKit "Deploying → Firewall".

## Server yang direkomendasikan & kapasitas (perkiraan)

| Paket | Spesifikasi | Perkiraan peserta serentak* | Rekaman bersamaan |
| --- | --- | --- | --- |
| Uji coba | 8 vCPU, 16 GB RAM, 100 GB SSD, 500 Mbps | ±250 | 1 |
| **Disarankan** | **16 vCPU, 32 GB RAM, 200 GB NVMe, 1 Gbps simetris** | **±800 mode kuliah · ±500 berbagi layar · ±300 rapat semua kamera** | **2–3** |
| Besar | 2 server: media 16 vCPU + Egress 16 vCPU, 1–10 Gbps | ±1.500+ | 4–5 |

\*Angka perkiraan berdasarkan bandwidth per penonton: ±0,25 Mbps (slide PDF + 1 kamera dosen), ±1,3 Mbps (berbagi layar 1080p), ±2 Mbps (galeri banyak kamera), dengan cadangan 30%. Ukur sebelum peluncuran dengan `lk load-test` (LiveKit CLI). Satu room dibatasi 300 peserta secara bawaan (`MAX_PARTICIPANTS`).

## Instalasi tanpa Docker

1. Pasang **Node.js ≥ 22.13** dan unduh binary **livekit-server** (GitHub `livekit/livekit`, rilis).
2. Salin proyek ke `/opt/kampusmeet`, buat `.env` dengan `scripts/gen-env.sh`.
3. Jalankan `sh scripts/render-config.sh`, lalu LiveKit: `livekit-server --config deploy/livekit.generated.yaml`.
4. Jalankan aplikasi: salin `deploy/kampusmeet.service` ke `/etc/systemd/system/`, lalu `systemctl enable --now kampusmeet`.
5. Pasang reverse proxy HTTPS (Caddy/Nginx) untuk kedua domain seperti `deploy/Caddyfile`.

Folder `public/` sudah berisi hasil build; server tidak memerlukan `npm install`.

## Pengembangan

```bash
npm install                 # hanya alat build (esbuild, livekit-client, pdf.js, ikon)
npm run build               # src/ → public/
livekit-server --config deploy/livekit.dev.yaml
npm run dev                 # http://localhost:3000
```

Struktur:
```
server/        index.js (router), auth.js, rooms.js (join, moderator, presentasi, webhook), events.js, admin.js (panel admin), livekit.js, db.js, security.js
src/html/      templat halaman + partial (navbar, footer, ilustrasi)
src/pages/     skrip tiap halaman situs
src/room/      ruang meeting: main, media (video/audio), panels (pengguna/chat/catatan/polling), presentation (PDF+whiteboard), controls, recorder, processors
src/css/       site.css, room.css
scripts/       build.mjs, gen-env.sh, fetch-model.sh
deploy/        docker-compose.yml, Caddyfile, *.template.yaml (sumber konfigurasi container), systemd
```

## Catatan & batasan

- **Transkripsi** memerlukan Chrome/Edge (desktop/Android) atau Safari di perangkat **pembicara**; peserta dengan browser lain tetap bisa membaca transkrip, tetapi ucapannya tidak tercatat. Di Chrome, audio pembicara diproses oleh layanan pengenal suara Google kecuali paket bahasa di perangkat tersedia (Chrome versi baru, dipakai otomatis). Setiap pembicara memilih satu bahasa (Indonesia atau English); kalimat campuran dikenali sesuai bahasa yang dipilih. Bila kampus mewajibkan audio tidak keluar dari server sendiri, fitur ini dapat diganti dengan server Whisper (butuh GPU) — tidak disertakan karena berat.

- Dokumen Word/PowerPoint perlu disimpan sebagai **PDF** dulu (konversi Office di server sengaja tidak dipakai karena berat).
- Latar virtual memakai model MediaPipe yang diunduh browser dari Google; untuk host sendiri jalankan `scripts/fetch-model.sh` dan set `SEGMENTER_MODEL_URL`.
- Rekaman tersimpan di komputer moderator (Chrome/Edge). Bila butuh rekaman otomatis di server, tambahkan LiveKit Egress (memerlukan server terpisah karena berat).
- Belum ada breakout room dan SSO kampus — keduanya bisa ditambahkan kemudian.
- Data tersimpan di `data/` (SQLite + file presentasi). Cadangkan folder ini secara berkala.
