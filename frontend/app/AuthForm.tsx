"use client";
/**
 * بوابة الدخول (كلية الأسباط الجامعة): تسجيل الدخول وإنشاء حساب.
 * لابتوب: عمودين (البطاقة يمين وصورة الحرم يسار). موبايل: الصورة شريط فوك والبطاقة تحتها.
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

function Logo({ size }: { size: number }) {
  const state = useSyncExternalStore(subscribeLogo, () => logoState, () => "loading" as LogoState);
  if (state === "ok") {
    // الشعار (خلفيته شفافة) + الشريط الذهبي تحته مرسوم بالكود حتى يطلع حاد بكل المقاسات.
    // بالليلي نضيف حافة بيضاء خفيفة حتى الأخضر يبين على الخلفية الغامقة
    return (
      <div className="mx-auto flex w-fit flex-col items-stretch" style={{ height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- شعار الكلية من public/brand */}
        <img src="/brand/logo.png" alt="كلية الأسباط الجامعة" className="portal-logo w-auto" style={{ height: size * 0.9 }} />
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
  const [modal, setModal] = useState<"password" | "support" | "faq" | null>(null);
  const isLogin = mode === "login";
  const night = theme === "dark";

  return (
    <main className="portal relative min-h-dvh overflow-x-hidden" data-theme={theme}>
      <button onClick={() => setMode(night ? "light" : "dark")} aria-label={night ? "الوضع النهاري" : "الوضع الليلي"}
        className="p-card absolute left-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full lg:left-6 lg:top-6">
        <Icon name={night ? "sun" : "moon"} size={18} />
      </button>

      <div className="mx-auto grid min-h-dvh max-w-[1240px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:items-center lg:gap-6 lg:px-8 lg:py-8">
        {/* البطاقة (يمين باللابتوب) */}
        <section className="relative z-10 order-2 -mt-6 px-4 pb-8 lg:order-1 lg:mt-0 lg:px-0 lg:pb-0">
          <div className="p-card mx-auto w-full max-w-[560px] rounded-[28px] px-5 py-6 sm:px-9 sm:py-7">
            <Logo size={isLogin ? 136 : 92} />
            <h1 className={`text-center font-extrabold ${isLogin ? "mt-3 text-[30px]" : "mt-2 text-[26px]"} p-green`}>
              <span className="p-title-accent" style={night ? { color: "var(--p-text)" } : undefined}>{isLogin ? "تسجيل الدخول" : "إنشاء حساب"}</span>
            </h1>
            <p className="p-muted mt-1 text-center text-[15px]">
              {isLogin ? "الوصول إلى خدمات الجامعة والأنظمة الأكاديمية" : "حساب جديد لمنسوبي الجامعة: طلبة وتدريسيين وإداريين"}
            </p>
            {isLogin ? <LoginForm onForgot={() => setModal("password")} /> : <RegisterForm />}

            <div className="my-4 flex items-center gap-3 text-sm">
              <span className="h-px flex-1" style={{ background: "var(--p-input-border)" }} />
              <span className="p-muted">أو</span>
              <span className="h-px flex-1" style={{ background: "var(--p-input-border)" }} />
            </div>
            {isLogin ? (
              <p className="p-muted mb-3 text-center text-sm">
                ما عندك حساب؟ <Link href="/register" className="p-link font-bold">أنشئ حساب جديد</Link>
              </p>
            ) : (
              <p className="p-muted mb-3 text-center text-sm">
                عندك حساب؟ <Link href="/login" className="p-link font-bold">سجّل دخولك</Link>
              </p>
            )}
            <div className="p-soft grid grid-cols-2 rounded-2xl">
              <HelpItem icon="help" title="مساعدة البوابة" text="دليل الاستخدام والأسئلة الشائعة" onClick={() => setModal("faq")} />
              <HelpItem icon="headset" title="الدعم الفني" text="للمساعدة في حل المشكلات" onClick={() => setModal("support")} divider />
            </div>
          </div>
        </section>

        {/* صورة الحرم والعبارة (يسار باللابتوب، وفوك بالموبايل) */}
        <Visual night={night} />
      </div>

      {modal === "faq" && <FaqModal onClose={() => setModal(null)} onSupport={() => setModal("support")} />}
      {(modal === "password" || modal === "support") && <HelpModal kind={modal} onClose={() => setModal(null)} />}
    </main>
  );
}

