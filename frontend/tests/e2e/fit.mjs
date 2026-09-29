// صفحة الدخول في الهاتف: بارتفاع الشاشة دون تمرير، والأزرار تحت شريط الحالة؛ ولوحة المفاتيح لا تُخفي ترويسة المحادثة
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const acc = JSON.parse(readFileSync('seed/accounts.json'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ok = (m) => console.log('✅', m);
const errs = [];
for (const [name, vp] of [['se', { width: 375, height: 667 }], ['14', { width: 390, height: 844 }], ['max', { width: 430, height: 932 }]]) {
  for (const page of ['login', 'register']) {
    for (const scheme of ['dark', 'light']) {
      const c = await b.newContext({ viewport: vp, colorScheme: scheme, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const p = await c.newPage();
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto('http://localhost:3000/' + page); await p.waitForTimeout(900);
      const m = await p.evaluate(() => {
        const card = document.querySelector('section.p-card');
        const r = card.getBoundingClientRect();
        return { scroll: document.scrollingElement.scrollHeight, inner: innerHeight, top: r.top, bottom: r.bottom, zoom: card.style.zoom };
      });
      if (m.scroll > m.inner + 1 || m.bottom > m.inner + 1 || m.top < 0) throw new Error(`${page} ${name}: does not fit ${JSON.stringify(m)}`);
      if (scheme === 'dark') ok(`${page} @ ${vp.width}x${vp.height}: fits the screen (zoom ${m.zoom || 1})`);
      await p.screenshot({ path: `ui/fit-${page}-${name}-${scheme[0]}.png` });
      await c.close();
    }
  }
}

// لوحة المفاتيح: نحاكي تقلّص الجزء الظاهر من الشاشة (كما في الآيفون) ← الترويسة تبقى ظاهرة
const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await c.addInitScript(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [acc.me.token, acc.me.user]);
const p = await c.newPage();
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:3000/chat'); await p.waitForSelector('.wasl');
await p.click('aside .w-scroll button:has-text("Zahraa")'); await p.waitForTimeout(800);
await p.evaluate(() => {
  document.documentElement.style.setProperty('--app-h', '500px');  // ما يبقى ظاهراً فوق اللوحة
  document.documentElement.style.setProperty('--app-top', '0px');
});
await p.waitForTimeout(300);
const hdr = await p.evaluate(() => {
  const h = document.querySelector('main header').getBoundingClientRect();
  const box = document.querySelector('textarea[aria-label="الرسالة"]').getBoundingClientRect();
  return { headerTop: h.top, inputBottom: box.bottom };
});
if (hdr.headerTop < 0 || hdr.inputBottom > 500) throw new Error('keyboard layout wrong ' + JSON.stringify(hdr));
ok('with the keyboard open: header stays at the top and the message box sits right above the keyboard');
await p.screenshot({ path: 'ui/keyboard-sim.png' });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
