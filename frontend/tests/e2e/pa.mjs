// المرحلة أ: إصلاحات الواجهة، من البداية إلى النهاية في المتصفح (هاتف وحاسوب، نهاري وليلي)
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name) => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role: 'student', university_id: `S${u}${n}` }).then((r) => r.data);
const ali = await reg('ali', 'علي حسن'), sara = await reg('sara', 'سارة أحمد');
await req('POST', '/contacts/', { identifier: sara.user.username }, ali.token);
await req('POST', '/contacts/', { identifier: ali.user.username }, sara.token);
const conv = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
await req('POST', `/conversations/${conv.id}/messages/`, { content: 'مرحباً سارة' }, ali.token);
// سارة تنشر حالة: يجب أن تظهر حلقة خضراء حول صورتها عند علي
await req('POST', '/stories/', { kind: 'text', text: 'صباح الخير', background: '#0f6a4c' }, sara.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function page(acc, { mobile = true, scheme = 'light', w = 390, h = 844 } = {}) {
  const c = await b.newContext(mobile
    ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme }
    : { viewport: { width: w, height: h }, colorScheme: scheme });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|404|tile|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(900);
  return p;
}
const lastMsgs = () => get(`/conversations/${conv.id}/messages/`, ali.token);

// ------------------------------------------------ 1) الهاتف: القائمة
const m = await page(ali);
const vp = await m.getAttribute('meta[name=viewport]', 'content');
if (!/maximum-scale=1/.test(vp)) fail('viewport lacks maximum-scale=1: ' + vp);
ok('viewport: ' + vp + ' (no auto-zoom on input focus in iOS)');
const rows = await m.$$eval('aside .w-scroll > button', (els) => els.map((e) => e.textContent.trim().slice(0, 30)));
if (!rows[0].startsWith('الرسائل المحفوظة')) fail('saved messages not first: ' + rows[0]);
ok('Saved Messages is pinned at the top of the chat list (before any chat is created)');
const ring = await m.$('aside .w-scroll .w-story-ring');
if (!ring) fail('no green story ring in chat list');
const ringBg = await ring.evaluate((e) => getComputedStyle(e).backgroundImage);
if (!/37, 211, 102/.test(ringBg)) fail('ring is not green: ' + ringBg);
ok('green story ring around Sara in the chat list: ' + ringBg.slice(0, 60));
await m.screenshot({ path: 'ui/pa-m-list.png' });
// الضغط على الصورة ذات الحلقة يفتح الحالة
await m.click('aside .w-scroll [aria-label="عرض الحالة"]'); await m.waitForTimeout(700);
if (!(await m.isVisible('text=صباح الخير'))) fail('story did not open from the avatar');
ok('tapping the ringed avatar opens her story');
await m.keyboard.press('Escape'); await m.waitForTimeout(300);
if (await m.isVisible('text=صباح الخير')) { await m.mouse.click(10, 10); await m.goto('http://localhost:3000/chat'); await m.waitForSelector('.wasl'); await m.waitForTimeout(700); }
const ring2 = await m.$eval('aside .w-scroll > button:has-text("سارة أحمد")', (e) => !!e.querySelector('.w-story-ring'));
if (ring2) fail('ring still green after viewing');
ok('after viewing, the ring turns grey (seen)');

// ------------------------------------------------ 2) الهاتف: Enter سطر جديد، والإرسال بالزر
await m.click('aside .w-scroll > button:has-text("سارة أحمد")'); await m.waitForSelector('main header >> text=سارة أحمد');
const box = m.locator('textarea[aria-label="الرسالة"]');
await box.fill('');
await box.type('السطر الأول'); await m.keyboard.press('Enter'); await box.type('السطر الثاني');
const val = await box.inputValue();
if (val !== 'السطر الأول\nالسطر الثاني') fail('mobile Enter did not insert a newline: ' + JSON.stringify(val));
const hBox = await box.evaluate((e) => e.clientHeight);
await m.click('button[aria-label="إرسال"]'); await m.waitForTimeout(900);
let msgs = await lastMsgs();
if (msgs.at(-1).content !== 'السطر الأول\nالسطر الثاني') fail('multi-line message not sent: ' + msgs.at(-1).content);
ok(`mobile: Enter adds a new line (box grew to ${hBox}px), the send button sends both lines as one message`);
await m.screenshot({ path: 'ui/pa-m-multiline.png' });