function Visual({ night }: { night: boolean }) {
  const img = `url(/brand/campus-${night ? "night" : "day"}.jpg)`;
  const heading = (
    <>
      <h2 className="text-[26px] font-extrabold leading-[1.45] lg:text-[40px]">
        <span className="p-green" style={night ? { color: "var(--p-text)" } : undefined}>معاً نحو</span><br />
        <span className="p-green" style={night ? { color: "var(--p-gold)" } : undefined}>مستقبل معرفيٍّ أكثر إشراقاً</span>
      </h2>
      <span className="mx-auto mt-3 block h-[3px] w-16 rounded-full lg:mt-5 lg:w-24" style={{ background: "var(--p-gold)" }} />
      <p className="p-muted mx-auto mt-3 max-w-xs text-[14px] leading-7 lg:mt-5 lg:text-[18px] lg:leading-8">
        بيئة جامعية ملهمة .. وخدمات رقمية<br />تدعم رحلتك الأكاديمية
      </p>
    </>
  );
  // الصورة تتلاشى عند الحواف (mask) فتندمج ويا خلفية الصفحة بدون حافة حادة
  const fade = (v: string, h: string) => ({
    backgroundImage: img, backgroundSize: "cover",
    maskImage: `${v}, ${h}`, WebkitMaskImage: `${v}, ${h}`,
    maskComposite: "intersect", WebkitMaskComposite: "source-in",
  }) as React.CSSProperties;
  return (
    <section className="relative order-1 lg:order-2 lg:h-[calc(100dvh-4rem)] lg:max-h-[860px] lg:min-h-[620px]">
      {/* موبايل: العبارة فوك، وتحتها شريط الصورة */}
      <div className="lg:hidden">
        <div className="px-6 pt-16 text-center">{heading}</div>
        <div className="-mt-2 h-[190px]" style={{ ...fade("linear-gradient(180deg, transparent, #000 30%, #000 70%, transparent)", "linear-gradient(90deg, #000, #000)"), backgroundPosition: "center 62%" }} />
      </div>

      {/* لابتوب: العبارة فوك، الصورة بالنص، والمميزات تحت */}
      <div className="absolute inset-0 hidden lg:block">
        <div className="absolute inset-0" style={{ ...fade("linear-gradient(180deg, transparent 18%, #000 45%, #000 74%, transparent 96%)", "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)"), backgroundPosition: "center 75%" }} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 860" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-20 300 Q 180 180 620 120" fill="none" stroke="var(--p-gold)" strokeWidth="2" opacity=".55" />
          <path d="M-20 770 Q 260 640 620 700" fill="none" stroke="var(--p-gold)" strokeWidth="2" opacity=".55" />
        </svg>
        <div className="relative px-10 pt-14 text-center">{heading}</div>
        <div className="absolute inset-x-0 bottom-6 flex justify-center">
          <Feature icon="users" label="لجميع منسوبي الجامعة" />
          <Feature icon="book" label="بيئة تعليمية داعمة" divider />
          <Feature icon="cap" label="خدمات أكاديمية متكاملة" divider />
        </div>
      </div>
    </section>
  );
}

function Feature({ icon, label, divider }: { icon: IconName; label: string; divider?: boolean }) {
  return (
    <div className="grid w-40 justify-items-center gap-2 px-3 text-center text-[15px] font-bold"
      style={divider ? { borderInlineStart: "1px solid color-mix(in srgb, var(--p-muted) 35%, transparent)" } : undefined}>
      <span className="p-feature grid h-14 w-14 place-items-center rounded-full"><Icon name={icon} size={26} filled={icon === "cap" || icon === "users"} /></span>
      {label}
    </div>
  );
}

