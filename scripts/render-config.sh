#!/bin/sh
# Membuat deploy/*.generated.yaml dari deploy/*.template.yaml + nilai di .env.
#
# Kenapa dipisah: file yang dipakai container berisi RAHASIA, sedangkan template
# berisi placeholder dan dilacak git. Dengan pemisahan ini `git pull` tidak pernah
# menimpa konfigurasi yang sedang berjalan.
#
# Pemakaian:  sh scripts/render-config.sh [IP-publik]
# Jalankan ulang setiap selesai `git pull` atau mengubah .env — aman diulang.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "ERROR: .env tidak ditemukan. Jalankan scripts/gen-env.sh terlebih dahulu." >&2; exit 1; }

val() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
SECRET=$(val LIVEKIT_API_SECRET)
REDISPW=$(val REDIS_PASSWORD)
APP=$(val APP_DOMAIN)

# IP yang diumumkan LiveKit sebagai kandidat ICE. Harus IP MASUK (yang dihubungi browser),
# bukan IP keluar server — pada server di belakang NAT keduanya sering berbeda.
NODE_IP=${1:-$(val NODE_IP)}
[ -n "$NODE_IP" ] || NODE_IP=$(getent ahostsv4 "$APP" 2>/dev/null | awk '{print $1}' | head -1)

[ -n "$SECRET" ]  || { echo "ERROR: LIVEKIT_API_SECRET kosong di .env" >&2; exit 1; }
[ -n "$REDISPW" ] || { echo "ERROR: REDIS_PASSWORD kosong di .env" >&2; exit 1; }
[ -n "$NODE_IP" ] || { echo "ERROR: IP publik tidak bisa ditentukan dari $APP. Beri sebagai argumen, atau isi NODE_IP= di .env." >&2; exit 1; }

render() { # <template> <generated> <image-container>
  [ -f "$1" ] || { echo "ERROR: template $1 tidak ada." >&2; exit 1; }
  # Docker membuat DIREKTORI bila target bind-mount belum ada; bersihkan sisa seperti itu
  [ -d "$2" ] && rm -rf "$2"
  sed -e "s#__LIVEKIT_API_SECRET__#$SECRET#g" \
      -e "s#__REDIS_PASSWORD__#$REDISPW#g" \
      -e "s#__NODE_IP__#$NODE_IP#g" "$1" > "$2"
  if grep -q '__[A-Z_]\{3,\}__' "$2"; then
    echo "ERROR: masih ada placeholder yang belum terisi di $2:" >&2
    grep -o '__[A-Z_]\{3,\}__' "$2" | sort -u | sed 's/^/  /' >&2
    exit 1
  fi
  chmod 600 "$2"
  # Container membaca file ini sebagai pengguna di dalam image (Egress non-root),
  # jadi kepemilikan harus disamakan — kalau tidak: "permission denied" lalu crash-loop.
  u=$(docker run --rm --entrypoint id "$3" -u 2>/dev/null || true)
  case "$u" in
    0)           : ;;                      # container root: 600 milik root sudah cukup
    *[!0-9]*|'') echo "PERINGATAN: uid container $3 tidak terdeteksi; $2 dilonggarkan ke 644 agar terbaca." >&2
                 chmod 644 "$2" ;;
    *)           chown "$u" "$2"; echo "  $2 -> uid $u" ;;
  esac
  echo "  dibuat: $2"
}

render deploy/livekit.template.yaml deploy/livekit.generated.yaml livekit/livekit-server:latest
render deploy/egress.template.yaml  deploy/egress.generated.yaml  livekit/egress:latest

# Folder MP4 sementara: ditulis Egress (uid non-root), dibaca & dihapus aplikasi (uid lain)
mkdir -p recordings && chmod 777 recordings

echo "Selesai. LiveKit akan mengumumkan IP $NODE_IP ke browser (rtc.node_ip)."
echo "Terapkan dengan: docker compose -f deploy/docker-compose.yml --env-file .env up -d"
