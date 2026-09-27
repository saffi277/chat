# دليل الـ API لمصمم الواجهة

> ✅ **الواجهة مبنية وجاهزة** بـ `frontend/app/chat/_ui/`، بالتصميم **الأساسي** (بنفسجي هادئ) بوضعين **نهاري وليلي**، ومربوطة بكل اللي تحت.
> الألوان كلها متغيرات بـ `frontend/app/wasl.css` (`[data-theme="light"]` و `[data-theme="dark"]`)،
> فأي تعديل بالشكل، أو ثيم جديد (زجاجي/بنفسجي بعدين)، يصير هناك بدون ما نلمس الشاشات.
>
> | الملف | الشاشة |
> |---|---|
> | `App.tsx` | الهيكل: عمودين بالكمبيوتر، شاشة وحدة بالموبايل |
> | `store.tsx` | البيانات المشتركة + الاتصال المباشر + المكالمات |
> | `ChatList.tsx` | قائمة المحادثات + التبويبات (الكل/غير مقروءة/المجموعات/المكالمات) + الشريط السفلي (الإعدادات/المكالمات/المحادثات/جهات الاتصال) |
> | `Conversation.tsx` / `Bubbles.tsx` / `Composer.tsx` | المحادثة، أشكال الرسائل، خانة الكتابة (صوت، صور، موقع) |
> | `Profiles.tsx` | ملف جهة الاتصال، معلومات المجموعة، الوسائط، الرسائل المميزة، مجموعة جديدة |
> | `Location.tsx` | مشاركة الموقع |
> | `Stories.tsx` | الحالات + العارض + النشر |
> | `Calls.tsx` | سجل المكالمات + شاشة المكالمة |
> | `People.tsx` / `Settings.tsx` | جهات الاتصال (زر ＋) / الإعدادات (فيها المظهر والحالات) |

كل شي بالواجهة إله API جاهز. **لا تكتب روابط بإيدك**: استخدم الدوال الجاهزة بـ
`frontend/lib/endpoints.ts`، وكل الأنواع (Types) بـ `frontend/lib/api.ts`.

```ts
import { conversations, messages, stories, calls, users, auth } from "@/lib/endpoints";
import { mediaUrl } from "@/lib/api";          // أي مسار صورة/ملف يرجع من السيرفر مرّره هنا
import { openSocket } from "@/lib/socket";     // الأحداث المباشرة
import { CallSession } from "@/lib/call";      // المكالمات
```

> 📌 الملفات اللي بـ `frontend/lib/` هي "الربط". صمّم براحتك بـ `app/`، وإذا احتجت شي من الـ API
> ما موجود هنا، گلّنا نضيفه بالباك اند بدل ما تعدل بـ `lib/`.

---

## 🔐 الدخول والتسجيل (بوابة كلية الأسباط الجامعة)

| الشي | الدالة |
|---|---|
| **الدخول** بالاسم أو البريد الجامعي أو الرقم الجامعي | `auth.login(identifier, password, role)`؛ إذا الدور ما يطابق يرجع 400 ويا `role` الصحيح |
| **حساب جديد** | `auth.register({ username, password, display_name, role, email, university_id })` |
| **نسيت كلمة المرور / الدعم الفني** | `auth.help({ kind: "password" \| "support", identifier, contact, message })` ← يوصل للإداري بـ `/admin` ← "طلبات المساعدة" |
| **تذكرني** | `saveSession(token, user, remember)`: مفعلة = localStorage، وبدونها sessionStorage |

- الأدوار: `student` طالب، `faculty` تدريسي، `staff` إداري (`ROLE_LABELS` بـ `lib/api.ts`). الدور يطلع للناس (`user.role`)، أما البريد والرقم الجامعي فخاصين (`me.email`, `me.university_id`).
- الإداري يغير كلمة مرور أي حساب من `/admin` ← Users ← الحساب ← "change password".
- الصور: `frontend/public/brand/logo.png` (شعار الكلية؛ إذا ما موجود يطلع شعار مؤقت) و `logo-dark.png` (نسخة الليلي: داخل القوس أبيض والخط فاتح)، وصور الحرم الحقيقية `campus-day.jpg` / `campus-night.jpg` بألوانها الأصلية.
- الألوان بـ `app/wasl.css` تحت `.portal[data-theme=...]`.

---

## 🗺️ كل شاشة ← شنو تستخدم

