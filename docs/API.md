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
- الصور: `frontend/public/brand/logo.png` (شعار الكلية؛ إذا ما موجود يطلع شعار مؤقت) و `logo-dark.png` (نسخة الليلي: داخل القوس أبيض والخط فاتح)، وصور الحرم الحقيقية `campus-day.webp` / `campus-night.webp` بألوانها الأصلية (مكبرة 4× بـ Real-ESRGAN، والليلية محاذية على النهارية بنفس القص والقياس).
- الألوان بـ `app/wasl.css` تحت `.portal[data-theme=...]`.

### 🌐 اللغة (العربية / English)
| الشيء | الطريقة |
|---|---|
| **نصوص الواجهة** | تُكتب بالعربية الفصحى داخل `t()`: ‏`t("المحادثات")`، وفي المكوّنات `const t = useT()` (يعيد الرسم عند تغيير اللغة). المتغيرات: ‏`t("آخر ظهور {time}", { time })` |
| **الترجمة الإنجليزية** | ‏`lib/i18n-en.ts` (المفتاح هو النص العربي). بعد إضافة نص: ‏`npm run i18n:check` يخبرك بما ينقصه ترجمة |
| **الاتجاه** | يتغير تلقائياً (`<html dir>`). استخدم الفئات المنطقية: ‏`ms-/me-` و`ps-/pe-` و`start-/end-` و`text-start` بدل `left/right` |
| **النص الذي يكتبه المستخدم** | ضع `dir="auto"` على الرسائل والأسماء، ليأخذ كل نص اتجاهه من محتواه |
| **حفظ الاختيار** | ‏`setLang("en")` + ‏`auth.updateMe({ language: "en" })` (يُحفظ في الحساب ويتبعه على أجهزته) |
| **رسائل الخادم** | الواجهة ترسل `Accept-Language` تلقائياً، فتعود أخطاء الخادم بلغة المستخدم. ترجماتها في `backend/locale/en/LC_MESSAGES/django.po` وبعد التعديل: ‏`python locale/compile.py` |
| **الإشعارات** | تصل كل مستلم بلغته المحفوظة في حسابه |

### 🔒 الجلسة والأمان (يهمك إذا تبني شاشة جديدة)
| الشي | شلون |
|---|---|
| **تسجيل الخروج** | `auth.logout()` ← `POST /api/auth/logout/` يمسح توكن هذا الجهاز، و `auth.logout(true)` ← `{"all": true}` يطلعه من كل الأجهزة |
| **التوكن** | يوصلك مرة وحدة بالدخول. السيرفر يحفظ الهاش مالته بس (SHA-256)، فإذا ضاع لازم دخول جديد |
| **روابط الملفات** (`file_url` بالرسائل والحالات) | موقّعة ومؤقتة (`?e=…&s=…`، تبقى 6-12 ساعة). استخدمها مثل ما هي ولا تحفظها للأبد: إذا انتهت، جيب الرسائل من جديد |
| **البحث عن الناس** | `users.list(q)` ← `GET /api/users/?q=&limit=50&offset=0`: جهات اتصالي أول، والبحث بالاسم أو الرقم الجامعي. ما نجيب كل الجامعة مرة وحدة |
| **إخفاء محتوى الإشعار** | `auth.updateMe({ hide_preview: true })`: الإشعار يطلع "رسالة جديدة" بس |
| **الأذونات** | `lib/permissions.ts`: `permState(name)`, `requestPerm(name)` (من ضغطة زر)، `permError(e, name)` رسالة عربية، `howToEnable(name)` خطوات حسب الجهاز |

---

## 🗺️ كل شاشة ← شنو تستخدم

| الشاشة | الدوال |
|---|---|
| **قائمة الرسائل** + تبويبات الكل/المجموعات/القنوات/المفضلة/غير مقروءة | `conversations.list("all" \| "groups" \| "channels" \| "favorites" \| "unread")` |
| البحث فوك القائمة | `conversations.list("all", q)` و `users.list(q)` (من أعرفهم فقط) |
| **جهات الاتصال** (من أضفتهم أنا) | `contacts.list()` ← `User[]` مع `is_contact: true` |
| **إضافة جهة اتصال** بمعرّف كامل | `users.find("S-2041")` للمعاينة (404 إن لم يوجد)، ثم `contacts.add({ identifier: "S-2041" })` |
| إضافة شخص أعرفه أصلاً (عضو مجموعة، أو راسلني) | `contacts.add({ user_id })` |
| إزالة من جهات الاتصال | `contacts.remove(userId)` (المحادثة تبقى) |
| **دليل القنوات** + بحث | `channels.list(q?)` ← `[{id, title, description, avatar, member_count, is_subscribed}]` |
| **قناة جديدة** (تدريسي/إداري فقط، وإلا 403) | `channels.create("إعلانات القسم", "وصف")` |
| اشتراك / إلغاء اشتراك | `channels.subscribe(id)` / `channels.unsubscribe(id)` |
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
| **رفع مع نسبة التقدّم** (مثل واتساب) | `messages.sendFile(id, file, { kind: "image", onProgress: (p) => ..., signal })`: `p` من 0 إلى 1، و`signal` لإلغاء الرفع |
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
- **الثيم** `me.theme`: لون التطبيق، مستقل عن الوضع: `default` (البنفسجي)، `green`، `blue`، `pink`، `orange`، `grey`. يُطبَّق على `data-accent`.
- **خلفية المحادثات** `me.wallpaper`: `doodles` (الافتراضية)، `plain`، `gradient`، `dots`، `campus` (صورة الكلية خافتة)، `none`. تُطبَّق على `data-wallpaper`.
  ولكل محادثة خلفيتها الخاصة (لي وحدي): `conversations.setPrefs(id, { wallpaper })`، و`""` = خلفية الثيم.
