"use client";
import { useEffect, useRef, useState } from "react";
import { ROLE_LABELS, THEMES, WALLPAPERS, type Me, type Mode } from "@/lib/api";
import { auth, conversations as convApi, manage } from "@/lib/endpoints";
import { LANGS, setLang, useT } from "@/lib/i18n";
import { howToEnable, isStandalone, PERM_LABELS, permState, platform, requestPerm, type PermName, type PermState } from "@/lib/permissions";
import { disablePush, enablePush, getPushState, testPush, type PushState } from "@/lib/push";
import { Avatar, IconButton, nameOf, Section, Toggle } from "./bits";
import { WallTile } from "./ConvSettings";
import { ManagePage } from "./Manage";
import { PrivacyPage } from "./Safety";
import { Icon } from "./icons";
import { useWasl } from "./store";

// الوضع نهاري/ليلي (وليس ثيماً). الثيم (اللون والخلفية) قسم مستقل: «الثيمات»
const modes: { value: Mode; label: string; icon: "sun" | "moon" | "device" }[] = [
  { value: "light", label: "نهاري", icon: "sun" },
  { value: "dark", label: "ليلي", icon: "moon" },
  { value: "system", label: "تلقائي", icon: "device" },
];

// ------------------------------------------------------------ الإعدادات: قائمة أقسام، وكل قسم في صفحته
type Page = "account" | "appearance" | "themes" | "language" | "notifications" | "privacy" | "permissions" | "manage";
type IconName = Parameters<typeof Icon>[0]["name"];

