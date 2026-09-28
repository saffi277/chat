"use client";
/**
 * بوابة الدخول (كلية الأسباط الجامعة): تسجيل الدخول وإنشاء حساب.
 * لابتوب: صورة الحرم تملي الشاشة والبطاقة الزجاجية يمين. موبايل: البطاقة بالنص على خلفية ناعمة.
 * الوضع (نهاري/ليلي) يتبع الجهاز، ويتبدل من زر ☀/🌙 (ينحفظ بالمتصفح).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ROLE_LABELS, saveSession, type Role } from "@/lib/api";
import { auth } from "@/lib/endpoints";
import { Icon, type IconName } from "./chat/_ui/icons";

const ROLES: Role[] = ["student", "faculty", "staff"];

// ------------------------------------------------------------ الوضع: الجهاز أو اختيار المستخدم
const MODE_KEY = "portal-mode";
const darkQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
function subscribeMode(cb: () => void) {
  const mq = window.matchMedia(darkQuery);
  mq.addEventListener("change", cb);
  listeners.add(cb);
  return () => { mq.removeEventListener("change", cb); listeners.delete(cb); };
}
function readMode(): "light" | "dark" {
  let saved: string | null = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch {}
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}
function setMode(mode: "light" | "dark") {
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  listeners.forEach((l) => l());
}

// ------------------------------------------------------------ الشعار: /brand/logo.png إذا موجود، وإلا شعار مؤقت
type LogoState = "loading" | "ok" | "missing";
let logoState: LogoState = "loading";
function subscribeLogo(cb: () => void) {
  if (logoState === "loading") {
    const img = new Image();
    img.onload = () => { logoState = "ok"; cb(); };
    img.onerror = () => { logoState = "missing"; cb(); };
    img.src = "/brand/logo.png";
  }
  return () => {};
}

function Logo({ size, night }: { size: number; night: boolean }) {
  const state = useSyncExternalStore(subscribeLogo, () => logoState, () => "loading" as LogoState);
  if (state === "ok") {
    // الشعار (خلفيته شفافة) + الشريط الذهبي تحته مرسوم بالكود حتى يطلع حاد بكل المقاسات.
    // بالليلي نستخدم logo-dark.png: داخل القوس أبيض والخط العربي فاتح (مثل التصميم)
    return (
      <div className="mx-auto flex w-fit flex-col items-stretch" style={{ height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- شعار الكلية من public/brand */}
        <img src={night ? "/brand/logo-dark.png" : "/brand/logo.png"} alt="كلية الأسباط الجامعة" className="w-auto" style={{ height: size * 0.9 }} />
        <span className="mt-auto grid place-items-center whitespace-nowrap font-extrabold uppercase leading-none text-white"
          style={{ background: "#a8802f", height: size * 0.075, fontSize: size * 0.05, letterSpacing: "0.06em" }} dir="ltr">
          Asbat University College
        </span>
      </div>
    );
  }
  if (state === "loading") return <div style={{ height: size }} />;
  // شعار مؤقت: قوس + كتاب + اسم الكلية (يتبدل تلقائياً لما ينحط logo.png)
  return (
    <div className="mx-auto grid justify-items-center" style={{ height: size }} aria-label="كلية الأسباط الجامعة">
      <svg viewBox="0 0 80 80" style={{ height: size * 0.72 }} aria-hidden="true">
        <path d="M14 76V34Q14 12 40 4Q66 12 66 34V76Z" fill="var(--p-green)" />
        <path d="M22 76V36Q22 20 40 13Q58 20 58 36V76Z" fill="var(--p-card)" />
        <path d="M28 76V38Q28 26 40 21Q52 26 52 38V76Z" fill="var(--p-green)" />
        <path d="M31 36c3-2 6-2 9 0 3-2 6-2 9 0v9c-3-2-6-2-9 0-3-2-6-2-9 0Z" fill="var(--p-gold)" />
      </svg>
      <span className="p-green mt-1 text-[11px] font-extrabold leading-none">كلية الأسباط الجامعة</span>
      <span className="p-gold mt-0.5 text-[7px] font-bold tracking-wider" dir="ltr">ASBAT UNIVERSITY COLLEGE</span>
    </div>
  );
}

