// المرحلة (ج): الدور المعلّق، والخصوصية، والحظر والإبلاغ، والأجهزة، والتحقق بخطوتين، وحذف الحساب،
// وإعادة التوجيه، والتثبيت، والبحث، والإشارة، والتنسيق، والاستطلاع، والمسودات، ومشاهدات القناة، والمجلدات
import { chromium } from 'playwright';
import { execSync } from 'child_process';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name, role = 'student') => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role, university_id: `S${u}${n}` }).then((r) => r.data);
const [ali, sara, omar] = [await reg('ali', 'علي حسن'), await reg('sara', 'سارة أحمد'), await reg('omar', 'عمر كريم')];
for (const [a, b] of [[ali, sara], [sara, ali], [ali, omar], [omar, ali], [sara, omar], [omar, sara]]) await req('POST', '/contacts/', { identifier: b.user.username }, a.token);
const dm = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
const group = (await req('POST', '/conversations/groups/', { title: `شعبة البرمجة ${n}`, member_ids: [sara.user.id, omar.user.id] }, ali.token)).data;
for (const t of ['مرحباً بالجميع', 'موعد امتحان البرمجة يوم الأحد الساعة التاسعة', 'أرسلوا الواجب قبل الخميس']) await req('POST', `/conversations/${group.id}/messages/`, { content: t }, ali.token);
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'هل راجعتِ الفصل الثالث؟' }, ali.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function page(acc, { mobile = true, scheme = 'light', w = 390, h = 844, url = 'http://localhost:3000/chat' } = {}) {
  const c = await b.newContext(mobile
    ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme }
    : { viewport: { width: w, height: h }, colorScheme: scheme });
  if (acc) await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|404|tile|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  await p.goto(url); await p.waitForSelector(acc ? '.wasl' : 'form'); await p.waitForTimeout(900);
  return p;
}
const openRow = async (p, name) => {
  if (await p.isVisible('main header button[aria-label="رجوع"]')) await p.click('main header button[aria-label="رجوع"]');
  if (await p.isVisible('nav >> text=المحادثات')) await p.click('nav >> text=المحادثات');
  await p.click(`aside .w-scroll > button:has-text("${name}")`); await p.waitForSelector(`main header >> text=${name}`); await p.waitForTimeout(600);
};
const more = async (p, item) => { await p.click('main header button[aria-label="المزيد"]'); await p.click(`main header button:has-text("${item}")`); };
const bubbleMenu = async (p, text) => { const bub = p.locator(`main [id^=m-] > div:has-text("${text}")`).last(); await bub.click({ button: 'right' }); };
const send = async (p, text) => { await p.fill('textarea[aria-label="الرسالة"]', text); await p.keyboard.press('Enter'); await p.waitForTimeout(700); };

// ------------------------------------------------ 1) الدور التدريسي بانتظار الاعتماد
const dr = await reg('dr', 'د. هدى', 'faculty');
if (dr.user.role !== 'student' || dr.user.requested_role !== 'faculty') fail('faculty self-granted: ' + JSON.stringify(dr.user));
const L = await page(null, { url: 'http://localhost:3000/login' });
await L.click('[role=radio]:has-text("تدريسي")').catch(() => L.click('button:has-text("تدريسي")'));
await L.fill('input[autocomplete=username]', `dr${n}`); await L.fill('input[type=password]', 'secret123');
await L.click('button:has-text("تسجيل الدخول")'); await L.waitForSelector('.wasl');
await L.click('nav >> text=الإعدادات'); await L.waitForSelector('text=بانتظار موافقة الإدارة');
await L.screenshot({ path: 'ui/pc-m-role-pending.png' });
if ((await req('POST', '/channels/', { title: 'x' }, dr.token)).status !== 403) fail('pending faculty can create channel');
ok('registering as faculty: signs in, shows "role awaiting approval", and cannot create channels yet (403)');
execSync(`cd ${process.env.BACKEND_DIR} && ${process.env.PYTHON || "python3"} manage.py shell -c "from accounts.admin import ProfileAdmin; from accounts.models import Profile; from django.contrib.admin.sites import site; from unittest import mock; ProfileAdmin(Profile, site).approve_role(mock.MagicMock(), Profile.objects.filter(user__username='dr${n}'))"`);
if ((await get('/auth/me/', dr.token)).role !== 'faculty') fail('approve action failed');
ok('admin action "Approve requested role" → faculty');
await L.context().close();