/** الحفظ في الخادم مع رسالة نجاح/خطأ (مشترك بين الصفحات) */
function useSave() {
  const { updateMe, notify } = useWasl();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<Me>, done?: string) {
    setBusy(true);
    try {
      updateMe(await fn());
      if (done) notify(done);
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

export function SettingsView() {
  const t = useT();
  const { me, signOut, openSaved, setTab, stories } = useWasl();
  const [page, setPage] = useState<Page | null>(null);
  // ما ينتظر مدير النظام (طلبات وبلاغات): نقطة على «لوحة الإدارة»
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (me.is_admin && !page) manage.overview().then((d) => setPending(d.role_requests.length + d.reports.length + d.support.length)).catch(() => {});
  }, [me.is_admin, page]);

  if (page) {
    const titles: Record<Page, string> = { account: "معلوماتي", appearance: "المظهر", themes: "الثيمات", language: "اللغة", notifications: "الإشعارات", privacy: "الخصوصية والأمان", permissions: "الأذونات", manage: "لوحة الإدارة" };
    return (
      <SubPage title={t(titles[page])} onBack={() => setPage(null)}>
        {page === "account" && <AccountPage />}
        {page === "appearance" && <AppearancePage />}
        {page === "themes" && <ThemesPage />}
        {page === "privacy" && <PrivacyWrap />}
        {page === "language" && <LanguagePage />}
        {page === "notifications" && <NotificationsPage />}
        {page === "manage" && <ManagePage onCount={setPending} />}
        {page === "permissions" && <><p className="w-muted mb-1 mt-3 px-1 text-xs leading-6">{t("تحكّم في ما يستطيع التطبيق استخدامه في جهازك.")}</p><Section><PermissionsList /></Section></>}
      </SubPage>
    );
  }

  const modeLabel = modes.find((m) => m.value === me.mode)?.label ?? "";
  return (
    <div className="flex h-full flex-col" style={{ background: "var(--bg)" }}>
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-[28px] font-extrabold leading-tight">{t("الإعدادات")}</h1>
      </header>
      <div className="w-scroll flex-1 overflow-y-auto px-4 pb-6">
        {/* بطاقتي: تفتح «معلوماتي» */}
        <button onClick={() => setPage("account")} className="mt-3 flex w-full items-center gap-4 rounded-[22px] p-4 text-start"
          style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
          <Avatar user={me} size={64} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-extrabold" dir="auto">{nameOf(me)}</span>
            <span className="w-muted block truncate text-sm">{t(ROLE_LABELS[me.role] ?? me.role)}{me.university_id ? ` • ${me.university_id}` : ""}</span>
            {me.requested_role && (
              // سجّل تدريسياً أو إدارياً: ينتظر اعتماد الإدارة
              <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: "color-mix(in srgb, #f59e0b 18%, transparent)", color: "#b45309" }}>
                <Icon name="clock" size={12} />{t("دور «{role}» بانتظار موافقة الإدارة", { role: t(ROLE_LABELS[me.requested_role]) })}
              </span>
            )}
          </span>
          <Icon name="back" size={18} className="w-muted rotate-180" />
        </button>

        <Group>
          <Row icon="user" color="#6c5ce7" label={t("معلوماتي")} onClick={() => setPage("account")} />
          <Row icon={me.mode === "dark" ? "moon" : "sun"} color="#0ea5e9" label={t("المظهر")} value={t(modeLabel)} onClick={() => setPage("appearance")} />
          <Row icon="palette" color={THEMES.find((x) => x.id === me.theme)?.color ?? "#6c5ce7"} label={t("الثيمات")}
            value={t(THEMES.find((x) => x.id === me.theme)?.label ?? "البنفسجي")} onClick={() => setPage("themes")} />
          <Row icon="globe" color="#10b981" label={t("اللغة")} value={LANGS.find((l) => l.value === me.language)?.label} onClick={() => setPage("language")} />
          <Row icon="bell" color="#f43f5e" label={t("الإشعارات")} onClick={() => setPage("notifications")} />
          <Row icon="lock" color="#475569" label={t("الخصوصية والأمان")} onClick={() => setPage("privacy")} />
          <Row icon="shield" color="#f59e0b" label={t("الأذونات")} onClick={() => setPage("permissions")} />
        </Group>

        {me.is_admin && (
          // لمدير النظام فقط
          <Group>
            <Row icon="crown" color="#0f766e" label={t("لوحة الإدارة")} onClick={() => setPage("manage")}
              value={pending ? String(pending) : undefined} badge={pending ? t("طلبات تنتظرك") : undefined} />
          </Group>
        )}

        <Group>
          <Row icon="stories" color="#8b5cf6" label={t("الحالات")} onClick={() => setTab("stories")}
            badge={stories.some((g) => !g.is_me && !g.all_seen) ? t("حالات جديدة") : undefined} />
          <Row icon="users" color="#3b82f6" label={t("جهات الاتصال")} onClick={() => setTab("people")} />
          <Row icon="bookmark" color="#14b8a6" label={t("الرسائل المحفوظة")} onClick={openSaved} />
        </Group>

        <button onClick={signOut} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-bold"
          style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }}>
          <Icon name="logout" size={19} />{t("تسجيل الخروج")}
        </button>
      </div>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <section className="w-divide mt-3 overflow-hidden rounded-[22px]" style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>{children}</section>;
}

/** صف في القائمة: أيقونة ملوّنة، الاسم، القيمة الحالية، وسهم */
function Row({ icon, color, label, value, badge, onClick }: { icon: IconName; color: string; label: string; value?: string; badge?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-hover flex w-full items-center gap-3 px-4 py-3 text-start font-semibold">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: color }}><Icon name={icon} size={17} /></span>
      <span className="flex-1">{label}</span>
      {badge && <span className="w-badge h-2.5 w-2.5 rounded-full" aria-label={badge} />}
      {value && <span className="w-muted text-sm font-normal">{value}</span>}
      <Icon name="back" size={18} className="w-muted rotate-180" />
    </button>
  );
}

/** صفحة داخل الإعدادات: ترويسة بزر رجوع إلى القائمة */
function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col" style={{ background: "var(--bg)" }}>
      <header className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <IconButton icon="back" label={t("رجوع")} onClick={onBack} plain size={40} />
        <h1 className="text-[22px] font-extrabold leading-tight">{title}</h1>
      </header>
      <div className="w-scroll flex-1 overflow-y-auto px-4 pb-6">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------ معلوماتي: الصورة والاسم والرقم والبريد
