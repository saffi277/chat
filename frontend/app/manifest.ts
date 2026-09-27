import type { MetadataRoute } from "next";

// ملف الـ Manifest يعرّف التطبيق للموبايل: اسمه، أيقونته، ألوانه، وشلون يفتح.
// هذا اللي يخلي "أضف للشاشة الرئيسية" يسويه تطبيق بدل رابط.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "وَصل",
    short_name: "وَصل",
    description: "تطبيق محادثات سريع وآمن",
    lang: "ar",
    dir: "rtl",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1f7bff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
