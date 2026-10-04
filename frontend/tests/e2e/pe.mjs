// المكالمة مثل Google Meet: الدردشة، والتفاعلات، ورفع اليد، وعلامة كتم الصوت، وإبراز من يتكلم، وتبديل الكاميرا،
// وملء الشاشة، والتكبير، وتثبيت مشارك في المكالمة الجماعية — في المكالمة الثنائية العادية والجماعية
import { chromium } from 'playwright';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const reg = (u, name) => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role: 'student', university_id: `E${u}${n}` }).then((r) => r.data);
const [ali, sara, omar] = [await reg('ali', 'علي حسن'), await reg('sara', 'سارة أحمد'), await reg('omar', 'عمر كريم')];
for (const [a, b] of [[ali, sara], [sara, ali], [ali, omar], [omar, ali], [sara, omar], [omar, sara]]) await req('POST', '/contacts/', { identifier: b.user.username }, a.token);
const dm = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'مرحباً سارة' }, ali.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
// ثلاث كاميرات وهمية: الثانية منها في Chromium «كاميرا عمق» (Y16) لا تُرسل عبر WebRTC أصلاً، فنخفيها
// فيبقى للصفحة كاميرتان صالحتان كالأمامية والخلفية في الهاتف (لاختبار «تبديل الكاميرا»)
const TWO_CAMERAS = () => {
  const list = MediaDevices.prototype.enumerateDevices;
  MediaDevices.prototype.enumerateDevices = async function () { return (await list.call(this)).filter((d) => d.label !== 'fake_device_1'); };
};
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=device-count=3', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing', '--autoplay-policy=no-user-gesture-required'] });
async function page(acc, { mobile = true, w = 390, h = 844 } = {}) {
  const c = await b.newContext(mobile
    ? { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: w, height: h } });
  await c.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:3000' });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  await c.addInitScript(TWO_CAMERAS);
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|404|tile|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(900);
  return p;
}
const openRow = async (p, name) => {
  if (await p.isVisible('nav >> text=المحادثات')) await p.click('nav >> text=المحادثات');
  await p.click(`aside .w-scroll > button:has-text("${name}")`); await p.waitForSelector(`main header >> text=${name}`); await p.waitForTimeout(600);
};
const shot = (p, name) => p.screenshot({ path: `ui/${name}.png` });
const dbg = (ps, tag) => async (e) => { for (const [i, p] of ps.entries()) await shot(p, `pe-dbg-${tag}-${i}`); throw e; };

// ------------------------------------------------ مكالمة ثنائية عادية: الحاسوب ↔ الهاتف
const d = await page(ali, { mobile: false, w: 1280, h: 800 });
const s = await page(sara);
await openRow(d, 'سارة أحمد');
await d.click('main header button[aria-label="مكالمة صوتية"]');
await s.waitForSelector('text=مكالمة صوتية واردة', { timeout: 10000 });
await s.click('button[aria-label="رد"]');
for (const p of [d, s]) await p.waitForSelector('.w-wave', { timeout: 15000 }).catch(dbg([d, s], 'connect'));
ok('one-to-one voice call connected (computer ↔ phone)');

// 1) الدردشة داخل المكالمة
await s.click('button[aria-label="الدردشة"]');
await s.fill('input[aria-label="رسالة في المكالمة"]', 'مرحباً من الهاتف');
await s.click('[role=dialog][aria-label="دردشة المكالمة"] button[aria-label="إرسال"]');
await d.waitForSelector('button[aria-label="الدردشة"] [data-testid=chat-unread]:has-text("1")', { timeout: 8000 }).catch(dbg([d, s], 'unread'));
await shot(d, 'pe-d-chat-unread');
await d.click('button[aria-label="الدردشة"]');
await d.waitForSelector('[data-testid=call-chat-message]:has-text("مرحباً من الهاتف")');
await d.fill('input[aria-label="رسالة في المكالمة"]', 'أهلاً، أراك');
await d.keyboard.press('Enter');
await s.waitForSelector('[data-testid=call-chat-message]:has-text("أهلاً، أراك")', { timeout: 8000 });
if (await d.isVisible('button[aria-label="الدردشة"] [data-testid=chat-unread]')) fail('unread badge should clear while the chat is open');
await shot(s, 'pe-m-chat');
ok('in-call chat: the phone writes, the computer sees an unread badge, opens the chat, replies, and the phone gets it');
await s.click('[role=dialog][aria-label="دردشة المكالمة"] button[aria-label="إغلاق"]');
await d.click('[role=dialog][aria-label="دردشة المكالمة"] button[aria-label="إغلاق"]');