// ------------------------------------------------ 2) الخصوصية: آخر ظهور والصورة
const s = await page(sara);
await s.click('nav >> text=الإعدادات'); await s.click('aside button:has-text("الخصوصية والأمان")');
await s.waitForSelector('text=آخر ظهور والاتصال الآن');
await s.click('[role=radiogroup][aria-label="آخر ظهور والاتصال الآن"] [role=radio]:has-text("لا أحد")'); await s.waitForTimeout(600);
const seenBy = (await get('/users/', ali.token)).find((u) => u.id === sara.user.id);
if (seenBy.is_online || seenBy.last_seen) fail('privacy last seen not applied: ' + JSON.stringify(seenBy));
await s.screenshot({ path: 'ui/pc-m-privacy.png' });
ok('privacy: "Last seen: Nobody" → Ali sees Sara offline with no last-seen time');
await s.click('[role=radiogroup][aria-label="آخر ظهور والاتصال الآن"] [role=radio]:has-text("الجميع")'); await s.waitForTimeout(400);

// ------------------------------------------------ 3) الحظر والإبلاغ
const d = await page(ali, { mobile: false, w: 1440, h: 900 });
await openRow(d, 'سارة أحمد');
await d.click('main header button:has-text("سارة أحمد")');
await d.waitForSelector('[role=dialog] >> text=حظر سارة أحمد');
await d.click('[role=dialog] button:has-text("حظر سارة أحمد")'); await d.waitForTimeout(700);
await d.keyboard.press('Escape'); await d.waitForTimeout(300);
if (!(await d.isVisible('main >> text=حظرت سارة أحمد'))) fail('blocked bar missing');
await d.screenshot({ path: 'ui/pc-d-blocked.png' });
await openRow(s, 'علي حسن');
await s.fill('textarea[aria-label="الرسالة"]', 'مرحباً'); await s.click('button[aria-label="إرسال"]');
await s.waitForSelector('text=لا يمكنك مراسلة هذا الشخص', { timeout: 5000 });
ok('block: Ali\'s message box is replaced by "You blocked Sara"; Sara\'s send is refused');
await d.click('main button:has-text("إلغاء الحظر")'); await d.waitForTimeout(700);
if (!(await d.isVisible('textarea[aria-label="الرسالة"]'))) fail('unblock did not restore composer');
ok('unblock from the bar restores the message box');
await s.fill('textarea[aria-label="الرسالة"]', 'رسالة مزعجة للاختبار'); await s.click('button[aria-label="إرسال"]'); await d.waitForTimeout(1200);
await bubbleMenu(d, 'رسالة مزعجة للاختبار');
await d.click('button:has-text("إبلاغ")');
await d.waitForSelector('[role=dialog][aria-label="إبلاغ عن رسالة"]');
await d.screenshot({ path: 'ui/pc-d-report.png' });
await d.click('[role=dialog] [role=switch]');  // لا نحظرها هذه المرة
await d.click('button:has-text("إرسال البلاغ")'); await d.waitForSelector('text=وصل بلاغك إلى الإدارة');
const rep = execSync(`cd ${process.env.BACKEND_DIR} && ${process.env.PYTHON || "python3"} manage.py shell -c "from accounts.models import Report; r=Report.objects.latest('id'); print(r.reason, r.message_text)"`).toString().trim().split('\n').at(-1);
if (!rep.includes('رسالة مزعجة للاختبار')) fail('report not stored: ' + rep);
ok('report a message → stored for the admin with the message text: ' + rep);

// ------------------------------------------------ 4) إعادة التوجيه، والتثبيت، والبحث
await bubbleMenu(d, 'هل راجعتِ الفصل الثالث؟');
await d.click('button:has-text("إعادة توجيه")');
await d.waitForSelector('[role=dialog][aria-label="إعادة التوجيه إلى..."]');
await d.click(`[role=dialog] [role=checkbox]:has-text("شعبة البرمجة ${n}")`);
await d.screenshot({ path: 'ui/pc-d-forward.png' });
await d.click('[role=dialog] button:has-text("إرسال (1)")'); await d.waitForTimeout(900);
await openRow(d, `شعبة البرمجة ${n}`);
if (!(await d.isVisible('main >> text=مُعاد توجيهها'))) fail('forwarded label missing');
ok('forward a message to the group → appears there marked "Forwarded"');
await bubbleMenu(d, 'موعد امتحان البرمجة');
await d.click('button:has-text("تثبيت")'); await d.waitForTimeout(900);
await openRow(s, `شعبة البرمجة ${n}`);
await s.waitForSelector('[data-testid=pinned-bar] >> text=موعد امتحان البرمجة', { timeout: 6000 });
await s.screenshot({ path: 'ui/pc-m-pinned.png' });
ok('pin a message → Sara sees the pinned bar at the top of the group');
// بحث عام من قائمة المحادثات
await s.click('main header button[aria-label="رجوع"]');
await s.fill('aside input[type=search]', 'الواجب');
await s.waitForSelector('[data-testid=search-hit]', { timeout: 8000 });
await s.screenshot({ path: 'ui/pc-m-search.png' });
await s.click('[data-testid=search-hit]');
await s.waitForSelector(`main header >> text=شعبة البرمجة ${n}`);
await s.waitForTimeout(1200);
const flashed = await s.$$eval('main [id^=m-] > div', (els) => els.some((e) => e.style.boxShadow.includes('var(--accent)') || getComputedStyle(e).boxShadow !== 'none' && e.textContent.includes('الواجب')));
ok('global search finds text inside encrypted messages; tapping the result opens the chat at that message' + (flashed ? ' (highlighted)' : ''));
await more(d, 'البحث في المحادثة');
await d.fill('[role=dialog] input[type=search]', 'امتحان');
await d.waitForSelector('[role=dialog] [data-testid=search-hit]');
ok('in-chat search works');
await d.keyboard.press('Escape');

