"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, saveSession, type User } from "@/lib/api";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const isLogin = mode === "login";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      // POST /api/auth/login/  body: {"username": "...", "password": "..."}
      const data = await api<{ token: string; user: User }>(`/auth/${mode}/`, "POST", { username, password });
      saveSession(data.token, data.user);
      router.push("/chat");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-emerald-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-emerald-700">{isLogin ? "تسجيل الدخول" : "حساب جديد"}</h1>
        <input className="w-full rounded-lg border p-2" placeholder="اسم المستخدم"
          value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input className="w-full rounded-lg border p-2" placeholder="كلمة المرور" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-emerald-600 p-2 font-bold text-white hover:bg-emerald-700">
          {isLogin ? "دخول" : "تسجيل"}
        </button>
        <p className="text-center text-sm">
          {isLogin ? "ما عندك حساب؟ " : "عندك حساب؟ "}
          <Link className="text-emerald-700 underline" href={isLogin ? "/register" : "/login"}>
            {isLogin ? "سجّل" : "ادخل"}
          </Link>
        </p>
      </form>
    </main>
  );
}
