#!/bin/sh
# Diagnosa "Gagal terhubung ke server media".
# Jalankan DI SERVER dari folder proyek:  sh scripts/diagnose.sh
set -u
cd "$(dirname "$0")/.." 2>/dev/null || true
[ -f .env ] || { echo "!! .env tidak ditemukan. Jalankan dari folder proyek."; exit 1; }
# shellcheck disable=SC2046
APP_DOMAIN=$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2-)
MEDIA_DOMAIN=$(grep -E '^MEDIA_DOMAIN=' .env | cut -d= -f2-)
LK_PUBLIC=$(grep -E '^LIVEKIT_PUBLIC_URL=' .env | cut -d= -f2-)
LK_SECRET=$(grep -E '^LIVEKIT_API_SECRET=' .env | cut -d= -f2-)
LK_KEY=$(grep -E '^LIVEKIT_API_KEY=' .env | cut -d= -f2-)
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[31mGAGAL\033[0m %s\n' "$1"; }
warn() { printf '  \033[33mCEK\033[0m  %s\n' "$1"; }
hdr()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

hdr "1. Konfigurasi .env"
echo "  APP_DOMAIN=$APP_DOMAIN"
echo "  MEDIA_DOMAIN=$MEDIA_DOMAIN"
echo "  LIVEKIT_PUBLIC_URL=$LK_PUBLIC"
[ -n "$MEDIA_DOMAIN" ] || bad "MEDIA_DOMAIN kosong (jalankan scripts/gen-env.sh)"
case "$LK_PUBLIC" in
  "wss://$MEDIA_DOMAIN") ok "LIVEKIT_PUBLIC_URL cocok dengan MEDIA_DOMAIN" ;;
  *) bad "LIVEKIT_PUBLIC_URL ($LK_PUBLIC) TIDAK sama dengan wss://$MEDIA_DOMAIN" ;;
esac
if grep -q '__LIVEKIT_API_SECRET__\|__REDIS_PASSWORD__\|__NODE_IP__' deploy/livekit.yaml deploy/egress.yaml 2>/dev/null; then
  bad "deploy/livekit.yaml atau egress.yaml masih berisi placeholder __..__ (gen-env.sh belum dijalankan)"
else ok "livekit.yaml/egress.yaml sudah terisi rahasia"; fi
YKEY=$(grep -E '^  [A-Za-z0-9_-]+:' deploy/livekit.yaml | head -1 | sed 's/^  //; s/:.*//')
YSEC=$(grep -E '^  [A-Za-z0-9_-]+:' deploy/livekit.yaml | head -1 | sed 's/.*: *//')
[ "$YKEY" = "$LK_KEY" ] && ok "API key cocok ($YKEY)" || bad "keys di livekit.yaml ($YKEY) != LIVEKIT_API_KEY ($LK_KEY)"
[ "$YSEC" = "$LK_SECRET" ] && ok "API secret cocok" || bad "secret di livekit.yaml != LIVEKIT_API_SECRET di .env"

