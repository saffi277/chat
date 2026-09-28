#!/bin/sh
# يشغل كل النظام ويطبع رابط https تفتحه من الموبايل.
#   ./start.sh          ← ويا رابط https مؤقت
#   ./start.sh local    ← بس على http://localhost
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  secret=$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 50)
  pass=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$secret|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pass|" .env
  echo "✔ سويت ملف .env بمفاتيح عشوائية"
fi
if [ "$1" = "local" ]; then
  docker compose up -d --build
  echo "✔ افتح: http://localhost"
  exit 0
fi
docker compose --profile tunnel up -d --build
echo "ننتظر الرابط..."
for i in $(seq 1 60); do
  url=$(docker compose logs tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
  [ -n "$url" ] && break
  sleep 2
done
echo ""
echo "================================================"
echo "  افتح هذا الرابط من الموبايل أو أي جهاز:"
echo "  $url"
echo "================================================"
