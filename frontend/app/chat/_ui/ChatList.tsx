"use client";
import { useState } from "react";
import { canBroadcast, type Conversation } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { ConvAvatar, Empty, listTime, nameOf, preview, StoryTap } from "./bits";
import { CallLog } from "./Calls";
import { Icon, type IconName } from "./icons";
import { PushBanner } from "./Settings";
import { useWasl, type Tab } from "./store";

type Filter = "all" | "unread" | "groups" | "channels" | "calls";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "unread", label: "غير مقروءة" },
  { id: "groups", label: "المجموعات" },
  { id: "channels", label: "القنوات" },
  { id: "calls", label: "المكالمات" },
];

type MenuItem = { icon: IconName; label: string; run: () => void };

/** رأس الشاشة: العنوان في البداية، وزر دائري بنفسجي فاتح في النهاية (يفتح قائمة) */
export function ScreenHeader({ title, menu }: { title: string; menu?: MenuItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <h1 className="flex-1 text-[28px] font-extrabold leading-tight">{title}</h1>
      {menu && (
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} aria-label={t("القائمة")} aria-expanded={open}
            className="w-tint grid h-10 w-10 place-items-center rounded-full transition active:scale-95">
            <Icon name="more" size={20} strokeWidth={2.6} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
              <div className="w-strong w-shadow absolute end-0 top-12 z-30 w-56 rounded-2xl p-1.5" style={{ border: "1px solid var(--border)" }}>
                {menu.map((it) => (
                  <button key={it.label} onClick={() => { setOpen(false); it.run(); }}
                    className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold">
                    <Icon name={it.icon} size={19} className="w-accent-text" />{it.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** خانة البحث الرمادية */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const t = useT();
  return (
    <label className="w-input mt-4 flex items-center gap-2 rounded-2xl px-4">
      <Icon name="search" size={20} className="w-muted" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-12 w-full bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} aria-label={t("بحث")} />
    </label>
  );
}

export function ChatList() {
  const { me, convs, setTab, setPanel, openSaved, otherOf } = useWasl();
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const saved = convs.find((c) => c.kind === "saved");
  const title = (c: Conversation) => (c.kind === "direct" ? (otherOf(c) ? nameOf(otherOf(c)!) : "") : c.title);
  const query = q.trim().toLowerCase();
  const shown = convs
    .filter((c) => c.kind !== "saved")
    .filter((c) => (filter === "groups" ? c.kind === "group" : filter === "channels" ? c.kind === "channel" : filter === "unread" ? c.unread_count > 0 : true))
    .filter((c) => !query || title(c).toLowerCase().includes(query) || c.last_message?.content.toLowerCase().includes(query));

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ScreenHeader title={t("المحادثات")} menu={[
          { icon: "chats", label: t("محادثة جديدة"), run: () => setTab("people") },
          { icon: "users", label: t("مجموعة جديدة"), run: () => setPanel({ type: "newGroup" }) },
          ...(canBroadcast(me) ? [{ icon: "megaphone" as IconName, label: t("قناة جديدة"), run: () => setPanel({ type: "newChannel" }) }] : []),
          { icon: "search", label: t("استكشاف القنوات"), run: () => setPanel({ type: "channels" }) },
          { icon: "bookmark", label: t("الرسائل المحفوظة"), run: openSaved },
          { icon: "star", label: t("الرسائل المميزة"), run: () => setPanel({ type: "starred" }) },
          { icon: "stories", label: t("الحالات"), run: () => setTab("stories") },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder={t("البحث في المحادثات")} />
        <div className="w-noscroll -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {filters.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className="w-chip shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition">
              {t(f.label)}
            </button>
          ))}
        </div>
      </header>

      <div className="w-scroll mt-2 flex-1 overflow-y-auto pb-2">
        {filter === "calls" ? <CallLog /> : (
          <>
            <PushBanner />
            {/* الرسائل المحفوظة مثبتة دائماً في الأعلى (تُنشأ محادثتها عند أول فتح) */}
            {filter === "all" && (!query || t("الرسائل المحفوظة").toLowerCase().includes(query)) && (
              saved ? <ChatRow conv={saved} /> : <SavedRow onOpen={openSaved} />
            )}
            {shown.map((c) => <ChatRow key={c.id} conv={c} />)}
            {shown.length === 0 && (
              <Empty icon={filter === "channels" ? "megaphone" : "chats"} title={t(query ? "لا توجد نتائج" : filter === "all" ? "لم تبدأ أي محادثة بعد" : filter === "channels" ? "لم تشترك في أي قناة بعد" : "لا يوجد شيء هنا")}
                text={filter === "all" && !query ? t("انتقل إلى جهات الاتصال واختر شخصاً لتبدأ.") : undefined}>
                {filter === "channels" && !query && (
                  <button onClick={() => setPanel({ type: "channels" })} className="w-accent mt-4 rounded-full px-5 py-2.5 text-sm font-bold">{t("استكشاف القنوات")}</button>
                )}
              </Empty>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** سطر «الرسائل المحفوظة» قبل إنشاء محادثتها */
function SavedRow({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button onClick={onOpen} className="w-hover group flex w-full items-center gap-3 px-4 text-start">
      <div className="py-2.5"><div className="w-tint grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full"><Icon name="bookmark" size={23} filled /></div></div>
      <div className="w-line min-w-0 flex-1 self-stretch border-b py-3.5">
        <strong className="block truncate text-[16px] font-bold">{t("الرسائل المحفوظة")}</strong>
        <span className="w-muted mt-1.5 block truncate text-[14px]">{t("مساحتك الخاصة")}</span>
      </div>
      <Icon name="pinned" size={16} className="w-muted shrink-0" />
    </button>
  );
}

/** سطر محادثة: الصورة في البداية، الاسم والمعاينة في الوسط، الوقت والعداد (أو 📌) في النهاية */
export function ChatRow({ conv, subtitle }: { conv: Conversation; subtitle?: string }) {
  const { me, otherOf, activeId, openConv, storyRing, openStory } = useWasl();
  const t = useT();
  const other = otherOf(conv);
  const name = conv.kind === "direct" ? (other ? nameOf(other) : "") : conv.title;
  const last = conv.last_message;
  // بلا "أنت:"، فعلامات ✓✓ تكفي (كما في التصميم)
  const p = conv.kind === "saved" && !last ? { text: t("مساحتك الخاصة") } : preview(last);
  const mine = last && last.sender.id === me.id && last.kind !== "system" && last.kind !== "call" && conv.kind !== "channel";
  const groupSender = conv.kind === "group" && last && last.sender.id !== me.id && last.kind !== "system" && last.kind !== "call" ? `${nameOf(last.sender)}: ` : "";
  const unread = conv.unread_count > 0;
  const callColor = last?.kind === "call" ? (/فائتة|مرفوضة/.test(last.content) ? "var(--danger)" : "var(--call)") : undefined;
  return (
    <button onClick={() => openConv(conv.id)}
      className={`group flex w-full items-center gap-3 px-4 text-start transition ${activeId === conv.id ? "w-card" : "w-hover"}`}>
      <div className="py-2.5">
        <StoryTap ring={storyRing(other?.id)} onOpen={() => other && openStory(other.id)}>
          <ConvAvatar conv={conv} other={other} size={54} ring={storyRing(other?.id)} />
        </StoryTap>
      </div>
      <div className="w-line min-w-0 flex-1 self-stretch border-b py-3.5 group-last:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <strong className="truncate text-[16px] font-bold" dir="auto">{name}</strong>
          {last && <time className="w-muted shrink-0 text-xs" dir="ltr">{listTime(last.created_at)}</time>}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="w-muted flex min-w-0 items-center gap-1 text-[14px]">
            {subtitle ? <span className="truncate" dir="auto">{subtitle}</span> : (
              <>
                {mine && (
                  <span className="shrink-0" style={{ color: last.status === "read" ? "var(--tick-read)" : undefined }}
                    aria-label={t(last.status === "read" ? "مقروءة" : last.status === "delivered" ? "وصلت" : "أُرسلت")}>
                    <Icon name={last.status === "sent" ? "check" : "checks"} size={16} strokeWidth={2.2} />
                  </span>
                )}
                {p.icon && <Icon name={p.icon} size={15} className="shrink-0" style={callColor ? { color: callColor } : undefined} />}
                <span className="truncate" dir="auto">{groupSender}{p.text}</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {conv.is_muted && <Icon name="bellOff" size={14} className="w-muted" />}
            {unread ? (
              <span className="w-badge grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[12px] font-bold">{conv.unread_count}</span>
            ) : conv.is_pinned || conv.kind === "saved" ? (
              <Icon name="pinned" size={16} className="w-muted" />
            ) : null}
          </span>
        </div>
      </div>
    </button>
  );
}

// ------------------------------------------------------------ الشريط السفلي
// في العربية (RTL) يظهر أول عنصر في اليمين: الإعدادات، المكالمات، المحادثات، جهات الاتصال.
// وفي الإنجليزية نعكس الترتيب لتبقى الإعدادات في أقصى اليمين كما في التطبيقات المعتادة.
const nav: { tab: Tab; icon: IconName; label: string }[] = [
  { tab: "settings", icon: "settings", label: "الإعدادات" },
  { tab: "calls", icon: "phone", label: "المكالمات" },
  { tab: "chats", icon: "chats", label: "المحادثات" },
  { tab: "people", icon: "users", label: "جهات الاتصال" },
];

export function NavBar() {
  const { tab, setTab, convs } = useWasl();
  const t = useT();
  const items = useLang() === "en" ? [...nav].reverse() : nav;
  const unread = convs.reduce((n, c) => n + (c.unread_count ? 1 : 0), 0);
  const current: Tab = tab === "stories" ? "settings" : tab;
  return (
    <nav className="w-line flex shrink-0 items-stretch border-t px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))]" style={{ background: "var(--panel)" }} aria-label={t("التنقل")}>
      {items.map((n) => {
        const on = current === n.tab;
        return (
          <button key={n.tab} onClick={() => setTab(n.tab)} aria-current={on ? "page" : undefined}
            className={`relative grid flex-1 justify-items-center gap-0.5 pb-1.5 pt-2 text-[11.5px] transition ${on ? "w-accent-text font-bold" : "w-muted font-medium"}`}>
            <span className={`grid h-8 w-14 place-items-center rounded-full ${on ? "w-tint" : ""}`}>
              <Icon name={n.icon} size={22} strokeWidth={on ? 2.1 : 1.8} filled={on && n.tab !== "settings"} />
            </span>
            {t(n.label)}
            {n.tab === "chats" && unread > 0 && (
              <span className="w-badge absolute left-1/2 top-1 ml-2 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 px-1 text-[10px] font-bold"
                style={{ borderColor: "var(--panel)" }}>{unread}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