// 2) تفاعل سريع، ورفع اليد
await d.click('button[aria-label="تفاعل"]');
await d.click('[role=menu] button[aria-label="👍"]');
await s.waitForSelector('[data-testid=call-reaction]:has-text("👍"):has-text("علي حسن")', { timeout: 8000 }).catch(dbg([d, s], 'react'));
await shot(s, 'pe-m-reaction');
await s.click('button[aria-label="تفاعل"]');
await s.click('[role=menu] button:has-text("رفع اليد")');
await d.waitForSelector('[data-testid=peer-hand]', { timeout: 8000 }).catch(dbg([d, s], 'hand'));
await shot(d, 'pe-d-hand');
await s.click('button[aria-label="تفاعل"]');
await s.click('[role=menu] button:has-text("إنزال اليد")');
await d.waitForSelector('[data-testid=peer-hand]', { state: 'detached', timeout: 8000 });
ok('reactions float on the other screen with the sender\'s name; raising and lowering a hand shows on the other side');

// 3) علامة كتم الصوت
await s.click('button[aria-label="كتم الصوت"]');
await d.waitForSelector('[data-testid=peer-muted]', { timeout: 8000 }).catch(dbg([d, s], 'muted'));
await s.click('button[aria-label="إلغاء الكتم"]');
await d.waitForSelector('[data-testid=peer-muted]', { state: 'detached', timeout: 8000 });
ok('when Sara mutes herself, Ali sees "muted" under her name; it disappears when she unmutes');

// 4) من يتكلم الآن (المايك الوهمي يصدر نغمة كل ثانية)
await d.waitForSelector('[data-speaking]', { timeout: 15000 }).catch(dbg([d, s], 'speaking'));
ok('active speaker: a ring lights up around Sara\'s picture while sound comes from her microphone');

// 5) تبديل الكاميرا (الأمامية ↔ الخلفية)
await s.click('button[aria-label="فيديو"]');
await d.waitForFunction(() => { const v = document.querySelector('[data-pip] video'); return v && v.videoWidth > 0 && !v.classList.contains('opacity-0'); }, null, { timeout: 15000 });
const camId = () => s.$eval('video.h-40', (v) => v.srcObject?.getVideoTracks()[0]?.getSettings().deviceId);
const before = await camId();
await s.click('button[aria-label="تبديل الكاميرا"]');
await s.waitForFunction((old) => document.querySelector('video.h-40')?.srcObject?.getVideoTracks()[0]?.getSettings().deviceId !== old, before, { timeout: 8000 });
// صور جديدة تصل فعلاً بعد التبديل (لا يكفي أن يبقى مقاس الفيديو من الصور القديمة)
await d.waitForTimeout(1500);
const newFrames = await d.$eval('[data-pip] video', async (v) => {
  const a = v.getVideoPlaybackQuality().totalVideoFrames;
  await new Promise((r) => setTimeout(r, 2000));
  return v.getVideoPlaybackQuality().totalVideoFrames - a;
});
if (newFrames < 10) fail(`the other side should keep receiving video after switching camera (${newFrames} new frames in 2s)`);
ok('switch camera: the phone moves to its other camera and the computer keeps seeing video without a new connection');

// 6) ملء الشاشة والنافذة العائمة (الحاسوب)
await d.click('button[aria-label="ملء الشاشة"]');
await d.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
await shot(d, 'pe-d-fullscreen');
await d.click('button[aria-label="الخروج من ملء الشاشة"]');
await d.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
ok('full screen: the call fills the screen and returns');
if (await d.isVisible('button[aria-label="نافذة عائمة"]')) {
  await d.click('button[aria-label="نافذة عائمة"]'); await d.waitForTimeout(800);
  const pip = await d.evaluate(() => !!document.pictureInPictureElement);
  ok(`picture-in-picture button is offered on the computer (${pip ? 'opened a floating window' : 'headless Chromium has no floating windows; it fails quietly'})`);
  if (pip) await d.evaluate(() => document.exitPictureInPicture());
}

// 7) مشاركة الشاشة من الحاسوب، والتكبير على الهاتف
await d.click('button[aria-label="مشاركة الشاشة"]');
await s.waitForSelector('button[aria-label="تكبير"]', { timeout: 15000 }).catch(dbg([d, s], 'zoom'));
await s.click('button[aria-label="تكبير"]');
const zoomed = await s.$eval('[data-pip]', (el) => el.scrollWidth > el.clientWidth * 1.5);
if (!zoomed) fail('zoom should make the shared screen twice as large and scrollable');
await shot(s, 'pe-m-zoomed');
await s.click('button[aria-label="تصغير"]');
ok('shared screen on the phone: "Zoom in" doubles it (drag to move around), "Zoom out" fits it again');