| الشاشة | الدوال |
|---|---|
| **قائمة الرسائل** + تبويبات الكل/المجموعات/المفضلة/غير مقروءة | `conversations.list("all" \| "groups" \| "favorites" \| "unread")` |
| البحث فوك القائمة | `conversations.list("all", q)` و `users.list(q)` |
| تثبيت 📌 / مفضلة / كتم / أرشفة | `conversations.setPrefs(id, { is_pinned: true })` (المثبتة تطلع أول) |
| **حذف المحادثة** (عندي بس) | `conversations.clear(id)`: تختفي لحد ما توصل رسالة جديدة |
| **تفاعل** ❤️ على رسالة | `messages.react(msgId, "❤️")` (نفس الإيموجي مرة ثانية = يشيله). `m.reactions = [{emoji, count, user_ids}]` |
| **الرسائل المميزة** ⭐ | `messages.star(msgId)` / `messages.unstar(msgId)` / `messages.starred(convId?)` |
| **الرسائل المحفوظة** | `conversations.saved()` ← محادثة عادية `kind: "saved"` |
| فتح محادثة ويا شخص | `conversations.openWith(userId)` |
| **شاشة المحادثة** | `messages.list(id)` (آخر 50)، وللأقدم `messages.list(id, oldestId)` |
| إرسال نص / رد على رسالة | `messages.sendText(id, "هلو", replyToId?)` |
| إرسال صورة/فيديو/ملف | `messages.sendFile(id, file, { caption })` |
| **رسالة صوتية** (الموجة + المدة) | `messages.sendFile(id, blob, { kind: "voice", duration: 24 })` |
| تعديل / حذف رسالة | `messages.edit(msgId, "نص")` / `messages.remove(msgId)` |
| قراءة المحادثة (✓✓ أزرق) | `conversations.markRead(id)` لما تفتحها |
| **مشاركة الموقع** + 15 دقيقة/ساعة/8 ساعات | `messages.sendLocation(id, lat, lng, 15 \| 60 \| 480, "تعليق")` |
| تحديث الموقع المباشر / إيقافه | `messages.updateLiveLocation(msgId, lat, lng)` / `messages.stopLiveLocation(msgId)` |
| **ملف جهة الاتصال** (الهاتف، المدينة، حول) | `users.get(userId)` |
| الوسائط المشتركة + العدد (248) | `conversations.media(id, "media" \| "file" \| "link" \| "voice")` ← `{counts, results}` |
| **إنشاء مجموعة** | `conversations.createGroup("رحلة إسطنبول", [ids])` |
| **معلومات المجموعة** + الأعضاء + المشرف | `conversations.get(id)`، `conversations.members(id)` |
| إضافة / إزالة عضو، تعيين مشرف | `addMembers`، `removeMember`، `setRole` |
| تعديل اسم/صورة المجموعة (المشرف) | `conversations.updateGroup(id, {title})`، `setGroupAvatar(id, file)` |
| مغادرة المجموعة | `conversations.leave(id)` |
| **الحالات/القصص** (الشريط الدائري) | `stories.feed()` ← مجمعة حسب الشخص، `all_seen` للحلقة الرمادية |
| تبويبات الحالات (الكل/الصور/الفيديو) | `stories.feed("image" \| "video")` |
| نشر حالة | `stories.postMedia(file, "تعليق")` أو `stories.postText("نص", "#5b5cf0")` |
| مشاهدة حالة (العدد 👁 1.2K) | `stories.markViewed(id)`، و `views_count` بكل حالة، و `stories.viewers(id)` لصاحبها |
| **سجل المكالمات** + الفائتة | `calls.log()` / `calls.log("missed")` |
| **شاشة المكالمة** (صوت/فيديو، كتم، سماعة، إنهاء) | `CallSession` (تحت) |
| **الإعدادات**: الاسم، الصورة، حول، الهاتف، المدينة | `auth.updateMe({...})`، `auth.setAvatar(file)` |
| **الوضع** (نهاري / ليلي / تلقائي) | `auth.updateMe({ mode: "light" \| "dark" \| "system" })` |
| الإشعارات | موجودة: `PushToggle` و `PushBanner` بـ `app/chat/_ui/Settings.tsx` |

---

## 🎨 الوضع (نهاري/ليلي) والثيم: شيئين مختلفين

- **الوضع** `me.mode`: `light` نهاري، `dark` ليلي، `system` تلقائي حسب الجهاز (الافتراضي). مو ثيم، بس نهار وليل لنفس التصميم.
- **الثيم** `me.theme`: شكل التطبيق. هسه بس `default` (الأساسي البنفسجي). الثيمات الثانية (زجاجي...) تنضاف بعدين.

**شلون شغال:** `store.tsx` يحسب `light` أو `dark` من `me.mode` ويحطها على `<div class="wasl" data-theme="...">`.
وكل الألوان متغيرات (`--bg`, `--panel`, `--card`, `--tint`, `--text`, `--muted`, `--accent`, `--bubble-in/out`...) بـ `app/wasl.css`.

إذا تضيف شاشة جديدة: استخدم الكلاسات الجاهزة (`w-panel`, `w-card`, `w-tint`, `w-muted`, `w-accent`, `w-line`...) أو `var(--xxx)`، ولا تكتب لون ثابت، فتشتغل بالوضعين تلقائياً.

---

## 📦 شكل البيانات (المهم منه)

