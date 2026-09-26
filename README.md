# شات — Django + Next.js

تطبيق محادثات فوري: تسجيل دخول، قائمة مستخدمين، محادثات، رسائل مباشرة بدون Refresh (WebSocket)، حالة متصل/غير متصل، "يكتب..."، وعلامة مقروء ✓✓.

![screenshot](docs/screenshot.png)

## التشغيل

**Backend** (بورت 8000):
```bash
python3 -m venv .venv && source .venv/bin/activate
cd backend
pip install -r requirements.txt
python manage.py migrate
daphne -p 8000 config.asgi:application
```

**Frontend** (بورت 3000):
```bash
cd frontend
npm install
npm run dev
```
افتح http://localhost:3000 بمتصفحين (واحد منهم Incognito) وسجل مستخدمين وجرب.

**الاختبارات:** `cd backend && python manage.py test`

## الهيكل

```
backend/
  config/settings.py    الإعدادات (DRF, Channels, CORS)
  config/asgi.py        يوزع: HTTP → Django ، WebSocket → Channels
  accounts/             التسجيل، الدخول، قائمة المستخدمين، Profile (online)
  chat/models.py        جداول Conversation و Message
  chat/views.py         الـ REST API للمحادثات والرسائل
  chat/consumers.py     الـ WebSocket (رسائل مباشرة + الحضور)
  chat/services.py      حفظ الرسالة + تنبيه المشاركين (مشترك بين API و WS)
frontend/
  lib/api.ts            كل Requests للـ Backend
  lib/socket.ts         فتح اتصال WebSocket
  app/login, register   صفحات الدخول
  app/chat/page.tsx     واجهة الشات
docs/LEARN.md           شرح المفاهيم مربوط بالكود
```

## الـ API

| Method | Endpoint | الوظيفة |
|---|---|---|
| POST | `/api/auth/register/` | تسجيل → يرجع token |
| POST | `/api/auth/login/` | دخول → يرجع token |
| GET | `/api/auth/me/` | معلوماتي |
| GET | `/api/users/` | قائمة المستخدمين |
| GET | `/api/conversations/` | محادثاتي (مع آخر رسالة وعدد غير المقروء) |
| POST | `/api/conversations/` | `{"user_id": 2}` فتح/جلب محادثة |
| GET | `/api/conversations/{id}/messages/` | الرسائل السابقة |
| POST | `/api/conversations/{id}/messages/` | إرسال رسالة (بديل HTTP) |
| PATCH | `/api/conversations/{id}/read/` | تعليم الرسائل كمقروءة |

WebSocket: `ws://localhost:8000/ws/chat/{id}/?token=...` و `ws://localhost:8000/ws/presence/?token=...`