// ------------------------------------------------ 8) بعد إضافة شخص: المكالمة الجماعية
const o = await page(omar);
await d.click('button[aria-label="إضافة"]');
const picker = d.locator('div.fixed:has(h3:has-text("إضافة إلى المكالمة"))');
await picker.locator('button:has-text("عمر كريم")').click();
await picker.locator('button:has-text("إضافة")').last().click();
await o.waitForSelector('text=يدعوك إلى المكالمة', { timeout: 10000 });
await o.click('button[aria-label="رد"]');
const tilesOk = async (p, want) => p.waitForFunction((w) => {
  const tiles = document.querySelectorAll('[data-testid=call-tile]');
  return tiles.length === w && ![...tiles].some((t) => t.textContent.includes('جارٍ الاتصال'));
}, want, { timeout: 20000 });
for (const p of [d, s, o]) await tilesOk(p, 3).catch(dbg([d, s, o], 'tiles'));
// كاميرا سارة (بعد التبديل) تظهر في مربعها عند علي وعمر
const tileVideo = (p, name) => p.waitForFunction((nm) => {
  const v = [...document.querySelectorAll('[data-testid=call-tile]')].find((t) => t.textContent.includes(nm))?.querySelector('video');
  return !!v && v.videoWidth > 0 && !v.classList.contains('opacity-0');
}, name, { timeout: 15000 });
for (const p of [d, o]) await tileVideo(p, 'سارة أحمد').catch(dbg([d, o], 'sara-cam'));
// علي يشارك شاشته: تُكبَّر تلقائياً عند الآخرين (مثل Google Meet)
await o.waitForSelector('[data-testid=call-tile][data-pinned]:has-text("علي حسن")', { timeout: 15000 }).catch(dbg([o], 'autopin'));
await shot(o, 'pe-m-group-autopin');
ok("3-person call: Ali's shared screen is enlarged automatically for the others, the rest in a strip below");
// الضغط على مربع سارة يكبّرها بدل الشاشة، والضغط ثانية يعيد الشبكة
await o.click('[data-testid=call-tile]:has-text("سارة أحمد")');
await o.waitForSelector('[data-testid=call-tile][data-pinned]:has-text("سارة أحمد")', { timeout: 5000 });
await shot(o, 'pe-m-group-pinned');
await o.click('[data-testid=call-tile][data-pinned]');
await o.waitForFunction(() => !document.querySelector('[data-testid=call-tile][data-pinned]'), null, { timeout: 5000 });
ok('tapping a tile enlarges that person; tapping again returns to the grid');
await d.click('[role=dialog][aria-label="مكالمة جماعية"] button[aria-label="إيقاف المشاركة"]');

// الدردشة والتفاعل ورفع اليد وكتم الصوت في المكالمة الجماعية
await o.click('button[aria-label="الدردشة"]');
await o.fill('input[aria-label="رسالة في المكالمة"]', 'سلام عليكم جميعاً');
await o.keyboard.press('Enter');
for (const p of [d, s]) await p.waitForSelector('[data-testid=chat-unread]', { timeout: 8000 }).catch(dbg([d, s, o], 'group-chat'));
await o.click('[role=dialog][aria-label="دردشة المكالمة"] button[aria-label="إغلاق"]');
await o.click('button[aria-label="تفاعل"]');
await o.click('[role=menu] button:has-text("رفع اليد")');
for (const p of [d, s]) await p.waitForSelector('[data-testid=call-tile]:has-text("عمر كريم") [data-testid=tile-hand]', { timeout: 8000 });
await s.click('button[aria-label="كتم الصوت"]');
for (const p of [d, o]) await p.waitForSelector('[data-testid=call-tile]:has-text("سارة أحمد") [data-testid=tile-muted]', { timeout: 8000 });
if (await d.isVisible('[data-testid=call-tile]:has-text("عمر كريم") [data-testid=tile-muted]')) fail('only Sara is muted');
await d.waitForTimeout(800);
await shot(d, 'pe-d-group');
ok("group call: Omar's chat reaches both (unread badge), his raised hand shows ✋ on his tile for everyone, Sara's mute shows on her tile");

for (const p of [o, s]) await p.click('button[aria-label="مغادرة المكالمة"]');
await d.waitForFunction(() => !document.querySelector('[role=dialog][aria-label="مكالمة جماعية"]'), null, { timeout: 10000 });

if (errs.length) fail('page errors: ' + [...new Set(errs)].join(' | '));
ok('no page errors');
await b.close();