// ------------------------------------------------ 3) الحاسوب: Shift+Enter سطر، وEnter يرسل
const d = await page(ali, { mobile: false, w: 1440, h: 900 });
const asideW = await d.$eval('aside', (e) => e.getBoundingClientRect().width);
const mainW = await d.$eval('main', (e) => e.getBoundingClientRect().width);
if (asideW !== 400 || Math.round(asideW + mainW) !== 1440) fail(`desktop width: aside ${asideW}, main ${mainW}`);
ok(`1440px: list ${asideW}px + chat ${mainW}px = the whole screen (no empty side margins)`);
const split = await d.$eval('aside', (e) => getComputedStyle(e).borderInlineEndColor);
if (split !== 'rgb(220, 220, 231)') fail('divider colour: ' + split);
ok('light mode: clear divider between the list and the chat: ' + split);
await d.click('aside .w-scroll > button:has-text("سارة أحمد")'); await d.waitForSelector('main header >> text=سارة أحمد');
const dbox = d.locator('textarea[aria-label="الرسالة"]');
await dbox.type('سطر 1'); await d.keyboard.press('Shift+Enter'); await dbox.type('سطر 2');
if ((await dbox.inputValue()) !== 'سطر 1\nسطر 2') fail('Shift+Enter did not add a newline');
await d.keyboard.press('Enter'); await d.waitForTimeout(900);
msgs = await lastMsgs();
if (msgs.at(-1).content !== 'سطر 1\nسطر 2') fail('Enter did not send on desktop: ' + msgs.at(-1).content);
if ((await dbox.inputValue()) !== '') fail('box not cleared');
ok('desktop: Shift+Enter adds a new line, Enter sends');

// ------------------------------------------------ 4) إرسال صورة مثل واتساب: تظهر فوراً مع التقدّم
const s = await page(sara); // سارة (المستقبلة) على الهاتف
await s.click('aside .w-scroll > button:has-text("علي حسن")'); await s.waitForSelector('main header >> text=علي حسن');
// نبطئ الشبكة: رفع علي بطيء، وتنزيل سارة بطيء، لنرى التقدّم ومكان الصورة المحجوز
const cdpD = await d.context().newCDPSession(d);
await cdpD.send('Network.enable');
await cdpD.send('Network.emulateNetworkConditions', { offline: false, latency: 50, downloadThroughput: 4e6, uploadThroughput: 250e3 });
const cdpS = await s.context().newCDPSession(s);
await cdpS.send('Network.enable');
await cdpS.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 120e3, uploadThroughput: 1e6 });
await d.setInputFiles('input[type=file][accept="image/*,video/*"]', 'ui/wide.jpg');
await d.waitForSelector('input[placeholder="أضف تعليقاً..."]');
await d.fill('input[placeholder="أضف تعليقاً..."]', 'مبنى الكلية');
await d.click('.fixed button[aria-label="إرسال"]');
await d.waitForSelector('main button[aria-label="إلغاء الإرسال"]', { timeout: 3000 });
ok('the photo appears in the chat immediately, with a progress ring and ✕ to cancel');
await d.waitForTimeout(1500);
const pct = await d.textContent('main [aria-label="جارٍ الإرسال..."]');
await d.screenshot({ path: 'ui/pa-d-uploading.png' });
ok('upload progress shown: ' + pct.trim());
await d.waitForSelector('main button[aria-label="إلغاء الإرسال"]', { state: 'detached', timeout: 30000 });
msgs = await lastMsgs();
const img = msgs.at(-1);
if (img.kind !== 'image' || img.width !== 2560 || img.height !== 1441) fail('server image dims: ' + JSON.stringify([img.kind, img.width, img.height]));
ok(`sent; the server stored the photo size ${img.width}×${img.height}`);
const stillLocal = await d.$eval(`#m-${img.id} img`, (e) => e.src.startsWith('blob:'));
ok('sender keeps the local copy after sending (no flicker): ' + stillLocal);
// عند المستقبل: مكان محجوز بقياس الصورة ومؤشر تحميل (لا رسالة فارغة)
await s.waitForSelector(`#m-${img.id}`, { timeout: 8000 });
const ph = await s.$eval(`#m-${img.id} button[aria-label="عرض الصورة"]`, (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, spin: !!e.querySelector('.animate-spin') }; });
if (ph.h < 100 || !ph.spin) fail('receiver placeholder: ' + JSON.stringify(ph));
await s.screenshot({ path: 'ui/pa-m-receiver-loading.png' });
ok(`receiver: placeholder ${Math.round(ph.w)}×${Math.round(ph.h)} (ratio ${(ph.w / ph.h).toFixed(2)}) with a loading spinner`);
await cdpS.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await cdpD.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await s.waitForFunction((id) => { const i = document.querySelector(`#m-${id} img`); return i && i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === '1'; }, img.id, { timeout: 30000 });
await s.waitForTimeout(400);
await s.screenshot({ path: 'ui/pa-m-receiver-loaded.png' });
ok('receiver: the photo fades in when it has loaded');

