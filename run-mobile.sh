#!/usr/bin/env bash
# تشغيل النظام كاملاً على حاسوبك وفتحه من الهاتف عبر رابط https مؤقت (بلا Docker).
#
#   ./run-mobile.sh           ← يجهّز كل شيء، يشغّل الخادم والواجهة والنفق، ويطبع الرابط ورمز QR
#   ./run-mobile.sh --fast    ← يتخطى تثبيت المكتبات وبناء الواجهة (إن لم يتغير الكود)
#   ./run-mobile.sh --force   ← إن كان المنفذ 8000 أو 3000 مشغولاً بخادم سابق من هذا المشروع، يوقفه دون سؤال
#   (يمكن الجمع بينهما: ./run-mobile.sh --fast --force)
#
# الإيقاف: Ctrl+C (يوقف كل شيء معاً).
# لماذا https؟ المتصفحات لا تسمح بالمايكروفون والكاميرا والإشعارات إلا عبر اتصال آمن.
# ملاحظة: رسائل الطرفية بالإنجليزية لأن أغلب الطرفيات (ومنها طرفية VS Code) لا تعرض العربية من اليمين إلى اليسار.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.run"
mkdir -p "$LOGS" "$ROOT/.tools"
FAST=0; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --force) FORCE=1 ;;
    *) echo "Usage: ./run-mobile.sh [--fast] [--force]"; exit 2 ;;
  esac
done

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m! %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$1"; exit 1; }
# أي خطأ غير متوقع يُطبع مع رقم السطر بدل أن يخرج السكربت بصمت
trap 'printf "\n\033[1;31m✖ Unexpected error at line %s (logs: %s)\033[0m\n" "$LINENO" "$LOGS" >&2' ERR

command -v node >/dev/null || die "Node.js is not installed. Install it first: https://nodejs.org"
PY=python3; command -v $PY >/dev/null || die "Python 3 is not installed."

# ---------------------------------------------------------------- المنافذ: من يشغلها؟
port_busy() { (echo >"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# رقم البرنامج الذي يستمع على المنفذ (lsof أو ss أو fuser، أيها متوفر).
# يعيد فراغاً إن لم يُعرف (مثلاً: البرنامج لمستخدم آخر كـ root أو Docker، فلا نراه دون صلاحيات)
port_pid() {
  local pid=""
  if command -v lsof >/dev/null; then
    pid="$(lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$pid" ] && command -v ss >/dev/null; then
    pid="$(ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
  fi
  if [ -z "$pid" ] && command -v fuser >/dev/null; then
    pid="$(fuser "$1/tcp" 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "$pid"
}

# حاوية Docker تنشر هذا المنفذ؟ (من تشغيل سابق لـ deploy/start.sh)
docker_on_port() {
  command -v docker >/dev/null || return 0
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E ":$1->" | awk '{print $1}' | head -1 || true
}

# هل هو خادم سابق من هذا المشروع؟ (Django أو Next.js أو النفق، أو يعمل من داخل مجلد المشروع)
is_ours() {
  local pid=$1 args cwd
  args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$ROOT"* || "$args" == *"$ROOT"* ]] && return 0
  [[ "$args" =~ manage\.py\ runserver|daphne|uvicorn|gunicorn|next-server|next\ start|next\ dev|cloudflared ]]
}

free_port() {
  local port=$1 pid args
  port_busy "$port" || return 0
  pid="$(port_pid "$port")"
  if [ -z "$pid" ]; then
    local container
    container="$(docker_on_port "$port")"
    if [ -n "$container" ]; then
      die "Port $port is used by the Docker container '$container' (from deploy/start.sh). Stop it with: (cd deploy && docker compose down), then try again."
    fi
    die "Port $port is in use by a program owned by another user (e.g. root or Docker), so it can't be identified without admin rights.
  See what it is:   sudo lsof -i :$port
  Stop it:          sudo fuser -k $port/tcp
  Then run again:   ./run-mobile.sh --fast"
  fi
  args="$(ps -o args= -p "$pid" 2>/dev/null || echo '?')"
  warn "Port $port is in use by: $args (PID $pid)"
  if ! is_ours "$pid"; then
    die "That program is not part of this project, so it was left running. Stop it yourself ('kill $pid'), then try again."
  fi
  # خادم سابق من المشروع (غالباً runserver في طرفية أخرى أو تشغيل سابق لهذا السكربت)
  if [ $FORCE = 0 ]; then
    if [ -t 0 ]; then
      read -r -p "  It looks like an earlier server from this project. Stop it and continue? [Y/n] " answer
      [[ "${answer:-y}" =~ ^[Yy]$ ]] || die "Stopped. Free port $port and run again."
    else
      die "Run again with --force to stop it automatically."
    fi
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do port_busy "$port" || break; sleep 0.5; done
  if port_busy "$port"; then kill -9 "$pid" 2>/dev/null || true; sleep 1; fi
  port_busy "$port" && die "Could not free port $port."
  echo "  ✔ Stopped the old server on port $port"
}

# ---------------------------------------------------------------- 1) الخادم (Django)
say "Preparing the backend (Django)"
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
say "Preparing the frontend (Next.js)"
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
    say "Downloading the tunnel tool cloudflared (one time only)"
    case "$(uname -m)" in
      x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; armv7l) ARCH=arm ;; *) die "Unsupported CPU: $(uname -m)" ;;
    esac
    case "$(uname -s)" in
      Linux) curl -fsSL -o "$CF" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH" ;;
      Darwin) curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" | tar -xz -C "$ROOT/.tools" ;;
      *) die "On Windows use Docker (deploy/start.sh) or WSL." ;;
    esac
    chmod +x "$CF"
  fi
