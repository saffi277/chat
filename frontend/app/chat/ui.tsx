"use client";
// قطع صغيرة تتكرر بصفحة الشات: الصورة الشخصية، آخر ظهور، الملف الشخصي، لوحة المعلومات، زر الإشعارات
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl, saveMe, type Me, type Theme, type User } from "@/lib/api";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";

export const nameOf = (u: User) => u.display_name || u.username;

export function Avatar({ user, size = 44, online, dark }: { user: User; size?: number; online?: boolean; dark?: boolean }) {
  const src = mediaUrl(user.avatar);
  const letters = nameOf(user).trim().slice(0, 2).toUpperCase();
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-2xl text-sm font-black ${
        dark ? "bg-[#222242] text-white" : "bg-gradient-to-br from-violet-200 to-indigo-100 text-[#5656b8]"
      }`}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- الصورة من سيرفر ثاني (الباك اند)
        <img src={src} alt="" className="h-full w-full rounded-2xl object-cover" />
      ) : (
        letters
      )}
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
            online ? "bg-emerald-400" : "bg-slate-300"
          }`}
        />
      )}
    </div>
  );
}

// "آخر ظهور اليوم 10:30" / "أمس 9:15" / "12/9/2026"
export function lastSeenText(u: User) {
  if (u.is_online) return "متصل الآن";
  if (!u.last_seen) return "غير متصل";
  const d = new Date(u.last_seen);
  const time = d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `آخر ظهور اليوم ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `آخر ظهور أمس ${time}`;
  return `آخر ظهور ${d.toLocaleDateString("ar")}`;
}

function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  // نافذة تطلع من الجنب بالكمبيوتر، ومن تحت بالموبايل
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm md:items-stretch md:justify-start" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl md:max-h-none md:w-[360px] md:rounded-none md:rounded-r-[28px]"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#222242]">{title}</h2>
          <button aria-label="إغلاق" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function InfoPanel({ user, onClose }: { user: User; onClose: () => void }) {
  return (
    <Sheet title="معلومات المحادثة" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar user={user} size={96} />
        <h3 className="mt-4 text-xl font-black text-[#222242]">{nameOf(user)}</h3>
        <p className="text-sm text-slate-400" dir="ltr">@{user.username}</p>
        <p className={`mt-2 text-sm ${user.is_online ? "text-emerald-500" : "text-slate-500"}`}>{lastSeenText(user)}</p>
      </div>
      <dl className="mt-8 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">انضم</dt>
          <dd className="font-bold text-[#31314d]">{new Date(user.date_joined).toLocaleDateString("ar")}</dd>
        </div>
      </dl>
    </Sheet>
  );
}

export function ProfileSheet({ me, onClose, onSaved, onLogout }: {
  me: Me;
  onClose: () => void;
  onSaved: (u: Me) => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(me.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(body: FormData | object) {
    setBusy(true);
    setError("");
    try {
      // PATCH /api/auth/me/ — نعدل جزء من البيانات بس
      const u = await api<Me>("/auth/me/", "PATCH", body);
      saveMe(u);
      onSaved(u);
      return u;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    const form = new FormData(); // الملفات تنرسل بـ multipart/form-data مو JSON
    form.append("avatar", file);
    save(form);
  }

  return (
    <Sheet title="ملفي الشخصي" onClose={onClose}>
      <div className="flex flex-col items-center">
        <button onClick={() => fileRef.current?.click()} className="group relative" aria-label="تغيير الصورة">
          <Avatar user={me} size={104} />
          <span className="absolute inset-0 grid place-items-center rounded-2xl bg-black/40 text-xs font-bold text-white opacity-0 transition group-hover:opacity-100">
            تغيير
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
        <div className="mt-3 flex gap-3 text-sm">
          <button className="font-bold text-[#5b5cf0]" onClick={() => fileRef.current?.click()} disabled={busy}>
            {me.avatar ? "تغيير الصورة" : "إضافة صورة"}
          </button>
          {me.avatar && (
            <button className="font-bold text-rose-500" onClick={() => save({ avatar: null })} disabled={busy}>
              حذف
            </button>
          )}
        </div>
      </div>

      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save({ display_name: name });
        }}
      >
        <label className="block text-sm font-bold text-slate-700">
          الاسم الظاهر
          <input
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#7775f5] focus:ring-4 focus:ring-violet-100"
            value={name}
            maxLength={50}
            placeholder={me.username}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="text-xs text-slate-400">
          هذا الاسم يشوفه الناس. اسم الدخول مالتك <span dir="ltr">@{me.username}</span> ما يتغير.
        </p>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}
        <button disabled={busy || name === me.display_name} className="w-full rounded-2xl bg-[#5b5cf0] p-3 font-bold text-white disabled:opacity-40">
          {busy ? "جاري الحفظ..." : "حفظ"}
        </button>
      </form>

      <div className="mt-8 border-t border-slate-100 pt-6">
        <p className="text-sm font-black text-[#31314d]">🎨 شكل التطبيق</p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="شكل التطبيق">
          {themes.map((t) => (
            <button
              key={t.value}
              role="radio"
              aria-checked={me.theme === t.value}
              disabled={busy}
              onClick={() => save({ theme: t.value })}
              className={`rounded-2xl border p-2 text-xs font-bold transition ${
                me.theme === t.value ? "border-[#5b5cf0] ring-2 ring-violet-200" : "border-slate-200"
              }`}
            >
              <span className="mb-2 block h-10 rounded-xl" style={{ background: t.preview }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 border-t border-slate-100 pt-6">
        <PushToggle />
      </div>

      <button onClick={onLogout} className="mt-6 w-full rounded-2xl bg-rose-50 p-3 font-bold text-rose-600 hover:bg-rose-100">
        تسجيل الخروج
      </button>
    </Sheet>
  );
}

const themes: { value: Theme; label: string; preview: string }[] = [
  { value: "glass", label: "الزجاجي", preview: "linear-gradient(135deg,#eef1ff,#ffffff 55%,#dff7f0)" },
  { value: "dark", label: "الداكن", preview: "linear-gradient(135deg,#08051b,#3b137a 60%,#d332e4)" },
  { value: "system", label: "حسب الجهاز", preview: "linear-gradient(90deg,#f2f3fb 50%,#120d36 50%)" },
];

const pushLabels: Record<PushState, string> = {
  unsupported: "متصفحك ما يدعم الإشعارات. على الآيفون: أضف التطبيق للشاشة الرئيسية أول.",
  denied: "الإشعارات ممنوعة. فعّلها من إعدادات المتصفح لهذا الموقع.",
  off: "الإشعارات طافية",
  on: "الإشعارات شغالة، توصلك الرسائل حتى لو التطبيق مسدود",
};

export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getPushState().then(setState);
  }, []);
  if (!state) return null;
  const canToggle = state === "on" || state === "off";
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-black text-[#31314d]">🔔 الإشعارات</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{pushLabels[state]}</p>
      </div>
      {canToggle && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setState(await (state === "on" ? disablePush() : enablePush()).catch((): PushState => state));
            setBusy(false);
          }}
          className={`h-11 shrink-0 rounded-2xl px-4 text-sm font-bold ${
            state === "on" ? "bg-slate-100 text-slate-600" : "bg-[#5b5cf0] text-white"
          }`}
        >
          {state === "on" ? "إيقاف" : "تفعيل"}
        </button>
      )}
    </div>
  );
}

// بطاقة صغيرة بالقائمة تذكّر المستخدم يفعّل الإشعارات
export function PushBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    getPushState().then(setState);
  }, []);
  if (state !== "off" || hidden) return null;
  return (
    <div className="mx-3 mb-3 rounded-2xl bg-[#efefff] p-3 text-sm">
      <p className="font-black text-[#3b3bb0]">🔔 فعّل الإشعارات</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">حتى توصلك الرسائل حتى لو التطبيق مسدود.</p>
      <div className="mt-2 flex gap-2">
        <button className="h-10 rounded-xl bg-[#5b5cf0] px-4 text-xs font-bold text-white" onClick={async () => setState(await enablePush().catch((): PushState => "off"))}>
          تفعيل
        </button>
        <button className="h-10 rounded-xl px-3 text-xs font-bold text-slate-500" onClick={() => setHidden(true)}>
          بعدين
        </button>
      </div>
    </div>
  );
}