function AccountPage() {
  const t = useT();
  const { me } = useWasl();
  const { busy, run } = useSave();
  const pick = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ display_name: me.display_name, bio: me.bio, phone: me.phone, city: me.city, email: me.email });
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== me[k]);
  const fields = [
    ["display_name", t("الاسم الظاهر"), me.username, "user"],
    ["phone", t("رقم الهاتف"), "+964 7xx xxx xxxx", "phone"],
    ["email", t("البريد الجامعي"), "name@asbat.edu.iq", "mail"],
    ["bio", t("نبذة"), t("مثلاً: متاح 🌙"), "info"],
    ["city", t("المدينة"), t("بغداد، العراق"), "pin"],
  ] as const;

  return (
    <>
      {/* الصورة */}
      <div className="mt-4 flex flex-col items-center">
        <button onClick={() => pick.current?.click()} className="relative" aria-label={t("تغيير الصورة")}>
          <Avatar user={me} size={112} />
          <span className="w-accent absolute bottom-1 end-1 grid h-9 w-9 place-items-center rounded-full border-2" style={{ borderColor: "var(--bg)" }}><Icon name="camera" size={17} /></span>
        </button>
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => auth.setAvatar(f), t("حُفظت الصورة")); e.target.value = ""; }} />
        <div className="mt-3 flex gap-4 text-sm font-bold">
          <button onClick={() => pick.current?.click()} className="w-accent-text">{t("تغيير الصورة")}</button>
          {me.avatar && <button onClick={() => run(() => auth.setAvatar(null))} style={{ color: "var(--danger)" }}>{t("حذف الصورة")}</button>}
        </div>
      </div>

      {/* ما يستطيع المستخدم تعديله */}
      <form onSubmit={(e) => { e.preventDefault(); run(() => auth.updateMe(form), t("حُفظ")); }}>
        <Section>
          <div className="space-y-3">
            {fields.map(([key, label, ph, icon]) => (
              <label key={key} className="block text-sm font-bold">
                <span className="flex items-center gap-1.5"><Icon name={icon} size={15} className="w-accent-text" />{label}</span>
                <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={ph}
                  type={key === "email" ? "email" : "text"} dir={key === "phone" || key === "email" ? "ltr" : "auto"}
                  inputMode={key === "phone" ? "tel" : key === "email" ? "email" : undefined} autoCapitalize={key === "email" ? "none" : undefined}
                  className="w-input mt-1.5 h-11 w-full rounded-xl px-4 text-base font-normal outline-none md:text-sm" />
              </label>
            ))}
          </div>
        </Section>
        <button disabled={!dirty || busy} className="w-accent mt-3 w-full rounded-full py-3 font-bold disabled:opacity-40">{t(busy ? "جارٍ الحفظ..." : "حفظ")}</button>
      </form>

      {/* بيانات الجامعة: للعرض فقط */}
      <Section title={t("بيانات الجامعة")}>
        <div className="w-divide">
          <ReadOnly label={t("الرقم الجامعي")} value={me.university_id || "—"} ltr />
          <ReadOnly label={t("الدور")} value={t(ROLE_LABELS[me.role] ?? me.role)} />
          <ReadOnly label={t("اسم المستخدم")} value={`@${me.username}`} ltr />
        </div>
        <p className="w-muted mt-2 flex items-center gap-1.5 text-xs"><Icon name="lock" size={12} />{t("يغيّرها الإداري فقط")}</p>
      </Section>
    </>
  );
}

function ReadOnly({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="w-muted text-sm">{label}</span>
      <span className="truncate font-bold" dir={ltr ? "ltr" : "auto"}>{value}</span>
    </div>
  );
}

/** اختيار واحد من قائمة (المظهر، اللغة) */
function Choice({ label, selected, onClick, icon, lang }: { label: string; selected: boolean; onClick: () => void; icon?: IconName; lang?: string }) {
  return (
    <button role="radio" aria-checked={selected} onClick={onClick} lang={lang} className="w-hover flex w-full items-center gap-3 px-4 py-3.5 text-start font-semibold">
      {icon && <Icon name={icon} size={20} className="w-accent-text" />}
      <span className="flex-1">{label}</span>
      <span className={`grid h-6 w-6 place-items-center rounded-full ${selected ? "w-accent" : "border-2 border-[var(--divider)]"}`}>{selected && <Icon name="check" size={14} strokeWidth={3} />}</span>
    </button>
  );
}