// ------------------------------------------------ 5) الإشارة @، والتنسيق، والاستطلاع
await d.fill('textarea[aria-label="الرسالة"]', '');
await d.type('textarea[aria-label="الرسالة"]', `@sara`);
await d.waitForSelector('[role=listbox][aria-label="الإشارة إلى عضو"]');
await d.screenshot({ path: 'ui/pc-d-mention.png' });
await d.click('[role=listbox] [role=option]:has-text("سارة أحمد")');
if (!(await d.inputValue('textarea[aria-label="الرسالة"]')).startsWith(`@sara${n} `)) fail('mention not inserted');
await d.type('textarea[aria-label="الرسالة"]', 'راجعي *الفصل الثالث* و _الرابع_ و ~الخامس~ و `print()`');
await d.keyboard.press('Enter'); await d.waitForTimeout(900);
const fmt = await d.evaluate(() => { const b = [...document.querySelectorAll('main [id^=m-]')].at(-1); return ['strong', 'em', 's', 'code'].map((t) => !!b.querySelector(t)).join(',') + '|' + (b.querySelector('.w-accent-text.font-bold')?.textContent ?? ''); });
if (!fmt.startsWith('true,true,true,true')) fail('formatting: ' + fmt);
ok('@mention suggestions + WhatsApp formatting (*bold* _italic_ ~strike~ `code`) render correctly: ' + fmt);
await d.click('button[aria-label="إرفاق"]'); await d.click('button:has-text("استطلاع")');
await d.fill('[role=dialog] input[aria-label="السؤال"]', 'متى نراجع قبل الامتحان؟');
await d.fill('[role=dialog] input[aria-label="الخيار 1"]', 'السبت');
await d.fill('[role=dialog] input[aria-label="الخيار 2"]', 'الأحد');
await d.click('[role=dialog] button:has-text("إضافة خيار")');
await d.fill('[role=dialog] input[aria-label="الخيار 3"]', 'الاثنين');
await d.screenshot({ path: 'ui/pc-d-poll-new.png' });
await d.click('[role=dialog] button:has-text("إرسال الاستطلاع")'); await d.waitForTimeout(900);
await s.waitForSelector('main >> text=متى نراجع قبل الامتحان؟');
await s.click('main button[aria-pressed]:has-text("الأحد")'); await s.waitForTimeout(900);
await d.waitForFunction(() => document.body.innerText.includes('المصوّتون: 1'), null, { timeout: 6000 });
await d.screenshot({ path: 'ui/pc-d-poll-votes.png' });
await s.screenshot({ path: 'ui/pc-m-poll.png' });
ok('poll: created from the attach menu; Sara voted; Ali\'s result updated live ("Voters: 1")');

// ------------------------------------------------ 6) المسودات
await s.fill('textarea[aria-label="الرسالة"]', 'سأرسل الملخص لاحقاً');
await s.click('main header button[aria-label="رجوع"]'); await s.waitForTimeout(400);
await s.fill('aside input[type=search]', ''); await s.waitForTimeout(300);  // بقي نص البحث من الخطوة السابقة
if (!(await s.isVisible(`aside button:has-text("شعبة البرمجة ${n}") >> text=مسودة:`))) fail('draft label missing');
await s.screenshot({ path: 'ui/pc-m-draft.png' });
await openRow(s, `شعبة البرمجة ${n}`);
if ((await s.inputValue('textarea[aria-label="الرسالة"]')) !== 'سأرسل الملخص لاحقاً') fail('draft not restored');
ok('draft: unsent text shows "Draft: …" in the list and comes back when reopening');

