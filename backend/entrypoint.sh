#!/bin/sh
# الصورة وحدة وتشتغل بدورين:
#   web → الـ API (gunicorn): ينتظر قاعدة البيانات، migrate، ويشتغل
#   ws  → الاتصالات المباشرة (uvicorn)
set -e
ROLE=${1:-web}
until python -c "import django,os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');django.setup();from django.db import connection;connection.ensure_connection()" 2>/dev/null; do
  echo "ننتظر قاعدة البيانات..."; sleep 2
done
export RESET_PRESENCE_ON_START=0
CPUS=$(nproc)
if [ "$ROLE" = "web" ]; then
  python manage.py migrate --noinput
  python manage.py reset_presence
  python manage.py encrypt_existing_files   # ملفات قديمة قبل التشفير (إذا اكو)
  # كل عملية بيها threads: عشرات الطلبات بنفس اللحظة حتى لو واحد ينتظر قاعدة البيانات
  exec gunicorn config.wsgi:application --bind 0.0.0.0:8001 \
    --worker-class gthread --workers "${WEB_WORKERS:-$(( CPUS * 2 ))}" --threads "${WEB_THREADS:-16}" \
    --timeout 60 --keep-alive 30 --max-requests 5000 --max-requests-jitter 500 --access-logfile -
else
  exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --workers "${WS_WORKERS:-$(( CPUS * 2 ))}" \
    --proxy-headers --forwarded-allow-ips='*' --ws-max-size 1048576 --timeout-keep-alive 30
fi
