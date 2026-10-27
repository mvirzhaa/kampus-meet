#!/bin/sh
# Membuat file .env dengan rahasia acak. Pemakaian: sh scripts/gen-env.sh meet.kampus.ac.id media.meet.kampus.ac.id
set -e
APP=${1:?domain aplikasi, mis. meet.uika-bogor.ac.id}
MEDIA=${2:?domain media, mis. media.meet.uika-bogor.ac.id}
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
for f in deploy/livekit.yaml deploy/egress.yaml; do
  sed -i -e "s#__LIVEKIT_API_SECRET__#$SECRET#" -e "s#__REDIS_PASSWORD__#$REDISPW#" "$f"
  chmod 600 "$f"
done
# Folder MP4 sementara, dipakai bersama oleh Egress (menulis) dan aplikasi (mengunggah lalu menghapus)
mkdir -p recordings && chmod 777 recordings
chmod 600 .env
echo "File .env dibuat. Periksa APP_NAME, CAMPUS_NAME, ALLOWED_EMAIL_DOMAINS, lalu isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET."
