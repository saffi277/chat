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

  return (
    <main className="flex h-full">
      <aside className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-l bg-white md:w-80`}>
        <header className="flex items-center justify-between bg-emerald-700 p-3 text-white">
          <span className="font-bold">{me?.username}</span>
          <button className="text-sm underline" onClick={() => { logout(); router.push("/login"); }}>خروج</button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <h2 className="px-3 pt-3 text-xs font-bold text-gray-500">المحادثات</h2>
          {conversations.map((c) => (
            <button key={c.id} onClick={() => setActive(c)}
              className={`flex w-full items-center justify-between p-3 text-right hover:bg-gray-100 ${active?.id === c.id ? "bg-gray-100" : ""}`}>
              <div className="min-w-0">
                <div className="font-bold">{other(c).username}</div>
                <div className="truncate text-sm text-gray-500">{c.last_message?.content ?? "—"}</div>
              </div>
              {c.unread_count > 0 && (
                <span className="rounded-full bg-emerald-600 px-2 text-xs text-white">{c.unread_count}</span>
              )}
            </button>
          ))}
          <h2 className="px-3 pt-3 text-xs font-bold text-gray-500">المستخدمين</h2>
          {users.map((u) => (
            <button key={u.id} onClick={() => openWith(u)} className="flex w-full items-center gap-2 p-3 hover:bg-gray-100">
              <span className={`h-2.5 w-2.5 rounded-full ${u.is_online ? "bg-green-500" : "bg-gray-300"}`} />
              {u.username}
            </button>
          ))}
        </div>
      </aside>

      <section className={`${active ? "flex" : "hidden md:flex"} flex-1 flex-col bg-[#efeae2]`}>
        {!active || !activeOther ? (
          <div className="m-auto text-gray-500">اختار شخص حتى تبدي المحادثة</div>
        ) : (
          <>
            <header className="flex items-center gap-3 bg-emerald-700 p-3 text-white">
              <button className="md:hidden" onClick={() => setActive(null)}>→</button>
              <div>
                <div className="font-bold">{activeOther.username}</div>
                <div className="text-xs">{typing ? "يكتب..." : activeOther.is_online ? "متصل" : "غير متصل"}</div>
              </div>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.map((m) => {
                const mine = m.sender.id === me?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-1.5 shadow ${mine ? "bg-emerald-100" : "bg-white"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className="text-left text-[10px] text-gray-500">
                        {new Date(m.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
                        {mine && <span className={m.is_read ? "text-sky-500" : ""}> ✓✓</span>}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="flex gap-2 bg-gray-100 p-3">
              <input className="flex-1 rounded-full border px-4 py-2" placeholder="اكتب رسالة..." value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify({ type: "typing" }));
                  }
                }} />
              <button className="rounded-full bg-emerald-600 px-5 font-bold text-white">إرسال</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
