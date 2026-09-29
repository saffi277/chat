// المرحلة (ب): الثيمات، وإعدادات المحادثة، والجدولة، وإعدادات المجموعة، ورابط الدعوة، والمكالمة الجماعية
import { chromium } from 'playwright';
import { execSync } from 'child_process';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name) => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role: 'student', university_id: `S${u}${n}` }).then((r) => r.data);
const [ali, sara, omar, zaid] = [await reg('ali', 'علي حسن'), await reg('sara', 'سارة أحمد'), await reg('omar', 'عمر كريم'), await reg('zaid', 'زيد علي')];
for (const [a, b] of [[ali, sara], [sara, ali], [ali, omar], [omar, ali], [sara, omar], [omar, sara]]) await req('POST', '/contacts/', { identifier: b.user.username }, a.token);
const dm = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'مرحباً سارة، هل أنتِ جاهزة للامتحان؟' }, ali.token);
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'نعم، راجعت الفصلين الأول والثاني' }, sara.token);
const group = (await req('POST', '/conversations/groups/', { title: `شعبة البرمجة ${n}`, member_ids: [sara.user.id, omar.user.id] }, ali.token)).data;
await req('POST', `/conversations/${group.id}/messages/`, { content: 'أهلاً بالجميع في مجموعة الشعبة' }, ali.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'] });
async function page(acc, { mobile = true, scheme = 'light', w = 390, h = 844, url = 'http://localhost:3000/chat' } = {}) {
  const c = await b.newContext(mobile
    ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme }
    : { viewport: { width: w, height: h }, colorScheme: scheme });
  await c.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:3000' });
  if (acc) await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|404|tile|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  await p.goto(url); await p.waitForSelector('.wasl'); await p.waitForTimeout(900);
  return p;
}
const openRow = async (p, name) => { if (await p.isVisible('main header button[aria-label="رجوع"]')) await p.click('main header button[aria-label="رجوع"]'); if (await p.isVisible('nav >> text=المحادثات')) await p.click('nav >> text=المحادثات'); await p.click(`aside .w-scroll > button:has-text("${name}")`); await p.waitForSelector(`main header >> text=${name}`); await p.waitForTimeout(500); };
const more = async (p, item) => { await p.click('main header button[aria-label="المزيد"]'); await p.click(`main header button:has-text("${item}")`); };

// ------------------------------------------------ 1) الثيمات
const d = await page(ali, { mobile: false, w: 1440, h: 900 });
await d.click('nav >> text=الإعدادات'); await d.click('aside button:has-text("الثيمات")');
await d.waitForSelector('text=لون التطبيق');
await d.click('[role=radio]:has-text("الأخضر")'); await d.waitForTimeout(600);
const accent = await d.$eval('.wasl', (e) => [e.dataset.accent, getComputedStyle(e).getPropertyValue('--accent').trim()]);
if (accent[0] !== 'green' || accent[1] !== '#0f9d6b') fail('accent: ' + accent);
await d.click('button[aria-label="نقاط"]'); await d.waitForTimeout(600);
if ((await d.$eval('.wasl', (e) => e.dataset.wallpaper)) !== 'dots') fail('wallpaper not applied');
const me = await get('/auth/me/', ali.token);
if (me.theme !== 'green' || me.wallpaper !== 'dots') fail('theme not saved: ' + me.theme + ' ' + me.wallpaper);
ok('Themes: green colour + dots background applied instantly and saved on the account');
await d.screenshot({ path: 'ui/pb-d-themes.png' });
await openRow(d, 'سارة أحمد');
await d.screenshot({ path: 'ui/pb-d-green-dots.png' });
const dd = await page(ali, { mobile: false, w: 1440, h: 900, scheme: 'dark' });
await openRow(dd, 'سارة أحمد');
const darkAccent = await dd.$eval('.wasl', (e) => getComputedStyle(e).getPropertyValue('--accent').trim());
if (darkAccent !== '#22b37d') fail('dark accent ' + darkAccent);
await dd.screenshot({ path: 'ui/pb-d-green-dark.png' });
ok('the same theme works in dark mode (its own dark shade): ' + darkAccent);
await dd.context().close();