function HelpItem({ icon, title, text, onClick, divider }: { icon: IconName; title: string; text: string; onClick: () => void; divider?: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 px-4 py-4 text-right transition hover:opacity-80"
      style={divider ? { borderInlineStart: "1px solid var(--p-input-border)" } : undefined}>
      <span className="p-green shrink-0" style={{ color: "var(--p-text)" }}><Icon name={icon} size={24} /></span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold">{title}</span>
        <span className="p-muted block text-[11.5px] leading-5">{text}</span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------ الحقول
function Field({ icon, children, end }: { icon: IconName; children: React.ReactNode; end?: React.ReactNode }) {
  return (
    <label className="p-field flex h-[50px] items-center gap-3 rounded-2xl px-4">
      <span className="p-muted shrink-0"><Icon name={icon} size={21} /></span>
      {children}
      {end}
    </label>
  );
}

function RolePicker({ role, setRole }: { role: Role | ""; setRole: (r: Role) => void }) {
  return (
    <>
      <Field icon="user" end={<span className="p-muted pointer-events-none shrink-0"><Icon name="chevronDown" size={20} /></span>}>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="اختر الدور"
          className="h-full min-w-0 flex-1 appearance-none text-[15px]" style={{ color: role ? "var(--p-text)" : "var(--p-muted)" }}>
          <option value="" disabled>اختر الدور</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </Field>
      <div className="p-seg mt-2 grid grid-cols-3 rounded-xl p-0.5" role="group" aria-label="الدور">
        {ROLES.map((r) => (
          <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}
            className="h-10 text-[15px] font-bold transition">{ROLE_LABELS[r]}</button>
        ))}
      </div>
    </>
  );
}

function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field icon="lock" end={
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="p-muted shrink-0">
        <Icon name={show ? "eyeOff" : "eye"} size={21} />
      </button>
    }>
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder="كلمة المرور"
        autoComplete={autoComplete} required minLength={6} className="h-full min-w-0 flex-1 text-base" aria-label="كلمة المرور" />
    </Field>
  );
}

function ErrorBox({ text }: { text: string }) {
  return text ? (
    <p className="rounded-xl px-3 py-2 text-sm font-bold" role="alert" style={{ background: "color-mix(in srgb, #dc2626 12%, transparent)", color: "#dc2626" }}>{text}</p>
  ) : null;
}

function LoginForm({ onForgot }: { onForgot: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState<Role | "">("student");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return setError("اختار الدور أول");
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
    <form onSubmit={submit} className="mt-5 space-y-3">
      <RolePicker role={role} setRole={setRole} />
      <Field icon="mail">
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="البريد الجامعي أو الرقم الجامعي"
          autoComplete="username" autoCapitalize="none" dir="auto" required className="h-full min-w-0 flex-1 text-base" aria-label="البريد الجامعي أو الرقم الجامعي" />
      </Field>
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="flex items-center justify-between pt-0.5 text-[15px]">
        <label className="flex cursor-pointer items-center gap-2 font-semibold">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="p-checkbox h-5 w-5 rounded" />
          تذكرني
        </label>
        <button type="button" onClick={onForgot} className="p-link font-bold">نسيت كلمة المرور؟</button>
      </div>
      <ErrorBox text={error} />
      <button disabled={busy} className="p-btn flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl text-lg font-extrabold transition active:scale-[.99] disabled:opacity-70">
        {busy ? "جاري الدخول..." : "دخول"}
        <span className="-scale-x-100"><Icon name="logIn" size={22} /></span>
      </button>
    </form>
  );
}

function RegisterForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role | "">("student");
  const [form, setForm] = useState({ display_name: "", username: "", email: "", university_id: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return setError("اختار الدور أول");
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
      <button disabled={busy} className="p-btn flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl text-lg font-extrabold transition active:scale-[.99] disabled:opacity-70">
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
