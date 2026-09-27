"use client";
import { useEffect, useRef, useState } from "react";
import type { Theme } from "@/lib/api";
import { auth } from "@/lib/endpoints";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import { Avatar, nameOf, Section, Toggle } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

const themes: { value: Theme; label: string; preview: string }[] = [
  { value: "glass", label: "الزجاجي", preview: "url(/bg/glass-landscape.svg) center / cover" },
  { value: "dark", label: "الداكن", preview: "linear-gradient(135deg,#08051b,#3b137a 60%,#d946ef)" },
  { value: "system", label: "حسب الجهاز", preview: "linear-gradient(90deg,#6fa8d8 50%,#120b30 50%)" },
];

export function SettingsView() {
  const { me, updateMe, signOut, openSaved, notify } = useWasl();
  const [form, setForm] = useState({ display_name: me.display_name, bio: me.bio, phone: me.phone, city: me.city });
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== me[k]);

  async function run(fn: () => Promise<typeof me>, done?: string) {
    setBusy(true);
    try {
      updateMe(await fn());
      if (done) notify(done);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-extrabold">الإعدادات</h1>
      </header>
      <div className="w-scroll flex-1 overflow-y-auto px-4 pb-28">
        <div className="w-card mt-4 flex items-center gap-4 rounded-[24px] p-4">
          <button onClick={() => pick.current?.click()} className="relative" aria-label="تغيير الصورة">
            <Avatar user={me} size={72} />
            <span className="w-accent absolute -bottom-1 -left-1 grid h-8 w-8 place-items-center rounded-full"><Icon name="camera" size={15} /></span>
          </button>
          <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => auth.setAvatar(f), "انحفظت الصورة"); e.target.value = ""; }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-extrabold">{nameOf(me)}</div>
            <div className="w-muted truncate text-sm" dir="ltr">@{me.username}</div>
            {me.avatar && <button onClick={() => run(() => auth.setAvatar(null))} className="mt-1 text-xs font-bold" style={{ color: "var(--danger)" }}>حذف الصورة</button>}
          </div>
        </div>

        <Section title="ملفي الشخصي">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => auth.updateMe(form), "انحفظ"); }}>
            {([
              ["display_name", "الاسم الظاهر", me.username],
              ["bio", "حول", "مثلاً: متوفر 🌙"],
              ["phone", "رقم الهاتف", "+964 7xx xxx xxxx"],
              ["city", "المدينة", "بغداد، العراق"],
            ] as const).map(([key, label, ph]) => (
              <label key={key} className="block text-sm font-bold">
                {label}
                <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={ph}
                  dir={key === "phone" ? "ltr" : "auto"} inputMode={key === "phone" ? "tel" : undefined}
                  className="w-input mt-1.5 h-12 w-full rounded-2xl px-4 text-base font-normal outline-none md:text-sm" />
              </label>
            ))}
            <button disabled={!dirty || busy} className="w-accent w-full rounded-full py-3 font-extrabold disabled:opacity-40">{busy ? "جاري الحفظ..." : "حفظ"}</button>
          </form>
        </Section>

        <Section title="شكل التطبيق">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="شكل التطبيق">
            {themes.map((t) => (
              <button key={t.value} role="radio" aria-checked={me.theme === t.value} disabled={busy}
                onClick={() => run(() => auth.updateMe({ theme: t.value }))}
                className={`rounded-2xl p-2 text-xs font-bold transition ${me.theme === t.value ? "w-accent" : "w-card"}`}>
                <span className="mb-2 block h-16 rounded-xl" style={{ background: t.preview }} />
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section><PushToggle /></Section>

        <Section>
          <button onClick={openSaved} className="flex w-full items-center gap-3 font-bold"><Icon name="bookmark" size={20} className="w-accent-text" />الرسائل المحفوظة</button>
        </Section>

        <button onClick={signOut} className="mt-4 flex w-full items-center justify-center gap-2 rounded-[20px] py-3.5 font-extrabold"
          style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }}>
          <Icon name="logout" size={19} />تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

const pushLabels: Record<PushState, string> = {
  unsupported: "متصفحك ما يدعم الإشعارات. على الآيفون: أضف التطبيق للشاشة الرئيسية أول.",
  denied: "الإشعارات ممنوعة. فعّلها من إعدادات المتصفح لهذا الموقع.",
  off: "توصلك الرسائل حتى لو التطبيق مسدود",
  on: "شغالة: توصلك الرسائل والمكالمات حتى لو التطبيق مسدود",
};

export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getPushState().then(setState);
  }, []);
  if (!state) return null;
  return (
    <div className="flex items-center gap-3">
      <Icon name="bell" size={20} className="w-accent-text" />
      <div className="flex-1">
        <p className="font-bold">الإشعارات</p>
        <p className="w-muted text-xs leading-5">{pushLabels[state]}</p>
      </div>
      {(state === "on" || state === "off") && (
        <Toggle on={state === "on"} label="الإشعارات" onChange={async () => {
          if (busy) return;
          setBusy(true);
          setState(await (state === "on" ? disablePush() : enablePush()).catch((): PushState => state));
          setBusy(false);
        }} />
      )}
    </div>
  );
}

/** بطاقة صغيرة بالقائمة تذكّر المستخدم يفعّل الإشعارات */
export function PushBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    getPushState().then(setState);
  }, []);
  if (state !== "off" || hidden) return null;
  return (
    <div className="w-card mx-1 mb-2 flex items-center gap-3 rounded-[20px] p-3">
      <span className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="bell" size={18} /></span>
      <div className="min-w-0 flex-1 text-xs"><p className="font-extrabold">فعّل الإشعارات</p><p className="w-muted">حتى ما تفوتك أي رسالة</p></div>
      <button className="w-accent rounded-full px-3 py-1.5 text-xs font-bold" onClick={async () => setState(await enablePush().catch((): PushState => "off"))}>تفعيل</button>
      <button className="w-muted" aria-label="إخفاء" onClick={() => setHidden(true)}><Icon name="x" size={16} /></button>
    </div>
  );
}
