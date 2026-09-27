"use client";
import { useState } from "react";
import type { Conversation } from "@/lib/api";
import { Avatar, ConvAvatar, Empty, listTime, nameOf, preview } from "./bits";
import { Icon, type IconName } from "./icons";
import { PushBanner } from "./Settings";
import { useWasl, type Tab } from "./store";

type Filter = "all" | "unread" | "groups" | "favorites";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "unread", label: "غير مقروءة" },
  { id: "groups", label: "المجموعات" },
  { id: "favorites", label: "المفضلة" },
];

/** رأس الشاشة الثابت: صورتي + العنوان يمين، وزر أزرق يسار */
export function ScreenHeader({ title, action }: { title: string; action?: { icon: IconName; label: string; onClick: () => void } }) {
  const { me, setTab } = useWasl();
  return (
    <div className="flex items-center gap-3">
      <button onClick={() => setTab("settings")} aria-label="ملفي"><Avatar user={me} size={40} /></button>
      <h1 className="flex-1 text-[26px] font-extrabold leading-tight">{title}</h1>
      {action && (
        <button onClick={action.onClick} aria-label={action.label} title={action.label}
          className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-95">
          <Icon name={action.icon} size={22} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

/** خانة البحث الرمادية */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="w-input mt-4 flex items-center gap-2 rounded-full px-4">
      <Icon name="search" size={18} className="w-muted" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-10 w-full bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} aria-label="بحث" />
    </label>
  );
}

export function ChatList() {
  const { convs, setTab, openSaved, otherOf } = useWasl();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const title = (c: Conversation) => (c.kind === "direct" ? (otherOf(c) ? nameOf(otherOf(c)!) : "") : c.title);
  const query = q.trim().toLowerCase();
  const shown = convs
    .filter((c) => c.kind !== "saved")
    .filter((c) => (filter === "groups" ? c.kind === "group" : filter === "favorites" ? c.is_favorite : filter === "unread" ? c.unread_count > 0 : true))
    .filter((c) => !query || title(c).toLowerCase().includes(query) || c.last_message?.content.toLowerCase().includes(query));
  const saved = convs.find((c) => c.kind === "saved");

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ScreenHeader title="الدردشات" action={{ icon: "plus", label: "محادثة جديدة", onClick: () => setTab("people") }} />
        <SearchBox value={q} onChange={setQ} placeholder="بحث في المحادثات..." />
        <div className="w-noscroll -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {filters.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className="w-chip shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition">
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="w-scroll mt-2 flex-1 overflow-y-auto">
        <PushBanner />
        {shown.map((c) => <ChatRow key={c.id} conv={c} />)}
        {shown.length === 0 && (
          <Empty icon="chats" title={query ? "ماكو نتائج" : filter === "all" ? "بعدك ما حچيت ويا أحد" : "ماكو شي هنا"}
            text={filter === "all" && !query ? "اضغط ＋ واختار شخص حتى تبدي." : undefined} />
        )}
        {filter === "all" && !query && (
          saved ? <ChatRow conv={saved} /> : (
            <button onClick={openSaved} className="w-hover flex w-full items-center gap-3 px-4 py-2.5 text-right">
              <div className="w-accent grid h-[52px] w-[52px] place-items-center rounded-full"><Icon name="bookmark" size={22} /></div>
              <div><div className="font-bold">الرسائل المحفوظة</div><div className="w-muted text-[13px]">مساحتك الخاصة</div></div>
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** سطر محادثة: الصورة يمين، الاسم والمعاينة بالنص، الوقت والعداد يسار */
export function ChatRow({ conv, subtitle }: { conv: Conversation; subtitle?: string }) {
  const { me, otherOf, activeId, openConv } = useWasl();
  const other = otherOf(conv);
  const name = conv.kind === "direct" ? (other ? nameOf(other) : "") : conv.title;
  const last = conv.last_message;
  const p = conv.kind === "saved" && !last ? { text: "مساحتك الخاصة" } : preview(last, me.id);
  const mine = last && last.sender.id === me.id && last.kind !== "system";
  const groupSender = conv.kind === "group" && last && last.sender.id !== me.id && last.kind !== "system" && last.kind !== "call" ? `${nameOf(last.sender)}: ` : "";
  const unread = conv.unread_count > 0;
  return (
    <button onClick={() => openConv(conv.id)}
      className={`group flex w-full items-center gap-3 px-4 text-right transition ${activeId === conv.id ? "w-card" : "w-hover"}`}>
      <div className="relative py-2.5">
        <ConvAvatar conv={conv} other={other} online={other?.is_online || undefined} />
        {conv.kind === "group" && (
          <span className="w-accent absolute bottom-2 left-0 grid h-5 w-5 place-items-center rounded-full border-2" style={{ borderColor: "var(--panel)" }}>
            <Icon name="users" size={10} strokeWidth={2.6} />
          </span>
        )}
      </div>
      <div className="w-line min-w-0 flex-1 self-stretch border-b py-3 group-last:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <strong className="truncate text-[16px] font-bold">{name}</strong>
          {last && <time className={`shrink-0 text-xs ${unread ? "w-accent-text font-semibold" : "w-muted"}`}>{listTime(last.created_at)}</time>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="w-muted flex min-w-0 items-center gap-1 text-[14px]">
            {subtitle ? <span className="truncate">{subtitle}</span> : (
              <>
                {p.icon && <Icon name={p.icon} size={15} className="shrink-0" style={last?.kind === "call" ? { color: last.content.includes("فائتة") || last.content.includes("مرفوضة") ? "var(--danger)" : "var(--call)" } : undefined} />}
                <span className="truncate">{groupSender}{p.text}</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {conv.is_muted && <Icon name="bellOff" size={14} className="w-muted" />}
            {unread ? (
              <span className="w-badge grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[12px] font-bold">{conv.unread_count}</span>
            ) : mine ? (
              <span className={last.status === "read" ? "" : "w-muted"} style={{ color: last.status === "read" ? "var(--tick-read)" : undefined }}
                aria-label={last.status === "read" ? "مقروءة" : last.status === "delivered" ? "وصلت" : "انرسلت"}>
                <Icon name={last.status === "sent" ? "check" : "checks"} size={17} strokeWidth={2.2} />
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </button>
  );
}

// ------------------------------------------------------------ الشريط السفلي
const nav: { tab: Tab; icon: IconName; label: string; fill: boolean }[] = [
  { tab: "chats", icon: "chats", label: "الدردشات", fill: true },
  { tab: "calls", icon: "phone", label: "المكالمات", fill: true },
  { tab: "groups", icon: "users", label: "المجموعات", fill: true },
  { tab: "settings", icon: "settings", label: "الإعدادات", fill: false },
];

export function NavBar() {
  const { tab, setTab, convs } = useWasl();
  const unread = convs.reduce((n, c) => n + (c.unread_count ? 1 : 0), 0);
  // جهات الاتصال والحالات يعتبرون تحت "الدردشات" و"الإعدادات"
  const current: Tab = tab === "people" ? "chats" : tab === "stories" ? "settings" : tab;
  return (
    <nav className="w-line flex shrink-0 items-stretch border-t pb-[env(safe-area-inset-bottom)]" style={{ background: "var(--panel)" }} aria-label="التنقل">
      {nav.map((n) => {
        const on = current === n.tab;
        return (
          <button key={n.tab} onClick={() => setTab(n.tab)} aria-current={on ? "page" : undefined}
            className={`relative grid flex-1 justify-items-center gap-1 pb-2 pt-2.5 text-[11px] font-semibold transition ${on ? "w-accent-text" : "w-muted"}`}>
            <Icon name={n.icon} size={24} strokeWidth={on ? 2.1 : 1.8} filled={on && n.fill} />
            {n.label}
            {n.tab === "chats" && unread > 0 && (
              <span className="w-badge absolute left-1/2 top-1 ml-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 px-1 text-[10px] font-bold"
                style={{ borderColor: "var(--panel)" }}>{unread}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
