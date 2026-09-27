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

  return (
    <main className="app-shell relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden p-5 lg:p-10">
      <div className="pointer-events-none absolute -right-20 top-8 h-72 w-72 rounded-full bg-violet-300/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-12 h-80 w-80 rounded-full bg-teal-200/45 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/70 bg-white/75 shadow-[0_25px_90px_rgba(30,36,70,.16)] backdrop-blur-xl lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden min-h-[620px] overflow-hidden bg-[#242453] p-12 text-white lg:flex lg:flex-col">
          <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(#a9a8ff_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative flex items-center gap-3 text-xl font-black tracking-tight"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-lg text-[#5b5cf0]">و</span> وَصل</div>
          <div className="relative my-auto">
            <p className="mb-4 text-sm font-bold tracking-[.18em] text-violet-200">قَرِّب المسافة</p>
            <h2 className="max-w-sm text-4xl font-black leading-[1.25]">كل أحاديثك المهمة، بلمسة أهدأ.</h2>
            <p className="mt-5 max-w-sm leading-8 text-indigo-100">مساحة بسيطة وسريعة حتى تبقى قريب من الأشخاص الذين يهمّونك.</p>
          </div>
          <div className="relative flex items-center gap-3 text-sm text-indigo-200"><span className="h-2 w-2 rounded-full bg-teal-300" /> محادثات خاصة وآمنة</div>
          <div className="absolute -bottom-16 -right-14 h-64 w-64 rounded-full border-[28px] border-violet-400/25" />
        </section>
        <section className="flex min-h-[620px] flex-col justify-center px-6 py-10 sm:px-12 lg:px-14">
          <div className="mb-10 flex items-center gap-3 text-lg font-black text-[#242453] lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5b5cf0] text-white">و</span> وَصل</div>
          <div className="mb-8">
            <p className="mb-2 text-sm font-bold text-[#6969a5]">أهلاً بك في وَصل</p>
            <h1 className="text-3xl font-black tracking-tight text-[#17172d]">{isLogin ? "سجّل دخولك" : "أنشئ حسابك"}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">{isLogin ? "أدخل بياناتك وكمل محادثاتك من حيث توقفت." : "ابدأ تجربة محادثة هادئة وسريعة خلال دقيقة."}</p>
          </div>
          <form onSubmit={submit} className="space-y-5">
            {!isLogin && (
              <label className="block text-sm font-bold text-slate-700">اسمك الظاهر <span className="font-normal text-slate-400">(اختياري)</span>
                <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-slate-400 focus:border-[#7775f5] focus:ring-4 focus:ring-violet-100" placeholder="مثلاً: مصطفى محمد" maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </label>
            )}
            <label className="block text-sm font-bold text-slate-700">اسم المستخدم
              <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-slate-400 focus:border-[#7775f5] focus:ring-4 focus:ring-violet-100" placeholder="اكتب اسم المستخدم" autoCapitalize="none" autoComplete="username" dir="auto" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            {!isLogin && <p className="-mt-3 text-xs text-slate-400">اسم المستخدم للدخول: حروف وأرقام و _ بدون فراغات.</p>}
            <label className="block text-sm font-bold text-slate-700">كلمة المرور
              <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-slate-400 focus:border-[#7775f5] focus:ring-4 focus:ring-violet-100" placeholder="••••••••" autoComplete={isLogin ? "current-password" : "new-password"} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}
            <button className="w-full rounded-2xl bg-[#5b5cf0] p-3.5 font-bold text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-[#4949dc] active:translate-y-0">
              {isLogin ? "دخول إلى المحادثات" : "إنشاء الحساب"}
            </button>
          </form>
          <p className="mt-7 text-center text-sm text-slate-500">{isLogin ? "مو مسجل بعد؟ " : "عندك حساب بالفعل؟ "}<Link className="font-bold text-[#5656dc] hover:underline" href={isLogin ? "/register" : "/login"}>{isLogin ? "أنشئ حساب" : "سجّل دخول"}</Link></p>
        </section>
      </div>
    </main>
  );
}