// إلغاء رفع أثناءه، ثم فشل وإعادة محاولة
await cdpD.send('Network.emulateNetworkConditions', { offline: false, latency: 50, downloadThroughput: 4e6, uploadThroughput: 100e3 });
await d.setInputFiles('input[type=file][accept="image/*,video/*"]', 'ui/tall.jpg');
await d.click('.fixed button[aria-label="إرسال"]');
await d.waitForSelector('main button[aria-label="إلغاء الإرسال"]');
await d.click('main button[aria-label="إلغاء الإرسال"]'); await d.waitForTimeout(800);
if (await d.$('main button[aria-label="إلغاء الإرسال"]')) fail('cancel did not remove the bubble');
const countAfterCancel = (await lastMsgs()).length;
ok('✕ cancels an upload in progress (nothing reaches the server)');
await cdpD.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await d.context().setOffline(true);
await d.setInputFiles('input[type=file][accept="image/*,video/*"]', 'ui/tall.jpg');
await d.click('.fixed button[aria-label="إرسال"]');
await d.waitForSelector('main button:has-text("إعادة المحاولة")', { timeout: 8000 });
await d.screenshot({ path: 'ui/pa-d-failed.png' });
await d.context().setOffline(false);
await d.click('main button:has-text("إعادة المحاولة")');
await d.waitForFunction(() => !document.querySelector('main button[aria-label="إلغاء الإرسال"]') && !document.body.innerText.includes('إعادة المحاولة'), null, { timeout: 15000 });
msgs = await lastMsgs();
if (msgs.length !== countAfterCancel + 1 || msgs.at(-1).width !== 800 || msgs.at(-1).height !== 1441) fail('retry: ' + JSON.stringify(msgs.at(-1)));
ok('offline → "Not sent" + Retry; retry sends it (portrait 800×1441 stored)');

// ------------------------------------------------ 5) الرد على صورة: ضغط مطوّل في الهاتف
const tallId = msgs.at(-1).id;
await s.waitForSelector(`#m-${tallId} img`);
await s.waitForTimeout(800);
const bb = await s.$eval(`#m-${img.id} > div`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; });
await cdpS.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x, y: bb.y }] });
await s.waitForTimeout(650);
await cdpS.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await s.waitForTimeout(400);
if (!(await s.isVisible(`#m-${img.id} button:has-text("رد")`))) fail('long-press did not open the message menu');
if (await s.$('[role=dialog][aria-label="عرض الصورة"]')) fail('long-press opened the viewer');
await s.screenshot({ path: 'ui/pa-m-longpress-menu.png' });
ok('mobile: long-press on the photo opens its menu (not the viewer)');
await s.click(`#m-${img.id} button:has-text("رد")`);
await s.waitForSelector('text=رد على علي حسن');
await s.fill('textarea[aria-label="الرسالة"]', 'صورة جميلة!'); await s.click('button[aria-label="إرسال"]'); await s.waitForTimeout(900);
msgs = await lastMsgs();
if (msgs.at(-1).reply_to?.id !== img.id) fail('reply not linked to the photo: ' + JSON.stringify(msgs.at(-1).reply_to));
await s.screenshot({ path: 'ui/pa-m-replied.png' });
ok('replying to a photo works: ' + msgs.at(-1).reply_to.preview);

// الحاسوب: زر ⌄ على الصورة، والنقر الأيمن على النص
await d.hover(`#m-${img.id} > div`);
await d.click(`#m-${img.id} button[aria-label="خيارات الرسالة"]`);
if (!(await d.isVisible(`#m-${img.id} button:has-text("رد")`))) fail('⌄ did not open the menu');
await d.screenshot({ path: 'ui/pa-d-menu.png' });
await d.click(`#m-${img.id} button:has-text("رد")`);
if (!(await d.isVisible('text=رد على علي حسن')) && !(await d.isVisible('text=رد على'))) fail('reply bar missing');
ok('desktop: the ⌄ button on the photo opens the menu → Reply');
await d.keyboard.press('Escape'); await d.waitForTimeout(200);
if (await d.isVisible('main >> text=رد على')) fail('Esc did not cancel the reply');
const textId = msgs.at(-1).id;
await d.click(`#m-${textId} > div`, { button: 'right' });
if (!(await d.isVisible(`#m-${textId} button:has-text("نسخ")`))) fail('right-click menu missing');
ok('desktop: right-click on a message opens its menu; Esc cancels a reply');
await d.keyboard.press('Escape'); await d.waitForTimeout(200);

