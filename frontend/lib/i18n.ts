/**
 * اللغة: العربية (الافتراضية، من اليمين إلى اليسار) أو الإنجليزية (من اليسار إلى اليمين).
 *
 * - النصوص تُكتب في الكود بالعربية الفصحى كما هي، وتُمرَّر إلى t():  t("المحادثات")
 *   فإن كانت اللغة الإنجليزية نبحث عن ترجمتها في قاموس EN (lib/i18n-en.ts).
 * - المتغيرات بين قوسين معقوفين:  t("آخر ظهور {time}", { time })
 * - داخل المكونات نستخدم useT() حتى يُعاد رسم المكوّن فور تغيير اللغة.
 * - الاختيار يُحفظ في المتصفح (لصفحة الدخول) وفي حساب المستخدم (ليتبعه على كل أجهزته).
 */
import { useSyncExternalStore } from "react";
import { EN } from "./i18n-en";
import { LANG_KEY as KEY } from "./lang-boot";

export type Lang = "ar" | "en";
export const LANGS: { value: Lang; label: string }[] = [
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
];

const listeners = new Set<() => void>();
let current: Lang = "ar";
if (typeof window !== "undefined") {
  try {
    current = localStorage.getItem(KEY) === "en" ? "en" : "ar";
  } catch {}
}

export function getLang(): Lang {
  return current;
}

/** اتجاه الصفحة واللغة على عنصر <html> (القوائم والأزرار تنقلب تلقائياً) */
function applyToDocument(lang: Lang) {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === "ar" ? "rtl" : "ltr";
}

export function setLang(lang: Lang) {
  if (typeof window === "undefined" || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {}
  applyToDocument(lang);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => "ar");
}

type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** ترجمة نص بحسب اللغة الحالية (للاستعمال خارج المكونات: رسائل الخطأ والإشعارات) */
export function t(ar: string, vars?: Vars): string {
  if (current === "en") {
    const en = EN[ar];
    if (en === undefined && process.env.NODE_ENV !== "production") console.warn("[i18n] missing:", ar);
    return fill(en ?? ar, vars);
  }
  return fill(ar, vars);
}

/** داخل المكونات: يعيد دالة الترجمة ويُعيد الرسم عند تغيير اللغة */
export function useT() {
  const lang = useLang();
  return (ar: string, vars?: Vars) => (lang === "en" ? fill(EN[ar] ?? ar, vars) : fill(ar, vars));
}

/** لغة تنسيق التاريخ والوقت (بأرقام إنجليزية في الحالتين، كما في التصميم) */
export function dateLocale(lang: Lang = current) {
  return lang === "ar" ? "ar-u-nu-latn" : "en-GB";
}