// ------------------------------------------------ 2) إعدادات المحادثة: الكتم لمدة، والخلفية الخاصة، والرسائل المختفية
await more(d, 'إعدادات المحادثة'); await d.waitForSelector('[role=dialog][aria-label="إعدادات المحادثة"]');
await d.click('[role=dialog][aria-label="إعدادات المحادثة"] button:has-text("كتم")');
await d.waitForSelector('[role=dialog][aria-label="كتم الإشعارات"]');
await d.screenshot({ path: 'ui/pb-d-mute.png' });
await d.click('[role=dialog][aria-label="كتم الإشعارات"] [role=radio]:has-text("8 ساعات")'); await d.waitForTimeout(800);
const conv1 = await get(`/conversations/${dm.id}/`, ali.token);
if (!conv1.is_muted || !conv1.muted_until) fail('mute 8h failed');
if (!(await d.isVisible('text=حتى'))) fail('"until" text missing');
ok('mute for 8 hours: muted until ' + new Date(conv1.muted_until).toLocaleTimeString('en'));
await d.click('button[aria-label="صورة الكلية"]'); await d.waitForTimeout(700);
await d.click('[role=radio]:has-text("24 ساعة")'); await d.waitForTimeout(900);
await d.screenshot({ path: 'ui/pb-d-conv-settings.png' });
await d.keyboard.press('Escape'); await d.waitForTimeout(300);
const wp = await d.$eval('main > div', (e) => e.dataset.wallpaper);
if (wp !== 'campus') fail('per-chat wallpaper: ' + wp);
if (!(await d.isVisible('text=الرسائل المختفية مفعّلة: 24 ساعة'))) fail('disappearing pill missing');
if (!(await d.isVisible('text=فعّل الرسائل المختفية: 24 ساعة'))) fail('system message missing');
await d.fill('textarea[aria-label="الرسالة"]', 'هذه الرسالة ستختفي بعد يوم'); await d.keyboard.press('Enter'); await d.waitForTimeout(900);
const last = (await get(`/conversations/${dm.id}/messages/`, ali.token)).at(-1);
if (!last.expires_at) fail('no expires_at');
if ((await get(`/conversations/${dm.id}/`, sara.token)).wallpaper !== '') fail('wallpaper leaked to Sara');
await d.screenshot({ path: 'ui/pb-d-disappearing.png' });
ok('per-chat background (college photo) for me only; disappearing messages 24h: pill, system message, timer on new messages');

