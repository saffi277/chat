import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // نسخة مستقلة صغيرة للتشغيل بـ Docker (deploy/)
  output: "standalone",
  // Django يحتاج الشرطة بآخر المسار (/api/auth/login/)، فلا نحذفها
  skipTrailingSlashRedirect: true,
  // التشغيل على جهاز واحد (./run-mobile.sh): الواجهة تمرر طلبات الخادم إلى Django،
  // فيكفي رابط واحد (للهاتف عبر النفق). في Docker يتولى Caddy ذلك قبل أن تصل الطلبات إلى هنا.
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    // قاعدتان لكل مسار: واحدة تحفظ الشرطة الأخيرة (/api/x/) وأخرى من دونها (/media/a.jpg)
    return ["api", "ws", "media", "admin", "static"].flatMap((p) => [
      { source: `/${p}/:path*/`, destination: `${backend}/${p}/:path*/` },
      { source: `/${p}/:path*`, destination: `${backend}/${p}/:path*` },
    ]);
  },
  async headers() {
    return [
      {
        // نسمح للموقع نفسه بس يطلب الكاميرا والمايك والموقع
        source: "/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), display-capture=(self)" }],
      },
      {
        // الـ Service Worker لازم ما يتخزن بالكاش، حتى أي تحديث يوصل للمستخدمين فوراً
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
