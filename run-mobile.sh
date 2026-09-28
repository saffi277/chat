#!/usr/bin/env bash
# تشغيل النظام كاملاً على حاسوبك وفتحه من الهاتف عبر رابط https مؤقت (بلا Docker).
#
#   ./run-mobile.sh          ← يجهّز كل شيء، يشغّل الخادم والواجهة والنفق، ويطبع الرابط ورمز QR
#   ./run-mobile.sh --fast   ← يتخطى تثبيت المكتبات وبناء الواجهة (إن لم يتغير الكود)
#
# الإيقاف: Ctrl+C (يوقف كل شيء معاً).
# لماذا https؟ المتصفحات لا تسمح بالمايكروفون والكاميرا والإشعارات إلا عبر اتصال آمن.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.run"
mkdir -p "$LOGS" "$ROOT/.tools"
FAST=0; [ "${1:-}" = "--fast" ] && FAST=1

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1"; exit 1; }

command -v node >/dev/null || die "Node.js غير مثبت. ثبّته أولاً: https://nodejs.org"
PY=python3; command -v $PY >/dev/null || die "Python 3 غير مثبت."

# ---------------------------------------------------------------- 1) الخادم (Django)
say "تجهيز الخادم (Django)"
cd "$ROOT/backend"
[ -d .venv ] || $PY -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
if [ $FAST = 0 ]; then
  pip install -q --upgrade pip
  pip install -q -r requirements.txt qrcode
fi
python manage.py migrate --noinput

# ---------------------------------------------------------------- 2) الواجهة (Next.js)
say "تجهيز الواجهة (Next.js)"
cd "$ROOT/frontend"
if [ $FAST = 0 ] || [ ! -d .next ]; then
  [ -d node_modules ] || npm install
  npm run build
fi

# ---------------------------------------------------------------- 3) أداة النفق (cloudflared)
CF="$(command -v cloudflared || true)"
if [ -z "$CF" ]; then
  CF="$ROOT/.tools/cloudflared"
  if [ ! -x "$CF" ]; then
    say "تنزيل أداة النفق cloudflared (مرة واحدة فقط)"
    case "$(uname -m)" in
      x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; armv7l) ARCH=arm ;; *) die "معالج غير مدعوم: $(uname -m)" ;;
    esac
    case "$(uname -s)" in
      Linux) curl -fsSL -o "$CF" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH" ;;
      Darwin) curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" | tar -xz -C "$ROOT/.tools" ;;
      *) die "على Windows استخدم Docker (deploy/start.sh) أو WSL." ;;
    esac
    chmod +x "$CF"
  fi
fi

# ---------------------------------------------------------------- 4) التشغيل
PIDS=()
cleanup() {
  printf '\n\033[1;33m■ إيقاف كل شيء...\033[0m\n'
  for p in ${PIDS[@]+"${PIDS[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for port in 8000 3000; do
  if (echo >/dev/tcp/127.0.0.1/$port) 2>/dev/null; then die "المنفذ $port مشغول. أوقف البرنامج الذي يستخدمه ثم أعد المحاولة."; fi
done

say "تشغيل الخادم على المنفذ 8000"
cd "$ROOT/backend"
# الرابط المؤقت يتبع trycloudflare.com: نثق به لنماذج لوحة الإدارة (CSRF)
CSRF_TRUSTED_ORIGINS="https://*.trycloudflare.com" \
  python manage.py runserver 0.0.0.0:8000 --noreload >"$LOGS/backend.log" 2>&1 &
PIDS+=($!)

say "تشغيل الواجهة على المنفذ 3000"
cd "$ROOT/frontend"
./node_modules/.bin/next start -p 3000 >"$LOGS/frontend.log" 2>&1 &
PIDS+=($!)

say "فتح النفق (رابط https)"
: >"$LOGS/tunnel.log"
"$CF" tunnel --no-autoupdate --url http://127.0.0.1:3000 >"$LOGS/tunnel.log" 2>&1 &
TUNNEL=$!
PIDS+=($TUNNEL)

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 $TUNNEL 2>/dev/null || break   # توقفت الأداة (مثلاً: لا إنترنت، أو جدار ناري يحجب Cloudflare)
  sleep 1
done
if [ -z "$URL" ]; then
  tail -3 "$LOGS/tunnel.log"
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  die "تعذّر إنشاء رابط https (تحقق من الإنترنت). بديل مؤقت على نفس شبكة الواي فاي: http://${IP:-IP-الحاسوب}:3000 (من دون مايكروفون أو كاميرا أو إشعارات)"
fi

# ننتظر حتى تجيب الواجهة والخادم
for _ in $(seq 1 30); do
  curl -fs -o /dev/null http://127.0.0.1:3000/login && curl -fs -o /dev/null http://127.0.0.1:8000/api/push/key/ && break
  sleep 1
done

cat <<EOF

======================================================================
  افتح هذا الرابط من الهاتف (أي شبكة: واي فاي أو بيانات الجوال):

      $URL

  على الحاسوب نفسه:       http://localhost:3000
  لوحة الإدارة:            $URL/admin
======================================================================
EOF
python - "$URL" <<'PY' 2>/dev/null || true
import sys, qrcode
q = qrcode.QRCode(border=1)
q.add_data(sys.argv[1])
print("  أو امسح هذا الرمز بكاميرا الهاتف:\n")
q.print_ascii(invert=True)
PY
cat <<EOF
  ملاحظات:
  - الرابط مؤقت: يتغير في كل تشغيل، ويعمل ما دام هذا الطرفية مفتوحة.
  - الأيفون: لتصلك الإشعارات أضف الموقع إلى الشاشة الرئيسية (زر المشاركة ← إضافة إلى الشاشة الرئيسية).
  - السجلات: $LOGS/   |   للإيقاف: Ctrl+C
EOF

# نبقى نعمل حتى يتوقف أحدها أو يضغط المستخدم Ctrl+C
wait -n "${PIDS[@]}"
echo "توقف أحد الأجزاء. راجع السجلات في $LOGS/"
