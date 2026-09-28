// يُستورد في app/layout.tsx (مكوّن خادم)، لذا لا يعتمد على React
export const LANG_KEY = "lang";

/**
 * سكربت صغير يعمل قبل رسم الصفحة: يضبط اللغة والاتجاه من الاختيار المحفوظ
 * حتى لا تظهر الصفحة بالعربية لحظةً ثم تنقلب إلى الإنجليزية.
 */
export const LANG_BOOT_SCRIPT = `try{var l=localStorage.getItem("${LANG_KEY}")==="en"?"en":"ar";document.documentElement.lang=l;document.documentElement.dir=l==="ar"?"rtl":"ltr"}catch(e){}`;
