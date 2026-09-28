/**
 * الأذونات: المايكروفون (الرسائل الصوتية والمكالمات)، الكاميرا (مكالمات الفيديو)، الإشعارات، الموقع.
 * - المتصفح يطلب الإذن عند ضغطة زر فقط، وعلى https فقط (أو localhost).
 * - إذا رفض المستخدم مرة، لا يسأل المتصفح ثانيةً: يجب أن يفعّله بنفسه من الإعدادات، لذا نشرح له الخطوات.
 */
import { t } from "./i18n";
import { enablePush, getPushState } from "./push";

export type PermName = "microphone" | "camera" | "notifications" | "geolocation";
export type PermState = "granted" | "denied" | "prompt" | "unsupported" | "insecure";

/** اسم الإذن وسببه بالعربية (مرّرهما إلى t() للعرض) */
export const PERM_LABELS: Record<PermName, { title: string; why: string }> = {
  microphone: { title: "المايكروفون", why: "للرسائل الصوتية والمكالمات" },
  camera: { title: "الكاميرا", why: "لمكالمات الفيديو والتصوير" },
  notifications: { title: "الإشعارات", why: "تصلك الرسائل والمكالمات حتى لو كان التطبيق مغلقاً" },
  geolocation: { title: "الموقع", why: "لمشاركة موقعك في المحادثة" },
};

export function platform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : "desktop";
}

/** هل هو مثبّت كتطبيق (من الشاشة الرئيسية)؟ الآيفون لا يسمح بالإشعارات إلا في هذه الحالة */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function query(name: "microphone" | "camera" | "geolocation"): Promise<PermState> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state as PermState;
  } catch {
    return "prompt"; // بعض المتصفحات (مثل سفاري القديم) لا تدعم الاستعلام عن الحالة
  }
}

export async function permState(name: PermName): Promise<PermState> {
  if (typeof window === "undefined") return "prompt";
  if (!window.isSecureContext) return "insecure";
  if (name === "notifications") {
    const s = await getPushState();
    return s === "on" ? "granted" : s === "denied" ? "denied" : s === "unsupported" ? "unsupported" : "prompt";
  }
  if (name === "geolocation") return "geolocation" in navigator ? query("geolocation") : "unsupported";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return query(name);
}

/** يطلب الإذن (يجب أن يكون من ضغطة زر). يعيد الحالة الجديدة */
export async function requestPerm(name: PermName): Promise<PermState> {
  const current = await permState(name);
  if (current === "insecure" || current === "unsupported") return current;
  try {
    if (name === "notifications") {
      const s = await enablePush();
      return s === "on" ? "granted" : s === "denied" ? "denied" : "prompt";
    }
    if (name === "geolocation") {
      await new Promise<GeolocationPosition>((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 15000 }));
      return "granted";
    }
    const stream = await navigator.mediaDevices.getUserMedia(name === "camera" ? { video: true } : { audio: true });
    stream.getTracks().forEach((tr) => tr.stop()); // نريد الإذن فقط، لا التسجيل
    return "granted";
  } catch (e) {
    return (e as Error).name === "NotAllowedError" || (e as GeolocationPositionError).code === 1 ? "denied" : permState(name);
  }
}

const MEDIA_ERRORS = ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError"];

/** هل الخطأ من المتصفح (إذن/جهاز)؟ إن لم يكن، فهو من الخادم ونعرض رسالته كما هي */
export function isDeviceError(e: unknown) {
  if (typeof window !== "undefined" && !window.isSecureContext) return true;
  const err = e as Error & { code?: number };
  return MEDIA_ERRORS.includes(err?.name) || (typeof err?.code === "number" && "PERMISSION_DENIED" in (err as object));
}

/** رسالة واضحة لأي خطأ من المايكروفون/الكاميرا/الموقع */
export function permError(e: unknown, name: PermName): string {
  const err = e as Error & { code?: number };
  const label = t(PERM_LABELS[name].title);
  if (typeof window !== "undefined" && !window.isSecureContext) return t("{label} يحتاج إلى رابط آمن (https). افتح التطبيق من الرابط الرسمي.", { label });
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError" || err?.code === 1) {
    return `${t("الوصول إلى {label} ممنوع.", { label })} ${howToEnable(name)}`;
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") return t("لم نجد {label} في هذا الجهاز.", { label });
  if (err?.name === "NotReadableError") return t("{label} مستخدم من تطبيق آخر. أغلقه وحاول مرة أخرى.", { label });
  if (name === "geolocation" && err?.code === 3) return t("استغرق تحديد الموقع وقتاً طويلاً. انتقل إلى مكان مفتوح أو شغّل الـ GPS وحاول مرة أخرى.");
  if (name === "geolocation" && err?.code === 2) return t("تعذّر تحديد موقعك. تأكد من أن الـ GPS يعمل.");
  return t("تعذّر تشغيل {label}. حاول مرة أخرى.", { label });
}

/** خطوات تفعيل الإذن بعد رفضه (بحسب الجهاز) */
export function howToEnable(name: PermName): string {
  const label = t(PERM_LABELS[name].title);
  switch (platform()) {
    case "ios":
      return name === "notifications"
        ? t("في الآيفون: أضف التطبيق إلى الشاشة الرئيسية أولاً (زر المشاركة ← إضافة إلى الشاشة الرئيسية)، ثم الإعدادات ← الإشعارات ← وَصل.")
        : t("في الآيفون: الإعدادات ← Safari ← {label} ← سماح (أو اضغط \"aA\" في شريط العنوان ← إعدادات موقع الويب).", { label });
    case "android":
      return t("في الأندرويد: اضغط 🔒 بجانب الرابط ← الأذونات ← {label} ← سماح، ثم حدّث الصفحة.", { label });
    default:
      return t("اضغط 🔒 بجانب الرابط في المتصفح ← {label} ← سماح، ثم حدّث الصفحة.", { label });
  }
}
