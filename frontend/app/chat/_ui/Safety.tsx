"use client";
/**
 * الخصوصية والأمان: من يرى آخر ظهوري وصورتي، وعلامات القراءة، والمحظورون،
 * والتحقق بخطوتين، والأجهزة المتصلة، وحذف الحساب. ومعها نافذة «إبلاغ».
 */
import { useCallback, useEffect, useState } from "react";
import { logout, type Audience, type Me, type Session, type User } from "@/lib/api";
import { auth, safety, type ReportReason } from "@/lib/endpoints";
import { useT } from "@/lib/i18n";
import { Avatar, nameOf, Section, Toggle } from "./bits";
import { Sheet, whenText } from "./ConvSettings";
import { Icon } from "./icons";
import { useWasl } from "./store";

const AUDIENCES: { id: Audience; label: string }[] = [
  { id: "everyone", label: "الجميع" },
  { id: "contacts", label: "جهات اتصالي" },
  { id: "nobody", label: "لا أحد" },
];
const REASONS: { id: ReportReason; label: string }[] = [
  { id: "spam", label: "رسائل مزعجة" },
  { id: "abuse", label: "محتوى مسيء" },
  { id: "harassment", label: "تحرّش أو تهديد" },
  { id: "other", label: "سبب آخر" },
];

function Radio({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className="w-hover flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-start text-[15px] font-semibold">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: on ? "var(--accent)" : "var(--muted)" }}>
        {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />}
      </span>
      {label}
    </button>
  );
}

