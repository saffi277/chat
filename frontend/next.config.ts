import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // نسخة مستقلة صغيرة للتشغيل بـ Docker (deploy/)
  output: "standalone",
  async headers() {
    return [
      {
        // نسمح للموقع نفسه بس يطلب الكاميرا والمايك والموقع
        source: "/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" }],
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
