// المكالمة الثنائية في الظروف الصعبة: الإلغاء أثناء سؤال إذن المايك، ورسالة تعارف ضاعت في الطريق،
// والاتصال ببعض في اللحظة نفسها، وسبب الفشل حين لا يتصل الجهازان
import { chromium } from 'playwright';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name) => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role: 'student', university_id: `G${u}${n}` }).then((r) => r.data);
const [ali, sara] = [await reg('ali', 'علي حسن'), await reg('sara', 'سارة أحمد')];
for (const [a, c] of [[ali, sara], [sara, ali]]) await req('POST', '/contacts/', { identifier: c.user.username }, a.token);
const dm = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'مرحباً سارة' }, ali.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

// ما يصل كل جهاز من الخادم على الاتصال العام يمر من هنا، لنُضيّع منه ما نريد
const filters = { ali: null, sara: null };
async function page(acc, who) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:3000' });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  // سؤال إذن المايك يأخذ وقتاً (الآيفون يسأل في كل مكالمة): ثانيتان
  await c.addInitScript(() => {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (cs) => new Promise((r) => setTimeout(r, window.__slowMic ? 2000 : 0)).then(() => orig(cs));
  });
  const p = await c.newPage();
  await p.routeWebSocket(/\/ws\/presence\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      const f = filters[who];
      const out = f ? f(JSON.parse(String(m))) : JSON.parse(String(m));
      if (out) ws.send(JSON.stringify(out));
    });
  });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(900);
  await p.click(`aside .w-scroll > button:has-text("${who === 'ali' ? 'سارة أحمد' : 'علي حسن'}")`);
  await p.waitForTimeout(600);
  return p;
}
const a = await page(ali, 'ali');
const s = await page(sara, 'sara');
const callBtn = 'main header button[aria-label="مكالمة صوتية"]';
const hangup = (p) => p.click('button[aria-label="إنهاء المكالمة"]');
const gone = (p) => p.waitForFunction(() => !document.querySelector('button[aria-label="إنهاء المكالمة"]') && !document.querySelector('button[aria-label="رد"]'), null, { timeout: 8000 });
async function connect() {
  await s.waitForSelector('button[aria-label="رد"]', { timeout: 10000 });
  await s.click('button[aria-label="رد"]');
  for (const p of [a, s]) await p.waitForSelector('.w-wave', { timeout: 20000 });
}
async function endBoth() {
  await hangup(a);
  for (const p of [a, s]) await gone(p);
}

// 1) ألغى المكالمة أثناء سؤال إذن المايك: كانت تُنشأ بعدها على الخادم وترن عند الآخر بلا أحد، وتمنع أي مكالمة دقيقة
await a.evaluate(() => { window.__slowMic = true; });
await a.click(callBtn);
await a.waitForTimeout(400);
await hangup(a);
await a.waitForTimeout(2600);
const ringing = await get('/calls/ringing/', sara.token);
if (ringing.call) fail(`a call cancelled while the mic prompt was open must not ring (call ${ringing.call.id} is ${ringing.call.status})`);
if (await s.isVisible('button[aria-label="رد"]')) await s.waitForFunction(() => !document.querySelector('button[aria-label="رد"]'), null, { timeout: 4000 });
await a.evaluate(() => { window.__slowMic = false; });
await a.click(callBtn);
await connect();
ok('hung up while the mic prompt was open: nothing rings at Sara, and calling again right away works');
await endBoth();

// 2) رسالة تعارف ضاعت: عرض المتصل لم يصل (هاتف سارة كان يعيد اتصاله لحظتها). كانت تبقى «جارٍ الاتصال» للأبد
let dropped = 0;
filters.sara = (e) => (e.type === 'call.signal' && e.data?.description?.type === 'offer' && dropped++ === 0 ? null : e);
await a.click(callBtn);
const t0 = Date.now();
await connect();
filters.sara = null;
if (dropped < 2) fail(`the offer should have been sent again after it was lost (sent ${dropped} times)`);
ok(`the caller's offer was lost on the way: it was sent again and the call connected (${((Date.now() - t0) / 1000).toFixed(1)}s after dialing)`);
await endBoth();

// 3) اتصلنا ببعض في اللحظة نفسها (لم يصل رنين علي إلى سارة بعد): بدل «توجد مكالمة جارية» ترى سارة مكالمة علي فترد
filters.sara = (e) => (e.type === 'call_incoming' ? null : e);
await a.click(callBtn);
await a.waitForSelector('text=يرنّ...', { timeout: 8000 });
await s.waitForTimeout(800);
await s.click(callBtn);
await s.waitForSelector('button[aria-label="رد"]', { timeout: 8000 });
if (await s.isVisible('text=توجد مكالمة جارية')) fail('Sara should not see "a call is already in progress"');
filters.sara = null;
await s.click('button[aria-label="رد"]');
for (const p of [a, s]) await p.waitForSelector('.w-wave', { timeout: 20000 });
ok('called each other at the same moment: Sara sees Ali\'s call coming in and answers it, instead of "a call is already in progress"');
await endBoth();

// 4) لا يتصل الجهازان أبداً (لا تصل عناوين أحدهما إلى الآخر، مثل شبكتين بلا خادم ترحيل): بعد 25 ثانية تنتهي المكالمة
// ويُذكر السبب. هنا لا خادم TURN في الإعداد، فالسبب: «غير مفعّل»
const noAddresses = (e) => {
  if (e.type !== 'call.signal') return e;
  if (e.data?.candidate) return null;
  if (e.data?.description) e.data.description.sdp = e.data.description.sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate')).join('\r\n');
  return e;
};
filters.ali = noAddresses; filters.sara = noAddresses;
await a.click(callBtn);
await s.waitForSelector('button[aria-label="رد"]', { timeout: 10000 });
await s.click('button[aria-label="رد"]');
await a.waitForSelector('text=جارٍ الاتصال...', { timeout: 8000 });
const reason = await a.waitForSelector('text=خادم المكالمات (TURN) غير مفعّل', { timeout: 35000 }).then(() => true, () => false);
if (!reason) { await a.screenshot({ path: 'ui/pg-dbg-a.png' }); await s.screenshot({ path: 'ui/pg-dbg-s.png' }); fail('a call that never connects should end with its reason'); }
await a.screenshot({ path: 'ui/pg-m-no-turn.png' });
filters.ali = null; filters.sara = null;
for (const p of [a, s]) await gone(p);
const last = (await get('/calls/', ali.token))[0];
if (!['ended', 'missed'].includes(last.status)) fail(`the failed call should be closed on the server (${last.status})`);
await a.click(callBtn);
await connect();
ok('a call that never connects ends after 25s saying why ("the call server (TURN) isn\'t enabled"), and the next call works');
await endBoth();

if (errs.length) fail('page errors: ' + errs.join(' | '));
ok('no page errors');
await b.close();
