// الإرسال الفوري على إنترنت ضعيف، والفيديو ومشاركة الشاشة في المكالمة (مع محاكاة سفاري)، وإضافة شخص إلى مكالمة جارية،
// والسحب للخلف في الآيفون، وأيقونة التبويب
import { chromium } from 'playwright';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name) => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role: 'student', university_id: `D${u}${n}` }).then((r) => r.data);
const [ali, sara, omar] = [await reg('ali', 'علي حسن'), await reg('sara', 'سارة أحمد'), await reg('omar', 'عمر كريم')];
for (const [a, b] of [[ali, sara], [sara, ali], [ali, omar], [omar, ali], [sara, omar], [omar, sara]]) await req('POST', '/contacts/', { identifier: b.user.username }, a.token);
const dm = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'مرحباً سارة' }, ali.token);
const omarDm = (await req('POST', '/conversations/', { user_id: ali.user.id }, omar.token)).data;
await req('POST', `/conversations/${omarDm.id}/messages/`, { content: 'أهلاً علي' }, omar.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'] });

// محاكاة سفاري (الآيفون): مسار الفيديو القادم من الطرف الآخر يبقى «صامتاً» ولا يصل حدث unmute.
// كان التطبيق يعتمد على هذا الحدث فلا يظهر الفيديو (الكاميرا ومشاركة الشاشة) على الآيفون رغم وصوله
const SAFARI_TRACKS = () => {
  const muted = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'muted');
  Object.defineProperty(MediaStreamTrack.prototype, 'muted', { get() { return this.kind === 'video' ? true : muted.get.call(this); } });
  Object.defineProperty(MediaStreamTrack.prototype, 'onunmute', { set() {}, get() { return null; } });
};

// إنترنت ضعيف على اتصال المحادثة: تأخير ما يصل من الخادم، أو ضياع رسائل المرسل في الطريق
const net = { delay: 0, drop: false };
async function page(acc, { mobile = true, w = 390, h = 844, url = 'http://localhost:3000/chat', safari = false, slowNet = false } = {}) {
  const c = await b.newContext(mobile
    ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: w, height: h } });
  await c.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:3000' });
  if (acc) await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  if (safari) await c.addInitScript(SAFARI_TRACKS);
  const p = await c.newPage();
  if (slowNet) {
    await p.routeWebSocket(/\/ws\/chat\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => { if (!(net.drop && String(m).includes('"type":"message"'))) server.send(m); });
      server.onMessage((m) => setTimeout(() => ws.send(m), net.delay));
    });
  }
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|404|tile|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  await p.goto(url); await p.waitForSelector(acc ? '.wasl' : 'form'); await p.waitForTimeout(900);
  return p;
}
const openRow = async (p, name) => {
  if (await p.isVisible('nav >> text=المحادثات')) await p.click('nav >> text=المحادثات');
  await p.click(`aside .w-scroll > button:has-text("${name}")`); await p.waitForSelector(`main header >> text=${name}`); await p.waitForTimeout(600);
};
const bubbles = (p, text) => p.locator(`main [id^=m-]:has-text("${text}")`).count();
const typeAndSend = async (p, text) => { await p.fill('textarea[aria-label="الرسالة"]', text); await p.click('button[aria-label="إرسال"]'); };

// ------------------------------------------------ 1) الرسالة تظهر فوراً «قيد الإرسال» على إنترنت ضعيف
const s = await page(sara, { safari: true, slowNet: true });
await openRow(s, 'علي حسن');
net.delay = 2500;
const slow = 'رسالة على إنترنت ضعيف';
const t0 = Date.now();
await typeAndSend(s, slow);
await s.waitForSelector(`[data-testid=pending-message]:has-text("${slow}") [aria-label="جارٍ الإرسال..."]`, { timeout: 600 });
const shownAfter = Date.now() - t0;
await s.screenshot({ path: 'ui/pd-m-sending.png' });
await s.waitForSelector('[data-testid=pending-message]', { state: 'detached', timeout: 10000 });
if (await bubbles(s, slow) !== 1) fail(`the message should appear exactly once after the server replies (got ${await bubbles(s, slow)})`);
ok(`weak internet: the message shows instantly with a clock (${shownAfter}ms), then becomes a normal message once (server reply took 2.5s)`);

net.delay = 0; net.drop = true;
const lost = 'رسالة ضاعت في الطريق';
await typeAndSend(s, lost);
await s.waitForSelector(`[data-testid=pending-message]:has-text("${lost}")`, { timeout: 600 });
await s.waitForSelector('button:has-text("لم تُرسل. اضغط لإعادة المحاولة")', { timeout: 26000 });
await s.screenshot({ path: 'ui/pd-m-not-sent.png' });
net.drop = false;
await s.click('button:has-text("لم تُرسل. اضغط لإعادة المحاولة")');
await s.waitForSelector('[data-testid=pending-message]', { state: 'detached', timeout: 8000 });
const saved = (await get(`/conversations/${dm.id}/messages/`, sara.token)).filter((m) => m.content === lost).length;
if (saved !== 1 || await bubbles(s, lost) !== 1) fail(`lost message: saved ${saved}, shown ${await bubbles(s, lost)}`);
ok('lost on the way: after 20s it says "Not sent. Tap to retry"; tapping sends it, and it is saved and shown once');