function AppearancePage() {
  const t = useT();
  const { me } = useWasl();
  const { busy, run } = useSave();
  return (
    <Group>
      <div role="radiogroup" aria-label={t("المظهر")} className="w-divide">
        {modes.map((m) => (
          <Choice key={m.value} label={t(m.label)} icon={m.icon} selected={me.mode === m.value}
            onClick={() => !busy && me.mode !== m.value && run(() => auth.updateMe({ mode: m.value }))} />
        ))}
      </div>
    </Group>
  );
}

/** الثيمات: لون التطبيق وخلفية المحادثات، مع معاينة حيّة. مستقلة عن الوضع النهاري والليلي */
function ThemesPage() {
  const t = useT();
  const { me, convs, activeId, refreshConvs, notify } = useWasl();
  const { busy, run } = useSave();
  // المحادثة المفتوحة بجانب الإعدادات (في الحاسوب) لها خلفية خاصة: تتقدّم على الخلفية العامة، فلا يتغير شكلها هي
  const open = convs.find((c) => c.id === activeId);
  const ownWall = open?.wallpaper ? WALLPAPERS.find((w) => w.id === open.wallpaper) : undefined;
  const resetChatWall = async () => {
    if (!open) return;
    try {
      await convApi.setPrefs(open.id, { wallpaper: "" });
      await refreshConvs();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <>
      {/* معاينة: تتغير فوراً مع الاختيار */}
      <div className="w-chat-bg mt-3 overflow-hidden rounded-[22px] p-4" style={{ boxShadow: "var(--soft-shadow)" }} aria-hidden>
        <div className="w-bubble-in w-fit max-w-[75%] rounded-[18px] px-3.5 py-2 text-sm">{t("مرحباً! هل رأيت جدول الامتحانات؟")}</div>
        <div className="w-bubble-out ms-auto mt-2 w-fit max-w-[75%] rounded-[18px] px-3.5 py-2 text-sm">{t("نعم، أرسلته في المجموعة 👍")}
          <span className="mt-0.5 flex justify-end" style={{ color: "var(--tick-read)" }}><Icon name="checks" size={14} /></span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="w-accent grid h-9 w-9 place-items-center rounded-full"><Icon name="send" size={16} /></span>
          <span className="w-badge grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold">3</span>
          <span className="w-tint rounded-full px-3 py-1 text-xs font-bold">{t("الكل")}</span>
        </div>
      </div>
      <p className="w-muted mb-1 mt-4 px-1 text-xs leading-6">{t("اللون يغيّر الأزرار والفقاعات والعدّادات، ويعمل في الوضعين النهاري والليلي.")}</p>
      <Section title={t("لون التطبيق")}>
        <div role="radiogroup" aria-label={t("لون التطبيق")} className="grid grid-cols-3 gap-3">
          {THEMES.map((th) => {
            const on = (me.theme || "default") === th.id;
            return (
              <button key={th.id} role="radio" aria-checked={on} onClick={() => !busy && !on && run(() => auth.updateMe({ theme: th.id }))}
                className="grid justify-items-center gap-1.5 rounded-2xl py-2 text-xs font-bold" style={on ? { background: "var(--tint)" } : undefined}>
                <span className="grid h-11 w-11 place-items-center rounded-full text-white shadow" style={{ background: th.color, outline: on ? `3px solid ${th.color}` : undefined, outlineOffset: 2 }}>
                  {on && <Icon name="check" size={20} strokeWidth={3} />}
                </span>
                {t(th.label)}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title={t("خلفية المحادثات")}>
        <div className="grid grid-cols-3 gap-2">
          {WALLPAPERS.map((w) => (
            <WallTile key={w.id} id={w.id} label={t(w.label)} on={(me.wallpaper || "doodles") === w.id}
              onClick={() => !busy && run(() => auth.updateMe({ wallpaper: w.id }))} />
          ))}
        </div>
        <p className="w-muted mt-2 text-xs">{t("ولكل محادثة أن تختار خلفيتها: من ⋯ ← إعدادات المحادثة.")}</p>
        {ownWall && (
          <div className="w-tint mt-3 flex items-center gap-3 rounded-2xl p-3 text-xs leading-6" role="status">
            <Icon name="info" size={18} className="shrink-0" />
            <span className="flex-1">{t("المحادثة المفتوحة لها خلفية خاصة بها ({name})، فلا تتغير بالخلفية العامة.", { name: t(ownWall.label) })}</span>
            <button onClick={resetChatWall} className="w-accent shrink-0 rounded-full px-3 py-1.5 font-bold">{t("استعمال العامة")}</button>
          </div>
        )}
      </Section>
    </>
  );
}

function PrivacyWrap() {
  const { run } = useSave();
  return <PrivacyPage save={run} />;
}

function LanguagePage() {
  const t = useT();
  const { me } = useWasl();
  const { busy, run } = useSave();
  return (
    <>
      <p className="w-muted mb-1 mt-3 px-1 text-xs leading-6">{t("تتغير النصوص واتجاه الواجهة فوراً.")}</p>
      <Group>
        <div role="radiogroup" aria-label={t("اللغة")} className="w-divide">
          {LANGS.map((l) => (
            <Choice key={l.value} label={l.label} lang={l.value} selected={me.language === l.value}
              onClick={() => { if (busy || me.language === l.value) return; setLang(l.value); run(() => auth.updateMe({ language: l.value })); }} />
          ))}
        </div>
      </Group>
    </>
  );
}

function NotificationsPage() {
  const t = useT();
  const { me } = useWasl();
  const { busy, run } = useSave();
  return (
    <Section>
      <PushToggle />
      <div className="w-line mt-3 flex items-center gap-3 border-t pt-3">
        <Icon name="eye" size={20} className="w-accent-text" />
        <div className="flex-1">
          <p className="font-bold">{t("إخفاء محتوى الإشعار")}</p>
          <p className="w-muted text-xs leading-5">{t("يظهر \"رسالة جديدة\" فقط، دون اسم المرسل أو النص")}</p>
        </div>
        <Toggle on={me.hide_preview} label={t("إخفاء محتوى الإشعار")} onChange={(v) => !busy && run(() => auth.updateMe({ hide_preview: v }))} />
      </div>
    </Section>
  );
}

const permIcons: Record<PermName, "mic" | "video" | "bell" | "pin"> = { microphone: "mic", camera: "video", notifications: "bell", geolocation: "pin" };
const stateLabels: Record<PermState, string> = {
  granted: "مسموح", denied: "ممنوع", prompt: "لم يُطلب بعد", unsupported: "غير مدعوم", insecure: "يحتاج https",
};

/** الأذونات: حالة كل إذن وزر "سماح". المتصفح يسأل عند ضغطة زر فقط، وإن رُفض نشرح كيف يُفعَّل */
function PermissionsList() {
  const t = useT();
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
                <p className="font-bold">{t(PERM_LABELS[n].title)}</p>
                <p className="w-muted text-xs leading-5">{t(PERM_LABELS[n].why)}</p>
              </div>
              {s === "prompt" ? (
                <button disabled={busy === n} onClick={() => ask(n)} className="w-accent rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50">
                  {busy === n ? "..." : t("سماح")}
                </button>
              ) : s ? (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: `color-mix(in srgb, var(${s === "granted" ? "--online" : "--danger"}) 15%, transparent)`, color: `var(${s === "granted" ? "--online" : "--danger"})` }}>
                  {t(stateLabels[s])}
                </span>
              ) : null}
            </div>
            {s === "denied" && <p className="w-tint mt-2 rounded-xl p-2.5 text-xs leading-6">{howToEnable(n)}</p>}
            {s === "insecure" && <p className="w-tint mt-2 rounded-xl p-2.5 text-xs leading-6">{t("افتح التطبيق من رابط https ليعمل {label}.", { label: t(PERM_LABELS[n].title) })}</p>}
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
  unsupported: "متصفحك لا يدعم الإشعارات. في الآيفون: أضف التطبيق إلى الشاشة الرئيسية أولاً.",
  denied: "الإشعارات ممنوعة. فعّلها من إعدادات المتصفح لهذا الموقع.",
  off: "تصلك الرسائل حتى لو كان التطبيق مغلقاً",
  on: "مفعّلة: تصلك الرسائل والمكالمات حتى لو كان التطبيق مغلقاً",
};

export function PushToggle() {
  const t = useT();
  const { notify } = useWasl();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  // إشعار تجريبي: يصل بعد 5 ثوانٍ (ليُغلق المستخدم التطبيق)، ثم نعرض ما حدث لكل جهاز
  async function sendTest() {
    setTesting(true);
    notify(t("سيصل إشعار تجريبي خلال 5 ثوانٍ. أغلق التطبيق أو اقفل الشاشة الآن."));
    try {
      const results = await testPush(5);
      const failed = results.filter((r) => !r.ok);
      if (!results.length || failed.some((r) => r.status === 404 || r.status === 410 || r.reason.includes("VapidPkHashMismatch"))) {
        notify(t("انتهى اشتراك هذا الجهاز. أوقف الإشعارات ثم فعّلها من جديد."));
      } else if (failed.length) {
        const f = failed[0];
        notify(t("رفضت خدمة الإشعارات ({host}) الإرسال: {status} {reason}", { host: f.host, status: f.status ?? "", reason: f.reason }));
      } else {
        notify(t("أُرسل الإشعار التجريبي ✅ إن لم يظهر، فتحقق من إعدادات الإشعارات في الهاتف."));
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setTesting(false);
    }
  }
  useEffect(() => {
    getPushState().then(setState);
  }, []);
  if (!state) return null;
  return (
    <div>
      <div className="flex items-center gap-3">
        <Icon name="bell" size={20} className="w-accent-text" />
        <div className="flex-1">
          <p className="font-bold">{t("الإشعارات")}</p>
          <p className="w-muted text-xs leading-5">{t(pushLabels[state])}</p>
        </div>
        {(state === "on" || state === "off") && (
          <Toggle on={state === "on"} label={t("الإشعارات")} onChange={async () => {
            if (busy) return;
            setBusy(true);
            setState(await (state === "on" ? disablePush() : enablePush()).catch((): PushState => state));
            setBusy(false);
          }} />
        )}
      </div>
      {state === "on" && (
        <button onClick={sendTest} disabled={testing} className="w-tint mt-3 w-full rounded-full py-2.5 text-sm font-bold disabled:opacity-50">
          {t(testing ? "جارٍ الإرسال..." : "إرسال إشعار تجريبي")}
        </button>
      )}
    </div>
  );
}

/** بطاقة صغيرة في القائمة تذكّر المستخدم بتفعيل الإشعارات */
export function PushBanner() {
  const t = useT();
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
  // الآيفون لا يرسل إشعارات لموقع مفتوح في سفاري: يجب إضافته إلى الشاشة الرئيسية وفتحه من هناك (iOS 16.4+)
  if (ios && state !== "on") {
    return (
      <div className="w-card mx-4 mb-2 flex items-start gap-3 rounded-2xl p-3">
        <span className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="device" size={18} /></span>
        <div className="min-w-0 flex-1 text-xs leading-5">
          <p className="font-extrabold">{t("ثبّت وَصل على الآيفون لتصلك الإشعارات")}</p>
          <p className="w-muted">{t("اضغط زر المشاركة ⬆︎ في سفاري ← إضافة إلى الشاشة الرئيسية، ثم افتح التطبيق من الأيقونة.")}</p>
        </div>
        <button className="w-muted" aria-label={t("إخفاء")} onClick={() => setHidden(true)}><Icon name="x" size={16} /></button>
      </div>
    );
  }
  if (state !== "off") return null;
  return (
    <div className="w-card mx-4 mb-2 flex items-center gap-3 rounded-2xl p-3">
      <span className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="bell" size={18} /></span>
      <div className="min-w-0 flex-1 text-xs"><p className="font-extrabold">{t("فعّل الإشعارات")}</p><p className="w-muted">{t("كي لا تفوتك أي رسالة")}</p></div>
      <button className="w-accent rounded-full px-3 py-1.5 text-xs font-bold" onClick={async () => setState(await enablePush().catch((): PushState => "off"))}>{t("تفعيل")}</button>
      <button className="w-muted" aria-label={t("إخفاء")} onClick={() => setHidden(true)}><Icon name="x" size={16} /></button>
    </div>
  );
}
