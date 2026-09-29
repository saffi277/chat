"use client";
/**
 * إعدادات المحادثة: الكتم لمدة، والرسائل المختفية، وخلفية هذه المحادثة، والرسائل المجدولة،
 * وللمشرف في المجموعة: الإرسال والتعديل للمشرفين فقط، والوضع البطيء، ورابط الدعوة.
 * ومعها نافذتان صغيرتان: «كتم الإشعارات» (اختيار المدة) و«جدولة رسالة».
 */
import { useCallback, useEffect, useState } from "react";
import { WALLPAPERS, type Conversation, type InvitePreview, type ScheduledMessage, type Wallpaper } from "@/lib/api";
import { conversations as convApi, invites, messages as msgApi } from "@/lib/endpoints";
import { dateLocale, getLang, useT } from "@/lib/i18n";
import { Avatar, Panel, Section, Toggle } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

/** وقت بلغة المستخدم وبأرقام إنجليزية: «الثلاثاء 30 أيلول، 9:00 م» */
export function whenText(iso: string) {
  return new Date(iso).toLocaleString(dateLocale(getLang()), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const MUTE_OPTIONS: { hours: number | null; label: string }[] = [
  { hours: 8, label: "8 ساعات" },
  { hours: 168, label: "أسبوع" },
  { hours: null, label: "دائماً" },
];
const DISAPPEAR_OPTIONS = [
  { value: 0, label: "إيقاف" },
  { value: 24 * 3600, label: "24 ساعة" },
  { value: 7 * 24 * 3600, label: "7 أيام" },
  { value: 90 * 24 * 3600, label: "90 يوماً" },
];
const SLOW_OPTIONS = [
  { value: 0, label: "إيقاف" },
  { value: 10, label: "10 ثوانٍ" },
  { value: 30, label: "30 ثانية" },
  { value: 60, label: "دقيقة" },
  { value: 300, label: "5 دقائق" },
  { value: 900, label: "15 دقيقة" },
  { value: 3600, label: "ساعة" },
];
export const disappearLabel = (secs: number) => DISAPPEAR_OPTIONS.find((o) => o.value === secs)?.label ?? "";

// ------------------------------------------------------------ نافذة صغيرة (من الأسفل في الهاتف، وفي الوسط في الحاسوب)
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/45 md:items-center" onClick={onClose}>
      <section role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-strong w-shadow w-full rounded-t-[28px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-w-md md:rounded-[28px]"
        style={{ border: "1px solid var(--border)" }}>
        <header className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-lg font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label={t("إغلاق")} className="w-card grid h-9 w-9 place-items-center rounded-full"><Icon name="x" size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

/** سطر اختيار واحد من عدة (دائرة تتلوّن عند الاختيار) */
function Choice({ label, on, onClick, hint }: { label: string; on: boolean; onClick: () => void; hint?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className="w-hover flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start text-[15px] font-semibold">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: on ? "var(--accent)" : "var(--muted)" }}>
        {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />}
      </span>
      <span className="flex-1">{label}</span>
      {hint && <span className="w-muted text-xs">{hint}</span>}
    </button>
  );
}

// ------------------------------------------------------------ كتم الإشعارات لمدة
export function MuteDialog({ convId, onClose }: { convId: number; onClose: () => void }) {
  const t = useT();
  const { refreshConvs, notify } = useWasl();
  const pick = async (hours: number | null) => {
    try {
      await convApi.setPrefs(convId, { is_muted: true, ...(hours ? { mute_hours: hours } : {}) });
      await refreshConvs();
      notify(t("كُتمت الإشعارات"));
      onClose();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <Sheet title={t("كتم الإشعارات")} onClose={onClose}>
      <p className="w-muted mb-2 text-sm">{t("لن تصلك إشعارات هذه المحادثة، وتبقى الرسائل تصل كالمعتاد.")}</p>
      <div role="radiogroup">
        {MUTE_OPTIONS.map((o) => <Choice key={o.label} label={t(o.label)} on={false} onClick={() => pick(o.hours)} />)}
      </div>
    </Sheet>
  );
}

/** الكتم من أي مكان: إن كانت مكتومة يلغيه، وإلا يفتح نافذة اختيار المدة */
export function useMuteToggle() {
  const { refreshConvs, setMuteDialog, notify } = useWasl();
  return useCallback(async (conv: Conversation) => {
    if (!conv.is_muted) return setMuteDialog(conv.id);
    await convApi.setPrefs(conv.id, { is_muted: false }).catch((e) => notify(e.message));
    await refreshConvs();
  }, [refreshConvs, setMuteDialog, notify]);
}

// ------------------------------------------------------------ جدولة رسالة
const pad = (n: number) => String(n).padStart(2, "0");
/** قيمة <input type="datetime-local"> بالتوقيت المحلي */
const localValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function presets() {
  const now = new Date();
  const hour = new Date(now.getTime() + 60 * 60 * 1000);
  hour.setSeconds(0, 0);
  const tonight = new Date(now);
  tonight.setHours(21, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  return [
    { label: "بعد ساعة", at: hour },
    ...(tonight.getTime() - now.getTime() > 5 * 60 * 1000 ? [{ label: "الليلة 9:00 م", at: tonight }] : []),
    { label: "غداً 8:00 ص", at: tomorrow },
  ];
}

export function ScheduleDialog({ convId, text = "", replyTo, onClose, onDone }: {
  convId: number; text?: string; replyTo?: number; onClose: () => void; onDone?: () => void;
}) {
  const t = useT();
  const { notify } = useWasl();
  const [content, setContent] = useState(text);
  const [at, setAt] = useState(() => localValue(presets()[0].at));
  const [silent, setSilent] = useState(false);
  const [busy, setBusy] = useState(false);
  // أقرب وقت مسموح (بعد دقيقتين): يُحسب مرة عند فتح النافذة
  const [min] = useState(() => localValue(new Date(Date.now() + 2 * 60 * 1000)));
  async function save() {
    const when = new Date(at);
    if (!content.trim() || Number.isNaN(when.getTime())) return;
    setBusy(true);
    try {
      await msgApi.schedule(convId, content.trim(), when, { silent, replyTo });
      notify(t("ستُرسل الرسالة {when}", { when: whenText(when.toISOString()) }));
      onDone?.();
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("جدولة رسالة")} onClose={onClose}>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} dir="auto" autoFocus={!text}
        placeholder={t("اكتب رسالة...")} aria-label={t("نص الرسالة المجدولة")}
        className="w-input w-full resize-none rounded-2xl px-4 py-3 text-base outline-none md:text-sm" />
      <div className="mt-3 flex flex-wrap gap-2">
        {presets().map((p) => (
          <button key={p.label} type="button" aria-pressed={at === localValue(p.at)} onClick={() => setAt(localValue(p.at))}
            className="w-chip rounded-full px-3.5 py-2 text-[13px] font-semibold">{t(p.label)}</button>
        ))}
      </div>
      <label className="mt-3 block text-sm font-bold">
        {t("وقت الإرسال")}
        <input type="datetime-local" value={at} min={min} onChange={(e) => setAt(e.target.value)} dir="ltr"
          className="w-input mt-1.5 h-12 w-full rounded-2xl px-4 text-base outline-none md:text-sm" />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex-1 text-sm font-semibold">{t("إرسال دون إشعار")}</span>
        <Toggle on={silent} onChange={setSilent} label={t("إرسال دون إشعار")} />
      </div>
      <button onClick={save} disabled={busy || !content.trim() || !at}
        className="w-accent mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-bold disabled:opacity-50">
        <Icon name="clock" size={18} />{t("جدولة")}
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------ لوحة إعدادات المحادثة
export function ConvSettingsPanel({ convId }: { convId: number }) {
  const t = useT();
  const { convs, setPanel, refreshConvs, notify, setMuteDialog } = useWasl();
  const conv = convs.find((c) => c.id === convId);
  const [scheduled, setScheduled] = useState<ScheduledMessage[] | null>(null);
  const [invite, setInvite] = useState<string | null | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const loadScheduled = useCallback(() => msgApi.scheduled(convId).then(setScheduled).catch(() => setScheduled([])), [convId]);
  useEffect(() => {
    loadScheduled();
  }, [loadScheduled]);
  const admin = conv?.my_role === "admin";
  const group = conv?.kind === "group";
  useEffect(() => {
    if (group && admin) convApi.get(convId).then((c) => setInvite(c.invite_code ?? null)).catch(() => {});
  }, [convId, group, admin]);
  if (!conv) return null;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refreshConvs();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const inviteUrl = invite ? `${window.location.origin}/chat?join=${invite}` : "";
  const canDisappear = conv.kind === "direct" || (group && conv.can_edit_info);

  return (
    <Panel title={t("إعدادات المحادثة")} onClose={() => setPanel(null)}>
      <Section title={t("الإشعارات")}>
        <div className="flex items-center gap-3">
          <Icon name={conv.is_muted ? "bellOff" : "bell"} size={22} className="w-accent-text" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">{t(conv.is_muted ? "مكتومة" : "مفعّلة")}</div>
            {conv.is_muted && <div className="w-muted text-xs">{conv.muted_until ? t("حتى {when}", { when: whenText(conv.muted_until) }) : t("دائماً")}</div>}
          </div>
          <button onClick={() => (conv.is_muted ? run(() => convApi.setPrefs(convId, { is_muted: false })) : setMuteDialog(convId))}
            className="w-tint rounded-full px-4 py-2 text-sm font-bold">{t(conv.is_muted ? "إلغاء الكتم" : "كتم")}</button>
        </div>
      </Section>

      {(conv.kind === "direct" || group) && (
        <Section title={t("الرسائل المختفية")}>
          <p className="w-muted mb-1 text-xs leading-6">{t("الرسائل الجديدة تُحذف عند الجميع بعد المدة المختارة. الرسائل السابقة لا تتأثر.")}</p>
          <div role="radiogroup" aria-label={t("الرسائل المختفية")} className={canDisappear ? "" : "pointer-events-none opacity-50"}>
            {DISAPPEAR_OPTIONS.map((o) => (
              <Choice key={o.value} label={t(o.label)} on={conv.disappear_after === o.value}
                onClick={() => run(() => convApi.setSettings(convId, { disappear_after: o.value }))} />
            ))}
          </div>
          {!canDisappear && <p className="w-muted mt-1 text-xs">{t("يغيّرها المشرفون فقط")}</p>}
        </Section>
      )}

      <Section title={t("خلفية هذه المحادثة")}>
        <div className="grid grid-cols-4 gap-2">
          <WallTile id="" label={t("الافتراضية")} on={!conv.wallpaper} onClick={() => run(() => convApi.setPrefs(convId, { wallpaper: "" }))} />
          {WALLPAPERS.map((w) => (
            <WallTile key={w.id} id={w.id} label={t(w.label)} on={conv.wallpaper === w.id} onClick={() => run(() => convApi.setPrefs(convId, { wallpaper: w.id }))} />
          ))}
        </div>
        <p className="w-muted mt-2 text-xs">{t("تظهر لك وحدك. الخلفية الافتراضية تُختار من الإعدادات ← الثيمات.")}</p>
      </Section>

      {conv.can_post && conv.kind !== "saved" && (
        <Section title={t("الرسائل المجدولة")} extra={
          <button onClick={() => setComposing(true)} className="w-accent-text flex items-center gap-1 text-sm font-bold"><Icon name="plus" size={16} />{t("جدولة رسالة")}</button>
        }>
          {scheduled === null ? <p className="w-muted text-sm">{t("جارٍ التحميل...")}</p> : scheduled.length === 0 ? (
            <p className="w-muted text-sm">{t("لا توجد رسائل مجدولة. للجدولة: اضغط مطوّلاً على زر الإرسال (أو انقر بالزر الأيمن).")}</p>
          ) : (
            <div className="w-divide">
              {scheduled.map((s) => (
                <div key={s.id} className="flex items-start gap-3 py-2.5">
                  <Icon name="clock" size={18} className="w-accent-text mt-1 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm" dir="auto">{s.content}</p>
                    <p className="w-muted mt-0.5 text-xs">
                      {whenText(s.send_at)}{s.silent && ` • ${t("دون إشعار")}`}
                    </p>
                    {s.status === "failed" && <p className="mt-0.5 text-xs font-bold" style={{ color: "var(--danger)" }}>{t("تعذّر الإرسال")}: {s.error}</p>}
                  </div>
                  <button onClick={() => msgApi.cancelScheduled(s.id).then(loadScheduled).catch((e) => notify(e.message))}
                    aria-label={t("إلغاء الرسالة المجدولة")} className="w-muted grid h-8 w-8 shrink-0 place-items-center rounded-full"><Icon name="trash" size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {group && admin && (
        <>
          <Section title={t("إعدادات المجموعة")}>
            <SettingToggle label={t("الإرسال للمشرفين فقط")} hint={t("الأعضاء يقرؤون ويتفاعلون فقط")} on={conv.only_admins_post}
              onChange={(v) => run(() => convApi.setSettings(convId, { only_admins_post: v }))} />
            <SettingToggle label={t("تعديل المعلومات للمشرفين فقط")} hint={t("الاسم والوصف والصورة")} on={conv.only_admins_edit}
              onChange={(v) => run(() => convApi.setSettings(convId, { only_admins_edit: v }))} />
            <label className="mt-2 flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{t("الوضع البطيء")}</span>
                <span className="w-muted block text-xs">{t("المدة بين رسالتين لكل عضو")}</span>
              </span>
              <select value={conv.slow_mode} onChange={(e) => run(() => convApi.setSettings(convId, { slow_mode: Number(e.target.value) }))}
                className="w-input h-10 rounded-full px-3 text-sm font-semibold outline-none">
                {SLOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </select>
            </label>
          </Section>
          <Section title={t("رابط الدعوة")}>
            <p className="w-muted mb-2 text-xs leading-6">{t("من يفتح الرابط يستطيع الانضمام إلى المجموعة. شاركه مع من تريد فقط.")}</p>
            {invite ? (
              <>
                <div className="w-input flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs" dir="ltr">
                  <Icon name="link" size={16} className="w-accent-text shrink-0" />
                  <span className="min-w-0 flex-1 truncate" data-testid="invite-url">{inviteUrl}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { navigator.clipboard?.writeText(inviteUrl); notify(t("نُسخ الرابط")); }}
                    className="w-tint flex-1 rounded-full py-2.5 text-sm font-bold">{t("نسخ الرابط")}</button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <button onClick={() => navigator.share({ title: conv.title, url: inviteUrl }).catch(() => {})}
                      className="w-tint flex-1 rounded-full py-2.5 text-sm font-bold">{t("مشاركة")}</button>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => run(async () => setInvite((await convApi.createInvite(convId)).invite_code))}
                    className="w-card flex-1 rounded-full py-2.5 text-sm font-bold">{t("رابط جديد")}</button>
                  <button onClick={() => run(async () => { await convApi.revokeInvite(convId); setInvite(null); })}
                    className="w-card flex-1 rounded-full py-2.5 text-sm font-bold" style={{ color: "var(--danger)" }}>{t("إلغاء الرابط")}</button>
                </div>
              </>
            ) : (
              <button onClick={() => run(async () => setInvite((await convApi.createInvite(convId)).invite_code))}
                className="w-accent flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold"><Icon name="link" size={16} />{t("إنشاء رابط دعوة")}</button>
            )}
          </Section>
        </>
      )}
      {composing && <ScheduleDialog convId={convId} onClose={() => setComposing(false)} onDone={loadScheduled} />}
    </Panel>
  );
}

function SettingToggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && <span className="w-muted block text-xs">{hint}</span>}
      </span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

/** معاينة خلفية (نفس CSS المحادثة) */
export function WallTile({ id, label, on, onClick }: { id: Wallpaper | ""; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label} className="grid justify-items-center gap-1 text-[11px] font-semibold">
      <span className="w-chat-bg relative block h-20 w-full overflow-hidden rounded-2xl" data-wallpaper={id || undefined}
        style={{ outline: on ? "3px solid var(--accent)" : "1px solid var(--border)", outlineOffset: on ? 1 : 0 }}>
        <span className="w-bubble-in absolute start-1.5 top-2 h-3 w-9 rounded-full" />
        <span className="w-bubble-out absolute end-1.5 top-7 h-3 w-10 rounded-full" />
        {on && <span className="w-accent absolute bottom-1 end-1 grid h-5 w-5 place-items-center rounded-full"><Icon name="check" size={12} strokeWidth={3} /></span>}
      </span>
      <span className={on ? "w-accent-text" : "w-muted"}>{label}</span>
    </button>
  );
}

// ------------------------------------------------------------ الانضمام برابط دعوة
export function JoinDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const { refreshConvs, openConv, setTab, notify } = useWasl();
  const [info, setInfo] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    invites.preview(code).then(setInfo).catch((e) => setError((e as Error).message));
  }, [code]);
  async function join() {
    setBusy(true);
    try {
      const c = await invites.join(code);
      await refreshConvs();
      setTab("chats");
      openConv(c.id);
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("دعوة إلى مجموعة")} onClose={onClose}>
      {error ? (
        <p className="py-4 text-center text-sm font-semibold" role="alert">{error}</p>
      ) : !info ? (
        <p className="w-muted py-4 text-center text-sm">{t("جارٍ التحميل...")}</p>
      ) : (
        <div className="grid justify-items-center text-center">
          <Avatar src={info.avatar} name={info.title} size={84} />
          <h3 className="mt-3 text-xl font-extrabold" dir="auto">{info.title}</h3>
          <p className="w-muted text-sm">{t("مجموعة • {n} أعضاء", { n: info.member_count })}</p>
          {info.description && <p className="mt-2 text-sm" dir="auto">{info.description}</p>}
          <button onClick={info.is_member ? () => { openConv(info.id); setTab("chats"); onClose(); } : join} disabled={busy}
            className="w-accent mt-5 h-12 w-full rounded-full text-[15px] font-bold disabled:opacity-50">
            {t(info.is_member ? "أنت عضو فيها: فتح المجموعة" : "انضمام إلى المجموعة")}
          </button>
        </div>
      )}
    </Sheet>
  );
}