// ------------------------------------------------ 6) عارض الصور: الصورة كاملة وزر إغلاق واضح
await d.click(`#m-${tallId} button[aria-label="عرض الصورة"]`);
await d.waitForSelector('[role=dialog][aria-label="عرض الصورة"] img');
await d.waitForTimeout(500);
const v = await d.evaluate(() => {
  const i = document.querySelector('[role=dialog][aria-label="عرض الصورة"] img').getBoundingClientRect();
  const x = document.querySelector('[role=dialog][aria-label="عرض الصورة"] button[aria-label="إغلاق"]').getBoundingClientRect();
  return { top: i.top, bottom: i.bottom, h: i.height, w: i.width, vh: innerHeight, xs: x.width, xtop: x.top };
});
if (v.top < 0 || v.bottom > v.vh || v.xs < 44) fail('viewer: ' + JSON.stringify(v));
await d.screenshot({ path: 'ui/pa-d-viewer.png' });
ok(`desktop viewer: the whole portrait photo fits (${Math.round(v.w)}×${Math.round(v.h)} inside ${v.vh}px), close button ${v.xs}px`);
await d.keyboard.press('Escape'); await d.waitForTimeout(300);
if (await d.$('[role=dialog][aria-label="عرض الصورة"]')) fail('Esc did not close the viewer');
if (!(await d.isVisible('main header >> text=سارة أحمد'))) fail('Esc closed the chat too');
ok('Esc closes the viewer only');
// الهاتف: العارض
await s.click(`#m-${img.id} button[aria-label="عرض الصورة"]`);
await s.waitForSelector('[role=dialog][aria-label="عرض الصورة"] img'); await s.waitForTimeout(400);
await s.screenshot({ path: 'ui/pa-m-viewer.png' });
await s.click('[role=dialog][aria-label="عرض الصورة"] button[aria-label="إغلاق"]'); await s.waitForTimeout(300);
if (await s.$('[role=dialog][aria-label="عرض الصورة"]')) fail('✕ did not close the viewer on mobile');
ok('mobile viewer: clear ✕ closes it');

// ------------------------------------------------ 7) الخروج من المحادثة في الحاسوب
await d.click('main header button[aria-label="إغلاق المحادثة"]'); await d.waitForTimeout(300);
if (!(await d.isVisible('text=وَصل للحاسوب'))) fail('✕ did not close the chat');
await d.click('aside .w-scroll > button:has-text("سارة أحمد")'); await d.waitForSelector('main header >> text=سارة أحمد');
await d.keyboard.press('Escape'); await d.waitForTimeout(300);
if (!(await d.isVisible('text=وَصل للحاسوب'))) fail('Esc did not close the chat');
ok('desktop: ✕ in the header, or Esc, leaves the conversation');

// ------------------------------------------------ 8) الرسائل المحفوظة من القائمة
await d.click('aside .w-scroll > button:has-text("الرسائل المحفوظة")'); await d.waitForSelector('main header >> text=الرسائل المحفوظة');
await d.fill('textarea[aria-label="الرسالة"]', 'ملاحظة لنفسي'); await d.keyboard.press('Enter'); await d.waitForTimeout(700);
const rows2 = await d.$$eval('aside .w-scroll > button', (els) => els.map((e) => e.textContent.trim().slice(0, 20)));
if (!rows2[0].startsWith('الرسائل المحفوظة')) fail('saved not first after use');
ok('Saved Messages opens from the pinned row and stays first');
await d.screenshot({ path: 'ui/pa-d-saved.png' });

// ------------------------------------------------ 9) أحجام الحاسوب، والوضع الليلي
for (const [w, h, want] of [[900, 700, 360], [1024, 768, 400], [1920, 1080, 440]]) {
  await d.setViewportSize({ width: w, height: h }); await d.waitForTimeout(300);
  const aw = await d.$eval('aside', (e) => e.getBoundingClientRect().width);
  const mw = await d.$eval('main', (e) => e.getBoundingClientRect().width);
  if (aw !== want || Math.round(aw + mw) !== w) fail(`${w}: ${aw}+${mw}`);
  ok(`${w}px: list ${aw}px, chat ${mw}px (full width)`);
}
await d.click('aside .w-scroll > button:has-text("سارة أحمد")'); await d.waitForTimeout(900);
await d.screenshot({ path: 'ui/pa-d-1920-light.png' });
const dd = await page(ali, { mobile: false, w: 1440, h: 900, scheme: 'dark' });
await dd.click('aside .w-scroll > button:has-text("سارة أحمد")'); await dd.waitForTimeout(1200);
await dd.screenshot({ path: 'ui/pa-d-dark.png' });
const md = await page(sara, { scheme: 'dark' });
await md.screenshot({ path: 'ui/pa-m-list-dark.png' });
await md.click('aside .w-scroll > button:has-text("علي حسن")'); await md.waitForTimeout(1200);
await md.screenshot({ path: 'ui/pa-m-chat-dark.png' });

console.log(errs.length ? '⚠️ page errors:\n' + errs.join('\n') : '✅ no page errors');
await b.close();
