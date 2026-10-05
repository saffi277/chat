// تشغيل اختبارات المتصفح (Playwright) كلها أو بعضها:
//   npm run test:e2e                 ← كلها بالترتيب
//   npm run test:e2e -- pa pc        ← بعضها بالاسم
// قبل التشغيل: الخادم على 8000 (python manage.py runserver) والواجهة على 3000 (npm run build && npm start).
// المتغيرات: BACKEND_DIR (مجلد الخادم، افتراضياً ../backend)، PYTHON (أمر بايثون)، CHROMIUM_PATH (متصفح بعينه، اختياري).
// الصور الملتقطة تُحفظ في tests/e2e/.out/ui/ لمراجعتها.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".out");
const SUITES = [
  ["auth-e2e", "بوابة الدخول والتسجيل والأدوار"],
  ["e2e", "المحادثات والوسائط والمكالمة والحالات والمجموعات"],
  ["contacts-channels", "جهات الاتصال الخاصة والقنوات"],
  ["en", "الواجهة الإنجليزية"],
  ["settings", "الإعدادات"],
  ["fit", "ملاءمة شاشة الدخول ولوحة المفاتيح"],
  ["perms", "مركز الأذونات"],
  ["pa", "المرحلة أ: عارض الصور، والرفع بالتقدّم، والرد على الصور، وShift+Enter"],
  ["pb", "المرحلة ب: الثيمات، وإعدادات المحادثة، والجدولة، والمكالمة الجماعية"],
  ["pc", "المرحلة ج: الخصوصية والأمان، وإعادة التوجيه، والبحث، والاستطلاعات، والمجلدات"],
  ["pd", "الإرسال الفوري على إنترنت ضعيف، والفيديو ومشاركة الشاشة (سفاري)، والإضافة إلى المكالمة، والسحب للخلف"],
  ["pe", "المكالمة مثل Google Meet: الدردشة، والتفاعلات، ورفع اليد، والكتم، ومن يتكلم، وتبديل الكاميرا، وملء الشاشة، والتكبير"],
  ["pf", "مكالمة أُغلق فيها التطبيق دون «إنهاء» لا تمنع الاتصال بعدها («توجد مكالمة جارية»)"],
];
const wanted = process.argv.slice(2);
const list = wanted.length ? SUITES.filter(([n]) => wanted.includes(n)) : SUITES;
const env = {
  ...process.env,
  BACKEND_DIR: process.env.BACKEND_DIR || resolve(here, "../../../backend"),
  PYTHON: process.env.PYTHON || "python3",
};

mkdirSync(join(out, "ui"), { recursive: true });
execFileSync(env.PYTHON, [join(here, "fixtures.py"), out], { stdio: "inherit" });
execFileSync(process.execPath, [join(here, "seed.mjs")], { cwd: out, env, stdio: "inherit" });

const failed = [];
for (const [name, about] of list) {
  console.log(`\n━━━ ${name}: ${about}`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, `${name}.mjs`)], { cwd: out, env, stdio: "inherit", timeout: 10 * 60 * 1000 });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status === 0) console.log(`✔ ${name} (${secs}s)`);
  else { console.log(`✘ ${name} (${secs}s)`); failed.push(name); }
}
console.log(`\n${list.length - failed.length}/${list.length} نجحت${failed.length ? `، وفشلت: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