### الرسالة `Message`
| الحقل | المعنى |
|---|---|
| `kind` | `text` `image` `video` `voice` `file` `location` `system` (رمادية بالنص) `call` (سجل مكالمة) |
| `content` | النص، أو التعليق على الصورة |
| `file_url` | مسار الملف: `mediaUrl(m.file_url)` |
| `file_name`, `file_size`, `duration` | للملفات والصوت/الفيديو (المدة بالثواني) |
| `latitude`, `longitude`, `is_live`, `live_until` | للموقع |
| `reply_to` | `{ sender_name, preview }` للفقاعة الصغيرة فوك الرد |
| `status` | `sent` ✓ ، `delivered` ✓✓ رمادي ، `read` ✓✓ أزرق |
| `is_deleted` | اعرض "🚫 تم حذف هذه الرسالة" |
| `edited_at` | إذا موجود اعرض "(معدّلة)" |
| `reactions` | `[{emoji, count, user_ids}]`: التفاعلات (تتحدث مباشرة بحدث `message_updated`) |

### المحادثة `Conversation`
| الحقل | المعنى |
|---|---|
| `kind` | `direct` (ثنائية)، `group`، `saved` |
| `title`, `avatar` | للمجموعة والمحفوظة. بالثنائية: اعرض الطرف الثاني من `participants` |
| `member_count`, `my_role` | "مجموعة • 12 عضواً"، وهل أني مشرف |
| `is_favorite`, `is_muted`, `is_archived`, `is_pinned` | إعداداتي |
| `last_message`, `unread_count` | للسطر الثاني والرقم البنفسجي |

---

## ⚡ الأحداث المباشرة (WebSocket)

**اتصالين:**
- `openSocket("/ws/presence/", ...)`: **مفتوح دائماً** طول ما التطبيق مفتوح.
- `openSocket("/ws/chat/<id>/", ...)`: بس للمحادثة المفتوحة.

| الحدث | وين | شنو تسوي |
|---|---|---|
| `message` | المحادثة | ضيف الرسالة |
| `message_updated` | المحادثة | بدّل الرسالة بنفس الـ id (تعديل/حذف/موقع تحرك) |
| `typing` | المحادثة | "يكتب الآن..." |
| `delivered` / `read` | المحادثة | حدّث علامات ✓✓ للرسائل اللي `id <= message_id` |
| `inbox` | العام | رسالة بأي محادثة: حدّث القائمة |
| `presence` | العام | النقطة الخضرة |
| `conversation_updated` | العام | اسم/صورة/أعضاء مجموعة تغيروا: `conversations.get(id)` |
| `story` / `story_viewed` | العام | حالة جديدة (حدّث الشريط) / أحد شاف حالتك |
| `call_incoming` | العام | اعرض شاشة المكالمة الواردة |
| `call_answered` / `call_ended` | العام | الطرف رد / المكالمة خلصت |
| `call.signal` | العام | مرره لـ `session.handleSignal(e.data)` |

إرسال بالـ WebSocket: `socket.send({ type: "message", content, reply_to? })` و `socket.send({ type: "typing" })`.
الملفات والموقع دائماً بـ HTTP (`messages.sendFile` / `sendLocation`).

---

## 📞 المكالمات

```ts
// المتصل
const s = await CallSession.start(conversationId, "video", peerUserId, presenceSocket, {
  onLocalStream: (st) => (myVideo.srcObject = st),
  onRemoteStream: (st) => (theirVideo.srcObject = st),
  onState: (state) => setStatus(state), // "connected" = بدت المكالمة
});
// بحدث call_answered و e.user_id مو أنا (يعني الطرف الثاني رد):   s.onAnswered()

// المستلم، بحدث call_incoming لما يضغط "رد":
const s = await CallSession.accept(e.call, presenceSocket, { ... });
// أو يرفض:  calls.decline(e.call.id)

// الطرفين:
//   حدث call.signal لهاي المكالمة  ← s.handleSignal(e.data)
//   حدث call_ended                ← s.close()
s.toggleMute(); s.toggleCamera(); await s.hangup();
```
- إذا ما حدا رد خلال دقيقة، المكالمة تصير **فائتة**.
- كل مكالمة تنسجل رسالة بالمحادثة مثل "مكالمة فيديو • 2:15".
- ✅ جربناها بين متصفحين: اتصلوا، وانتقل صوت وصورة بالاتجاهين.
- ⚠️ حالياً بين **شخصين** بس (مكالمات المجموعة مرحلة جاية). وبين شبكات مختلفة بالإنتاج نحتاج خادم TURN.

---

## ⚠️ الأخطاء

الدالة `api()` ترمي:
- `ApiError` ويا `status` ورسالة عربية جاهزة للعرض (`err.message`)، مثل: 400 بيانات غلط، 403 مو مشرف، 404 مو موجود.
- `NetworkError` إذا السيرفر ما يرد.

## 📏 الحدود
| الشي | الحد |
|---|---|
| صورة | 10 ميگا |
| فيديو | 50 ميگا |
| رسالة صوتية | 10 ميگا (`audio/*`، مثلاً webm من MediaRecorder) |
| ملف | 25 ميگا |
| الموقع المباشر | من دقيقة لحد 8 ساعات |
| الحالة | تختفي بعد 24 ساعة |
