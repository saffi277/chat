import { execSync } from 'child_process';
// جهات الاتصال الخاصة + القنوات: من البداية إلى النهاية في المتصفح (هاتف 390×844)
import { chromium } from 'playwright';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const post = (path, body, token) => fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => fetch(B + path, { headers: { Authorization: 'Token ' + token } }).then((r) => r.json());
const teacher = (await post('/auth/register/', { username: `dr_huda${n}`, password: 'secret123', display_name: 'د. هدى الكعبي', role: 'faculty', university_id: `F-${n}`, email: `huda${n}@asbat.edu.iq` })).data;
execSync(`cd ${process.env.BACKEND_DIR} && ${process.env.PYTHON || "python3"} manage.py shell -c "from accounts.models import Profile; Profile.objects.filter(user__username='dr_huda${n}').update(role='faculty', requested_role='')"`);  // اعتماد الإدارة
const student = (await post('/auth/register/', { username: `ali${n}`, password: 'secret123', display_name: 'علي حسن', role: 'student', university_id: `S-${n}` })).data;
const ok = (m) => console.log('✅', m);
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function page(acc, scheme = 'light') {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|404|tile/.test(m.text()) && errs.push(m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(800);
  return p;
}

// ---------- الطالب: لا يرى أحداً حتى يضيفه
const s = await page(student);
await s.click('nav >> text=جهات الاتصال'); await s.waitForTimeout(500);
if (!(await s.isVisible('text=لم تُضف أحداً بعد'))) throw new Error('empty contacts state missing');
if ((await get('/users/', student.token)).length !== 0) throw new Error('student sees accounts');
ok('new student: contacts list is empty, the server returns nobody');
await s.screenshot({ path: 'ui/cc-1-empty.png' });

// جزء من المعرّف لا يكفي
await s.click('aside button:has-text("إضافة جهة اتصال")'); await s.waitForSelector('[role=dialog]');
await s.fill('[role=dialog] input', `F-${String(n).slice(0, 2)}`); await s.click('[role=dialog] button:has-text("بحث")');
await s.waitForSelector('[role=dialog] [role=alert]');
ok('partial identifier finds nobody: ' + (await s.textContent('[role=dialog] [role=alert]')).slice(0, 40));
await s.fill('[role=dialog] input', `F-${n}`); await s.click('[role=dialog] button:has-text("بحث")');
await s.waitForSelector('[role=dialog] >> text=د. هدى الكعبي');
await s.screenshot({ path: 'ui/cc-2-found.png' });
await s.click('[role=dialog] button:has-text("إضافة إلى جهات الاتصال")'); await s.waitForSelector('[role=dialog] >> text=ضمن جهات اتصالك');
ok('found the teacher by full university ID and added her');
await s.click('[role=dialog] button:has-text("مراسلة")'); await s.waitForSelector('main header >> text=د. هدى الكعبي');
await s.fill('textarea[aria-label="الرسالة"]', 'السلام عليكم دكتورة'); await s.click('button[aria-label="إرسال"]'); await s.waitForTimeout(600);
ok('opened a chat with her and sent a message');

// ---------- الأستاذة: ترى رسالة الطالب وشريط «ليس ضمن جهات اتصالك»، وتنشئ قناة
const t = await page(teacher);
await t.click('aside .w-scroll button:has-text("علي حسن")'); await t.waitForTimeout(800);
if (!(await t.isVisible('text=علي حسن ليس ضمن جهات اتصالك'))) throw new Error('stranger banner missing');
await t.screenshot({ path: 'ui/cc-3-stranger.png' });
await t.click('[role=note] button:has-text("إضافة")'); await t.waitForTimeout(600);
if (await t.isVisible('[role=note]')) throw new Error('banner should disappear after adding');
ok('teacher sees "not in your contacts" and adds the student in one tap');
await t.click('button[aria-label="رجوع"]'); await t.click('nav >> text=جهات الاتصال'); await t.waitForTimeout(400);
await t.click('aside button:has-text("قناة جديدة")'); await t.waitForSelector('[role=dialog]');
await t.fill('[role=dialog] input', `إعلانات المرحلة الثالثة ${n}`);
await t.fill('[role=dialog] textarea', 'مواعيد المحاضرات والامتحانات');
await t.screenshot({ path: 'ui/cc-4-new-channel.png' });
await t.click('[role=dialog] button:has-text("إنشاء القناة")'); await t.waitForSelector('main header >> text=إعلانات المرحلة الثالثة');
await t.fill('textarea[aria-label="الرسالة"]', 'امتحان البرمجة يوم الأحد الساعة 9 صباحاً'); await t.click('button[aria-label="إرسال"]'); await t.waitForTimeout(700);
await t.screenshot({ path: 'ui/cc-5-channel-admin.png' });
ok('teacher created a channel and posted');

// ---------- الطالب: لا يستطيع إنشاء قناة، يشترك، يقرأ، ولا يكتب
await s.click('button[aria-label="رجوع"]'); await s.click('nav >> text=جهات الاتصال'); await s.waitForTimeout(300);
if (await s.isVisible('aside button:has-text("قناة جديدة")')) throw new Error('student can see New channel');
const forbidden = await post('/channels/', { title: 'x' }, student.token);
if (forbidden.status !== 403) throw new Error('student created a channel');
ok('student has no "New channel" and the server refuses (403)');
await s.click('aside button:has-text("استكشاف القنوات")'); await s.waitForSelector('[role=dialog]');
await s.fill('[role=dialog] input', `${n}`); await s.waitForSelector(`[role=dialog] >> text=إعلانات المرحلة الثالثة ${n}`);
await s.screenshot({ path: 'ui/cc-6-explore.png' });
await s.click('[role=dialog] button:has-text("اشتراك")'); await s.waitForSelector('main header >> text=إعلانات المرحلة الثالثة');
await s.waitForSelector('main >> text=امتحان البرمجة يوم الأحد');
if (await s.isVisible('textarea[aria-label="الرسالة"]')) throw new Error('subscriber has a composer');
if (!(await s.isVisible('text=النشر في هذه القناة لمشرفيها فقط'))) throw new Error('read-only bar missing');
await s.screenshot({ path: 'ui/cc-7-channel-subscriber.png' });
const conv = (await get('/conversations/?filter=channels', student.token))[0];
const denied = await post(`/conversations/${conv.id}/messages/`, { content: 'hi' }, student.token);
if (denied.status !== 403) throw new Error('subscriber could post');
ok('student subscribed, reads the post, has no composer, and the server refuses posting (403)');
await s.click('button[aria-label="رجوع"]'); await s.click('nav >> text=المحادثات'); await s.click('button[aria-pressed]:has-text("القنوات")'); await s.waitForTimeout(400);
await s.screenshot({ path: 'ui/cc-8-filter.png' });
if (!(await s.isVisible(`aside >> text=إعلانات المرحلة الثالثة ${n}`))) throw new Error('channels filter');
ok('"Channels" filter in the chat list');

// الوضع الليلي + الإنجليزية لصفحة القناة
const d = await page(student, 'dark');

await fetch(B + '/auth/me/', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + student.token }, body: JSON.stringify({ mode: 'dark' }) });
await d.reload(); await d.waitForSelector('.wasl'); await d.waitForTimeout(600);
await d.click(`aside .w-scroll button:has-text("${n}")`); await d.waitForTimeout(800);
await d.screenshot({ path: 'ui/cc-9-channel-dark.png' });
console.log('errors:', errs.length ? [...new Set(errs)] : 'none');
await b.close();
