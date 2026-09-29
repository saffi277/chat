import { execSync } from 'child_process';
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ok = (s) => console.log('✅', s);
const n = Date.now() % 100000;
const c = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await c.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
// تسجيل: تدريسي + بريد + رقم جامعي
await p.goto('http://localhost:3000/register');
await p.click('button[role=radio]:has-text("تدريسي")');
await p.fill('input[aria-label="الاسم الكامل"]', 'د. سارة');
await p.fill('input[aria-label="اسم المستخدم"]', 'sara' + n);
await p.fill('input[aria-label="البريد الجامعي"]', `sara${n}@asbat.edu.iq`);
await p.fill('input[aria-label="الرقم الجامعي"]', 'T-' + n);
await p.fill('input[aria-label="كلمة المرور"]', 'secret123');
await p.click('button:has-text("إنشاء الحساب")');
await p.waitForURL('**/chat'); await p.waitForSelector('.wasl'); ok('register as faculty → chat');
await p.click('nav >> text=الإعدادات'); await p.waitForSelector('text=بانتظار موافقة الإدارة'); ok('faculty role awaits admin approval (shown in settings)');
// الإدارة تعتمد الدور (كما من /admin)
execSync(`cd ${process.env.BACKEND_DIR} && ${process.env.PYTHON || "python3"} manage.py shell -c "from accounts.models import Profile; Profile.objects.filter(university_id__iexact='T-${n}').update(role='faculty', requested_role='')"`);
await p.click('button:has-text("تسجيل الخروج")'); await p.waitForURL('**/login'); ok('logout');
// دور غلط
await p.fill('input[aria-label="البريد الجامعي أو الرقم الجامعي"]', 't-' + n);
await p.fill('input[aria-label="كلمة المرور"]', 'secret123');
await p.click('button:has-text("تسجيل الدخول")');
await p.waitForSelector('[role=alert]:has-text("تدريسي")'); ok('wrong role shows error');
// "تذكّرني" مفعّل افتراضياً؛ نلغيه هنا: الدخول بالرقم الجامعي دون "تذكّرني" = sessionStorage
if (!(await p.isChecked('input[type=checkbox]'))) throw new Error('remember me should be on by default');
ok('remember me is on by default');
await p.uncheck('input[type=checkbox]');
await p.click(`button[role=radio]:has-text("تدريسي")`);
await p.click('button:has-text("تسجيل الدخول")');
await p.waitForURL('**/chat'); await p.waitForSelector('.wasl');
const where = await p.evaluate(() => [!!sessionStorage.getItem('token'), !!localStorage.getItem('token')]);
if (where.join() !== 'true,false') throw new Error('storage ' + where); ok('login by university ID (session only)');
await p.click('nav >> text=الإعدادات'); await p.click('button:has-text("تسجيل الخروج")'); await p.waitForURL('**/login');
// بالبريد ويا "تذكرني"
await p.click('button[role=radio]:has-text("تدريسي")');
await p.fill('input[aria-label="البريد الجامعي أو الرقم الجامعي"]', `SARA${n}@asbat.edu.iq`);
await p.fill('input[aria-label="كلمة المرور"]', 'secret123');
await p.check('input[type=checkbox]');
await p.click('button:has-text("تسجيل الدخول")'); await p.waitForURL('**/chat');
if (!(await p.evaluate(() => !!localStorage.getItem('token')))) throw new Error('remember'); ok('login by email with remember me');
await p.click('nav >> text=الإعدادات'); await p.click('button:has-text("تسجيل الخروج")'); await p.waitForURL('**/login');
// نسيت كلمة المرور
await p.click('button:has-text("نسيت كلمة المرور؟")');
await p.fill('[role=dialog] input[aria-label="البريد الجامعي أو الرقم الجامعي"]', 'T-' + n);
await p.fill('[role=dialog] input[aria-label="وسيلة التواصل"]', '07701234567');
await p.click('[role=dialog] button:has-text("إرسال الطلب")');
await p.waitForSelector('[role=dialog] >> text=وصل طلبك'); ok('forgot password request sent');
await p.screenshot({ path: 'ui/auth-forgot.png' });
await p.click('[role=dialog] button:has-text("حسناً")');
await p.click('button:has-text("الأسئلة الشائعة")'); await p.waitForSelector('[role=dialog] >> text=كيف أسجّل الدخول؟'); ok('portal help opens');
await p.screenshot({ path: 'ui/auth-faq.png' });
// الوضع الليلي من الزر
await p.keyboard.press('Escape'); await p.click('[role=dialog] button[aria-label="إغلاق"]');
await p.click('button[aria-label="الوضع الليلي"]'); await p.waitForSelector('.portal[data-theme="dark"]'); ok('night toggle');
console.log('errors:', errs.length ? errs : 'none');
await b.close();