// ------------------------------------------------------------ الصفحة
export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const theme = useSyncExternalStore(subscribeMode, readMode, () => "light" as const);
  const [modal, setModal] = useState<"password" | "support" | "faq" | "guide" | null>(null);
  const isLogin = mode === "login";
  const night = theme === "dark";

  return (
    <main className="portal relative min-h-dvh overflow-x-hidden" data-theme={theme}>
      {/* صورة الحرم تملي الشاشة (باللابتوب)، وبالموبايل خلفية غامقة/فاتحة ناعمة */}
      {/* الصورتين نفس القص والقياس بالضبط (الليلية محاذية على النهارية)، فالتبديل يصير تلاشي ناعم بدون ما يتحرك المبنى */}
      {(["day", "night"] as const).map((photo) => (
        <div key={photo} className="portal-photo pointer-events-none fixed inset-0 hidden transition-opacity duration-500 lg:block"
          style={{ backgroundImage: `url(/brand/campus-${photo}.webp)`, opacity: (photo === "night") === night ? 1 : 0 }} aria-hidden="true" />
      ))}
      <svg className="pointer-events-none fixed right-0 top-0 hidden h-[70vh] w-[45vw] lg:block" viewBox="0 0 600 700" preserveAspectRatio="none" aria-hidden="true">
        <path d="M600 40 C 420 60 300 200 290 700" fill="none" stroke="var(--p-gold)" strokeWidth="1.2" opacity=".35" />
        <path d="M600 110 C 460 130 360 250 350 700" fill="none" stroke="var(--p-gold)" strokeWidth="1" opacity=".22" />
      </svg>

      <button onClick={() => setMode(night ? "light" : "dark")} aria-label={night ? "الوضع النهاري" : "الوضع الليلي"}
        className="p-card absolute left-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full lg:left-6 lg:top-6">
        <Icon name={night ? "sun" : "moon"} size={18} />
      </button>

      {/* البطاقة: يمين الشاشة باللابتوب، وبالنص بالموبايل */}
      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 pb-8 pt-16 lg:justify-start lg:px-[5vw] lg:py-8">
        <section className="p-card p-fit w-full max-w-[540px] rounded-[30px] px-5 py-7 sm:px-10 sm:py-8">
          <Logo size={isLogin ? 176 : 118} night={night} />
          <h1 className={`p-welcome text-center font-extrabold ${isLogin ? "mt-5 text-[40px]" : "mt-3 text-[32px]"} leading-tight`}>
            {isLogin ? "مرحباً بكم" : "حساب جديد"}
          </h1>
          <p className="p-muted mx-auto mt-2 max-w-sm text-center text-[16px] leading-7">
            {isLogin ? "سجل الدخول للوصول إلى خدمات الجامعة والأنظمة الأكاديمية" : "لمنسوبي الجامعة: طلبة وتدريسيين وإداريين"}
          </p>
          {isLogin ? <LoginForm onForgot={() => setModal("password")} /> : <RegisterForm />}

          <div className="my-5 flex items-center gap-4 text-sm">
            <span className="h-px flex-1" style={{ background: "var(--p-input-border)" }} />
            <span className="p-muted">أو</span>
            <span className="h-px flex-1" style={{ background: "var(--p-input-border)" }} />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <HelpTile icon="help" label="الأسئلة الشائعة" onClick={() => setModal("faq")} />
            <HelpTile icon="book" label="دليل الاستخدام" onClick={() => setModal("guide")} />
            <HelpTile icon="headset" label="الدعم الفني" onClick={() => setModal("support")} />
          </div>
          <p className="p-muted mt-5 text-center text-[13px]">
            {isLogin ? "ما عندك حساب؟ " : "عندك حساب؟ "}
            <Link href={isLogin ? "/register" : "/login"} className="p-link font-bold">{isLogin ? "أنشئ حساب" : "سجّل دخولك"}</Link>
          </p>
        </section>
      </div>

      {modal === "faq" && <FaqModal onClose={() => setModal(null)} onSupport={() => setModal("support")} />}
      {modal === "guide" && <GuideModal onClose={() => setModal(null)} />}
      {(modal === "password" || modal === "support") && <HelpModal kind={modal} onClose={() => setModal(null)} />}
    </main>
  );
}

function HelpTile({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-tile grid justify-items-center gap-2 whitespace-nowrap rounded-2xl px-1 py-4 text-[13px] font-semibold transition hover:-translate-y-0.5 sm:text-[14px]">
      <span className="p-tile-icon"><Icon name={icon} size={26} /></span>
      {label}
    </button>
  );
}

// ------------------------------------------------------------ الحقول
/** الأيقونة الأساسية على اليسار (مثل التصميم)، وزر إضافي (مثل 👁) يمين */
function Field({ icon, children, start }: { icon: IconName; children: React.ReactNode; start?: React.ReactNode }) {
  return (
    <label className="p-field flex h-[56px] items-center gap-3 rounded-2xl px-4">
      {start}
      {children}
      <span className="p-muted shrink-0"><Icon name={icon} size={22} /></span>
    </label>
  );
}