// ------------------------------------------------------------ الإبلاغ
export function ReportDialog({ user, messageId, onClose }: { user: Pick<User, "id" | "display_name" | "username">; messageId?: number; onClose: () => void }) {
  const t = useT();
  const { notify, setBlocked, isBlocked } = useWasl();
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(!isBlocked(user.id));
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await safety.report({ user_id: user.id, message_id: messageId, reason, details, block: false });
      if (block && !isBlocked(user.id)) await setBlocked(user.id, true);
      notify(t("وصل بلاغك إلى الإدارة. شكراً لك."));
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t(messageId ? "إبلاغ عن رسالة" : "إبلاغ عن {name}", { name: nameOf(user) })} onClose={onClose}>
      <p className="w-muted mb-2 text-sm">{t("يصل البلاغ إلى إدارة الكلية مع نص الرسالة، ولا يعلم به الشخص.")}</p>
      <div role="radiogroup" aria-label={t("سبب البلاغ")}>
        {REASONS.map((r) => <Radio key={r.id} label={t(r.label)} on={reason === r.id} onClick={() => setReason(r.id)} />)}
      </div>
      <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} dir="auto" placeholder={t("تفاصيل (اختياري)")}
        aria-label={t("تفاصيل البلاغ")} className="w-input mt-2 w-full resize-none rounded-2xl px-4 py-3 text-base outline-none md:text-sm" />
      {!isBlocked(user.id) && (
        <div className="mt-3 flex items-center gap-3">
          <span className="flex-1 text-sm font-semibold">{t("حظر {name} أيضاً", { name: nameOf(user) })}</span>
          <Toggle on={block} onChange={setBlock} label={t("حظر أيضاً")} />
        </div>
      )}
      <button onClick={send} disabled={busy} className="mt-4 h-12 w-full rounded-full text-[15px] font-bold text-white disabled:opacity-50" style={{ background: "var(--danger)" }}>
        {t("إرسال البلاغ")}
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------ صفحة الخصوصية والأمان (في الإعدادات)
export function PrivacyPage({ save }: { save: (fn: () => Promise<Me>, done?: string) => Promise<boolean> }) {
  const t = useT();
  const { me, setBlocked, notify } = useWasl();
  const [blockedUsers, setBlockedUsers] = useState<User[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [dialog, setDialog] = useState<"twoStep" | "twoStepOff" | "delete" | null>(null);
  const loadBlocked = useCallback(() => safety.blocked().then(setBlockedUsers).catch(() => setBlockedUsers([])), []);
  const loadSessions = useCallback(() => auth.sessions().then(setSessions).catch(() => setSessions([])), []);
  useEffect(() => {
    loadBlocked();
    loadSessions();
  }, [loadBlocked, loadSessions]);

  return (
    <>
      <p className="w-muted mb-1 mt-3 px-1 text-xs leading-6">{t("من لا يُسمح له يرى «غير متصل» بدل آخر ظهورك، والحرف الأول من اسمك بدل صورتك.")}</p>
      <Section title={t("آخر ظهور والاتصال الآن")}>
        <div role="radiogroup" aria-label={t("آخر ظهور والاتصال الآن")}>
          {AUDIENCES.map((a) => <Radio key={a.id} label={t(a.label)} on={me.privacy_last_seen === a.id}
            onClick={() => me.privacy_last_seen !== a.id && save(() => auth.updateMe({ privacy_last_seen: a.id }))} />)}
        </div>
      </Section>
      <Section title={t("الصورة الشخصية")}>
        <div role="radiogroup" aria-label={t("الصورة الشخصية")}>
          {AUDIENCES.map((a) => <Radio key={a.id} label={t(a.label)} on={me.privacy_photo === a.id}
            onClick={() => me.privacy_photo !== a.id && save(() => auth.updateMe({ privacy_photo: a.id }))} />)}
        </div>
      </Section>
      <Section>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">{t("علامات القراءة")}</span>
            <span className="w-muted block text-xs leading-5">{t("إن أوقفتها لا يرى أحد أنك قرأت رسالته (✓✓ الزرقاء)، ولا ترى أنت قراءتهم. لا ينطبق على المجموعات.")}</span>
          </span>
          <Toggle on={me.read_receipts} label={t("علامات القراءة")} onChange={(v) => save(() => auth.updateMe({ read_receipts: v }))} />
        </div>
      </Section>

      <Section title={t("المحظورون ({n})", { n: blockedUsers?.length ?? 0 })}>
        {blockedUsers?.length === 0 && <p className="w-muted text-sm">{t("لم تحظر أحداً. للحظر: افتح صفحة الشخص ← ⋯ ← حظر.")}</p>}
        {blockedUsers?.map((u) => (
          <div key={u.id} className="flex items-center gap-3 py-2">
            <Avatar user={u} size={40} />
            <span className="min-w-0 flex-1 truncate font-bold" dir="auto">{nameOf(u)}</span>
            <button onClick={async () => { await setBlocked(u.id, false).catch((e) => notify(e.message)); loadBlocked(); }}
              className="w-tint rounded-full px-3.5 py-1.5 text-xs font-bold">{t("إلغاء الحظر")}</button>
          </div>
        ))}
      </Section>

      <Section title={t("التحقق بخطوتين")}>
        <p className="w-muted mb-2 text-xs leading-6">{t("كلمة سرّ ثانية تُطلب بعد كلمة المرور عند الدخول من أي جهاز جديد، فلا يدخل أحد حسابك حتى لو عرف كلمة المرور.")}</p>
        <div className="flex items-center gap-3">
          <Icon name="shield" size={22} className={me.two_step ? "w-accent-text" : "w-muted"} />
          <span className="flex-1 font-bold">{t(me.two_step ? "مفعّل" : "غير مفعّل")}</span>
          <button onClick={() => setDialog("twoStep")} className="w-tint rounded-full px-4 py-2 text-sm font-bold">{t(me.two_step ? "تغيير" : "تفعيل")}</button>
          {me.two_step && <button onClick={() => setDialog("twoStepOff")} className="w-card rounded-full px-4 py-2 text-sm font-bold">{t("إيقاف")}</button>}
        </div>
      </Section>

      <Section title={t("الأجهزة المتصلة")}>
        {sessions?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-2.5">
            <span className="w-card grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="device" size={19} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold" dir="ltr">{s.device || t("جهاز غير معروف")}</span>
              <span className={`block text-xs ${s.current ? "w-accent-text font-bold" : "w-muted"}`}>
                {s.current ? t("هذا الجهاز") : t("آخر نشاط: {when}", { when: whenText(s.last_used) })}
              </span>
            </span>
            {!s.current && (
              <button onClick={async () => { await auth.endSession(s.id).catch(() => {}); loadSessions(); notify(t("خرج ذلك الجهاز من حسابك")); }}
                className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}>
                {t("إنهاء الجلسة")}
              </button>
            )}
          </div>
        ))}
      </Section>

      <button onClick={() => setDialog("delete")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-bold"
        style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }}>
        <Icon name="trash" size={19} />{t("حذف الحساب")}
      </button>

      {dialog === "twoStep" && <TwoStepDialog onClose={() => setDialog(null)} save={save} />}
      {dialog === "twoStepOff" && (
        <PasswordDialog title={t("إيقاف التحقق بخطوتين")} action={t("إيقاف")} onClose={() => setDialog(null)}
          run={(pw) => save(() => auth.removeTwoStep(pw), t("أُوقف التحقق بخطوتين"))} />
      )}
      {dialog === "delete" && <DeleteAccountDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function TwoStepDialog({ onClose, save }: { onClose: () => void; save: (fn: () => Promise<Me>, done?: string) => Promise<boolean> }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState("");
  const input = "w-input h-12 w-full rounded-2xl px-4 text-base outline-none md:text-sm";
  return (
    <Sheet title={t("التحقق بخطوتين")} onClose={onClose}>
      <form className="grid gap-2.5" onSubmit={async (e) => { e.preventDefault(); if (await save(() => auth.setTwoStep(password, code, hint), t("فُعّل التحقق بخطوتين"))) onClose(); }}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("كلمة المرور الحالية")} aria-label={t("كلمة المرور الحالية")} required className={input} autoComplete="current-password" />
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("كلمة التحقق (4 أحرف على الأقل)")} aria-label={t("كلمة التحقق بخطوتين")} required minLength={4} className={input} autoComplete="new-password" />
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder={t("تلميح يذكّرك بها (اختياري)")} aria-label={t("التلميح")} maxLength={60} className={input} dir="auto" />
        <p className="w-muted text-xs leading-5">{t("إن نسيتها، اطلب من الإدارة إيقافها عبر «الدعم الفني» في صفحة الدخول.")}</p>
        <button className="w-accent h-12 rounded-full text-[15px] font-bold">{t("حفظ")}</button>
      </form>
    </Sheet>
  );
}

