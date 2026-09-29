import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errs = []; const ok = (m) => console.log('✅', m);
const n = Date.now() % 100000;
const api = async (path, body, token, method = 'POST') => (await fetch('http://localhost:8000/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const A = await api('/auth/register/', { username: 'aa' + n, password: 'secret123', display_name: 'علي' });
const B = await api('/auth/register/', { username: 'bb' + n, password: 'secret123', display_name: 'بتول' });
const open = async (acc, vp) => {
  const c = await b.newContext({ viewport: vp });
  await c.grantPermissions(['geolocation', 'microphone', 'camera'], { origin: 'http://localhost:3000' });
  await c.setGeolocation({ latitude: 33.3152, longitude: 44.3661 });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(600);
  return p;
};
const a = await open(A, { width: 1280, height: 800 });
const bb = await open(B, { width: 390, height: 844 });
const box = 'textarea[aria-label="الرسالة"]';

// بدء محادثة من جهات الاتصال (الزر الأزرق بالنص)
await a.click('nav >> text=جهات الاتصال');
// جهات الاتصال خاصة: نضيف بتول باسم مستخدمها أولاً، ثم نراسلها من القائمة
await a.click('aside button:has-text("إضافة جهة اتصال")'); await a.fill('[role=dialog] input', 'bb' + n);
await a.click('[role=dialog] button:has-text("بحث")'); await a.click('[role=dialog] button:has-text("إضافة إلى جهات الاتصال")');
await a.waitForSelector('[role=dialog] >> text=ضمن جهات اتصالك'); await a.click('[role=dialog] button[aria-label="رجوع"]');
await a.click('button[aria-label="مراسلة بتول"]');
await a.waitForSelector(box); ok('open chat from contacts (center button)');
await a.fill(box, 'هلو بتول 👋'); await a.click('button[aria-label="إرسال"]');
await bb.waitForSelector('aside >> text=هلو بتول'); ok('B sees new message in list live');
await bb.click('aside .w-scroll button:has-text("علي")');
await bb.waitForSelector('main >> text=هلو بتول');
// رد على رسالة
await bb.click('main p:has-text("هلو بتول")'); await bb.click('main button:text-is("رد")');
await bb.fill(box, 'هلا علي!'); await bb.click('button[aria-label="إرسال"]');
await a.waitForSelector('main >> text=هلا علي!'); ok('reply delivered live');
await a.waitForSelector('main span[aria-label="مقروءة"]'); ok('blue ticks (read)');
// يكتب الآن
await bb.type(box, 'ا'); await a.waitForSelector('text=يكتب الآن...'); ok('typing indicator'); await bb.fill(box, '');
// صورة
const [fc] = await Promise.all([a.waitForEvent('filechooser'), a.click('main button[aria-label="صورة أو فيديو"]')]);
await fc.setFiles('seed/sunset.jpg');
await a.fill('input[placeholder="أضف تعليقاً..."]', 'الغروب 🌅'); await a.click('main button[aria-label="إرسال"]');
await bb.waitForSelector('main img[alt="الغروب 🌅"]'); ok('image with caption delivered');
// رسالة صوتية (مايك وهمي)
await a.click('button[aria-label="تسجيل رسالة صوتية"]'); await a.waitForSelector('text=جارٍ التسجيل'); await a.waitForTimeout(1800);
await a.click('button[aria-label="إرسال التسجيل"]');
await bb.waitForSelector('main button[aria-label="تشغيل"]', { timeout: 15000 }); ok('voice message recorded & delivered');
// الموقع
await a.click('button[aria-label="إرفاق"]'); await a.click('main button:text-is("الموقع")');
await a.waitForSelector('text=مشاركة موقعي المباشر'); await a.click('[role=dialog] button:has-text("15 دقيقة")');
await a.click('[role=dialog] button:has-text("مشاركة الموقع")');
await bb.waitForSelector('main >> text=الموقع المباشر', { timeout: 10000 }); ok('live location shared');
// تعديل وحذف
await a.click('main p:has-text("هلو بتول")'); await a.click('button:has-text("تعديل")');
await a.fill(box, 'هلو بتول (معدلة)'); await a.click('button[aria-label="حفظ التعديل"]');
await bb.waitForSelector('main >> text=هلو بتول (معدلة)'); ok('edit propagates live');
await a.click('main p:has-text("هلو بتول (معدلة)")'); await a.click('button:has-text("حذف للجميع")');
await bb.waitForSelector('main >> text=حُذفت هذه الرسالة'); ok('delete for everyone');
// تفاعل ❤️ يوصل مباشرة
await a.click('main p:has-text("هلا علي!")'); await a.click('main button[aria-label="تفاعل ❤️"]');
await bb.waitForSelector('main button[aria-label="❤️ 1"]', { timeout: 10000 }); ok('reaction delivered live');
// نجمة ⭐ + لوحة الرسائل المميزة
await a.click('main p:has-text("هلا علي!")'); await a.click('main button:has-text("تمييز بنجمة")');
await a.click('main button[aria-label="المزيد"]'); await a.click('main button:has-text("الرسائل المميزة")');
await a.waitForSelector('[role=dialog] >> text=هلا علي!'); ok('starred message listed'); await a.keyboard.press('Escape');
// تثبيت 📌
await a.click('main button[aria-label="المزيد"]'); await a.click('main button:has-text("تثبيت المحادثة")');
// الرسائل المحفوظة ثابتة أولاً دائماً، والمحادثة المثبتة بعدها مباشرة
await a.waitForFunction(() => [...document.querySelectorAll('aside .w-scroll > button')].filter((e) => !e.textContent.includes('الرسائل المحفوظة'))[0]?.textContent?.includes('بتول')); ok('pinned chat goes to top (after Saved Messages)');
// حالة نص
await bb.click('button[aria-label="رجوع"]'); await bb.click('nav >> text=الإعدادات'); await bb.click('aside button:has-text("الحالات")');
await bb.click('button[aria-label="حالة جديدة"]'); await bb.fill('[role=dialog] textarea', 'يوم جميل ☀️');
await bb.click('[role=dialog] button:text-is("نشر")');
await a.click('nav >> text=الإعدادات'); await a.click('aside button:has-text("الحالات")'); await a.waitForSelector('text=يوم جميل', { timeout: 10000 }); ok('story posted & visible to others');
await a.click('button:has-text("يوم جميل")'); await a.waitForTimeout(700); await a.click('button[aria-label="إغلاق"]'); ok('story viewer opens');
// مكالمة فيديو
await a.click('nav >> text=المحادثات'); await a.click('aside .w-scroll button:has-text("بتول")');
await a.click('main button[aria-label="مكالمة فيديو"]');
await bb.waitForSelector('text=مكالمة فيديو واردة', { timeout: 10000 }); ok('incoming call screen');
await bb.screenshot({ path: 'ui/e2e-incoming.png' });
await bb.click('button[aria-label="رد"]');
await a.waitForSelector('button[aria-label="إنهاء المكالمة"]');
await a.waitForFunction(() => /\d:\d\d/.test(document.body.innerText), null, { timeout: 20000 }); ok('call connected (timer running)');
await a.waitForTimeout(1500); await a.screenshot({ path: 'ui/e2e-call.png' });
await a.click('button[aria-label="إنهاء المكالمة"]');
await bb.waitForSelector('text=انتهت المكالمة', { timeout: 8000 }); ok('hangup reaches other side');
// مجموعة جديدة
await a.waitForTimeout(2200);
await a.click('nav >> text=المحادثات'); await a.click('aside button[aria-label="القائمة"]'); await a.click('aside button:has-text("مجموعة جديدة")');
await a.fill('input[placeholder="اسم المجموعة"]', 'الشلة'); await a.fill('.fixed input[placeholder="ابحث..."]', 'bb' + n); await a.click('.fixed .w-scroll button:has-text("بتول")'); await a.click('button:has-text("إنشاء")');
await a.waitForSelector('main >> text=أنشأ المجموعة'); await bb.click('nav >> text=المحادثات'); await bb.waitForTimeout(1500); await bb.waitForSelector('aside >> text=الشلة', { timeout: 10000 }); ok('group created & appears for member');
// الشكل
await a.click('nav >> text=الإعدادات'); await a.click('aside button:has-text("المظهر")'); await a.click('[role=radio]:has-text("ليلي")');
await a.waitForSelector('.wasl[data-theme="dark"]'); ok('theme switch to dark');
await a.click('[role=radio]:has-text("نهاري")'); await a.waitForSelector('.wasl[data-theme="light"]'); ok('back to light');
await a.click('nav >> text=المحادثات'); await a.click('aside button:text-is("المجموعات")'); await a.waitForSelector('aside >> text=الشلة'); ok('groups filter lists the new group');
// حذف المحادثة عندي بس
await a.click('aside button:text-is("الكل")'); await a.click('aside .w-scroll button:has-text("بتول")');
await a.click('main button[aria-label="المزيد"]'); await a.click('main button:has-text("حذف المحادثة")');
await a.waitForFunction(() => ![...document.querySelectorAll('aside .w-scroll > button')].some((b) => b.textContent.includes('بتول')));
const bConvs = await (await fetch('http://localhost:8000/api/conversations/', { headers: { Authorization: 'Token ' + B.token } })).json();
if (!bConvs.some((c) => c.kind === 'direct' && c.last_message)) throw new Error('B lost the chat');
ok('delete chat hides it for me only');
console.log('errors:', errs.length ? [...new Set(errs)] : 'none');
await b.close();
