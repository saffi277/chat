/**
 * الأذونات: المايك (الرسائل الصوتية والمكالمات)، الكاميرا (مكالمات الفيديو)، الإشعارات، الموقع.
 * - المتصفح يطلب الإذن بس من ضغطة زر، وبس على https (أو localhost).
 * - إذا المستخدم رفض مرة، المتصفح ما يسأل مرة ثانية: لازم يفعلها بنفسه من الإعدادات، فنشرحله الخطوات.
 */
import { enablePush, getPushState } from "./push";

export type PermName = "microphone" | "camera" | "notifications" | "geolocation";
export type PermState = "granted" | "denied" | "prompt" | "unsupported" | "insecure";

export const PERM_LABELS: Record<PermName, { title: string; why: string }> = {
  microphone: { title: "المايكروفون", why: "للرسائل الصوتية والمكالمات" },
  camera: { title: "الكاميرا", why: "لمكالمات الفيديو والتصوير" },
  notifications: { title: "الإشعارات", why: "توصلك الرسائل والمكالمات حتى لو التطبيق مسدود" },
  geolocation: { title: "الموقع", why: "لمشاركة موقعك بالمحادثة" },
};

export function platform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : "desktop";
}

/** مثبت كتطبيق (من الشاشة الرئيسية)؟ الآيفون ما يسمح بالإشعارات إلا بهاي الحالة */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function query(name: "microphone" | "camera" | "geolocation"): Promise<PermState> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state as PermState;
  } catch {
    return "prompt"; // بعض المتصفحات (مثل سفاري القديم) ما تدعم السؤال عن الحالة
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

/** يطلب الإذن (لازم من ضغطة زر). يرجع الحالة الجديدة */
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
    stream.getTracks().forEach((t) => t.stop()); // بس نريد الإذن، مو التسجيل
    return "granted";
  } catch (e) {
    return (e as Error).name === "NotAllowedError" || (e as GeolocationPositionError).code === 1 ? "denied" : permState(name);
  }
}

const MEDIA_ERRORS = ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError"];

/** الخطأ من المتصفح (إذن/جهاز)؟ لو لا، هو خطأ من السيرفر ونعرض رسالته مثل ما هي */
export function isDeviceError(e: unknown) {
  if (typeof window !== "undefined" && !window.isSecureContext) return true;
  const err = e as Error & { code?: number };
  return MEDIA_ERRORS.includes(err?.name) || (typeof err?.code === "number" && "PERMISSION_DENIED" in (err as object));
}

/** رسالة عربية واضحة لأي خطأ من المايك/الكاميرا/الموقع */
export function permError(e: unknown, name: PermName): string {
  const err = e as Error & { code?: number };
  const label = PERM_LABELS[name].title;
  if (typeof window !== "undefined" && !window.isSecureContext) return `${label} يحتاج رابط آمن (https). افتح التطبيق من الرابط الرسمي.`;
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError" || err?.code === 1) {
    return `ممنوع الوصول لـ${label}. ${howToEnable(name)}`;
  }
  if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") return `ما لگينا ${label} بهذا الجهاز.`;
  if (err?.name === "NotReadableError") return `${label} مستخدم من تطبيق ثاني. سده وجرب مرة ثانية.`;
  if (name === "geolocation" && err?.code === 3) return "تحديد الموقع طوّل. اطلع لمكان مفتوح أو شغّل الـ GPS وجرب مرة ثانية.";
  if (name === "geolocation" && err?.code === 2) return "ما گدرنا نحدد موقعك. تأكد إن الـ GPS شغال.";
  return `ما گدرنا نشغل ${label}. جرب مرة ثانية.`;
}

/** خطوات تفعيل الإذن بعد ما انرفض (حسب الجهاز) */
export function howToEnable(name: PermName): string {
  const label = PERM_LABELS[name].title;
  switch (platform()) {
    case "ios":
      return name === "notifications"
        ? "بالآيفون: أضف التطبيق للشاشة الرئيسية أول (زر المشاركة ← إضافة إلى الشاشة الرئيسية)، وبعدين الإعدادات ← الإشعارات ← وَصل."
        : `بالآيفون: الإعدادات ← Safari ← ${label} ← سماح (أو اضغط "aA" بشريط العنوان ← إعدادات موقع الويب).`;
    case "android":
      return `بالأندرويد: اضغط 🔒 يم الرابط ← الأذونات ← ${label} ← سماح، وبعدين حدّث الصفحة.`;
    default:
      return `اضغط 🔒 يم الرابط بالمتصفح ← ${label} ← سماح، وبعدين حدّث الصفحة.`;
  }
}
