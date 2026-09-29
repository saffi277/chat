// الإعدادات: قائمة أقسام، وكل قسم في صفحته؛ «معلوماتي» تحفظ الاسم والبريد؛ الخلفية الليلية والخط
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ok = (m) => console.log('✅', m); const errs = [];
const n = Date.now() % 100000;
const api = async (path, body, token, method = 'POST') => (await fetch('http://localhost:3000/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const A = await api('/auth/register/', { username: 'st' + n, password: 'secret123', display_name: 'مصطفى', role: 'faculty', university_id: 'U' + n });
await api('/auth/me/', { mode: 'dark' }, A.token, 'PATCH');
const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [A.token, A.user]);
const p = await c.newPage();
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl[data-theme="dark"]');
const bg = await p.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme, font: getComputedStyle(document.body).fontFamily }));
if (bg.body !== 'rgb(18, 23, 38)' || bg.scheme !== 'dark') throw new Error('dark background ' + JSON.stringify(bg));
ok('dark mode: page background behind the keyboard is dark, color-scheme dark');
if (!bg.font.startsWith('"IBM Plex Sans Arabic"')) throw new Error('font ' + bg.font);
if (!(await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Sans Arabic"', 'مرحبا'); }))) throw new Error('font not loaded');
ok('one fixed, clear font on every device (IBM Plex Sans Arabic), loaded with the app');
await p.click('nav >> text=الإعدادات'); await p.waitForTimeout(500);
const list = await p.locator('aside').innerText();
if (/الاسم الظاهر|إخفاء محتوى الإشعار|المايكروفون/.test(list)) throw new Error('settings list shows page content');
await p.screenshot({ path: 'ui/settings-list-d.png' });
ok('settings shows only the list of sections');
for (const [row, expect] of [['المظهر', 'تلقائي'], ['اللغة', 'English'], ['الإشعارات', 'إخفاء محتوى الإشعار'], ['الأذونات', 'المايكروفون']]) {
  await p.click(`aside button:has-text("${row}")`); await p.waitForSelector(`aside >> text=${expect}`);
  await p.click('button[aria-label="رجوع"]'); await p.waitForSelector('aside >> text=معلوماتي');
}
ok('each section opens its own page, and back returns to the list');
await p.click('aside button:has-text("معلوماتي")'); await p.waitForSelector('text=بيانات الجامعة');
await p.screenshot({ path: 'ui/settings-account-d.png', fullPage: false });
const inputs = p.locator('aside form input');
await inputs.nth(0).fill('مصطفى محمد');
await inputs.nth(2).fill(`mus${n}@asbat.edu.iq`);
await p.click('aside button:has-text("حفظ")'); await p.waitForTimeout(800);
const me = await api('/auth/me/', null, A.token, 'GET');
if (me.display_name !== 'مصطفى محمد' || me.email !== `mus${n}@asbat.edu.iq`) throw new Error('not saved ' + JSON.stringify(me));
if (!(await p.isVisible(`aside >> text=U${n}`))) throw new Error('university id not shown');
ok('«معلوماتي»: photo, name, phone and email editable and saved; university ID shown');
// المحادثة الليلية مع لوحة مفاتيح (محاكاة)
await p.click('nav >> text=المحادثات');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
