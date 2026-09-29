import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const acc = JSON.parse(readFileSync('seed/accounts.json'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [], missing = new Set();
const ok = (m) => console.log('✅', m);
const api = (path, method = 'GET', body) => fetch('http://localhost:8000/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + acc.me.token }, body: body && JSON.stringify(body) }).then((r) => r.json());
const watch = (p) => {
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { const t = m.text(); if (t.startsWith('[i18n] missing')) missing.add(t); else if (m.type() === 'error' && !/WebSocket|tile|net::|logo\.png|404/.test(t)) errs.push(t.slice(0, 200)); });
};
// ---------- صفحة الدخول: زر اللغة
for (const [name, vp] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844 }]]) {
  const c = await b.newContext({ viewport: vp, colorScheme: 'dark' });
  const p = await c.newPage(); watch(p);
  await p.goto('http://localhost:3000/login'); await p.waitForTimeout(800);
  await p.click('button:has-text("English")'); await p.waitForTimeout(500);
  const dir = await p.evaluate(() => document.documentElement.dir);
  if (dir !== 'ltr' || !(await p.isVisible('text=Welcome'))) throw new Error('login did not switch to English');
  await p.screenshot({ path: `ui/en-login-${name}.png` });
  if (name === 'm') {
    await p.fill('input[autocomplete=username]', 'nobody'); await p.fill('input[type=password]', 'wrong-pass'); await p.click('button:has-text("Sign in")');
    const box = p.locator('form p[role=alert]'); await box.waitFor(); const msg = await box.textContent();
    if (!/Incorrect sign-in details/.test(msg)) throw new Error('server error not in English: ' + msg);
    ok('server error comes back in English: ' + msg.slice(0, 40));
    await p.reload(); await p.waitForTimeout(600);
    if (await p.evaluate(() => document.documentElement.dir) !== 'ltr') throw new Error('language not remembered');
    ok('language remembered after reload');
  }
  await c.close();
}
ok('login page switches to English (LTR)');

// ---------- التطبيق بالإنجليزية
await api('/auth/me/', 'PATCH', { language: 'en', mode: 'light' });
async function page(vp) {
  const c = await b.newContext({ viewport: vp });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('lang', 'en'); }, [acc.me.token, acc.me.user]);
  const p = await c.newPage(); watch(p);
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(1000);
  return p;
}
let p = await page({ width: 1366, height: 820 });
await p.click('aside .w-scroll button:has-text("Zahraa")'); await p.waitForTimeout(1200);
await p.screenshot({ path: 'ui/en-desk-chat.png' });
const asideLeft = await p.evaluate(() => document.querySelector('aside').getBoundingClientRect().left);
if (asideLeft > 50) throw new Error('chat list should be on the left in English');
ok('desktop: list on the left, chat on the right');
await p.click('main header button:has-text("Zahraa")'); await p.waitForSelector('[role=dialog]'); await p.waitForTimeout(700);
await p.screenshot({ path: 'ui/en-desk-contact.png' });
await p.context().close();

p = await page({ width: 390, height: 844 });
await p.screenshot({ path: 'ui/en-m-list.png' });
await p.click('aside .w-scroll button:has-text("Zahraa")'); await p.waitForTimeout(1200);
await p.screenshot({ path: 'ui/en-m-chat.png' });
await p.click('button[aria-label="Back"]'); await p.waitForTimeout(300);
await p.click('nav >> text=Settings'); await p.waitForTimeout(600);
await p.screenshot({ path: 'ui/en-m-settings.png' });
await p.click('aside button:has-text("Language")'); await p.waitForTimeout(400);
await p.screenshot({ path: 'ui/en-m-settings-lang.png' });
// التبديل إلى العربية من الإعدادات: تنقلب فوراً وتُحفظ في الحساب
await p.click('button[role=radio]:has-text("العربية")'); await p.waitForTimeout(900);
if (await p.evaluate(() => document.documentElement.dir) !== 'rtl') throw new Error('did not flip to RTL');
if (!(await p.isVisible('nav >> text=الإعدادات'))) throw new Error('labels not Arabic');
if ((await api('/auth/me/')).language !== 'ar') throw new Error('language not saved on the account');
ok('settings: switching to Arabic flips the layout instantly and is saved on the account');
await p.screenshot({ path: 'ui/ar-m-settings-after-switch.png' });
await p.context().close();
console.log('missing translations:', missing.size ? [...missing] : 'none');
console.log('errors:', errs.length ? [...new Set(errs)] : 'none');
await b.close();
