import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./wasl.css";

export const metadata: Metadata = {
  title: "وَصل | محادثاتك بمكان واحد",
  description: "تطبيق محادثات سريع وآمن",
  // لما ينضاف للشاشة الرئيسية بالآيفون يفتح مثل تطبيق (بدون شريط المتصفح)
  appleWebApp: { capable: true, title: "وَصل", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#0b141a" }],
  // نستخدم كل الشاشة حتى جوة النوتش، ونحمي الأطراف بـ env(safe-area-inset-*)
  viewportFit: "cover",
  // لما يطلع الكيبورد، الصفحة تصغر بدل ما يغطي خانة الكتابة
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
