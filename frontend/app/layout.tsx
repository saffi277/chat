import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "وَصل | محادثاتك بمكان واحد",
  description: "تطبيق محادثات سريع وآمن",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="flex h-full flex-col">{children}</body>
    </html>
  );
}