hdr "2. DNS kedua domain"
PUB=$(curl -4 -s --max-time 8 https://api.ipify.org || echo '?')
echo "  IP publik server: $PUB"
for d in "$APP_DOMAIN" "$MEDIA_DOMAIN"; do
  [ -n "$d" ] || continue
  IPS=$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  if [ -z "$IPS" ]; then bad "$d TIDAK punya record A (ini penyebab paling umum!)"
  elif echo "$IPS" | grep -q "$PUB"; then ok "$d -> $IPS"
  else warn "$d -> $IPS  (berbeda dari IP keluar server $PUB; server di belakang NAT)"; fi
done
# IP MASUK = yang dihubungi browser; inilah yang harus diumumkan LiveKit, bukan IP keluar.
INBOUND=$(getent ahostsv4 "$APP_DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)

hdr "3. Container & port yang mendengarkan"
docker compose -f deploy/docker-compose.yml --env-file .env ps 2>/dev/null || docker ps --format '  {{.Names}}\t{{.Status}}'
echo "  -- listening --"
(ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null) | grep -E ':(80|443|3000|6379|7880|7881|3478)\b' | sed 's/^/  /'

hdr "4. LiveKit lokal"
if curl -s --max-time 5 http://127.0.0.1:7880/ | grep -qi ok; then ok "http://127.0.0.1:7880 merespons"
else bad "LiveKit tidak merespons di 127.0.0.1:7880 (cek: docker compose logs livekit)"; fi
echo "  -- IP yang diumumkan LiveKit ke browser (nodeIP / NAT1To1) --"
docker compose -f deploy/docker-compose.yml --env-file .env logs livekit 2>/dev/null | grep -iE 'external ip|nodeIP|NAT1To1|starting LiveKit' | tail -6 | sed 's/^/  /'
NODEIP=$(docker compose -f deploy/docker-compose.yml --env-file .env logs livekit 2>/dev/null | grep -o '"nodeIP": "[^"]*"' | tail -1 | cut -d'"' -f4)
if [ -n "$NODEIP" ]; then
  if [ "$NODEIP" = "$INBOUND" ]; then ok "nodeIP = IP yang dihubungi browser ($NODEIP)"
  else
    bad "nodeIP=$NODEIP TAPI browser menghubungi $INBOUND -> kandidat ICE menunjuk alamat yang salah."
    echo "       Perbaiki di deploy/livekit.yaml:  use_external_ip: false  +  node_ip: $INBOUND"
    echo "       lalu: docker compose -f deploy/docker-compose.yml --env-file .env restart livekit"
  fi
fi
echo "  -- port UDP yang dipakai LiveKit --"
grep -E '^\s*(udp_port|port_range_start|port_range_end):' deploy/livekit.yaml | sed 's/^/  /'

hdr "5. Jalur publik media (HTTPS/WSS lewat Caddy)"
if [ -n "$MEDIA_DOMAIN" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$MEDIA_DOMAIN/" 2>/dev/null)
  case "$CODE" in
    200) ok "https://$MEDIA_DOMAIN/ -> 200 (TLS + Caddy + LiveKit OK)" ;;
    000) bad "https://$MEDIA_DOMAIN/ tidak bisa dihubungi (DNS / sertifikat / firewall 443)" ;;
    *)   bad "https://$MEDIA_DOMAIN/ -> HTTP $CODE (seharusnya 200)" ;;
  esac
  UP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
       -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
       -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$MEDIA_DOMAIN/rtc" 2>/dev/null)
  [ "$UP" = "401" ] && ok "WebSocket /rtc diteruskan Caddy (401 tanpa token = normal)" || warn "/rtc -> HTTP $UP (harapan: 401)"
fi

hdr "6. Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi active; then
  ufw status 2>/dev/null | sed 's/^/  /'
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --list-all 2>/dev/null | sed 's/^/  /'
else
  echo "  (ufw/firewalld tidak aktif — cek juga security group cloud / firewall kampus)"
fi
echo "  Wajib terbuka/di-forward ke server ini:"
echo "    TCP 80, 443, 7881   |   UDP 443(HTTP3), 7882, 3478, 30000-31000"

hdr "7. Uji dari LUAR (jalankan di laptop, bukan di server)"
cat <<TXT
  TCP 443  : nc -vz  -w5 $INBOUND 443
  TCP 7881 : nc -vz  -w5 $INBOUND 7881
  UDP 7882 : nc -vzu -w5 $INBOUND 7882
  UDP 3478 : nc -vzu -w5 $INBOUND 3478
  Media    : curl -sS -o /dev/null -w '%{http_code}
' https://$MEDIA_DOMAIN/
  Browser  : buka https://$APP_DOMAIN , masuk meeting, F12 -> Console & Network.
             Catat error berwarna merah dan status koneksi wss://$MEDIA_DOMAIN/rtc
TXT
echo
