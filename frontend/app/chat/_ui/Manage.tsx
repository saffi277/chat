"use client";
// لوحة الإدارة (الإعدادات ← لوحة الإدارة): ما ينتظر مدير النظام، بخطوة واحدة لكل أمر.
// طلبات الأدوار (قبول/رفض)، والبلاغات، وطلبات «نسيت كلمة المرور» والدعم الفني. والباقي النادر في /admin
import { useCallback, useEffect, useState } from "react";
import { ROLE_LABELS, type ManageOverview, type ManagedPerson } from "@/lib/api";
import { manage } from "@/lib/endpoints";
import { useT } from "@/lib/i18n";
import { listTime, Section } from "./bits";
import { Icon } from "./icons";
import { REASONS } from "./Safety";
import { useWasl } from "./store";

const who = (p: ManagedPerson | null) => (p ? p.display_name || p.username : "—");

export function ManagePage({ onCount }: { onCount?: (n: number) => void }) {
  const t = useT();
  const { notify } = useWasl();
  const [data, setData] = useState<ManageOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => manage.overview().then((d) => {
    setData(d);
    onCount?.(d.role_requests.length + d.reports.length + d.support.length);
  }).catch((e) => notify((e as Error).message)), [notify, onCount]);
  useEffect(() => { load(); }, [load]);

  /** تنفيذ أمر ثم تحديث القائمة (الزر المضغوط يُعطَّل حتى ينتهي) */
  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      notify(done);
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="w-muted mt-6 text-center text-sm">{t("جارٍ التحميل...")}</p>;
  const nothing = !data.role_requests.length && !data.reports.length && !data.support.length;
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label={t("الحسابات")} value={data.stats.users} />
        <Stat label={t("متصل الآن")} value={data.stats.online} />
      </div>

      {nothing && (
        <Section>
          <p className="py-4 text-center font-bold"><Icon name="check" size={18} className="inline align-[-3px]" /> {t("لا شيء ينتظرك الآن")}</p>
        </Section>
      )}

      {data.role_requests.length > 0 && (
        <Section title={`${t("طلبات الأدوار")} (${data.role_requests.length})`}>
          <p className="w-muted -mt-1 mb-2 text-xs leading-6">{t("تحقّق من هوية صاحب الطلب قبل القبول: الدور التدريسي والإداري يسمح بالنشر في القنوات.")}</p>
          {data.role_requests.map((p) => (
            <Card key={p.id} testid="role-request">
              <Line strong>{who(p)}</Line>
              <Line muted>@{p.username}{p.university_id ? ` • ${p.university_id}` : ""}{p.email ? ` • ${p.email}` : ""}</Line>
              <Line>{t("يطلب دور: {role}", { role: t(ROLE_LABELS[p.requested_role || "student"]) })}</Line>
              <div className="mt-2 flex gap-2">
                <button disabled={!!busy} onClick={() => act(`r${p.id}`, () => manage.decideRole(p.id, true), t("قُبل الطلب"))}
                  className="w-accent h-10 flex-1 rounded-full text-sm font-bold disabled:opacity-50">{t("قبول")}</button>
                <button disabled={!!busy} onClick={() => act(`r${p.id}`, () => manage.decideRole(p.id, false), t("رُفض الطلب، ويبقى الحساب طالباً"))}
                  className="w-card h-10 flex-1 rounded-full text-sm font-bold disabled:opacity-50">{t("رفض")}</button>
              </div>
            </Card>
          ))}
        </Section>
      )}

      {data.support.length > 0 && (
        <Section title={`${t("طلبات المساعدة")} (${data.support.length})`}>
          {data.support.map((s) => <SupportCard key={s.id} s={s} busy={!!busy} act={act} />)}
        </Section>
      )}

      {data.reports.length > 0 && (
        <Section title={`${t("البلاغات")} (${data.reports.length})`}>
          {data.reports.map((r) => (
            <Card key={r.id} testid="report">
              <Line strong>{t(REASONS.find((x) => x.id === r.reason)?.label ?? "سبب آخر")}</Line>
              <Line>{t("عن: {name}", { name: who(r.user) })}{r.user ? ` (@${r.user.username})` : ""}</Line>
              <Line muted>{t("من: {name}", { name: who(r.reporter) })} • {listTime(r.created_at)}</Line>
              {r.message_text && <p className="w-card mt-1.5 rounded-xl px-3 py-2 text-sm" dir="auto">«{r.message_text}»</p>}
              {r.details && <Line>{r.details}</Line>}
              <button disabled={!!busy} onClick={() => act(`p${r.id}`, () => manage.reportDone(r.id), t("تمت مراجعة البلاغ"))}
                className="w-tint mt-2 h-10 w-full rounded-full text-sm font-bold disabled:opacity-50">{t("تمت المراجعة")}</button>
            </Card>
          ))}
        </Section>
      )}

      <a href="/admin/" target="_blank" rel="noreferrer" className="w-muted mt-5 block text-center text-xs underline">
        {t("الإدارة المتقدمة (للأمور النادرة)")}
      </a>
    </>
  );
}

function SupportCard({ s, busy, act }: { s: ManageOverview["support"][number]; busy: boolean;
  act: (key: string, fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const forgot = s.kind === "password";
  return (
    <Card testid="support-request">
      <Line strong>{t(forgot ? "نسيت كلمة المرور" : "دعم فني")}</Line>
      <Line>{s.user ? `${who(s.user)} (@${s.user.username})` : t("الحساب غير معروف: {id}", { id: s.identifier || "—" })}</Line>
      {s.contact && <Line muted>{t("للتواصل: {contact}", { contact: s.contact })}</Line>}
      {s.message && <p className="w-card mt-1.5 rounded-xl px-3 py-2 text-sm" dir="auto">{s.message}</p>}
      <Line muted>{listTime(s.created_at)}</Line>
      {forgot && s.user ? (
        <form className="mt-2 flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          act(`s${s.id}`, () => manage.supportDone(s.id, password), t("تم تعيين كلمة المرور الجديدة. أبلغ صاحبها بها."));
        }}>
          <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required dir="ltr"
            placeholder={t("كلمة مرور جديدة")} aria-label={t("كلمة مرور جديدة")}
            className="w-input h-10 min-w-0 flex-1 rounded-full px-4 text-base outline-none md:text-sm" />
          <button disabled={busy} className="w-accent h-10 rounded-full px-4 text-sm font-bold disabled:opacity-50">{t("تعيين")}</button>
        </form>
      ) : null}
      <button disabled={busy} onClick={() => act(`s${s.id}`, () => manage.supportDone(s.id), t("أُغلق الطلب"))}
        className="w-card mt-2 h-10 w-full rounded-full text-sm font-bold disabled:opacity-50">{t("تم الحل")}</button>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[22px] p-4 text-center" style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="w-muted text-xs">{label}</div>
    </div>
  );
}

function Card({ children, testid }: { children: React.ReactNode; testid: string }) {
  return <div data-testid={testid} className="border-t py-3 first:border-t-0 first:pt-0 last:pb-0" style={{ borderColor: "var(--divider)" }}>{children}</div>;
}

function Line({ children, strong, muted }: { children: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return <p className={`text-sm leading-6 ${strong ? "font-extrabold" : ""} ${muted ? "w-muted text-xs" : ""}`} dir="auto">{children}</p>;
}
