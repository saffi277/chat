// مكالمة أُغلق فيها التطبيق دون «إنهاء» (نفدت البطارية، أو انقطع الإنترنت، أو أُغلق التطبيق من قائمة التطبيقات):
// كانت تبقى «جارية» للأبد، فكل من يتصل بعدها في المحادثة نفسها يرى «توجد مكالمة جارية في هذه المحادثة»
import { chromium } from 'playwright';
const B = 'http://localhost:8000/api';
const n = Date.now() % 100000;
const req = (method, path, body, token) => fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (path, token) => req('GET', path, null, token).then((r) => r.data);
const reg = (u, name) => req('POST', '/auth/register/', { username: `${u}${n}`, password: 'secret123', display_name: name, role: 'student', university_id: `F${u}${n}` }).then((r) => r.data);
const [ali, sara] = [await reg('ali', 'علي حسن'), await reg('sara', 'سارة أحمد')];
for (const [a, c] of [[ali, sara], [sara, ali]]) await req('POST', '/contacts/', { identifier: c.user.username }, a.token);
const dm = (await req('POST', '/conversations/', { user_id: sara.user.id }, ali.token)).data;
await req('POST', `/conversations/${dm.id}/messages/`, { content: 'مرحباً سارة' }, ali.token);

const ok = (m) => console.log('✅', m);
const fail = (m) => { throw new Error('❌ ' + m); };
const errs = [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const beats = { ali: 0, sara: 0 };
async function page(acc, who) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:3000' });
  await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.token, acc.user]);
  const p = await c.newPage();
  p.on('websocket', (ws) => ws.on('framesent', (f) => { if (String(f.payload).includes('"call.alive"')) beats[who]++; }));
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl'); await p.waitForTimeout(900);
  return p;
}
const a = await page(ali, 'ali');
const s = await page(sara, 'sara');
await a.click(`aside .w-scroll > button:has-text("سارة أحمد")`); await a.waitForSelector('main header >> text=سارة أحمد');
await a.click('main header button[aria-label="مكالمة صوتية"]');
await s.waitForSelector('text=مكالمة صوتية واردة', { timeout: 10000 });
await s.click('button[aria-label="رد"]');
for (const p of [a, s]) await p.waitForSelector('.w-wave', { timeout: 15000 });
const callId = (await get('/calls/', ali.token))[0].id;

// 1) مكالمة حقيقية تبقى جارية ما دام أحدهما فيها، ولو تجاوزت مهلة الانقطاع (70 ثانية)
await a.waitForTimeout(80000);
const busy = await req('POST', '/calls/', { conversation_id: dm.id }, sara.token);
if (busy.status !== 400) fail(`a live call must still block a second call (got ${busy.status})`);
if (!await a.isVisible('.w-wave') || !await s.isVisible('.w-wave')) fail('the live call was cut while both were in it');
if (beats.ali < 5 || beats.sara < 5) fail(`each device should say "still in the call" every 15s (ali ${beats.ali}, sara ${beats.sara})`);
ok(`a live call stays up past the 70s limit: each device says "still in the call" every 15s (${beats.ali} and ${beats.sara} beats in 80s)`);

// 2) أُغلق التطبيقان دون «إنهاء»: لا رسالة إنهاء تصل الخادم
await a.context().close(); await s.context().close();
const stuck = await req('POST', '/calls/', { conversation_id: dm.id }, sara.token);
if (stuck.status !== 400) fail(`right after closing, the call is not yet known to be over (got ${stuck.status})`);
await new Promise((r) => setTimeout(r, 72000));
const again = await req('POST', '/calls/', { conversation_id: dm.id }, sara.token);
if (again.status !== 201) fail(`after the apps closed, calling again must work (got ${again.status}: ${JSON.stringify(again.data)})`);
const old = (await get('/calls/', ali.token)).find((c) => c.id === callId);
if (old.status !== 'ended' || !(old.duration >= 75 && old.duration <= 110)) fail(`the abandoned call should end with its real length (${old.status}, ${old.duration}s)`);
ok(`both apps closed without "end": a minute later Sara can call Ali again, and the old call is logged as ended (${old.duration}s, its real length)`);
await req('POST', `/calls/${again.data.id}/end/`, null, sara.token);

if (errs.length) fail('page errors: ' + errs.join(' | '));
ok('no page errors');
await b.close();
