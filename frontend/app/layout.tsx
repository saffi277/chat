import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./wasl.css";
import { LANG_BOOT_SCRIPT } from "@/lib/lang-boot";

export const metadata: Metadata = {
  title: "وَصل | محادثاتك في مكان واحد",
  description: "تطبيق محادثات سريع وآمن",
  // عند إضافته إلى الشاشة الرئيسية في الآيفون يفتح كتطبيق (دون شريط المتصفح)
  appleWebApp: { capable: true, title: "وَصل", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // يمنع الآيفون من تكبير الصفحة تلقائياً عند الضغط على خانة كتابة (تكبير الأصابع يبقى متاحاً في iOS)
  maximumScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#0b141a" }],
  // نستخدم الشاشة كلها حتى داخل النتوء، ونحمي الأطراف بـ env(safe-area-inset-*)
  viewportFit: "cover",
  // عند ظهور لوحة المفاتيح تصغر الصفحة بدل أن تغطي خانة الكتابة
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // اللغة والاتجاه يضبطهما سكربت صغير قبل الرسم (من اختيار المستخدم المحفوظ)، لذا نتجاهل اختلافهما عند الترطيب
    <html lang="ar" dir="rtl" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
