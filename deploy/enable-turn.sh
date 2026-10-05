#!/bin/sh
# يفعّل خادم ترحيل المكالمات (TURN) على السيرفر نفسه، بأمر واحد:   ./enable-turn.sh
# بدونه تنجح المكالمة بين جهازين على الشبكة نفسها فقط، وتبقى «جارٍ الاتصال» بين شبكتين مختلفتين
# (مثلاً هاتف على بيانات الجوال وحاسوب على واي فاي).
#
# ما يفعله:
#   1) يضع في .env سرّاً عشوائياً (TURN_SECRET) وعنوان السيرفر (TURN_URLS)، إن لم يكونا موجودين.
#   2) يفتح المنافذ في جدار الحماية (ufw) إن كان مفعّلاً.
#   3) يشغّل خادم TURN (coturn)، ويعيد تشغيل الخادم ليقرأ الإعدادات الجديدة.
# عنوان السيرفر يُكتشف وحده؛ ولتحديده بنفسك:   TURN_HOST=1.2.3.4 ./enable-turn.sh
set -e
cd "$(dirname "$0")"
[ -f .env ] || { echo "✖ لا يوجد ملف .env: شغّل ./start.sh أولاً"; exit 1; }

has() { grep -q "^$1=." .env; }
set_env() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}

if ! has TURN_SECRET; then
  set_env TURN_SECRET "$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48)"
  echo "✔ TURN_SECRET: سرّ عشوائي جديد"
fi

if ! has TURN_URLS || [ -n "$TURN_HOST" ]; then
  host="$TURN_HOST"
  [ -n "$host" ] || host=$(curl -s --max-time 5 https://api.ipify.org || true)
  [ -n "$host" ] || host=$(hostname -I 2>/dev/null | awk '{print $1}')
  case "$host" in
    ''|*[!0-9a-zA-Z.:-]*) echo "✖ تعذّر معرفة عنوان السيرفر. حدده بنفسك:  TURN_HOST=1.2.3.4 ./enable-turn.sh"; exit 1 ;;
  esac
  set_env TURN_URLS "turn:$host:3478?transport=udp,turn:$host:3478?transport=tcp"
  echo "✔ TURN_URLS: $host"
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 3478/udp >/dev/null && ufw allow 3478/tcp >/dev/null && ufw allow 49160:49200/udp >/dev/null
  echo "✔ فُتحت المنافذ في جدار الحماية: 3478 (UDP وTCP) و49160-49200 (UDP)"
fi

[ "$DRY_RUN" = 1 ] && { echo "(تجربة: لم يُشغَّل Docker)"; exit 0; }
docker compose --profile tunnel --profile turn up -d --build
echo ""
echo "✔ خادم المكالمات يعمل. إن كان لشركة الاستضافة جدار حماية في لوحة التحكم، افتح فيه أيضاً:"
echo "   3478 (UDP وTCP) و49160-49200 (UDP)"
echo "   وللتحديث بعد اليوم:  docker compose --profile tunnel --profile turn up -d --build"