// ------------------------------------------------ 7) مشاهدات القناة
const ch = (await req('POST', '/channels/', { title: `إعلانات ${n}` }, dr.token)).data;
for (const u of [sara, omar]) await req('POST', `/channels/${ch.id}/subscribe/`, null, u.token);
await req('POST', `/conversations/${ch.id}/messages/`, { content: 'المحاضرة غداً في القاعة 3' }, dr.token);
await req('PATCH', `/conversations/${ch.id}/read/`, null, sara.token);
const drp = await page(dr, { mobile: false, w: 1280, h: 800 });
await openRow(drp, `إعلانات ${n}`);
const views = await drp.textContent('main [id^=m-]:last-child [title="المشاهدات"]').catch(() => '');
if (views.trim() !== '1') fail('channel views: ' + views);
await drp.screenshot({ path: 'ui/pc-d-channel-views.png' });
ok('channel: the admin sees the view count on each post (👁 1)');

// ------------------------------------------------ 8) المجلدات
await d.click('main header button[aria-label="إغلاق المحادثة"]');
await d.click('aside button[aria-label="مجلد جديد"]');
await d.fill('[role=dialog] input[aria-label="اسم المجلد"]', 'الدراسة');
await d.click(`[role=dialog] [role=checkbox]:has-text("شعبة البرمجة ${n}")`);
await d.click('[role=dialog] button:has-text("حفظ")'); await d.waitForTimeout(800);
await d.click('aside button[aria-pressed]:has-text("الدراسة")'); await d.waitForTimeout(500);
const rows = await d.$$eval('aside .w-scroll > button', (els) => els.map((e) => e.textContent));
if (rows.length !== 1 || !rows[0].includes('شعبة البرمجة')) fail('folder filter: ' + rows.length);
await d.screenshot({ path: 'ui/pc-d-folder.png' });
ok('chat folder "Study" appears as a chip and shows only its chats');

// ------------------------------------------------ 9) الأجهزة، والتحقق بخطوتين، وحذف الحساب
await req('POST', '/auth/login/', { identifier: `omar${n}`, password: 'secret123' });
const o = await page(omar);
await o.click('nav >> text=الإعدادات'); await o.click('aside button:has-text("الخصوصية والأمان")');
await o.waitForSelector('text=هذا الجهاز');
const devices = await o.$$eval('button:has-text("إنهاء الجلسة")', (b) => b.length);
if (devices < 1) fail('other session not listed');
await o.click('button:has-text("إنهاء الجلسة") >> nth=0'); await o.waitForSelector('text=خرج ذلك الجهاز');
ok(`devices list shows this device + ${devices} other; ending a session works`);
await o.click('button:has-text("تفعيل")');
await o.fill('[role=dialog] input[aria-label="كلمة المرور الحالية"]', 'secret123');
await o.fill('[role=dialog] input[aria-label="كلمة التحقق بخطوتين"]', '2468');
await o.fill('[role=dialog] input[aria-label="التلميح"]', 'رقم زوجي');
await o.screenshot({ path: 'ui/pc-m-two-step-set.png' });
await o.click('[role=dialog] button:has-text("حفظ")'); await o.waitForSelector('text=فُعّل التحقق بخطوتين');
const L2 = await page(null, { url: 'http://localhost:3000/login' });
await L2.fill('input[autocomplete=username]', `omar${n}`); await L2.fill('input[type=password]', 'secret123');
await L2.click('button:has-text("تسجيل الدخول")');
await L2.waitForSelector('text=حسابك محمي بالتحقق بخطوتين');
await L2.screenshot({ path: 'ui/pc-m-two-step-login.png' });
await L2.fill('input[aria-label="كلمة التحقق بخطوتين"]', '1111'); await L2.click('button:has-text("تأكيد الدخول")');
await L2.waitForSelector('text=كلمة التحقق بخطوتين غير صحيحة');
await L2.fill('input[aria-label="كلمة التحقق بخطوتين"]', '2468'); await L2.click('button:has-text("تأكيد الدخول")');
await L2.waitForSelector('.wasl');
ok('two-step verification: password alone is not enough; wrong code refused; right code signs in');
const temp = await reg('temp', 'حساب تجريبي');
const T = await page(temp);
await T.click('nav >> text=الإعدادات'); await T.click('aside button:has-text("الخصوصية والأمان")');
await T.click('button:has-text("حذف الحساب")');
await T.fill('[role=dialog] input[aria-label="كلمة المرور الحالية"]', 'secret123');
await T.screenshot({ path: 'ui/pc-m-delete.png' });
await T.click('[role=dialog] button:has-text("حذف حسابي نهائياً")');
await T.waitForURL(/\/login/, { timeout: 8000 });
if ((await req('GET', '/auth/me/', null, temp.token)).status !== 401) fail('account still works');
ok('delete account with password → signed out and the account is gone');

console.log(errs.length ? '⚠️ page errors:\n' + [...new Set(errs)].join('\n') : '✅ no page errors');
await b.close();
