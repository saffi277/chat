// إشعارات Push: توصل حتى لو التطبيق مسدود.
// الخطوات: نسجل Service Worker ← نطلب إذن المستخدم ← المتصفح يسوي "اشتراك" عند شركته
// (Google/Apple/Mozilla) ← ندز الاشتراك للباك اند ← الباك اند يدز الإشعار لهذا الاشتراك.
import { api } from "./api";
import { t } from "./i18n";

export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// المفتاح العام يجي بصيغة base64url، والمتصفح يريده bytes
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// إذا خدمة الإشعارات ما ردت (نت ضعيف، أو متصفح بدون خدمات Google) ما نخلي الزر معلق للأبد
function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

// لازم تنادى من ضغطة زر (الآيفون وفايرفوكس يرفضون طلب الإذن بدون تفاعل)
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const { public_key } = await api<{ public_key: string }>("/push/key/");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await withTimeout(
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) }),
      15000,
      t("لم تستجب خدمة الإشعارات. حاول مرة أخرى."),
    ));
  await api("/push/subscribe/", "POST", sub.toJSON());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("/push/subscribe/", "DELETE", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}

// بعد الدخول: إذا الإذن موجود من قبل، نجدد الاشتراك بصمت ونربطه بالحساب الحالي
export async function syncPushSubscription() {
  if (!pushSupported()) return;
  await registerServiceWorker();
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await api("/push/subscribe/", "POST", sub.toJSON()).catch(() => {});
}
