"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api, saveSession, type User } from "@/lib/api";
import { Icon } from "./chat/_ui/icons";

const darkQuery = "(prefers-color-scheme: dark)";
const subscribeDark = (cb: () => void) => {
  const mq = window.matchMedia(darkQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const isLogin = mode === "login";
  const dark = useSyncExternalStore(subscribeDark, () => window.matchMedia(darkQuery).matches, () => false);

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

  const field = "w-input mt-2 h-12 w-full rounded-xl px-4 text-base font-normal outline-none";
  return (
    // الألوان تتبع الجهاز (فاتح/داكن) لأن المستخدم بعده ما مسجل
    <main className="wasl flex min-h-dvh flex-1 items-center justify-center p-4" data-theme={dark ? "dark" : "light"}>
      <section className="mx-auto w-full max-w-sm">
        <div className="grid justify-items-center text-center">
          <span className="w-accent grid h-16 w-16 place-items-center rounded-full"><Icon name="chats" size={30} filled /></span>
          <h1 className="mt-5 text-[26px] font-extrabold">{isLogin ? "تسجيل الدخول" : "حساب جديد"}</h1>
          <p className="w-muted mt-1.5 text-sm leading-6">{isLogin ? "أهلاً بيك بـ وَصل. كمل محادثاتك من حيث توقفت." : "سوّي حسابك خلال دقيقة وابدأ تحچي."}</p>
        </div>
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
            {error && <p className="rounded-xl px-3 py-2 text-sm font-bold" style={{ background: "color-mix(in srgb, var(--danger) 15%, transparent)", color: "var(--danger)" }}>{error}</p>}
            <button className="w-accent w-full rounded-full py-3.5 text-base font-bold transition active:scale-[.98]">
              {isLogin ? "دخول إلى المحادثات" : "إنشاء الحساب"}
            </button>
          </form>
          <p className="w-muted mt-6 text-center text-sm">
            {isLogin ? "مو مسجل بعد؟ " : "عندك حساب بالفعل؟ "}
            <Link className="w-accent-text font-extrabold hover:underline" href={isLogin ? "/register" : "/login"}>{isLogin ? "أنشئ حساب" : "سجّل دخول"}</Link>
          </p>
      </section>
    </main>
  );
}
