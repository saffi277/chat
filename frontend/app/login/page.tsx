import type { Metadata } from "next";
import AuthForm from "../AuthForm";

export const metadata: Metadata = { title: "تسجيل الدخول | كلية الأسباط الجامعة" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