// ------------------------------------------------ 2) الكاميرا ومشاركة الشاشة تظهران عند الطرف الآخر (الآيفون)
const d = await page(ali, { mobile: false, w: 1280, h: 800 });
await openRow(d, 'سارة أحمد');
const dbg = (tag) => async (e) => { await d.screenshot({ path: `ui/pd-dbg-${tag}-d.png` }); await s.screenshot({ path: `ui/pd-dbg-${tag}-s.png` }); throw e; };
async function voiceCall() {
  await d.click('main header button[aria-label="مكالمة صوتية"]');
  await s.waitForSelector('text=مكالمة صوتية واردة', { timeout: 10000 }).catch(dbg('ring'));
  await s.click('button[aria-label="رد"]');
  for (const p of [d, s]) await p.waitForSelector('.w-wave', { timeout: 15000 }).catch(dbg('connect'));
}
const remoteVideo = (p, fit) => p.waitForFunction((f) => {
  const v = document.querySelector(`video.inset-0.${f}`);
  return v && v.videoWidth > 0 && !v.paused && !v.classList.contains('opacity-0');
}, fit, { timeout: 15000 });
// مربع المشارك في المكالمة الجماعية: هل يظهر فيه فيديو يعمل (أم صورته الشخصية)؟
const tileVideo = (p, name, want = true) => p.waitForFunction(([nm, w]) => {
  const tile = [...document.querySelectorAll('[data-testid=call-tile]')].find((t) => t.textContent.includes(nm));
  const v = tile?.querySelector('video');
  const has = !!v && v.videoWidth > 0 && !v.classList.contains('opacity-0');
  return tile && (w ? has : !has);
}, [name, want], { timeout: 15000 });

