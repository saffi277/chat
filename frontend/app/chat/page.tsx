"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getMe, getToken, logout, type Conversation, type Message, type User } from "@/lib/api";
import { openSocket } from "@/lib/socket";

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadLists = useCallback(async () => {
    const [u, c] = await Promise.all([api<User[]>("/users/"), api<Conversation[]>("/conversations/")]);
    setUsers(u);
    setConversations(c);
  }, []);

  // أول ما تفتح الصفحة: نتأكد من الدخول، نجيب القوائم، ونفتح اتصال الحضور (online)
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api<User[]>("/users/"), api<Conversation[]>("/conversations/")])
      .then(([u, c]) => {
        setUsers(u);
        setConversations(c);
        setMe(getMe());
      })
      .catch(() => router.replace("/login"));
    const presence = openSocket("/ws/presence/", (e) => {
      if (e.type === "presence") {
        setUsers((list) => list.map((u) => (u.id === e.user_id ? { ...u, is_online: e.is_online } : u)));
      } else if (e.type === "inbox") {
        // رسالة جديدة بأي محادثة → نحدث القائمة (آخر رسالة + عدد غير المقروء)
        api<Conversation[]>("/conversations/").then(setConversations);
      }
    });
    return () => presence.close();
  }, [router]);

  // لما نفتح محادثة: نجيب الرسائل القديمة (HTTP) ونفتح WebSocket للجديدة
  useEffect(() => {
    if (!active) return;
    api<Message[]>(`/conversations/${active.id}/messages/`).then(setMessages);
    api(`/conversations/${active.id}/read/`, "PATCH").then(loadLists);

    const ws = openSocket(`/ws/chat/${active.id}/`, (e) => {
      if (e.type === "message") {
        setMessages((m) => [...m, e.message]);
        if (e.message.sender.id !== getMe()?.id) api(`/conversations/${active.id}/read/`, "PATCH").then(loadLists);
      } else if (e.type === "read") {
        setMessages((m) => m.map((msg) => (msg.sender.id !== e.reader_id ? { ...msg, is_read: true } : msg)));
      } else if (e.type === "typing" && e.user_id !== getMe()?.id) {
        setTyping(true);
        setTimeout(() => setTyping(false), 1500);
      }
    });
    socketRef.current = ws;
    return () => ws.close();
  }, [active, loadLists]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  async function openWith(user: User) {
    // POST /api/conversations/ → يرجع المحادثة (موجودة أو جديدة)
    setActive(await api<Conversation>("/conversations/", "POST", { user_id: user.id }));
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "message", content }));
    setText("");
  }

  const other = (c: Conversation) => c.participants.find((p) => p.id !== me?.id) ?? c.participants[0];
  const activeOther = active ? users.find((u) => u.id === other(active).id) ?? other(active) : null;
  const initials = (name: string) => name.slice(0, 2).toUpperCase();

  return (
    <main className="app-shell h-full p-0 md:p-4 lg:p-6">
      <div className="flex h-full overflow-hidden bg-white md:mx-auto md:max-w-[1600px] md:rounded-[28px] md:border md:border-white/80 md:shadow-[0_18px_60px_rgba(31,34,70,.12)]">
      <aside className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-l border-slate-100 bg-white md:w-[350px]`}>
        <header className="border-b border-slate-100 px-5 pb-5 pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5b5cf0] font-black text-white">و</span><div><h1 className="font-black text-[#222242]">وَصل</h1><p className="text-xs text-slate-400">مساحتك للتواصل</p></div></div>
            <button aria-label="تسجيل الخروج" title="تسجيل الخروج" className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-500" onClick={() => { logout(); router.push("/login"); }}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 00-2-2h-6" /></svg>
            </button>
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-[#f6f7fb] px-3 py-2.5 text-sm text-slate-400"><svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/></svg><span>ابحث في محادثاتك</span></div>
        </header>
        <div className="soft-scroll flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-3 flex items-center justify-between px-2"><h2 className="text-xs font-black tracking-wider text-slate-400">المحادثات</h2><span className="text-xs font-bold text-[#6969df]">{conversations.length}</span></div>
          <div className="space-y-1">
          {conversations.map((c) => {
            const person = other(c); const selected = active?.id === c.id;
            return <button key={c.id} onClick={() => setActive(c)} className={`group flex w-full items-center gap-3 rounded-2xl p-3 text-right transition ${selected ? "bg-[#efefff]" : "hover:bg-slate-50"}`}>
              <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-200 to-indigo-100 font-black text-sm text-[#5656b8]">{initials(person.username)}<span className={`absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${person.is_online ? "bg-emerald-400" : "bg-slate-300"}`} /></div>
              <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-[#292942]">{person.username}</strong>{c.last_message && <time className="shrink-0 text-[10px] text-slate-400">{new Date(c.last_message.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}</time>}</div><div className="mt-1 flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-400">{c.last_message?.content ?? "ابدأ محادثة جديدة"}</span>{c.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#5b5cf0] px-1 text-[10px] font-bold text-white">{c.unread_count}</span>}</div></div>
            </button>;
          })}
          </div>
          <div className="my-6 h-px bg-slate-100" />
          <div className="mb-3 flex items-center justify-between px-2"><h2 className="text-xs font-black tracking-wider text-slate-400">ابدأ محادثة</h2><span className="h-2 w-2 rounded-full bg-emerald-400" /></div>
          <div className="space-y-1">
          {users.map((u) => (
            <button key={u.id} onClick={() => openWith(u)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-right transition hover:bg-slate-50"><div className="relative grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-xs font-black text-slate-500">{initials(u.username)}<span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-white ${u.is_online ? "bg-emerald-400" : "bg-slate-300"}`} /></div><div><strong className="block text-sm text-[#35354d]">{u.username}</strong><span className={`text-xs ${u.is_online ? "text-emerald-500" : "text-slate-400"}`}>{u.is_online ? "متصل الآن" : "غير متصل"}</span></div></button>
          ))}
          </div>
        </div>
        <div className="border-t border-slate-100 p-4"><div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#222242] text-sm font-black text-white">{me ? initials(me.username) : "؟"}</span><div className="min-w-0"><p className="truncate text-sm font-black text-[#31314d]">{me?.username}</p><p className="text-xs text-emerald-500">متصل</p></div></div></div>
      </aside>

      <section className={`${active ? "flex" : "hidden md:flex"} message-pattern flex-1 flex-col`}>
        {!active || !activeOther ? (
          <div className="m-auto max-w-sm px-8 text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] bg-white shadow-xl shadow-indigo-100"><svg viewBox="0 0 24 24" className="h-9 w-9 fill-none stroke-[#5b5cf0]" strokeWidth="1.7"><path d="M20 15a3 3 0 01-3 3H9l-5 3V7a3 3 0 013-3h10a3 3 0 013 3z"/><path d="M8 10h8M8 14h5"/></svg></div><h2 className="mt-6 text-xl font-black text-[#292942]">مكانك للحكايات الجميلة</h2><p className="mt-2 text-sm leading-7 text-slate-500">اختار شخص من القائمة وابدأ محادثة جديدة الآن.</p></div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-100 bg-white/90 px-5 py-4 backdrop-blur">
              <button aria-label="رجوع" className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setActive(null)}>←</button>
              <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-200 to-indigo-100 text-sm font-black text-[#5656b8]">{initials(activeOther.username)}<span className={`absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${activeOther.is_online ? "bg-emerald-400" : "bg-slate-300"}`} /></div>
              <div className="flex-1"><div className="font-black text-[#292942]">{activeOther.username}</div><div className={`mt-0.5 text-xs ${typing || activeOther.is_online ? "text-emerald-500" : "text-slate-400"}`}>{typing ? "يكتب الآن..." : activeOther.is_online ? "متصل الآن" : "غير متصل"}</div></div>
              <button aria-label="معلومات المحادثة" className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></button>
            </header>
            <div className="soft-scroll flex-1 space-y-3 overflow-y-auto p-4 sm:p-7">
              {messages.map((m) => {
                const mine = m.sender.id === me?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 shadow-sm ${mine ? "rounded-tr-sm bg-[#5b5cf0] text-white shadow-indigo-200" : "rounded-tl-sm bg-white text-[#303047] shadow-slate-200/70"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`mt-1 text-left text-[10px] ${mine ? "text-violet-200" : "text-slate-400"}`}>
                        {new Date(m.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
                        {mine && <span className={m.is_read ? "text-teal-200" : ""}> ✓✓</span>}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-100 bg-white/90 p-3 backdrop-blur sm:px-5">
              <button type="button" aria-label="إضافة" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-slate-400 transition hover:bg-slate-100 hover:text-[#5b5cf0]"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg></button>
              <input className="h-11 flex-1 rounded-2xl bg-[#f5f6fa] px-4 text-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-violet-100" placeholder="اكتب رسالتك هنا..." value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify({ type: "typing" }));
                  }
                }} />
              <button aria-label="إرسال الرسالة" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#5b5cf0] text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-[#4949dc] active:translate-y-0"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" transform="rotate(180 12 12)"><path d="M3.4 2.8 21 11.1a1 1 0 010 1.8L3.4 21.2a1 1 0 01-1.4-1.1l1.7-6.2a1 1 0 01.96-.73H13a1 1 0 000-2H4.66a1 1 0 01-.96-.73L2 3.9a1 1 0 011.4-1.1Z"/></svg></button>
            </form>
          </>
        )}
      </section>
      </div>
    </main>
  );
}