function PasswordDialog({ title, action, onClose, run, danger, children }: {
  title: string; action: string; onClose: () => void; run: (password: string) => Promise<boolean | void>; danger?: boolean; children?: React.ReactNode;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose}>
      {children}
      <form className="grid gap-2.5" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await run(password);
        setBusy(false);
        if (ok !== false) onClose();
      }}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("كلمة المرور الحالية")} aria-label={t("كلمة المرور الحالية")}
          required autoFocus autoComplete="current-password" className="w-input h-12 w-full rounded-2xl px-4 text-base outline-none md:text-sm" />
        <button disabled={busy} className={`h-12 rounded-full text-[15px] font-bold disabled:opacity-50 ${danger ? "text-white" : "w-accent"}`}
          style={danger ? { background: "var(--danger)" } : undefined}>{action}</button>
      </form>
    </Sheet>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { notify } = useWasl();
  return (
    <PasswordDialog title={t("حذف الحساب")} action={t("حذف حسابي نهائياً")} danger onClose={onClose}
      run={async (pw) => {
        try {
          await auth.deleteAccount(pw);
          logout();
          window.location.replace("/login");
          return true;
        } catch (e) {
          notify((e as Error).message);
          return false;
        }
      }}>
      <p className="mb-3 text-sm leading-7">{t("سيُحذف حسابك ورسائلك وملفاتك وحالاتك نهائياً، وتغادر كل مجموعاتك. لا يمكن التراجع عن ذلك.")}</p>
    </PasswordDialog>
  );
}
