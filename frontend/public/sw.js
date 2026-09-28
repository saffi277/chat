// Service Worker: سكربت يعمل في الخلفية حتى لو كانت صفحة التطبيق مغلقة.
// مهمته هنا: يستقبل إشعارات Push ويعرضها، ويفتح المحادثة عند الضغط عليها.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// أجهزة Apple: كل Push يجب أن يعرض إشعاراً، وإلا تلغي Apple الاشتراك بعد عدة مرات فتتوقف الإشعارات كلها
const APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent);

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // إن كان المستخدم يشاهد المحادثة نفسها الآن فلا داعي للإشعار (إلا على أجهزة Apple، انظر أعلاه)
      const watching = clients.some(
        (c) => c.focused && c.visibilityState === "visible" && new URL(c.url).searchParams.get("c") === String(data.conversation),
      );
      if (watching && !APPLE) return;
      // نقطة على أيقونة التطبيق (الرقم الدقيق يتحدّث عند فتح التطبيق)
      if (self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
      const lang = data.lang === "en" ? "en" : "ar";
      return self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag, // رسائل المحادثة نفسها تستبدل الإشعار القديم بدل أن تتكدس
        renotify: true, // ومع ذلك يرنّ ويهتز لكل رسالة جديدة
        dir: lang === "ar" ? "rtl" : "ltr",
        lang,
        data: { url: data.url },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/chat", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // إن كان التطبيق مفتوحاً (ولو في الخلفية): نركّز عليه ونرسل له الرابط ليفتح المحادثة أو المكالمة بنفسه،
      // دون إعادة تحميل الصفحة (إعادة التحميل كانت تُضيع نافذة المكالمة الواردة)
      const existing = clients.find((c) => new URL(c.url).pathname.startsWith("/chat"));
      if (existing) {
        existing.postMessage({ type: "open", url });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
