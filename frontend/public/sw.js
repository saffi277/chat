// Service Worker: سكربت يشتغل بالخلفية حتى لو صفحة التطبيق مسدودة.
// شغلته هنا: يستلم إشعارات Push ويعرضها، ويفتح المحادثة لما تضغط عليها.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // إذا المستخدم فاتح نفس المحادثة وقاعد يشوفها، ما نزعجه بإشعار
      const watching = clients.some(
        (c) => c.focused && c.visibilityState === "visible" && new URL(c.url).searchParams.get("c") === String(data.conversation),
      );
      if (watching) return;
      return self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag, // رسائل نفس المحادثة تبدل الإشعار القديم بدل ما تتكدس
        renotify: true,
        dir: "rtl",
        lang: "ar",
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
      // إذا التطبيق مفتوح بتبويب، نروحله بدل ما نفتح واحد جديد
      const existing = clients.find((c) => new URL(c.url).pathname.startsWith("/chat"));
      if (existing) return existing.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : self.clients.openWindow(url)));
      return self.clients.openWindow(url);
    }),
  );
});