- كلها تُحفظ بـ `auth.updateMe({ theme, wallpaper })`، وصفحتها: الإعدادات ← الثيمات.

**شلون شغال:** `store.tsx` يحسب `light` أو `dark` من `me.mode`، و`App.tsx` يضع الثلاثة على `<div class="wasl" data-theme data-accent data-wallpaper>`.
وكل الألوان متغيرات (`--bg`, `--panel`, `--card`, `--tint`, `--text`, `--muted`, `--accent`, `--bubble-in/out`...) بـ `app/wasl.css`.

إذا تضيف شاشة جديدة: استخدم الكلاسات الجاهزة (`w-panel`, `w-card`, `w-tint`, `w-muted`, `w-accent`, `w-line`...) أو `var(--xxx)`، ولا تكتب لون ثابت، فتشتغل بالوضعين تلقائياً.

---

## 👥 جهات الاتصال: لا أحد يرى كل حسابات الجامعة

- `GET /api/users/` يرجع **من أعرفهم فقط**: جهات اتصالي، ومن يشاركني محادثة ثنائية أو مجموعة، ومن أضافني.
- شخص جديد تصل إليه بمعرّف **كامل** تعرفه عنه: الرقم الجامعي، أو البريد، أو اسم المستخدم، أو رقم الهاتف
  (`07701234567` و `+9647701234567` الرقم نفسه). كتابة جزء منه لا تكفي، وعدد المحاولات 30 في الدقيقة.
- المراسلة، والإضافة إلى مجموعة، وملف الشخص، والحالات: كلها لمن أعرفهم فقط (غيرهم 404).
- عند الترقية: من كانت بينهما محادثة ثنائية صار كلٌّ منهما جهة اتصال للآخر تلقائياً.

## 📣 القنوات

- ينشئها **التدريسي والإداري** فقط. منشئها مشرفها، ويستطيع تعيين مشرفين آخرين **من التدريسيين والإداريين فقط**.
- **النشر للمشرفين فقط**: المشترك يقرأ ويتفاعل (❤️) ولا يرسل (الخادم يرد 403 عبر HTTP، ويتجاهل الإرسال عبر WebSocket).
- المشترك يرى المشرفين فقط، والمشرف يرى كل المشتركين. المشتركون لا يصبحون «معارف» لبعضهم.
- لا علامات قراءة ✓✓ في القناة، والإشعار يصل باسم القناة.
- في الواجهة: `conv.kind === "channel"`، و `conv.my_role === "admin"` يعني أنه يستطيع النشر.

---

## 📦 شكل البيانات (المهم منه)

### الرسالة `Message`
| الحقل | المعنى |
|---|---|
| `kind` | `text` `image` `video` `voice` `file` `location` `system` (رمادية بالنص) `call` (سجل مكالمة) |
| `content` | النص، أو التعليق على الصورة |
| `file_url` | مسار الملف: `mediaUrl(m.file_url)` |
| `file_name`, `file_size`, `duration` | للملفات والصوت/الفيديو (المدة بالثواني) |
| `width`, `height` | أبعاد الصورة أو الفيديو بالبكسل (أو `null`). يقرؤها الخادم من الصورة، ويرسلها المتصفح للفيديو (`width`/`height` مع الملف). تُستعمل لحجز مكان الوسائط بقياسها الصحيح قبل تحميلها |
| `latitude`, `longitude`, `is_live`, `live_until` | للموقع |
| `reply_to` | `{ sender_name, preview }` للفقاعة الصغيرة فوك الرد |
| `status` | `sent` ✓ ، `delivered` ✓✓ رمادي ، `read` ✓✓ أزرق |
| `is_deleted` | اعرض "🚫 تم حذف هذه الرسالة" |
| `edited_at` | إذا موجود اعرض "(معدّلة)" |
| `reactions` | `[{emoji, count, user_ids}]`: التفاعلات (تتحدث مباشرة بحدث `message_updated`) |