fi

# ---------------------------------------------------------------- 4) التشغيل
free_port 8000
free_port 3000

PIDS=()
cleanup() {
  printf '\n\033[1;33m■ Stopping everything...\033[0m\n'
  for p in ${PIDS[@]+"${PIDS[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# النفق أولاً: نحتاج رابطه قبل تشغيل الخادم (يُستخدم عنواناً للتواصل في توقيع الإشعارات، وخدمة Apple
# ترفض العناوين الوهمية). الأداة تنتظر حتى تعمل الواجهة على 3000، فلا مشكلة في تشغيلها قبلها.
say "Opening the tunnel (https link)"
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
  # بلا نفق نكمل على الشبكة المحلية فقط (من دون مايكروفون أو كاميرا أو إشعارات، لأنها تحتاج https)
  tail -3 "$LOGS/tunnel.log"
  kill $TUNNEL 2>/dev/null || true
  PIDS=()   # النفق متوقف: لا ننتظره في النهاية (وإلا توقف كل شيء فوراً)
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  URL="http://${IP:-YOUR-PC-IP}:3000"
  warn "Could not create the https link (check your internet). Continuing on your local Wi-Fi only: $URL (no microphone, camera or notifications)"
fi

say "Starting the backend on port 8000"
cd "$ROOT/backend"
# CSRF: نثق برابط النفق لنماذج لوحة الإدارة. VAPID_CONTACT: رابط الموقع نفسه عنواناً للتواصل مع خدمات الإشعارات
if [[ "$URL" == https://* ]]; then export VAPID_CONTACT="$URL"; fi
CSRF_TRUSTED_ORIGINS="https://*.trycloudflare.com" \
  python manage.py runserver 0.0.0.0:8000 --noreload >"$LOGS/backend.log" 2>&1 &
PIDS+=($!)

say "Starting the frontend on port 3000"
cd "$ROOT/frontend"
./node_modules/.bin/next start -p 3000 >"$LOGS/frontend.log" 2>&1 &
PIDS+=($!)

# ننتظر حتى تستجيب الواجهة والخادم
for _ in $(seq 1 30); do
  curl -fs -o /dev/null http://127.0.0.1:3000/login && curl -fs -o /dev/null http://127.0.0.1:8000/api/push/key/ && break
  sleep 1
done

if [[ "$URL" == https://* ]]; then WHERE="any network: Wi-Fi or mobile data"; else WHERE="same Wi-Fi as this computer only"; fi
cat <<EOF

======================================================================
  Open this link on your phone ($WHERE):

      $URL

  On this computer:   http://localhost:3000
  Admin panel:        $URL/admin
======================================================================
EOF
python - "$URL" <<'PY' 2>/dev/null || true
import sys, qrcode
q = qrcode.QRCode(border=1)
q.add_data(sys.argv[1])
print("  Or scan this code with your phone's camera:\n")
q.print_ascii(invert=True)
PY
cat <<EOF
  Notes:
  - The link is temporary: it changes on every run and works while this terminal is open.
  - iPhone: to get notifications, add the site to the Home Screen (Share → Add to Home Screen).
  - Logs: $LOGS/   |   Stop: Ctrl+C
EOF

# نبقى نعمل حتى يتوقف أحد الأجزاء أو يضغط المستخدم Ctrl+C
wait -n "${PIDS[@]}" || true
echo "One of the parts stopped. Check the logs in $LOGS/"
