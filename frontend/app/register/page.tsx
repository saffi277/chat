import type { Metadata } from "next";
import AuthForm from "../AuthForm";

export const metadata: Metadata = { title: "إنشاء حساب | كلية الأسباط الجامعة" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
