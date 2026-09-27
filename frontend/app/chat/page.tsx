"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiError, getMe, getToken, logout, saveMe, type Conversation, type Me, type Message, type User } from "@/lib/api";
import { syncPushSubscription } from "@/lib/push";
import { openSocket, type LiveSocket, type SocketStatus } from "@/lib/socket";
import { Avatar, InfoPanel, lastSeenText, nameOf, ProfileSheet, PushBanner } from "./ui";

// نضيف رسالة للقائمة إذا ما موجودة (ممكن توصل مرتين: من الـ WebSocket ومن رد الـ HTTP)
// هل الجهاز على الوضع الداكن؟ (لخيار "حسب الجهاز")
const darkQuery = "(prefers-color-scheme: dark)";
const subscribeDark = (cb: () => void) => {
  const mq = window.matchMedia(darkQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const systemIsDark = () => window.matchMedia(darkQuery).matches;

const addMessage = (list: Message[], m: Message) => (list.some((x) => x.id === m.id) ? list : [...list, m]);

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [query, setQuery] = useState("");
  const [conn, setConn] = useState<SocketStatus>("open");
  const [panel, setPanel] = useState<"info" | "profile" | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);

  const loadLists = useCallback(async () => {
    const [u, c] = await Promise.all([api<User[]>("/users/"), api<Conversation[]>("/conversations/")]);
    setUsers(u);
    setConversations(c);
    return c;
  }, []);

  const signOut = useCallback(() => {
    logout();
    router.replace("/login");
  }, [router]);

  // أول ما تفتح الصفحة: نتأكد من الدخول، نجيب القوائم، ونفتح اتصال الحضور (online)
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // رابط مثل /chat?c=5 (من الإشعار) يفتح المحادثة مباشرة.
    // نقراه هسه، قبل ما التأثير اللي يحدّث الرابط يمسحه
    const wanted = Number(new URLSearchParams(window.location.search).get("c"));
    Promise.all([api<Me>("/auth/me/"), api<User[]>("/users/"), api<Conversation[]>("/conversations/")])
      .then(([meData, u, c]) => {
        saveMe(meData);
        setMe(meData);
        setUsers(u);
        setConversations(c);
        const conv = c.find((x) => x.id === wanted);
        if (conv) setActive(conv);
        syncPushSubscription();
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) signOut();
      });

    const presence = openSocket(
      "/ws/presence/",
      (e) => {
        if (e.type === "presence") {
          const seen = new Date().toISOString();
          setUsers((list) =>
            list.map((u) => (u.id === e.user_id ? { ...u, is_online: e.is_online, last_seen: e.is_online ? u.last_seen : seen } : u)),
          );
        } else if (e.type === "inbox") {
          // رسالة جديدة بأي محادثة → نحدث القائمة (آخر رسالة + عدد غير المقروء)
          api<Conversation[]>("/conversations/").then(setConversations);
        }
      },
      // إذا الاتصال انقطع ورجع، نحدث القوائم حتى ما يفوتنا شي
      { onOpen: (reconnected) => reconnected && loadLists() },
    );
    return () => presence.close();
  }, [router, loadLists, signOut]);

  // لما نفتح محادثة: نجيب الرسائل القديمة (HTTP) ونفتح WebSocket للجديدة
  useEffect(() => {
    if (!active) return;
    const id = active.id;
    const refresh = () => {
      api<Message[]>(`/conversations/${id}/messages/`).then(setMessages);
      api(`/conversations/${id}/read/`, "PATCH").then(loadLists);
    };
    refresh();

    const ws = openSocket(
      `/ws/chat/${id}/`,
      (e) => {
        if (e.type === "message") {
          setMessages((m) => addMessage(m, e.message));
          if (e.message.sender.id !== getMe()?.id) api(`/conversations/${id}/read/`, "PATCH").then(loadLists);
        } else if (e.type === "read") {
          setMessages((m) => m.map((msg) => (msg.sender.id !== e.reader_id ? { ...msg, is_read: true } : msg)));
        } else if (e.type === "typing" && e.user_id !== getMe()?.id) {
          setTyping(true);
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), 2000);
        }
      },
      { onStatus: setConn, onOpen: (reconnected) => reconnected && refresh() },
    );
    socketRef.current = ws;
    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [active, loadLists]);

  // الرابط يتبع المحادثة المفتوحة، حتى الإشعار يعرف إنت شايفها لو لا
  useEffect(() => {
    window.history.replaceState(null, "", active ? `/chat?c=${active.id}` : "/chat");
  }, [active]);

  // عدد الرسائل غير المقروءة بعنوان التبويب: "(3) وَصل"
  const unread = conversations.reduce((n, c) => n + c.unread_count, 0);
  useEffect(() => {
    document.title = unread ? `(${unread}) وَصل` : "وَصل | محادثاتك بمكان واحد";
  }, [unread]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  async function openWith(user: User) {
    // POST /api/conversations/ → يرجع المحادثة (موجودة أو جديدة)
    setQuery("");
    setActive(await api<Conversation>("/conversations/", "POST", { user_id: user.id }));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !active) return;
    setText("");
    // الطريق السريع: WebSocket. إذا مقطوع، نرجع للـ HTTP حتى الرسالة ما تضيع
    if (socketRef.current?.send({ type: "message", content })) return;
    try {
      const m = await api<Message>(`/conversations/${active.id}/messages/`, "POST", { content });
      setMessages((list) => addMessage(list, m));
    } catch {
      setText(content);
    }
  }

  function onType(value: string) {
    setText(value);
    // ما ندز "يكتب" بكل حرف، مرة كل ثانية تكفي
    if (Date.now() - lastTypingSent.current > 1000) {
      lastTypingSent.current = Date.now();
      socketRef.current?.send({ type: "typing" });
    }
  }

  // حالة الشخص (متصل/آخر ظهور) نأخذها من قائمة users لأن هي اللي تتحدث مباشرة
  const live = (u: User) => users.find((x) => x.id === u.id) ?? u;
  const other = (c: Conversation) => live(c.participants.find((p) => p.id !== me?.id) ?? c.participants[0]);
  const activeOther = active ? other(active) : null;

  const q = query.trim().toLowerCase();
  const matches = (u: User) => !q || nameOf(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  const shownConversations = conversations.filter(
    (c) => matches(other(c)) || (!!q && !!c.last_message?.content.toLowerCase().includes(q)),
  );
  const shownUsers = users.filter(matches);

  // النموذجين: الزجاجي (الفاتح) والداكن البنفسجي (تصميم صديقنا بـ .dark-theme بـ globals.css).
  // الاختيار ينحفظ بحساب المستخدم (me.theme) فيتبعه على كل أجهزته
  const deviceDark = useSyncExternalStore(subscribeDark, systemIsDark, () => false);
  const dark = me?.theme === "dark" || (me?.theme === "system" && deviceDark);

  return (
    <main className={`app-shell ${dark ? "dark-theme" : "glass-theme"} h-dvh p-0 md:p-4 lg:p-6`}>
      <div className="phone-stage flex h-full overflow-hidden bg-white md:mx-auto md:max-w-[1280px] md:rounded-[36px] md:border md:border-white/80 md:shadow-[0_18px_60px_rgba(31,34,70,.12)]">
      <aside className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-l border-slate-100 bg-white md:w-[390px]`}>
        <header className="border-b border-slate-100 px-5 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5b5cf0] font-black text-white">و</span><div><h1 className="font-black text-[#222242]">وَصل</h1><p className="text-xs text-slate-400">مساحتك للتواصل</p></div></div>
            <button aria-label="تسجيل الخروج" title="تسجيل الخروج" className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-500" onClick={signOut}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 00-2-2h-6" /></svg>
            </button>
          </div>
          <label className="mt-5 flex items-center gap-3 rounded-2xl bg-[#f6f7fb] px-3 text-slate-400 focus-within:ring-2 focus-within:ring-violet-100">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth="2"><circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/></svg>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في محادثاتك" aria-label="بحث"
              className="h-11 w-full bg-transparent text-base text-[#292942] outline-none placeholder:text-slate-400 md:text-sm" />
          </label>
          <div className="story-strip mt-5 flex gap-3 overflow-x-auto pb-1">
            <button className="story-add"><span>＋</span><small>قصتك</small></button>
            {shownUsers.slice(0, 5).map((u) => <button key={u.id} onClick={() => openWith(u)} className="story"><Avatar user={u} size={46} online={u.is_online} /><small>{nameOf(u)}</small></button>)}
          </div>
        </header>
        <div className="soft-scroll flex-1 overflow-y-auto px-3 py-4">
          <PushBanner />
          <div className="mb-3 flex items-center justify-between px-2"><h2 className="text-xs font-black tracking-wider text-slate-400">المحادثات</h2><span className="text-xs font-bold text-[#6969df]">{shownConversations.length}</span></div>
          <div className="space-y-1">
          {shownConversations.map((c) => {
            const person = other(c); const selected = active?.id === c.id;
            return <button key={c.id} onClick={() => setActive(c)} className={`chat-card group flex w-full items-center gap-3 rounded-2xl p-3 text-right transition ${selected ? "bg-[#efefff]" : "hover:bg-slate-50"}`}>
              <Avatar user={person} online={person.is_online} />
              <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-[#292942]">{nameOf(person)}</strong>{c.last_message && <time className="shrink-0 text-[10px] text-slate-400">{new Date(c.last_message.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</time>}</div><div className="mt-1 flex items-center justify-between gap-2"><span className={`truncate text-xs ${c.unread_count ? "font-bold text-[#31314d]" : "text-slate-400"}`}>{c.last_message?.content ?? "ابدأ محادثة جديدة"}</span>{c.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#5b5cf0] px-1 text-[10px] font-bold text-white">{c.unread_count}</span>}</div></div>
            </button>;
          })}
          {q && shownConversations.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">ماكو محادثات بهذا الاسم</p>}
          </div>
          <div className="my-5 h-px bg-slate-100" />
          <div className="quick-actions grid grid-cols-3 gap-2 px-1 pb-5"><button><b>☎</b><span>مكالمة</span></button><button><b>◉</b><span>فيديو</span></button><button><b>⌘</b><span>كروب جديد</span></button></div>
          <div className="mb-3 flex items-center justify-between px-2"><h2 className="text-xs font-black tracking-wider text-slate-400">ابدأ محادثة</h2><span className="h-2 w-2 rounded-full bg-emerald-400" /></div>
          <div className="space-y-1">
          {shownUsers.map((u) => (
            <button key={u.id} onClick={() => openWith(u)} className="contact-card flex w-full items-center gap-3 rounded-2xl p-3 text-right transition hover:bg-slate-50"><Avatar user={u} size={40} online={u.is_online} /><div className="min-w-0"><strong className="block truncate text-sm text-[#35354d]">{nameOf(u)}</strong><span className={`text-xs ${u.is_online ? "text-emerald-500" : "text-slate-400"}`}>{lastSeenText(u)}</span></div><i>＋</i></button>
          ))}
          {q && shownUsers.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">ماكو أحد بهذا الاسم</p>}
          </div>
        </div>
        <div className="border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button onClick={() => me && setPanel("profile")} className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-2.5 text-right transition hover:bg-slate-100" aria-label="ملفي الشخصي">
            {me ? <Avatar user={me} size={36} dark /> : <span className="h-9 w-9 rounded-xl bg-slate-200" />}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-[#31314d]">{me ? nameOf(me) : ""}</p><p className="text-xs text-emerald-500">متصل</p></div>
            <span className="text-xs font-bold text-slate-400">تعديل</span>
          </button>
        </div>
      </aside>

      <section className={`${active ? "flex" : "hidden md:flex"} message-pattern min-w-0 flex-1 flex-col`}>
        {!active || !activeOther ? (
          <div className="m-auto max-w-sm px-8 text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] bg-white shadow-xl shadow-indigo-100"><svg viewBox="0 0 24 24" className="h-9 w-9 fill-none stroke-[#5b5cf0]" strokeWidth="1.7"><path d="M20 15a3 3 0 01-3 3H9l-5 3V7a3 3 0 013-3h10a3 3 0 013 3z"/><path d="M8 10h8M8 14h5"/></svg></div><h2 className="mt-6 text-xl font-black text-[#292942]">مكانك للحكايات الجميلة</h2><p className="mt-2 text-sm leading-7 text-slate-500">اختار شخص من القائمة وابدأ محادثة جديدة الآن.</p></div>
        ) : (
          <>
            <header className="conversation-head flex items-center gap-3 border-b border-slate-100 bg-white/90 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-5">
              <button aria-label="رجوع" className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setActive(null)}>→</button>
              <button onClick={() => setPanel("info")} className="flex min-w-0 flex-1 items-center gap-3 text-right" aria-label="معلومات المحادثة">
                <Avatar user={activeOther} online={activeOther.is_online} />
                <div className="min-w-0"><div className="truncate font-black text-[#292942]">{nameOf(activeOther)}</div><div className={`mt-0.5 truncate text-xs ${conn !== "open" ? "text-amber-500" : typing || activeOther.is_online ? "text-emerald-500" : "text-slate-400"}`}>{conn !== "open" ? "جاري الاتصال..." : typing ? "يكتب الآن..." : lastSeenText(activeOther)}</div></div>
              </button>
              <button aria-label="مكالمة صوتية" className="call-action">☎</button><button aria-label="مكالمة فيديو" className="call-action">◉</button><button onClick={() => setPanel("info")} aria-label="معلومات المحادثة" className="call-action">⋮</button>
            </header>
            <div className="soft-scroll flex-1 space-y-3 overflow-y-auto p-4 sm:p-7">
              {messages.map((m) => {
                const mine = m.sender.id === me?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`message-bubble max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm sm:max-w-[78%] ${mine ? "rounded-tr-sm bg-[#5b5cf0] text-white shadow-indigo-200" : "rounded-tl-sm bg-white text-[#303047] shadow-slate-200/70"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`mt-1 text-left text-[10px] ${mine ? "text-violet-200" : "text-slate-400"}`}>
                        {new Date(m.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
                        {/* ✓ = انرسلت، ✓✓ أزرق = انقرت */}
                        {mine && <span className={`ms-1 font-bold ${m.is_read ? "text-sky-300" : "text-white/60"}`} aria-label={m.is_read ? "مقروءة" : "مرسلة"}>{m.is_read ? "✓✓" : "✓"}</span>}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="composer flex items-center gap-2 border-t border-slate-100 bg-white/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-5">
              {/* 16px (text-base) بالموبايل حتى الآيفون ما يسوي zoom لما تضغط على الخانة */}
              <button type="button" className="attach-action" aria-label="إرفاق">＋</button><input className="h-11 min-w-0 flex-1 rounded-2xl bg-[#f5f6fa] px-4 text-base outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-violet-100 md:text-sm" placeholder="اكتب رسالتك هنا..." value={text}
                enterKeyHint="send" onChange={(e) => onType(e.target.value)} />
              <button aria-label="إرسال الرسالة" disabled={!text.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#5b5cf0] text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-[#4949dc] active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0"><svg viewBox="0 0 24 24" className="h-5 w-5 rotate-180 fill-current"><path d="M3.4 2.8 21 11.1a1 1 0 010 1.8L3.4 21.2a1 1 0 01-1.4-1.1l1.7-6.2a1 1 0 01.96-.73H13a1 1 0 000-2H4.66a1 1 0 01-.96-.73L2 3.9a1 1 0 011.4-1.1Z"/></svg></button>
            </form>
          </>
        )}
      </section>
      </div>

      {panel === "info" && activeOther && <InfoPanel user={activeOther} onClose={() => setPanel(null)} />}
      {panel === "profile" && me && <ProfileSheet me={me} onClose={() => setPanel(null)} onSaved={setMe} onLogout={signOut} />}
    </main>
  );
}
