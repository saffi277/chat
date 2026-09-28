"use client";
import { useEffect, useRef, useState } from "react";
import { ROLE_LABELS, type Mode } from "@/lib/api";
import { auth } from "@/lib/endpoints";
import { howToEnable, isStandalone, PERM_LABELS, permState, platform, requestPerm, type PermName, type PermState } from "@/lib/permissions";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import { Avatar, nameOf, Section, Toggle } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

// الوضع نهاري/ليلي (مو ثيم). الثيمات تنضاف كقسم منفصل بعدين
const modes: { value: Mode; label: string; icon: "sun" | "moon" | "device" }[] = [
  { value: "light", label: "نهاري", icon: "sun" },
  { value: "dark", label: "ليلي", icon: "moon" },
  { value: "system", label: "تلقائي", icon: "device" },
];

export function SettingsView() {
  const { me, updateMe, signOut, openSaved, notify, setTab, stories } = useWasl();
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
    <div className="flex h-full flex-col" style={{ background: "var(--bg)" }}>
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-[28px] font-extrabold leading-tight">الإعدادات</h1>
      </header>
      <div className="w-scroll flex-1 overflow-y-auto px-4 pb-6">
        <div className="mt-3 flex items-center gap-4 rounded-[22px] p-4" style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
          <button onClick={() => pick.current?.click()} className="relative" aria-label="تغيير الصورة">
            <Avatar user={me} size={72} />
            <span className="w-accent absolute -bottom-1 -left-1 grid h-8 w-8 place-items-center rounded-full border-2" style={{ borderColor: "var(--panel)" }}><Icon name="camera" size={15} /></span>
          </button>
          <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => auth.setAvatar(f), "انحفظت الصورة"); e.target.value = ""; }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-extrabold">{nameOf(me)}</div>
            <div className="w-muted truncate text-sm" dir="ltr">@{me.username}</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="w-tint rounded-full px-2 py-0.5">{ROLE_LABELS[me.role] ?? me.role}</span>
              {me.university_id && <span className="w-tint rounded-full px-2 py-0.5" dir="ltr">{me.university_id}</span>}
            </div>
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
                  className="w-input mt-1.5 h-11 w-full rounded-xl px-4 text-base font-normal outline-none md:text-sm" />
              </label>
            ))}
            <button disabled={!dirty || busy} className="w-accent w-full rounded-full py-3 font-bold disabled:opacity-40">{busy ? "جاري الحفظ..." : "حفظ"}</button>
          </form>
        </Section>

        <Section title="الوضع">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="الوضع">
            {modes.map((t) => (
              <button key={t.value} role="radio" aria-checked={me.mode === t.value} disabled={busy}
                onClick={() => run(() => auth.updateMe({ mode: t.value }))}
                className={`grid justify-items-center gap-1.5 rounded-2xl py-3 text-[13px] font-semibold transition ${me.mode === t.value ? "w-tint" : ""}`}
                style={me.mode === t.value ? { border: "1px solid var(--tint-border)" } : { background: "var(--card)" }}>
                <Icon name={t.icon} size={20} filled={me.mode === t.value && t.icon !== "device"} />
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="الإشعارات">
          <PushToggle />
          <div className="w-line mt-3 flex items-center gap-3 border-t pt-3">
            <Icon name="eye" size={20} className="w-accent-text" />
            <div className="flex-1">
              <p className="font-bold">إخفاء محتوى الإشعار</p>
              <p className="w-muted text-xs leading-5">يطلع &quot;رسالة جديدة&quot; بس، بدون اسم المرسل ولا النص</p>
            </div>
            <Toggle on={me.hide_preview} label="إخفاء محتوى الإشعار" onChange={(v) => !busy && run(() => auth.updateMe({ hide_preview: v }))} />
          </div>
        </Section>

        <Section title="الأذونات"><PermissionsList /></Section>

        <section className="mt-3 overflow-hidden rounded-[22px]" style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
          <button onClick={() => setTab("stories")} className="w-hover flex w-full items-center gap-3 px-4 py-3.5 font-semibold">
            <Icon name="stories" size={20} className="w-accent-text" /><span className="flex-1 text-right">الحالات</span>
            {stories.some((g) => !g.is_me && !g.all_seen) && <span className="w-badge h-2.5 w-2.5 rounded-full" aria-label="حالات جديدة" />}
            <Icon name="back" size={18} className="w-muted rotate-180" />
          </button>
          <button onClick={() => setTab("people")} className="w-hover w-line flex w-full items-center gap-3 border-t px-4 py-3.5 font-semibold">
            <Icon name="users" size={20} className="w-accent-text" /><span className="flex-1 text-right">جهات الاتصال</span>
            <Icon name="back" size={18} className="w-muted rotate-180" />
          </button>
          <button onClick={openSaved} className="w-hover w-line flex w-full items-center gap-3 border-t px-4 py-3.5 font-semibold">
            <Icon name="bookmark" size={20} className="w-accent-text" /><span className="flex-1 text-right">الرسائل المحفوظة</span>
            <Icon name="back" size={18} className="w-muted rotate-180" />
          </button>
        </section>

        <button onClick={signOut} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-bold"
          style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }}>
          <Icon name="logout" size={19} />تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

const permIcons: Record<PermName, "mic" | "video" | "bell" | "pin"> = { microphone: "mic", camera: "video", notifications: "bell", geolocation: "pin" };
const stateLabels: Record<PermState, string> = {
  granted: "مسموح", denied: "ممنوع", prompt: "ما انطلب بعد", unsupported: "غير مدعوم", insecure: "يحتاج https",
};

/** الأذونات: حالة كل واحد وزر "سماح". المتصفح يسأل بس من ضغطة زر، وإذا انرفض نشرح شلون يتفعل */
function PermissionsList() {
  const names: PermName[] = ["microphone", "camera", "notifications", "geolocation"];
  const [states, setStates] = useState<Partial<Record<PermName, PermState>>>({});
  const [busy, setBusy] = useState<PermName | null>(null);
  useEffect(() => {
    Promise.all(names.map(async (n) => [n, await permState(n)] as const)).then((all) => setStates(Object.fromEntries(all)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(n: PermName) {
    setBusy(n);
    const s = await requestPerm(n).catch((): PermState => "prompt");
    setStates((cur) => ({ ...cur, [n]: s }));
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      {names.map((n, i) => {
        const s = states[n];
        return (
          <div key={n} className={i ? "w-line border-t pt-3" : ""}>
            <div className="flex items-center gap-3">
              <Icon name={permIcons[n]} size={20} className="w-accent-text" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{PERM_LABELS[n].title}</p>
                <p className="w-muted text-xs leading-5">{PERM_LABELS[n].why}</p>
              </div>
              {s === "prompt" ? (
                <button disabled={busy === n} onClick={() => ask(n)} className="w-accent rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50">
                  {busy === n ? "..." : "سماح"}
                </button>
              ) : s ? (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: `color-mix(in srgb, var(${s === "granted" ? "--online" : "--danger"}) 15%, transparent)`, color: `var(${s === "granted" ? "--online" : "--danger"})` }}>
                  {stateLabels[s]}
                </span>
              ) : null}
            </div>
            {s === "denied" && <p className="w-tint mt-2 rounded-xl p-2.5 text-xs leading-6">{howToEnable(n)}</p>}
            {s === "insecure" && <p className="w-tint mt-2 rounded-xl p-2.5 text-xs leading-6">افتح التطبيق من رابط https حتى يشتغل {PERM_LABELS[n].title}.</p>}
            {s === "unsupported" && n === "notifications" && platform() === "ios" && !isStandalone() && (
              <p className="w-tint mt-2 rounded-xl p-2.5 text-xs leading-6">{howToEnable("notifications")}</p>
            )}
          </div>
        );
      })}
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
  const [ios, setIos] = useState(false);
  useEffect(() => {
    getPushState().then((st) => {
      setState(st);
      setIos(platform() === "ios" && !isStandalone());
    });
  }, []);
  if (hidden) return null;
  // الآيفون ما يدز إشعارات لموقع بسفاري: لازم ينضاف للشاشة الرئيسية ويتفتح من هناك (iOS 16.4+)
  if (ios && state !== "on") {
    return (
      <div className="w-card mx-4 mb-2 flex items-start gap-3 rounded-2xl p-3">
        <span className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="device" size={18} /></span>
        <div className="min-w-0 flex-1 text-xs leading-5">
          <p className="font-extrabold">ثبّت وَصل على الآيفون حتى توصلك الإشعارات</p>
          <p className="w-muted">اضغط زر المشاركة <b>⬆︎</b> بسفاري ← <b>إضافة إلى الشاشة الرئيسية</b>، وافتح التطبيق من الأيقونة.</p>
        </div>
        <button className="w-muted" aria-label="إخفاء" onClick={() => setHidden(true)}><Icon name="x" size={16} /></button>
      </div>
    );
  }
  if (state !== "off") return null;
  return (
    <div className="w-card mx-4 mb-2 flex items-center gap-3 rounded-2xl p-3">
      <span className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="bell" size={18} /></span>
      <div className="min-w-0 flex-1 text-xs"><p className="font-extrabold">فعّل الإشعارات</p><p className="w-muted">حتى ما تفوتك أي رسالة</p></div>
      <button className="w-accent rounded-full px-3 py-1.5 text-xs font-bold" onClick={async () => setState(await enablePush().catch((): PushState => "off"))}>تفعيل</button>
      <button className="w-muted" aria-label="إخفاء" onClick={() => setHidden(true)}><Icon name="x" size={16} /></button>
    </div>
  );
}