### المحادثة `Conversation`
| الحقل | المعنى |
|---|---|
| `kind` | `direct` (ثنائية)، `group`، `saved`، `channel` (قناة) |
| `title`, `avatar` | للمجموعة والمحفوظة. بالثنائية: اعرض الطرف الثاني من `participants` |
| `member_count`, `my_role` | "مجموعة • 12 عضواً"، وهل أني مشرف |
| `is_favorite`, `is_muted`, `is_archived`, `is_pinned` | إعداداتي |
| `muted_until` | الكتم لمدة: حتى متى (`null` = دائم). الكتم: `setPrefs(id, { is_muted: true, mute_hours: 8 })` |
| `wallpaper` | خلفية هذه المحادثة عندي (`""` = خلفية الثيم) |
| `disappear_after` | الرسائل المختفية بالثواني: `0` أو `86400` أو `604800` أو `7776000`. الرسالة الجديدة فيها `expires_at` |
| `only_admins_post`, `only_admins_edit`, `slow_mode` | إعدادات المجموعة (المشرف): `conversations.setSettings(id, {...})`. `slow_mode` بالثواني: 0، 10، 30، 60، 300، 900، 3600 |
| `can_post`, `can_edit_info` | أستطيع الإرسال؟ وتعديل الاسم والصورة؟ (اعرض خانة الكتابة حسب `can_post`) |
| `invite_code` | رابط الدعوة (للمشرف فقط، في `conversations.get`): الرابط `/chat?join=<code>` |
| `last_message`, `unread_count` | للسطر الثاني والرقم البنفسجي |

### إعدادات المحادثة والرسائل المجدولة ورابط الدعوة
| الطلب | ماذا يفعل |
|---|---|
| `messages.schedule(id, text, date, { silent? })` | جدولة رسالة نصية. يرسلها العامل الخلفي في وقتها (`backend/chat/worker.py`، كل 15 ثانية) |
| `messages.scheduled(id)` / `messages.cancelScheduled(sid)` | رسائلي المجدولة في المحادثة / إلغاء واحدة |
| `messages.sendText(id, text, replyTo, true)` أو `socket.send({type:"message", content, silent:true})` | **إرسال دون إشعار** |
| `conversations.createInvite(id)` / `revokeInvite(id)` | رابط دعوة جديد (يلغي القديم) / إلغاؤه |
| `invites.preview(code)` / `invites.join(code)` | معاينة المجموعة قبل الانضمام / الانضمام |
| رفض الإرسال | HTTP: ‏403 (المجموعة للمشرفين) أو 429 (الوضع البطيء). WebSocket: حدث `error` فيه `detail` و`message` |

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
| `call_left` | العام | غادر أحدهم المكالمة الجماعية: `group.peerLeft(user_id)` |
| `message_removed` | المحادثة | رسالة مختفية انتهت مدتها: احذفها من القائمة |
| `scheduled_changed` | العام | أُرسلت رسالتي المجدولة (أو تعذّر إرسالها): حدّث العدد |
| `error` | المحادثة | `rate_limited` أو `not_allowed` أو `slow_mode`، ومعه `message` بلغة المستخدم |
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
- **المكالمة الجماعية** (حتى 8 أشخاص): `GroupCall.start(convId, kind, meId, socket, handlers)` و`GroupCall.join(call, ...)`.
  كل مشارك يتصل بكل مشارك مباشرة (Mesh). من ينضم يأخذ `participants` من الخادم ويرسل عرضاً لكل واحد.
  المغادرة `group.leave()` (= `calls.leave(id)`): تبقى المكالمة لمن بقي، وتنتهي حين يغادر الأخير.
  الانضمام إلى مكالمة جارية: `calls.active(convId)` ثم `GroupCall.join`.
- **مشاركة الشاشة** (الحاسوب): `session.shareScreen()` / `stopScreen()` في المكالمتين: تحلّ الشاشة محل الكاميرا.
- ✅ جربنا المكالمة الجماعية بأربعة متصفحات: انضمام، ومغادرة، وانضمام متأخر، ومشاركة شاشة.
- ⚠️ بين شبكات مختلفة بالإنتاج نحتاج خادم TURN. والـ Mesh مناسب حتى 8 تقريباً؛ لأكثر من ذلك يلزم خادم وسائط (SFU).

---

## ⚠️ الأخطاء

الدالة `api()` ترمي:
- `ApiError` ويا `status` ورسالة عربية جاهزة للعرض (`err.message`)، مثل: 400 بيانات غلط، 403 مو مشرف، 404 مو موجود.
- `NetworkError` إذا السيرفر ما يرد.
- **429** = طلبات هواية بوقت قصير (حماية من الإغراق). الرسالة تطلع جاهزة، والمستخدم يعيد بعد شوية.

## 📏 الحدود
| الشي | الحد |
|---|---|
| صورة | 10 ميگا |
| فيديو | 50 ميگا |
| رسالة صوتية | 10 ميگا (`audio/*`، مثلاً webm من MediaRecorder) |
| ملف | 25 ميگا |
| الموقع المباشر | من دقيقة لحد 8 ساعات |
| الحالة | تختفي بعد 24 ساعة |
| طلبات عامة | 600 بالدقيقة لكل مستخدم (120 بدون دخول) |
| محاولات الدخول | 20 بالدقيقة لكل IP |
| إرسال الرسائل | 120 بالدقيقة لكل مستخدم |
| طلب مساعدة/نسيت كلمة المرور | 10 بالساعة |
