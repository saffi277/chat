"use client";
import { useState } from "react";
import type { Conversation } from "@/lib/api";
import { Avatar, Chip, ConvAvatar, Empty, IconButton, listTime, nameOf, preview } from "./bits";
import { Icon } from "./icons";
import { PushBanner } from "./Settings";
import { useWasl, type Tab } from "./store";

type Filter = "all" | "groups" | "favorites" | "unread";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "groups", label: "المجموعات" },
  { id: "favorites", label: "المفضلة" },
  { id: "unread", label: "غير مقروءة" },
];

export function ChatList() {
  const { me, convs, theme, setTab, openSaved, otherOf } = useWasl();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const title = (c: Conversation) => (c.kind === "direct" ? (otherOf(c) ? nameOf(otherOf(c)!) : "") : c.title);
  const query = q.trim().toLowerCase();
  const shown = convs
    .filter((c) => c.kind !== "saved")
    .filter((c) => (filter === "groups" ? c.kind === "group" : filter === "favorites" ? c.is_favorite : filter === "unread" ? c.unread_count > 0 : true))
    .filter((c) => !query || title(c).toLowerCase().includes(query) || c.last_message?.content.toLowerCase().includes(query));
  const saved = convs.find((c) => c.kind === "saved");
  const unreadTotal = convs.filter((c) => c.unread_count > 0).length;

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button onClick={() => setTab("settings")} aria-label="ملفي"><Avatar user={me} size={44} /></button>
          <div className="flex-1">
            <h1 className="text-2xl font-extrabold leading-tight">{theme === "dark" ? "دردشاتي" : "الرسائل"}</h1>
          </div>
          <IconButton icon="plus" label="محادثة جديدة" onClick={() => setTab("people")} size={42} />
        </div>
        <label className="w-input mt-4 flex items-center gap-2 rounded-full px-4">
          <Icon name="search" size={18} className="w-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في الرسائل..."
            className="h-11 w-full bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} aria-label="بحث" />
        </label>
        {theme === "dark" && <StoryStrip />}
        <div className="w-noscroll -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {filters.map((f) => (
            <Chip key={f.id} label={f.id === "unread" && unreadTotal ? `${f.label} ${unreadTotal}` : f.label}
              active={filter === f.id} onClick={() => setFilter(f.id)} />
          ))}
        </div>
      </header>

      <div className="w-scroll mt-3 flex-1 overflow-y-auto px-2 pb-28">
        <PushBanner />
        {shown.map((c) => <ChatRow key={c.id} conv={c} />)}
        {shown.length === 0 && (
          <Empty icon="chats" title={query ? "ماكو نتائج" : filter === "all" ? "بعدك ما حچيت ويا أحد" : "ماكو شي هنا"}
            text={filter === "all" && !query ? "اضغط ＋ واختار شخص حتى تبدي." : undefined} />
        )}
        {filter === "all" && !query && (
          saved ? <ChatRow conv={saved} /> : (
            <button onClick={openSaved} className="w-hover flex w-full items-center gap-3 rounded-[20px] px-3 py-3 text-right">
              <div className="w-accent grid h-[52px] w-[52px] place-items-center rounded-full"><Icon name="bookmark" size={22} /></div>
              <div><div className="font-extrabold">الرسائل المحفوظة</div><div className="w-muted text-xs">مساحتك الخاصة</div></div>
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ChatRow({ conv }: { conv: Conversation }) {
  const { me, otherOf, activeId, openConv } = useWasl();
  const other = otherOf(conv);
  const name = conv.kind === "direct" ? (other ? nameOf(other) : "") : conv.title;
  const last = conv.last_message;
  const p = conv.kind === "saved" && !last ? { text: "مساحتك الخاصة" } : preview(last, me.id);
  const mine = last && last.sender.id === me.id && last.kind !== "system";
  const groupSender = conv.kind === "group" && last && last.sender.id !== me.id && last.kind !== "system" ? `${nameOf(last.sender)}: ` : "";
  return (
    <button onClick={() => openConv(conv.id)}
      className={`flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-right transition ${activeId === conv.id ? "w-card" : "w-hover"}`}>
      <ConvAvatar conv={conv} other={other} online={other?.is_online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <strong className="truncate text-[15px]">{name}</strong>
          {last && <time className={`shrink-0 text-xs ${conv.unread_count ? "w-accent-text font-bold" : "w-muted"}`}>{listTime(last.created_at)}</time>}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`flex min-w-0 items-center gap-1 text-[13px] ${conv.unread_count ? "font-bold" : "w-muted"}`}>
            {mine && (
              <span className="shrink-0" style={{ color: last.status === "read" ? "var(--tick-read)" : undefined }}>
                <Icon name={last.status === "sent" ? "check" : "checks"} size={15} strokeWidth={2.2} />
              </span>
            )}
            {p.icon && <Icon name={p.icon} size={14} className="shrink-0 w-accent-text" />}
            <span className="truncate">{groupSender}{p.text}</span>
          </span>
          {conv.is_muted && <Icon name="bellOff" size={14} className="w-muted shrink-0" />}
          {conv.unread_count > 0 && (
            <span className="w-badge grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold">{conv.unread_count}</span>
          )}
        </div>
      </div>
    </button>
  );
}

/** دوائر الحالات فوك القائمة (بالنموذج الداكن) */
export function StoryStrip() {
  const { stories, me, setPanel, setStoryViewer } = useWasl();
  const mine = stories.find((g) => g.is_me);
  return (
    <div className="w-noscroll -mx-4 mt-4 flex gap-3 overflow-x-auto px-4">
      <button className="grid shrink-0 justify-items-center gap-1 text-[11px]"
        onClick={() => (mine ? setStoryViewer({ userId: me.id, index: 0 }) : setPanel({ type: "storyCompose" }))}>
        <div className="relative">
          <Avatar user={me} size={58} ring={mine ? true : undefined} />
          <span className="w-accent absolute -bottom-0.5 -left-0.5 grid h-6 w-6 place-items-center rounded-full border-2"
            style={{ borderColor: "var(--panel-strong)" }} onClick={(e) => { e.stopPropagation(); setPanel({ type: "storyCompose" }); }}>
            <Icon name="plus" size={13} strokeWidth={3} />
          </span>
        </div>
        <span className="w-muted">قصتي</span>
      </button>
      {stories.filter((g) => !g.is_me).map((g) => (
        <button key={g.user.id} className="grid shrink-0 justify-items-center gap-1 text-[11px]" onClick={() => setStoryViewer({ userId: g.user.id, index: 0 })}>
          <Avatar user={g.user} size={58} ring={g.all_seen ? "seen" : true} />
          <span className="w-muted max-w-16 truncate">{nameOf(g.user)}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ الشريط السفلي العائم
const nav: { tab: Tab; icon: "chats" | "phone" | "stories" | "settings"; label: string }[] = [
  { tab: "chats", icon: "chats", label: "المحادثات" },
  { tab: "calls", icon: "phone", label: "المكالمات" },
  { tab: "stories", icon: "stories", label: "الحالات" },
  { tab: "settings", icon: "settings", label: "الإعدادات" },
];

export function NavBar() {
  const { tab, setTab, convs } = useWasl();
  const unread = convs.reduce((n, c) => n + (c.unread_count ? 1 : 0), 0);
  const item = (n: (typeof nav)[number]) => (
    <button key={n.tab} onClick={() => setTab(n.tab)} aria-current={tab === n.tab ? "page" : undefined}
      className={`relative grid min-w-0 flex-1 justify-items-center gap-0.5 rounded-full py-1.5 text-[10px] font-bold leading-tight transition ${tab === n.tab ? "w-accent-text" : "w-muted"}`}>
      <Icon name={n.icon} size={22} strokeWidth={tab === n.tab ? 2.3 : 1.8} />
      {n.label}
      {n.tab === "chats" && unread > 0 && (
        <span className="w-badge absolute right-1/2 top-0 mr-[-18px] grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px]">{unread}</span>
      )}
    </button>
  );
  return (
    <nav className="w-panel w-shadow absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex items-center rounded-full px-2 py-1.5" aria-label="التنقل">
      {nav.slice(0, 2).map(item)}
      {/* الزر الأزرق بالنص: رسالة جديدة / جهات الاتصال */}
      <button onClick={() => setTab("people")} aria-label="جهات الاتصال ورسالة جديدة"
        className={`w-accent mx-1 -mt-7 grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 transition active:scale-95 ${tab === "people" ? "scale-105" : ""}`}
        style={{ borderColor: "var(--panel-strong)" }}>
        <Icon name="send" size={26} />
      </button>
      {nav.slice(2).map(item)}
    </nav>
  );
}
