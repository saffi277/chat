// لوحة الإدارة داخل التطبيق: تظهر لمدير النظام فقط، وفيها طلبات الأدوار والبلاغات وطلبات «نسيت كلمة المرور»
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name, role = 'student') => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role, university_id: `H${u}${n}` }).then((r) => r.data);
const boss = await reg('boss', 'مدير النظام');
execSync(`cd ${process.env.BACKEND_DIR} && ${process.env.PYTHON || 'python3'} manage.py shell -c "from django.contrib.auth.models import User; User.objects.filter(username='boss${n}').update(is_staff=True)"`);
const ali = await reg('ali', 'علي الإداري', 'staff');
const sara = await reg('sara', 'سارة أحمد');
await req('POST', '/contacts/', { identifier: ali.user.username }, sara.token);
await req('POST', '/reports/', { user_id: ali.user.id, reason: 'spam', details: `يرسل إعلانات ${n}` }, sara.token);
await req('POST', '/auth/help/', { kind: 'password', identifier: `Hsara${n}`, contact: `0770${n}` });

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function page(acc, { mobile = true } = {}) {
  const c = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(700);
  await p.click('nav >> text=الإعدادات'); await p.waitForTimeout(500);
  return p;
}

// 1) غير المدير لا يرى اللوحة، والخادم يرفضه
const s = await page(sara);
if (await s.isVisible('text=لوحة الإدارة')) fail('a student must not see the admin panel');
if ((await req('GET', '/manage/', null, sara.token)).status !== 403) fail('the server must refuse non-admins');
ok('a normal account has no "Admin panel" and the server refuses it (403)');

// 2) المدير: الصف مع عدد ما ينتظره، ثم الصفحة
const m = await page(boss);
// العدد يشمل ما تركته حزم الاختبار الأخرى في قاعدة البيانات نفسها، فنتأكد فقط أنه ظاهر وليس صفراً
await m.waitForSelector('button:has-text("لوحة الإدارة") [aria-label="طلبات تنتظرك"]', { timeout: 8000 });
await m.screenshot({ path: 'ui/ph-m-settings-row.png' });
await m.click('button:has-text("لوحة الإدارة")');
await m.waitForSelector('[data-testid=role-request]');
await m.screenshot({ path: 'ui/ph-m-panel.png', fullPage: true });
ok('the admin sees "Admin panel" in settings with a dot and the number of waiting items, and it opens');

// 3) قبول طلب الدور
const card = m.locator('[data-testid=role-request]', { hasText: `@ali${n}` });
if (!(await card.textContent()).includes('إداري')) fail('the card should say which role is requested');
await card.locator('button:has-text("قبول")').click();
await m.locator('[data-testid=role-request]', { hasText: `@ali${n}` }).waitFor({ state: 'detached', timeout: 8000 });
const me = await get('/auth/me/', ali.token);
if (me.role !== 'staff' || me.requested_role) fail(`approve failed: ${me.role}/${me.requested_role}`);
ok('approving the role request: Ali is now staff, and the request disappears');

// 4) نسيت كلمة المرور: كلمة جديدة من اللوحة
const sup = m.locator('[data-testid=support-request]', { hasText: `0770${n}` });
if (!(await sup.textContent()).includes(`0770${n}`)) fail('the contact should be shown');
await sup.locator('input[aria-label="كلمة مرور جديدة"]').fill('fresh-pass-9');
await sup.locator('button:has-text("تعيين")').click();
await sup.waitFor({ state: 'detached', timeout: 8000 });
const login = await req('POST', '/auth/login/', { identifier: `sara${n}`, password: 'fresh-pass-9' });
if (login.status !== 200) fail(`login with the new password failed (${login.status})`);
ok('"forgot password": the admin sets a new password from the panel, and Sara can sign in with it');

// 5) البلاغ
const rep = m.locator('[data-testid=report]', { hasText: `يرسل إعلانات ${n}` });
const text = await rep.textContent();
if (!text.includes('رسائل مزعجة') || !text.includes('يرسل إعلانات')) fail('report card: ' + text);
await rep.locator('button:has-text("تمت المراجعة")').click();
await rep.waitFor({ state: 'detached', timeout: 8000 });
ok('report shown with its reason and details; "Reviewed" clears it');

// 6) الحاسوب
const d = await page(boss, { mobile: false });
await d.click('button:has-text("لوحة الإدارة")');
await d.waitForSelector('text=الحسابات');
await d.screenshot({ path: 'ui/ph-d-panel.png' });
ok('the panel works on a computer too');

if (errs.length) fail('page errors: ' + errs.join(' | '));
ok('no page errors');
await b.close();
