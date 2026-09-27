"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, saveSession, type User } from "@/lib/api";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const isLogin = mode === "login";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      // POST /api/auth/login/  body: {"username": "...", "password": "..."}
      const body = isLogin ? { username, password } : { username, password, display_name: displayName };
      const data = await api<{ token: string; user: User }>(`/auth/${mode}/`, "POST", body);
      saveSession(data.token, data.user);
      router.push("/chat");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const field = "w-input mt-2 h-13 w-full rounded-2xl px-4 text-base outline-none focus:ring-4 focus:ring-white/40";
  return (
    <main className="wasl relative flex min-h-dvh flex-1 items-center justify-center p-4 lg:p-10" data-theme="glass">
      <div className="grid w-full max-w-5xl items-center gap-8 lg:grid-cols-2">
        {/* الجهة الترحيبية (بالكمبيوتر) مثل التصميم: "أقرب لما يهمك" */}
        <section className="hidden text-white lg:block">
          <div className="flex items-center gap-3 text-2xl font-extrabold drop-shadow">
            <span className="w-accent grid h-14 w-14 place-items-center rounded-[20px] text-2xl">و</span>وَصل
          </div>
          <h2 className="mt-10 text-6xl font-extrabold leading-tight drop-shadow-lg">أقرب<br />لما يهمك</h2>
          <p className="mt-4 max-w-sm text-lg leading-8 text-white/90 drop-shadow">مراسلة سلسة، مكالمات صوت وفيديو، حالات، ومشاركة الموقع المباشر. بتصميم زجاجي هادئ.</p>
        </section>
        <section className="w-panel w-shadow mx-auto w-full max-w-md rounded-[32px] p-6 sm:p-9">
          <div className="mb-6 flex items-center gap-3 text-lg font-extrabold lg:hidden">
            <span className="w-accent grid h-11 w-11 place-items-center rounded-2xl">و</span>وَصل
          </div>
          <h1 className="text-3xl font-extrabold">{isLogin ? "سجّل دخولك" : "أنشئ حسابك"}</h1>
          <p className="w-muted mt-2 text-sm leading-6">{isLogin ? "أدخل بياناتك وكمل محادثاتك من حيث توقفت." : "ابدأ تجربة محادثة هادئة وسريعة خلال دقيقة."}</p>
          <form onSubmit={submit} className="mt-7 space-y-4">
            {!isLogin && (
              <label className="block text-sm font-bold">اسمك الظاهر <span className="w-muted font-normal">(اختياري)</span>
                <input className={field} placeholder="مثلاً: مصطفى محمد" maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </label>
            )}
            <label className="block text-sm font-bold">اسم المستخدم
              <input className={field} placeholder="اكتب اسم المستخدم" autoCapitalize="none" autoComplete="username" dir="auto" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            {!isLogin && <p className="w-muted -mt-2 text-xs">للدخول: حروف وأرقام و _ بدون فراغات.</p>}
            <label className="block text-sm font-bold">كلمة المرور
              <input className={field} placeholder="••••••••" autoComplete={isLogin ? "current-password" : "new-password"} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="rounded-2xl px-3 py-2 text-sm font-bold" style={{ background: "color-mix(in srgb, var(--danger) 15%, transparent)", color: "var(--danger)" }}>{error}</p>}
            <button className="w-accent w-full rounded-full py-4 text-base font-extrabold transition active:scale-[.98]">
              {isLogin ? "دخول إلى المحادثات" : "إنشاء الحساب"}
            </button>
          </form>
          <p className="w-muted mt-6 text-center text-sm">
            {isLogin ? "مو مسجل بعد؟ " : "عندك حساب بالفعل؟ "}
            <Link className="w-accent-text font-extrabold hover:underline" href={isLogin ? "/register" : "/login"}>{isLogin ? "أنشئ حساب" : "سجّل دخول"}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
