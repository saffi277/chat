"use client";
import { useState } from "react";
import { canBroadcast, ROLE_LABELS, type User } from "@/lib/api";
import { contacts as contactsApi, users as usersApi } from "@/lib/endpoints";
import { useT } from "@/lib/i18n";
import { Avatar, Empty, IconButton, lastSeenText, nameOf, Panel } from "./bits";
import { ScreenHeader, SearchBox } from "./ChatList";
import { Icon, type IconName } from "./icons";
import { useWasl } from "./store";

/** زر كبير في أعلى القائمة: إضافة جهة اتصال، مجموعة جديدة، قناة جديدة... */
function ActionRow({ icon, label, hint, onClick }: { icon: IconName; label: string; hint?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-hover flex w-full items-center gap-3 px-4 py-2.5 text-start">
      <span className="w-tint grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full"><Icon name={icon} size={22} filled={icon === "users"} /></span>
      <span className="min-w-0">
        <span className="block font-bold">{label}</span>
        {hint && <span className="w-muted block truncate text-[13px]">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * جهات الاتصال: من أضفتهم أنت فقط (كما في واتساب)، لا قائمة بكل حسابات الجامعة.
 * منها تبدأ محادثة، أو تنشئ مجموعة أو قناة.
 */
export function PeopleView() {
  const t = useT();
  const { me, contacts, openWith, setPanel, openSaved } = useWasl();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = contacts
    .filter((u) => !query || nameOf(u).toLowerCase().includes(query) || u.username.toLowerCase().includes(query) || u.phone.includes(query))
    .sort((a, b) => Number(b.is_online) - Number(a.is_online));
  const teacher = canBroadcast(me);

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ScreenHeader title={t("جهات الاتصال")} menu={[
          { icon: "userPlus", label: t("إضافة جهة اتصال"), run: () => setPanel({ type: "addContact" }) },
          { icon: "users", label: t("مجموعة جديدة"), run: () => setPanel({ type: "newGroup" }) },
          ...(teacher ? [{ icon: "megaphone" as IconName, label: t("قناة جديدة"), run: () => setPanel({ type: "newChannel" }) }] : []),
          { icon: "search", label: t("استكشاف القنوات"), run: () => setPanel({ type: "channels" }) },
          { icon: "bookmark", label: t("الرسائل المحفوظة"), run: openSaved },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder={t("البحث في جهات الاتصال")} />
      </header>
      <div className="w-scroll mt-2 flex-1 overflow-y-auto pb-4">
        <ActionRow icon="userPlus" label={t("إضافة جهة اتصال")} hint={t("بالرقم الجامعي أو البريد أو اسم المستخدم")} onClick={() => setPanel({ type: "addContact" })} />
        <ActionRow icon="users" label={t("مجموعة جديدة")} onClick={() => setPanel({ type: "newGroup" })} />
        {teacher && <ActionRow icon="megaphone" label={t("قناة جديدة")} hint={t("ينشر فيها المشرفون فقط")} onClick={() => setPanel({ type: "newChannel" })} />}
        <ActionRow icon="search" label={t("استكشاف القنوات")} onClick={() => setPanel({ type: "channels" })} />
        <p className="w-muted px-4 pb-1 pt-3 text-[13px] font-semibold">{t("جهات الاتصال ({n})", { n: contacts.length })}</p>
        {contacts.length === 0 && (
          <Empty icon="users" title={t("لم تُضف أحداً بعد")} text={t("أضف زملاءك وأساتذتك بالرقم الجامعي أو البريد الجامعي، ولن يظهر لك غيرهم.")} />
        )}
        {contacts.length > 0 && list.length === 0 && <Empty icon="search" title={t("لا يوجد أحد بهذا الاسم")} />}
        {list.map((u) => (
          <div key={u.id} className="w-hover flex items-center gap-3 px-4 py-2">
            <button onClick={() => setPanel({ type: "contact", userId: u.id })} className="flex min-w-0 flex-1 items-center gap-3 text-start">
              <Avatar user={u} size={52} online={u.is_online || undefined} />
              <span className="min-w-0">
                <span className="block truncate font-bold" dir="auto">{nameOf(u)}</span>
                <span className="block truncate text-[13px]" dir="auto" style={{ color: u.is_online ? "var(--online)" : "var(--muted)" }}>{u.bio || lastSeenText(u)}</span>
              </span>
            </button>
            <IconButton icon="chats" label={t("مراسلة {name}", { name: nameOf(u) })} onClick={() => openWith(u.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * إضافة جهة اتصال: تكتب معرّفاً تعرفه عن الشخص (بالضبط، لا جزءاً منه)، فيظهر لك لتتأكد أنه هو، ثم تضيفه.
 * هكذا لا يستطيع أحد تصفّح حسابات الجامعة بكتابة حرف أو حرفين.
 */
export function AddContactPanel() {
  const t = useT();
  const { setPanel, isContact, contactAdded, openWith, notify } = useWasl();
  const [identifier, setIdentifier] = useState("");
  const [found, setFound] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    setError("");
    setFound(null);
    try {
      setFound(await usersApi.find(identifier.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!found) return;
    setBusy(true);
    try {
      const u = await contactsApi.add({ identifier: identifier.trim() });
      contactAdded(u);
      setFound({ ...u, is_contact: true });
      notify(t("أُضيف {name} إلى جهات اتصالك", { name: nameOf(u) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saved = found && (found.is_contact || isContact(found.id));

  return (
    <Panel title={t("إضافة جهة اتصال")} onClose={() => setPanel(null)}>
      <p className="w-muted mt-1 text-sm leading-7">{t("اكتب الرقم الجامعي أو البريد الجامعي أو اسم المستخدم أو رقم الهاتف كاملاً.")}</p>
      <form onSubmit={search} className="mt-3 flex gap-2">
        <input autoFocus value={identifier} onChange={(e) => { setIdentifier(e.target.value); setError(""); }} dir="auto"
          placeholder={t("مثال: S-2041 أو name@asbat.edu.iq")} aria-label={t("المعرّف")} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className="w-input h-12 min-w-0 flex-1 rounded-full px-4 text-base outline-none" style={{ color: "var(--text)" }} />
        <button type="submit" disabled={busy || !identifier.trim()} className="w-accent h-12 shrink-0 rounded-full px-5 font-bold disabled:opacity-50">{t("بحث")}</button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-2xl px-4 py-3 text-sm font-semibold" style={{ background: "var(--card)", color: "var(--danger)" }}>{error}</p>}
      {found && (
        <section className="mt-4 flex flex-col items-center rounded-[22px] p-5 text-center" style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
          <Avatar user={found} size={88} />
          <h3 className="mt-3 text-xl font-extrabold" dir="auto">{nameOf(found)}</h3>
          <p className="w-muted text-sm" dir="ltr">@{found.username}</p>
          <span className="w-tint mt-2 rounded-full px-3 py-0.5 text-xs font-bold">{t(ROLE_LABELS[found.role])}</span>
          <div className="mt-4 flex w-full gap-2">
            {saved ? (
              <span className="w-card flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-sm font-bold"><Icon name="check" size={16} />{t("ضمن جهات اتصالك")}</span>
            ) : (
              <button onClick={add} disabled={busy} className="w-accent flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 font-bold disabled:opacity-50">
                <Icon name="userPlus" size={18} />{t("إضافة إلى جهات الاتصال")}
              </button>
            )}
            {saved && (
              <button onClick={() => openWith(found.id)} className="w-accent flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 font-bold">
                <Icon name="chats" size={18} />{t("مراسلة")}
              </button>
            )}
          </div>
        </section>
      )}
    </Panel>
  );
}