// ------------------------------------------------ 3) الجدولة (نقر أيمن على زر الإرسال)، والإرسال دون إشعار (ضغط مطوّل في الهاتف)
await d.fill('textarea[aria-label="الرسالة"]', 'تذكير: الامتحان غداً الساعة 9');
await d.click('button[aria-label="إرسال"]', { button: 'right' });
await d.click('[role=menuitem]:has-text("جدولة الإرسال")');
await d.waitForSelector('[role=dialog][aria-label="جدولة رسالة"]');
await d.click('[role=dialog] button:has-text("بعد ساعة")');
await d.screenshot({ path: 'ui/pb-d-schedule.png' });
await d.click('[role=dialog] button:has-text("جدولة"):not(:has-text("رسالة"))'); await d.waitForTimeout(900);
await d.waitForSelector('main >> text=رسائل مجدولة: 1');
const sch = await get(`/conversations/${dm.id}/scheduled/`, ali.token);
if (sch.length !== 1 || sch[0].content !== 'تذكير: الامتحان غداً الساعة 9') fail('scheduled: ' + JSON.stringify(sch));
if ((await d.inputValue('textarea[aria-label="الرسالة"]')) !== '') fail('box not cleared after scheduling');
ok('schedule: right-click send → "Schedule send" → in 1 hour; chip "Scheduled messages: 1"');
// نقرّب موعدها ونترك العامل الخلفي (كل 15 ثانية) يرسلها
execSync(`cd ${process.env.BACKEND_DIR} && ${process.env.PYTHON || "python3"} manage.py shell -c "from chat.models import ScheduledMessage as S; from django.utils import timezone; S.objects.filter(pk=${sch[0].id}).update(send_at=timezone.now())"`);
const s = await page(sara);
await openRow(s, 'علي حسن');
await s.waitForSelector('main >> text=تذكير: الامتحان غداً الساعة 9', { timeout: 25000 });
await d.waitForSelector('main >> text=رسائل مجدولة: 1', { state: 'detached', timeout: 5000 });
ok('the background worker sent it on time; it appeared live for Sara and the chip disappeared');
// سارة: ضغط مطوّل على الإرسال ← «إرسال دون إشعار»
await s.fill('textarea[aria-label="الرسالة"]', 'تمام، شكراً للتذكير');
const cdp = await s.context().newCDPSession(s);
const sb = await s.$eval('button[aria-label="إرسال"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [sb] });
await s.waitForTimeout(650);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await s.waitForSelector('[role=menuitem]:has-text("إرسال دون إشعار")');
await s.screenshot({ path: 'ui/pb-m-send-menu.png' });
await s.click('[role=menuitem]:has-text("إرسال دون إشعار")'); await s.waitForTimeout(900);
if ((await get(`/conversations/${dm.id}/messages/`, ali.token)).at(-1).content !== 'تمام، شكراً للتذكير') fail('silent send');
ok('mobile: long-press send → "Send without notification" works');

// ------------------------------------------------ 4) إعدادات المجموعة: الإرسال للمشرفين، والوضع البطيء، ورابط الدعوة
await openRow(d, `شعبة البرمجة ${n}`);
await more(d, 'إعدادات المحادثة'); await d.waitForSelector('text=إعدادات المجموعة');
await d.click('[role=switch][aria-label="الإرسال للمشرفين فقط"]'); await d.waitForTimeout(700);
await d.selectOption('select', '30'); await d.waitForTimeout(700);
await d.click('button:has-text("إنشاء رابط دعوة")'); await d.waitForSelector('[data-testid=invite-url]');
const inviteUrl = (await d.textContent('[data-testid=invite-url]')).trim();
await d.screenshot({ path: 'ui/pb-d-group-settings.png' });
const g1 = await get(`/conversations/${group.id}/`, ali.token);
if (!g1.only_admins_post || g1.slow_mode !== 30 || !inviteUrl.includes('/chat?join=')) fail('group settings: ' + JSON.stringify([g1.only_admins_post, g1.slow_mode, inviteUrl]));
ok('group admin: only admins send ON, slow mode 30s, invite link ' + inviteUrl.replace(/join=.*/, 'join=…'));
await d.keyboard.press('Escape');
await openRow(s, `شعبة البرمجة ${n}`);
if (await s.$('textarea[aria-label="الرسالة"]')) fail('member still has a composer');
if (!(await s.isVisible('text=الإرسال في هذه المجموعة للمشرفين فقط'))) fail('read-only bar missing');
await s.screenshot({ path: 'ui/pb-m-admins-only.png' });
ok('member sees "Only admins can send messages in this group" instead of the message box');
await d.click('main header button[aria-label="المزيد"]'); await d.click('main header button:has-text("إعدادات المحادثة")');
await d.click('[role=switch][aria-label="الإرسال للمشرفين فقط"]'); await d.waitForTimeout(700); await d.keyboard.press('Escape');
await s.waitForSelector('textarea[aria-label="الرسالة"]', { timeout: 8000 });
await s.fill('textarea[aria-label="الرسالة"]', 'سؤال عن الواجب'); await s.click('button[aria-label="إرسال"]'); await s.waitForTimeout(700);
await s.fill('textarea[aria-label="الرسالة"]', 'وسؤال آخر'); await s.click('button[aria-label="إرسال"]');
await s.waitForSelector('text=الوضع البطيء مفعّل', { timeout: 5000 });
ok('slow mode: the second message within 30s is refused with "Slow mode is on: you can send again in N seconds"');
// زيد (ليس عضواً ولا يعرف أحداً) يفتح رابط الدعوة
const z = await page(zaid, { url: inviteUrl.replace(/^https?:\/\/[^/]+/, 'http://localhost:3000') });
await z.waitForSelector('[role=dialog][aria-label="دعوة إلى مجموعة"] >> text=شعبة البرمجة');
await z.screenshot({ path: 'ui/pb-m-invite.png' });
await z.click('button:has-text("انضمام إلى المجموعة")');
await z.waitForSelector(`main header >> text=شعبة البرمجة ${n}`);
await z.waitForSelector('main >> text=انضم عبر رابط الدعوة', { timeout: 8000 }).catch(async () => { await z.screenshot({ path: 'ui/pb-dbg-join.png' }); fail('join system message missing'); });
await z.screenshot({ path: 'ui/pb-m-joined.png' });
ok('Zaid opened the invite link → group preview → Join → he is in the group');

// ------------------------------------------------ 5) المكالمة الجماعية (أربعة متصفحات)
const o = await page(omar);
await d.click(`main header button[aria-label="مكالمة فيديو"]`);
await d.waitForSelector('[role=dialog][aria-label="مكالمة جماعية"]');
for (const p of [s, o]) {
  await p.waitForSelector('text=يتصل بالمجموعة', { timeout: 10000 });
}
await s.screenshot({ path: 'ui/pb-m-group-incoming.png' });
await s.click('button[aria-label="رد"]');
await o.click('button[aria-label="رد"]');
const tilesOk = async (p, want) => p.waitForFunction((w) => {
  const tiles = document.querySelectorAll('[data-testid=call-tile]');
  return tiles.length === w && ![...tiles].some((t) => t.textContent.includes('جارٍ الاتصال'));
}, want, { timeout: 20000 });
for (const p of [d, s, o]) await tilesOk(p, 3);
await d.waitForTimeout(1500);
const vids = await d.$$eval('[data-testid=call-tile] video', (vs) => vs.filter((v) => v.videoWidth > 0).length);
await d.screenshot({ path: 'ui/pb-d-group-call.png' });
await o.screenshot({ path: 'ui/pb-m-group-call.png' });
ok(`group video call: 3 people, each sees 3 tiles, all connected directly (videos playing on Ali's screen: ${vids})`);
// زيد رنّت عنده فرفض، ثم غيّر رأيه: ينضم من شريط «انضمام» في المجموعة
await z.click('button[aria-label="رفض"]', { timeout: 10000 });
await z.waitForSelector('text=مكالمة جماعية جارية', { timeout: 10000 });
await z.screenshot({ path: 'ui/pb-m-join-banner.png' });
await z.click('button:has-text("انضمام")');
for (const p of [d, s, o, z]) await tilesOk(p, 4);
ok('Zaid joined the ongoing call from the "Join" bar → 4 people, everyone sees 4 tiles');
// مشاركة الشاشة من الحاسوب
let shared = false;
try {
  await d.click('[role=dialog][aria-label="مكالمة جماعية"] button[aria-label="مشاركة الشاشة"]');
  await d.waitForSelector('text=يشارك الشاشة', { timeout: 6000 });
  shared = true;
  await d.waitForTimeout(1500);
  await d.screenshot({ path: 'ui/pb-d-screen-share.png' });
  await d.click('[role=dialog][aria-label="مكالمة جماعية"] button[aria-label="إيقاف المشاركة"]');
} catch (e) { console.log('⚠️ screen share in headless Chromium:', e.message.split('\n')[0]); }
if (shared) ok('screen sharing starts and stops (the screen replaces the camera for everyone)');
// عمر يغادر: تبقى لمن بقي
await o.click('button[aria-label="مغادرة المكالمة"]');
for (const p of [d, s, z]) await tilesOk(p, 3);
const act = await get(`/calls/active/?conversation=${group.id}`, ali.token);
if (act.call?.status !== 'ongoing') fail('call ended when one left');
ok('Omar left: the call continues for the other three');
for (const p of [s, z]) await p.click('button[aria-label="مغادرة المكالمة"]');
await d.waitForTimeout(800);
await d.click('button[aria-label="مغادرة المكالمة"]'); await d.waitForTimeout(1500);
const endAct = await get(`/calls/active/?conversation=${group.id}`, ali.token);
if (endAct.call) fail('call still active after everyone left');
const log = (await get(`/conversations/${group.id}/messages/`, ali.token)).at(-1);
ok('everyone left → the call ended and was logged: ' + log.content);

console.log(errs.length ? '⚠️ page errors:\n' + [...new Set(errs)].join('\n') : '✅ no page errors');
await b.close();