const ROLE_ICONS: Record<Role, IconName> = { student: "cap", faculty: "user", staff: "users" };

function RolePicker({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  return (
    <div className="p-seg grid grid-cols-3 rounded-2xl p-1" role="radiogroup" aria-label="الدور">
      {ROLES.map((r) => (
        <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)}
          className="flex h-12 items-center justify-center gap-2 text-[16px] font-bold transition">
          <Icon name={ROLE_ICONS[r]} size={20} filled={role === r && r === "student"} />{ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}

function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field icon="lock" start={
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="p-muted shrink-0">
        <Icon name={show ? "eye" : "eyeOff"} size={22} />
      </button>
    }>
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder="كلمة المرور"
        autoComplete={autoComplete} required minLength={6} className="h-full min-w-0 flex-1 text-base" aria-label="كلمة المرور" />
    </Field>
  );
}

function ErrorBox({ text }: { text: string }) {
  return text ? (
    <p className="rounded-xl px-3 py-2 text-sm font-bold" role="alert" style={{ background: "color-mix(in srgb, #dc2626 14%, transparent)", color: "#f87171" }}>{text}</p>
  ) : null;
}

function LoginForm({ onForgot }: { onForgot: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>("student");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // POST /api/auth/login/  body: {"identifier", "password", "role"}
      const data = await auth.login(identifier.trim(), password, role);
      saveSession(data.token, data.user, remember);
      router.push("/chat");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <RolePicker role={role} setRole={setRole} />
      <Field icon="mail">
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="البريد الجامعي أو الرقم الجامعي"
          autoComplete="username" autoCapitalize="none" dir="auto" required className="h-full min-w-0 flex-1 text-base" aria-label="البريد الجامعي أو الرقم الجامعي" />
      </Field>
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="flex items-center justify-between text-[15px]">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="p-checkbox h-5 w-5 rounded" />
          تذكرني
        </label>
        <button type="button" onClick={onForgot} className="p-forgot">نسيت كلمة المرور؟</button>
      </div>
      <ErrorBox text={error} />
      <button disabled={busy} className="p-btn flex h-[58px] w-full items-center justify-center gap-3 rounded-2xl text-[19px] font-bold transition active:scale-[.99] disabled:opacity-70">
        {busy ? "جاري الدخول..." : "تسجيل الدخول"}
        <span className="-scale-x-100"><Icon name="logIn" size={23} /></span>
      </button>
    </form>
  );
}

function RegisterForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("student");
  const [form, setForm] = useState({ display_name: "", username: "", email: "", university_id: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await auth.register({ ...form, role, username: form.username.trim(), email: form.email.trim(), university_id: form.university_id.trim() });
      saveSession(data.token, data.user, true);
      router.push("/chat");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <RolePicker role={role} setRole={setRole} />
      <Field icon="user">
        <input value={form.display_name} onChange={set("display_name")} placeholder="الاسم الكامل" maxLength={50} className="h-full min-w-0 flex-1 text-base" aria-label="الاسم الكامل" />
      </Field>
      <Field icon="info">
        <input value={form.username} onChange={set("username")} placeholder="اسم المستخدم (بالإنگليزي)" autoComplete="username"
          autoCapitalize="none" dir="auto" required className="h-full min-w-0 flex-1 text-base" aria-label="اسم المستخدم" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field icon="mail">
          <input type="email" value={form.email} onChange={set("email")} placeholder="البريد الجامعي" autoComplete="email" dir="auto" className="h-full min-w-0 flex-1 text-base" aria-label="البريد الجامعي" />
        </Field>
        <Field icon="cap">
          <input value={form.university_id} onChange={set("university_id")} placeholder="الرقم الجامعي" dir="auto" className="h-full min-w-0 flex-1 text-base" aria-label="الرقم الجامعي" />
        </Field>
      </div>
      <PasswordField value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="new-password" />
      <ErrorBox text={error} />
      <button disabled={busy} className="p-btn flex h-[56px] w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold transition active:scale-[.99] disabled:opacity-70">
        {busy ? "جاري إنشاء الحساب..." : "إنشاء الحساب"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------ النوافذ
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 sm:place-items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px]" style={{ background: "var(--p-page)", color: "var(--p-text)", boxShadow: "var(--p-card-shadow)" }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-extrabold">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="p-muted"><Icon name="x" size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HelpModal({ kind, onClose }: { kind: "password" | "support"; onClose: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setDone((await auth.help({ kind, identifier, contact, message })).detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === "password" ? "نسيت كلمة المرور؟" : "الدعم الفني"} onClose={onClose}>
      {done ? (
        <div className="py-4 text-center">
          <span className="p-btn mx-auto grid h-14 w-14 place-items-center rounded-full"><Icon name="check" size={26} strokeWidth={2.6} /></span>
          <p className="mt-4 font-bold">{done}</p>
          <button onClick={onClose} className="p-btn mt-5 h-12 w-full rounded-2xl font-bold">تمام</button>
        </div>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <p className="p-muted text-sm leading-6">
            {kind === "password"
              ? "اكتب بريدك أو رقمك الجامعي، ويوصل طلبك للدعم الفني حتى يعيّنون إلك كلمة مرور جديدة ويتواصلون وياك."
              : "اكتب المشكلة اللي تواجهك، ويرد عليك فريق الدعم الفني بأقرب وقت."}
          </p>
          <Field icon="mail">
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="البريد الجامعي أو الرقم الجامعي"
              required={kind === "password"} dir="auto" className="h-full min-w-0 flex-1 text-base" aria-label="البريد الجامعي أو الرقم الجامعي" />
          </Field>
          <Field icon="phone">
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="رقم الهاتف أو بريد للتواصل" dir="auto"
              className="h-full min-w-0 flex-1 text-base" aria-label="وسيلة التواصل" />
          </Field>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} required={kind === "support"} rows={3}
            placeholder={kind === "password" ? "ملاحظة (اختياري)" : "شنو المشكلة؟"} aria-label="الرسالة"
            className="p-field w-full resize-none rounded-2xl px-4 py-3 text-base outline-none" />
          <ErrorBox text={error} />
          <button disabled={busy} className="p-btn h-12 w-full rounded-2xl font-bold disabled:opacity-70">{busy ? "جاري الإرسال..." : "إرسال الطلب"}</button>
        </form>
      )}
    </Modal>
  );
}

const FAQ = [
  ["شلون أدخل؟", "اختار دورك (طالب، تدريسي، إداري)، واكتب بريدك الجامعي أو رقمك الجامعي أو اسم المستخدم، وبعدين كلمة المرور."],
  ["يگلي الدور غلط", "كل حساب مسجل بدور واحد. اختار الدور اللي سجلت بيه، وإذا تعتقد الدور غلط راسل الدعم الفني."],
  ["شنو فايدة \"تذكرني\"؟", "إذا فعلتها يبقى حسابك مفتوح بهذا الجهاز حتى لو سديت المتصفح. لا تفعلها بجهاز مشترك."],
  ["نسيت كلمة المرور", "اضغط \"نسيت كلمة المرور؟\" وارسل طلب، والدعم الفني يعيّن إلك رمز جديد ويتواصل وياك."],
  ["الوضع الليلي", "من الزر ☀/🌙 بزاوية الصفحة، أو داخل التطبيق من الإعدادات ← الوضع."],
];

function FaqModal({ onClose, onSupport }: { onClose: () => void; onSupport: () => void }) {
  return (
    <Modal title="مساعدة البوابة" onClose={onClose}>
      <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
        {FAQ.map(([q, a]) => (
          <details key={q} className="p-soft rounded-2xl px-4 py-3">
            <summary className="cursor-pointer font-bold">{q}</summary>
            <p className="p-muted mt-2 text-sm leading-6">{a}</p>
          </details>
        ))}
      </div>
      <button onClick={onSupport} className="p-link mt-4 text-sm font-bold">ما لگيت جوابك؟ راسل الدعم الفني</button>
    </Modal>
  );
}

const GUIDE = [
  ["١", "اختار دورك", "طالب أو تدريسي أو إداري، حسب حسابك."],
  ["٢", "ادخل بياناتك", "البريد الجامعي أو الرقم الجامعي (أو اسم المستخدم) وكلمة المرور."],
  ["٣", "ابدأ المراسلة", "من جهات الاتصال اختار أي شخص، أو سوّي مجموعة لشعبتك."],
  ["٤", "فعّل الإشعارات", "من الإعدادات، حتى توصلك الرسائل والمكالمات حتى لو التطبيق مسدود."],
  ["٥", "على الموبايل", "من المتصفح اختار \"إضافة إلى الشاشة الرئيسية\" حتى يصير مثل تطبيق."],
];

function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="دليل الاستخدام" onClose={onClose}>
      <ol className="space-y-3">
        {GUIDE.map(([n, t, d]) => (
          <li key={n} className="flex gap-3">
            <span className="p-btn grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold">{n}</span>
            <span><span className="block font-bold">{t}</span><span className="p-muted text-sm leading-6">{d}</span></span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
