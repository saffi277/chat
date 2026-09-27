# دليل الـ API لمصمم الواجهة

> ✅ **الواجهة مبنية وجاهزة** بـ `frontend/app/chat/_ui/`، بالنموذجين (الزجاجي والداكن)، ومربوطة بكل اللي تحت.
> الألوان كلها متغيرات بـ `frontend/app/wasl.css` (`[data-theme="glass"]` و `[data-theme="dark"]`)،
> فأي تعديل بالشكل يصير هناك بدون ما نلمس الشاشات.
>
> | الملف | الشاشة |
> |---|---|
> | `App.tsx` | الهيكل: عمودين بالكمبيوتر، شاشة وحدة بالموبايل |
> | `store.tsx` | البيانات المشتركة + الاتصال المباشر + المكالمات |
> | `ChatList.tsx` | قائمة الرسائل + التبويبات + الشريط السفلي العائم |
> | `Conversation.tsx` / `Bubbles.tsx` / `Composer.tsx` | المحادثة، أشكال الرسائل، خانة الكتابة (صوت، صور، موقع) |
> | `Profiles.tsx` | ملف جهة الاتصال، معلومات المجموعة، الوسائط، مجموعة جديدة |
> | `Location.tsx` | مشاركة الموقع |
> | `Stories.tsx` | الحالات + العارض + النشر |
> | `Calls.tsx` | سجل المكالمات + شاشة المكالمة |
> | `People.tsx` / `Settings.tsx` | جهات الاتصال / الإعدادات |

كل شي بالنموذجين (الزجاجي والداكن) إله API جاهز. **لا تكتب روابط بإيدك**: استخدم الدوال الجاهزة بـ
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

## 🗺️ كل شاشة ← شنو تستخدم

| الشاشة (بالنموذجين) | الدوال |
|---|---|
| **قائمة الرسائل** + تبويبات الكل/المجموعات/المفضلة/غير مقروءة | `conversations.list("all" \| "groups" \| "favorites" \| "unread")` |
| البحث فوك القائمة | `conversations.list("all", q)` و `users.list(q)` |
| نجمة المفضلة / كتم / أرشفة | `conversations.setPrefs(id, { is_favorite: true })` |
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
| **اختيار النموذج** (الزجاجي / الداكن) | `auth.updateMe({ theme: "glass" \| "dark" \| "system" })` |
| الإشعارات | موجودة: `PushToggle` و `PushBanner` بـ `app/chat/ui.tsx` |

---

## 🎨 النموذجين سوه

المستخدم يختار شكله، وينحفظ بحسابه (`me.theme`)، فيتبعه على كل أجهزته:

| القيمة | الشكل |
|---|---|
| `glass` | النموذج الزجاجي الحديث (فاتح) |
| `dark` | النموذج الداكن الفاخر |
| `system` | حسب إعداد الجهاز (فاتح/داكن) |

**هسه شغال هيچ:** صفحة الشات تضيف الكلاس `dark-theme` على `<main>` إذا المستخدم اختار الداكن
(أو "حسب الجهاز" والجهاز داكن). وكل ستايل النموذج الداكن موجود بـ `app/globals.css` تحت `.dark-theme`.
الاختيار من نافذة "ملفي الشخصي" ← "🎨 شكل التطبيق"، وينحفظ بالحساب.

إذا تضيف شاشة جديدة: صممها بالشكل الفاتح (الزجاجي)، وضيف ألوانها الداكنة تحت `.dark-theme` بـ `globals.css`.

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

### المحادثة `Conversation`
| الحقل | المعنى |
|---|---|
| `kind` | `direct` (ثنائية)، `group`، `saved` |
| `title`, `avatar` | للمجموعة والمحفوظة. بالثنائية: اعرض الطرف الثاني من `participants` |
| `member_count`, `my_role` | "مجموعة • 12 عضواً"، وهل أني مشرف |
| `is_favorite`, `is_muted`, `is_archived` | إعداداتي |
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
