# دليل التعلّم — شنو صار داخل النظام

كل مفهوم من خطة المقابلة، شرح قصير + وين تلكاه بالكود.

## 1. الرحلة الكاملة لرسالة

```
Frontend → Request → API → Backend → Database → Response → Frontend
```
مثال "فتح محادثة ويا سارة":
1. تضغط على اسمها → `openWith()` في `frontend/app/chat/page.tsx`
2. `api("/conversations/", "POST", {user_id: 2})` في `frontend/lib/api.ts` يبني **Request**
3. Django يطابق الرابط في `backend/chat/urls.py` → الدالة `conversations()` في `backend/chat/views.py`
4. الدالة تسأل الـ **Database** (هل اكو محادثة؟ إذا لا تنشئ وحدة)
5. ترجع **Response** بصيغة JSON وكود 201 أو 200
6. الواجهة تحفظه بـ `setActive(...)` والشاشة تتحدث

## 2. HTTP و Request / Response
- **Request** يتكون من: Method + URL + Headers + Body.
- **Response**: Status code + Headers + Body.
- أكواد مهمة: `200` تمام، `201` انخلق، `400` بياناتك غلط، `401` ما مسجل دخول، `404` مو موجود.
- بالكود: `fetch(...)` في `lib/api.ts` ، و `Response(..., status=...)` في `views.py`.

## 3. JSON
نص يمثل بيانات: `{"username": "ali", "id": 1}`.
- الواجهة: `JSON.stringify` (Object → نص) و `res.json()` (نص → Object).
- الـ Backend: الـ **Serializer** (`serializers.py`) يحول الموديل ↔ JSON ويتحقق من البيانات.

## 4. API و Methods
- `GET` جلب ، `POST` إضافة ، `PATCH/PUT` تعديل ، `DELETE` حذف.
- عدنا: `GET /messages/` نجيب، `POST /messages/` نضيف، `PATCH /read/` نعدل `is_read`.

## 5. Authentication (Token)
- التسجيل/الدخول يرجع `token`. نخزنه بـ `localStorage`.
- كل Request نضيف Header: `Authorization: Token abc123` → Django يعرف منو أنت (`request.user`).
- الباسورد ينحفظ **مشفّر (hash)** عبر `create_user`.

## 6. Database و SQL
الجداول (`models.py` → Django يحولها لجداول عبر `migrate`):
- `auth_user` (id, username, password)
- `accounts_profile` (id, user_id **FK**, is_online, last_seen)
- `chat_conversation` (id, created_at) + جدول وسيط `chat_conversation_participants` (Many-to-Many)
- `chat_message` (id, conversation_id **FK**, sender_id **FK**, content, created_at, is_read)

- **Primary Key**: `id` يميز كل صف.
- **Foreign Key**: `sender_id` يأشر على `auth_user.id`.

الـ ORM يكتب SQL بدالك. أمثلة مكافئة:
```sql
-- conv.messages.all()
SELECT * FROM chat_message WHERE conversation_id = 1 ORDER BY created_at;
-- Message.objects.create(...)
INSERT INTO chat_message (conversation_id, sender_id, content, created_at, is_read) VALUES (1, 1, 'هلو', now(), false);
-- mark_read
UPDATE chat_message SET is_read = true WHERE conversation_id = 1 AND sender_id != 2 AND is_read = false;
-- on_delete=CASCADE: حذف محادثة يحذف رسائلها
DELETE FROM chat_conversation WHERE id = 1;
```
جرب بنفسك: `cd backend && python manage.py dbshell` ثم `.tables` و `SELECT * FROM chat_message;`

## 7. ليش WebSocket؟
HTTP: الواجهة لازم **تطلب** حتى تاخذ. سارة ما تعرف اكو رسالة جديدة إلا إذا سوت Refresh (أو Polling كل ثانية = هدر).
WebSocket: اتصال **يبقى مفتوح** بالاتجاهين؛ السيرفر يدز الرسالة لحظة وصولها.

بالكود:
- الواجهة تفتح: `openSocket("/ws/chat/5/")` في `lib/socket.ts`
- `config/asgi.py` يوجه WebSocket إلى `chat/routing.py` → `ChatConsumer`
- `connect()` يتأكد من الـ token والعضوية، `receive_json()` يستلم الرسالة، يخزنها بالـ DB، ويبثها.

## 8. Channels و Groups
- **Channels** = مكتبة تخلي Django يفهم WebSocket.
- **Group** = غرفة. كل من فاتح المحادثة 5 ينضم لـ `chat_5`. `group_send` يوصل لكل الغرفة.
- **Channel layer** = البريد بين الاتصالات (InMemory للتطوير، Redis للإنتاج مع أكثر من سيرفر).
- `presence` غرفة عامة للـ online/offline، و `user_{id}` غرفة شخصية لتنبيه "وصلتك رسالة".

## 9. Frontend ↔ Backend (الخلاصة)
- البيانات القديمة (قائمة، رسائل سابقة) → **HTTP API**.
- الأحداث الحية (رسالة جديدة، يكتب، متصل، مقروء) → **WebSocket**.
- الأمان: كلاهما يستخدم نفس الـ token، والـ Backend يتأكد أنك مشارك بالمحادثة (غير ذلك 404 / يسد الاتصال).

## أسئلة مقابلة تجريبية
1. شنو الفرق بين `POST` و `PATCH`؟
2. ليش ما نخزن الباسورد نص عادي؟
3. شنو يصير لو المستخدم غير مسجل وطلب `/api/users/`؟ (401)
4. ليش استخدمنا WebSocket بدل Polling؟
5. شنو الـ Foreign Key بجدول الرسائل؟
6. ليش الـ token ينرسل بالرابط بالـ WebSocket مو بالـ Header؟
7. لو صار عدنا 3 سيرفرات، شنو نغير؟ (Redis channel layer + PostgreSQL)
