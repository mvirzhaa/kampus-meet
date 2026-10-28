#!/bin/sh
# Membuat file .env dengan rahasia acak.
# Pemakaian: sh scripts/gen-env.sh meet.kampus.ac.id media.meet.kampus.ac.id [IP-publik]
# IP publik opsional; bila dikosongkan diambil dari record A domain aplikasi (= IP yang dihubungi
# browser). Nilai ini dipakai LiveKit sebagai alamat kandidat ICE, jadi harus IP MASUK, bukan IP
# keluar server (pada server di belakang NAT keduanya sering berbeda).
set -e
APP=${1:?domain aplikasi, mis. meet.uika-bogor.ac.id}
MEDIA=${2:?domain media, mis. media.meet.uika-bogor.ac.id}
NODE_IP=${3:-$(getent ahostsv4 "$APP" 2>/dev/null | awk '{print $1}' | head -1)}
[ -n "$NODE_IP" ] || { echo "Tidak bisa menentukan IP publik dari $APP. Beri sebagai argumen ke-3."; exit 1; }
[ -f .env ] && { echo ".env sudah ada, tidak ditimpa."; exit 1; }
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48; }
sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$APP#" \
    -e "s#^LIVEKIT_PUBLIC_URL=.*#LIVEKIT_PUBLIC_URL=wss://$MEDIA#" \
    -e "s#^LIVEKIT_API_SECRET=.*#LIVEKIT_API_SECRET=$(rand)#" \
    -e "s#^APP_SECRET=.*#APP_SECRET=$(rand)#" \
    -e "s#^REDIS_PASSWORD=.*#REDIS_PASSWORD=$(rand)#" .env.example > .env
printf "APP_DOMAIN=%s\nMEDIA_DOMAIN=%s\n" "$APP" "$MEDIA" >> .env
SECRET=$(grep '^LIVEKIT_API_SECRET=' .env | cut -d= -f2)
REDISPW=$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2)
# Kedua file berisi rahasia sehingga dibatasi 600. Tetapi container membacanya sebagai
# pengguna di dalam image — Egress berjalan non-root — jadi kepemilikan file harus
# disamakan dengan uid tersebut. Tanpa ini container gagal start berulang kali dengan
# "open /etc/egress.yaml: permission denied".
own_for_container() { # <file> <image>
  u=$(docker run --rm --entrypoint id "$2" -u 2>/dev/null || true)
  case "$u" in
    0)           : ;;                       # container root: 600 milik root sudah cukup
    *[!0-9]*|'') echo "PERINGATAN: uid container $2 tidak terdeteksi; $1 dilonggarkan ke 644 agar bisa dibaca." >&2
                 chmod 644 "$1" ;;
    *)           chown "$u" "$1" ;;
  esac
}
set -- deploy/livekit.yaml livekit/livekit-server:latest deploy/egress.yaml livekit/egress:latest
while [ $# -gt 0 ]; do
  sed -i -e "s#__LIVEKIT_API_SECRET__#$SECRET#" -e "s#__REDIS_PASSWORD__#$REDISPW#" -e "s#__NODE_IP__#$NODE_IP#" "$1"
  chmod 600 "$1"
  own_for_container "$1" "$2"
  shift 2
done
# Folder MP4 sementara, dipakai bersama oleh Egress (menulis) dan aplikasi (mengunggah lalu menghapus)
mkdir -p recordings && chmod 777 recordings
chmod 600 .env
echo "LiveKit akan mengumumkan IP $NODE_IP ke browser (rtc.node_ip)."
echo "File .env dibuat. Periksa APP_NAME, CAMPUS_NAME, ALLOWED_EMAIL_DOMAINS, lalu isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET."