// المكالمة الأولى: الهاتف يشغّل الكاميرا أثناء مكالمة صوتية
await voiceCall();
ok('audio call connected (Ali on a computer, Sara on a simulated iPhone)');
await s.screenshot({ path: 'ui/pd-m-call-buttons.png' });
const offscreen = await s.$$eval('button[aria-pressed]', (bs) => bs.filter((x) => { const r = x.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).length);
if (offscreen) fail(`${offscreen} call buttons are cut off the phone screen`);
ok('all five call buttons fit the phone screen (they wrap to a second row)');
await s.click('button[aria-label="فيديو"]');
await remoteVideo(d, 'object-cover').catch(dbg('camera'));
await d.screenshot({ path: 'ui/pd-d-sees-camera.png' });
ok("the phone turned its camera on mid-call: the computer shows it");
await d.click('button[aria-label="إنهاء المكالمة"]');
await s.waitForFunction(() => !document.querySelector('.w-wave'), null, { timeout: 10000 });
await s.waitForTimeout(2500);

// المكالمة الثانية: الحاسوب يشارك شاشته
await voiceCall();
await d.click('button[aria-label="مشاركة الشاشة"]');
await remoteVideo(s, 'object-contain').catch(dbg('share'));
await s.screenshot({ path: 'ui/pd-m-sees-screen.png' });
ok("screen share from the computer: the phone shows the whole screen (contain, not cropped), even with Safari's missing unmute event");

// ------------------------------------------------ 3) إضافة شخص إلى المكالمة الجارية (مثل واتساب)
const o = await page(omar);
await d.click('button[aria-label="إضافة"]');
const picker = d.locator('div.fixed:has(h3:has-text("إضافة إلى المكالمة"))');
await picker.locator('button:has-text("عمر كريم")').click();
await d.screenshot({ path: 'ui/pd-d-add-picker.png' });
await picker.locator('button:has-text("إضافة")').last().click();
await o.waitForSelector('text=يدعوك إلى المكالمة', { timeout: 10000 });
await o.screenshot({ path: 'ui/pd-m-invited.png' });
await o.click('button[aria-label="رد"]');
const tilesOk = async (p, want) => p.waitForFunction((w) => {
  const tiles = document.querySelectorAll('[data-testid=call-tile]');
  return tiles.length === w && ![...tiles].some((t) => t.textContent.includes('جارٍ الاتصال'));
}, want, { timeout: 20000 });
for (const p of [d, s, o]) await tilesOk(p, 3).catch(async (e) => { await p.screenshot({ path: 'ui/pd-dbg-tiles.png' }); throw e; });
ok('Ali added Omar mid-call: it rang for Omar ("is inviting you to the call"), he answered, and the one-to-one call became a 3-person call without dropping');
// عمر انضم بالصوت فقط (المكالمة صوتية)، وعلي يشارك شاشته: يُعاد التفاوض فيراها
await tileVideo(o, 'علي حسن').catch(async (e) => { await o.screenshot({ path: 'ui/pd-dbg-omar-screen.png' }); throw e; });
await tileVideo(s, 'علي حسن');
await o.screenshot({ path: 'ui/pd-m-three-screen.png' });
ok("Omar joined by voice only and still sees Ali's shared screen; Sara (iPhone) keeps seeing it in Ali's tile");
await d.click('[role=dialog][aria-label="مكالمة جماعية"] button[aria-label="إيقاف المشاركة"]');
for (const p of [o, s]) await tileVideo(p, 'علي حسن', false);
ok("Ali stopped sharing: his tile goes back to his picture for everyone");
await s.click('[role=dialog][aria-label="مكالمة جماعية"] button[aria-label="تشغيل الكاميرا"]');
for (const p of [d, o]) await tileVideo(p, 'سارة أحمد').catch(async (e) => { await p.screenshot({ path: 'ui/pd-dbg-sara-cam.png' }); throw e; });
await d.screenshot({ path: 'ui/pd-d-three.png' });
await o.screenshot({ path: 'ui/pd-m-three.png' });
ok("Sara turned her camera on in the 3-person call: Ali and Omar see it in Sara's own tile");
await o.click('button[aria-label="مغادرة المكالمة"]');
for (const p of [d, s]) await tilesOk(p, 2);
ok('Omar left: Ali and Sara are still in the call');
await s.click('button[aria-label="مغادرة المكالمة"]');
await d.waitForFunction(() => !document.querySelector('[role=dialog][aria-label="مكالمة جماعية"]'), null, { timeout: 10000 });
const log = await get('/calls/', ali.token);
if (log[0].status !== 'ended') fail(`call should end when one person is left (status ${log[0].status})`);
ok('Sara left too: Ali was alone, so the call ended (like WhatsApp)');

// ------------------------------------------------ 4) السحب للخلف في الآيفون لا يعيد صفحة الدخول
const m = await page(null, { url: 'http://localhost:3000/login' });
await m.fill('input[aria-label="البريد الجامعي أو الرقم الجامعي"]', `Domar${n}`);
await m.fill('input[aria-label="كلمة المرور"]', 'secret123');
await m.click('form button.p-btn');
await m.waitForSelector('.wasl', { timeout: 10000 }); await m.waitForTimeout(800);
await openRow(m, 'علي حسن');
await m.goBack(); await m.waitForTimeout(800);
if (!m.url().includes('/chat') || await m.isVisible('main header >> text=علي حسن')) fail(`swipe back inside a chat should close it (url ${m.url()})`);
await m.screenshot({ path: 'ui/pd-m-back-list.png' });
await m.mouse.click(200, 300); await m.waitForTimeout(200);
await m.goBack(); await m.waitForTimeout(1200);
if (!m.url().includes('/chat') || await m.isVisible('input[aria-label="كلمة المرور"]')) fail(`swipe back on the list must not show the login page (url ${m.url()})`);
await m.goto('http://localhost:3000/login'); await m.waitForURL(/\/chat/, { timeout: 8000 });
ok('swipe back: closes the open chat, then stays in the app; the login page never comes back while signed in');

// ------------------------------------------------ 5) أيقونة التبويب: شعار الكلية
const icons = await m.$$eval('link[rel=icon]', (ls) => ls.map((l) => l.getAttribute('href')));
const ico = await fetch('http://localhost:3000/favicon.ico');
if (!icons.some((h) => h.includes('college-192.png')) || ico.status !== 200) fail(`tab icon: ${icons.join(', ')}`);
ok('the browser tab shows the college logo');

// ------------------------------------------------ 6) الخلفية العامة والمحادثة ذات الخلفية الخاصة
await req('PATCH', `/conversations/${dm.id}/`, { wallpaper: 'campus' }, ali.token);
const w = await page(ali, { mobile: false, w: 1280, h: 800 });
await openRow(w, 'سارة أحمد');
await w.click('nav >> text=الإعدادات'); await w.click('aside button:has-text("الثيمات")');
const chatWall = () => w.$eval('main [data-wallpaper]', (el) => el.getAttribute('data-wallpaper')).catch(() => null);
await w.click('aside button:has-text("نقاط")'); await w.waitForTimeout(800);
if (await chatWall() !== 'campus') fail('the chat with its own background should keep it');
await w.waitForSelector('aside [role=status]:has-text("المحادثة المفتوحة لها خلفية خاصة بها (صورة الكلية)")');
await w.screenshot({ path: 'ui/pd-d-own-wallpaper.png' });
await w.click('aside [role=status] button:has-text("استعمال العامة")');
await w.waitForFunction(() => !document.querySelector('main [data-wallpaper]') && !document.querySelector('aside [role=status]'), null, { timeout: 8000 });
const shell = await w.$eval('.wasl-shell', (el) => el.getAttribute('data-wallpaper'));
if (shell !== 'dots') fail(`general background should be dots (got ${shell})`);
await w.screenshot({ path: 'ui/pd-d-general-wallpaper.png' });
ok('themes: a chat with its own background explains why it did not change, and one tap switches it to the general background');

if (errs.length) fail('page errors: ' + [...new Set(errs)].join(' | '));
ok('no page errors');
await b.close();
