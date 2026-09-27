"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Conversation as Conv, Message } from "@/lib/api";
import { conversations as convApi, messages as msgApi } from "@/lib/endpoints";
import { openSocket, type LiveSocket, type SocketStatus } from "@/lib/socket";
import { MessageBody, ReplyQuote, SenderName, Ticks } from "./Bubbles";
import { clock, ConvAvatar, dayLabel, IconButton, lastSeenText, nameOf } from "./bits";
import { Composer } from "./Composer";
import { Icon, type IconName } from "./icons";
import { useWasl } from "./store";

// نضيف أو نبدل رسالة بالقائمة حسب الـ id
const upsert = (list: Message[], m: Message) => {
  const i = list.findIndex((x) => x.id === m.id);
  if (i === -1) return [...list, m].sort((a, b) => a.id - b.id);
  const copy = list.slice();
  copy[i] = m;
  return copy;
};

export function Conversation({ conv }: { conv: Conv }) {
  const { me, otherOf, openConv, setPanel, startCall, liveShares, stopLiveShare, startLiveShare, refreshConvs, notify } = useWasl();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState<string | null>(null);
  const [conn, setConn] = useState<SocketStatus>("open");
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const socketRef = useRef<LiveSocket | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // نبقى تحت إذا المستخدم أصلاً تحت
  const keepFrom = useRef<number | null>(null); // حتى الشاشة ما تنط لما نحمل رسائل أقدم
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const other = otherOf(conv);
  const id = conv.id;
  // نسخة من المحادثة بـ ref: القائمة تتحدث كثير، وما نريد نعيد فتح الاتصال كل مرة
  const convRef = useRef(conv);
  useEffect(() => {
    convRef.current = conv;
  }, [conv]);

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") convApi.markRead(id).then(refreshConvs).catch(() => {});
  }, [id, refreshConvs]);

  // تحميل الرسائل + اتصال المحادثة
  useEffect(() => {
    let alive = true;
    const load = () => msgApi.list(id).then((list) => {
      if (!alive) return;
      setMsgs(list);
      setHasMore(list.length >= 50);
      setLoading(false);
      stick.current = true;
    });
    load();
    markRead();
    let refetch: ReturnType<typeof setTimeout> | undefined;
    const ws = openSocket(`/ws/chat/${id}/`, (e) => {
      if (e.type === "message") {
        setMsgs((l) => upsert(l, e.message));
        if (e.message.sender.id !== me.id) markRead();
      } else if (e.type === "message_updated") {
        setMsgs((l) => upsert(l, e.message));
      } else if (e.type === "typing" && e.user_id !== me.id) {
        const c = convRef.current;
        const u = c.participants.find((p) => p.id === e.user_id);
        setTyping(c.kind === "group" && u ? `${nameOf(u)} يكتب...` : "يكتب الآن...");
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(null), 2200);
      } else if ((e.type === "read" || e.type === "delivered") && (e.type === "read" ? e.reader_id : e.user_id) !== me.id) {
        if (convRef.current.kind === "direct") {
          const level = e.type === "read" ? "read" : "delivered";
          setMsgs((l) => l.map((m) => (m.sender.id === me.id && m.id <= e.message_id && m.status !== "read" ? { ...m, status: level, is_read: level === "read" } : m)));
        } else {
          // بالمجموعة الحالة تعتمد على كل الأعضاء، فنجيبها من السيرفر
          clearTimeout(refetch);
          refetch = setTimeout(() => msgApi.list(id).then((list) => alive && setMsgs((old) => {
            const byId = new Map(list.map((m) => [m.id, m]));
            return old.map((m) => byId.get(m.id) ?? m);
          })), 400);
        }
      }
    }, { onStatus: setConn, onOpen: (again) => again && load() });
    socketRef.current = ws;
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      ws.close();
      socketRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(refetch);
    };
  }, [id, me.id, markRead]);

  // السكرول: ننزل لتحت بالرسائل الجديدة، ونثبت المكان لما نحمل الأقدم
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs, typing]);

  async function loadOlder() {
    if (!hasMore || !msgs.length) return;
    const el = scroller.current!;
    const older = await msgApi.list(id, msgs[0].id);
    keepFrom.current = el.scrollHeight - el.scrollTop;
    setHasMore(older.length >= 50);
    setMsgs((l) => [...older, ...l]);
  }

  function onScroll() {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && keepFrom.current === null) loadOlder();
  }

  const title = conv.kind === "direct" ? (other ? nameOf(other) : "") : conv.title;
  const status = conn !== "open" ? "جاري الاتصال..." : typing ?? (conv.kind === "group" ? `${conv.member_count} أعضاء` : conv.kind === "saved" ? "مساحتك الخاصة" : other ? lastSeenText(other) : "");
  const openInfo = () => (conv.kind === "group" ? setPanel({ type: "group", convId: id }) : other ? setPanel({ type: "contact", userId: other.id }) : setPanel({ type: "media", convId: id }));

  async function togglePref(key: "is_favorite" | "is_muted" | "is_archived") {
    setMoreOpen(false);
    await convApi.setPrefs(id, { [key]: !conv[key] });
    await refreshConvs();
    if (key === "is_archived" && !conv.is_archived) openConv(null);
  }

  const menuItems: { icon: IconName; label: string; run: () => void }[] = [
    { icon: "info", label: conv.kind === "group" ? "معلومات المجموعة" : "معلومات الاتصال", run: () => { setMoreOpen(false); openInfo(); } },
    { icon: "image", label: "الوسائط والملفات", run: () => { setMoreOpen(false); setPanel({ type: "media", convId: id }); } },
    { icon: "pin", label: "مشاركة الموقع", run: () => { setMoreOpen(false); setPanel({ type: "location", convId: id }); } },
    ...(conv.kind !== "saved" ? [
      { icon: "star" as IconName, label: conv.is_favorite ? "إزالة من المفضلة" : "إضافة للمفضلة", run: () => togglePref("is_favorite") },
      { icon: (conv.is_muted ? "bell" : "bellOff") as IconName, label: conv.is_muted ? "إلغاء الكتم" : "كتم الإشعارات", run: () => togglePref("is_muted") },
      { icon: "archive" as IconName, label: conv.is_archived ? "إلغاء الأرشفة" : "أرشفة المحادثة", run: () => togglePref("is_archived") },
    ] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" onClick={() => { setMenuFor(null); setMoreOpen(false); }}>
      {/* الهيدر */}
      <header className="w-line relative z-10 flex items-center gap-1 border-b px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]" style={{ background: "var(--panel)" }}>
        <IconButton icon="back" label="رجوع" onClick={() => openConv(null)} className="md:hidden" plain />
        <button onClick={openInfo} className="flex min-w-0 flex-1 items-center gap-3 px-1 text-right">
          <ConvAvatar conv={conv} other={other} size={44} online={other?.is_online} />
          <div className="min-w-0">
            <div className="truncate font-bold">{title}</div>
            <div className={`truncate text-xs ${typing || other?.is_online ? "font-bold" : "w-muted"}`}
              style={{ color: conn !== "open" ? "#f59e0b" : typing || other?.is_online ? "var(--online)" : undefined }}>{status}</div>
          </div>
        </button>
        {conv.kind === "direct" && (
          <>
            <IconButton icon="video" label="مكالمة فيديو" onClick={() => startCall(conv, "video")} plain />
            <IconButton icon="phone" label="مكالمة صوتية" onClick={() => startCall(conv, "audio")} plain />
          </>
        )}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <IconButton icon="more" label="المزيد" onClick={() => setMoreOpen((o) => !o)} plain />
          {moreOpen && (
            <div className="w-strong w-shadow absolute left-0 top-12 z-20 w-60 rounded-2xl p-1.5" style={{ border: "1px solid var(--border)" }}>
              {menuItems.map((it) => (
                <button key={it.label} onClick={it.run} className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold">
                  <Icon name={it.icon} size={18} className="w-accent-text" />{it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* الرسائل */}
      <div ref={scroller} onScroll={onScroll} className="w-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-2 md:px-6">
        {loading && <p className="w-muted py-10 text-center text-sm">جاري التحميل...</p>}
        {hasMore && !loading && <button onClick={loadOlder} className="w-chip mx-auto my-3 block rounded-full px-4 py-1.5 text-xs">رسائل أقدم</button>}
        {!loading && msgs.length === 0 && (
          <div className="w-panel mx-auto mt-10 max-w-xs rounded-2xl p-5 text-center text-sm">
            <p className="font-bold">{conv.kind === "saved" ? "احفظ هنا أي شي تريده" : "ابدأ المحادثة 👋"}</p>
            <p className="w-muted mt-1 text-xs">الرسائل توصل فوراً، ويا الصور والرسائل الصوتية.</p>
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const mine = m.sender.id === me.id;
          const grouped = prev && !newDay && prev.sender.id === m.sender.id && prev.kind !== "system" && prev.kind !== "call";
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-4 flex justify-center">
                  <span className="w-panel rounded-full px-3 py-1 text-xs font-semibold">{dayLabel(m.created_at)}</span>
                </div>
              )}
              {m.kind === "system" || m.kind === "call" ? (
                <div className="my-3 flex justify-center">
                  <span className="w-panel flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs">
                    {m.kind === "call" && <Icon name="phone" size={13} className="w-call" />}
                    {m.content}{m.kind === "call" && <span className="w-muted">• {clock(m.created_at)}</span>}
                  </span>
                </div>
              ) : (
                <div id={`m-${m.id}`} className={`group flex items-end gap-1 ${mine ? "justify-start" : "justify-end"} ${grouped ? "mt-1" : "mt-3"}`}>
                  <div className={`relative max-w-[82%] rounded-2xl px-3 py-1.5 md:max-w-[65%] ${mine ? "w-bubble-out rounded-tr-sm" : "w-bubble-in rounded-tl-sm"}`}
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}>
                    {conv.kind === "group" && !mine && !grouped && <SenderName m={m} />}
                    {m.reply_to && <ReplyQuote r={m.reply_to} mine={mine} onClick={() => document.getElementById(`m-${m.reply_to!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
                    <MessageBody m={m} mine={mine} onImage={setLightbox}
                      sharingLive={liveShares.includes(m.id)} onStopLive={() => stopLiveShare(m.id)} />
                    <div className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${mine ? "opacity-85" : "w-muted"}`} dir="ltr">
                      {mine && !m.is_deleted && <Ticks m={m} />}
                      <span>{clock(m.created_at)}</span>
                      {m.edited_at && !m.is_deleted && <span>معدّلة</span>}
                    </div>
                    {menuFor === m.id && !m.is_deleted && (
                      <MessageMenu m={m} mine={mine} onClose={() => setMenuFor(null)}
                        onReply={() => { setEditing(null); setReply(m); }}
                        onEdit={() => { setReply(null); setEditing(m); }}
                        onDelete={async () => { if (confirm("تحذف الرسالة عند الكل؟")) await msgApi.remove(m.id).catch((e) => notify(e.message)); }}
                        onResumeLive={m.is_live && mine && !liveShares.includes(m.id) ? () => startLiveShare(m) : undefined} />
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
        {typing && conv.kind !== "group" && (
          <div className="mt-3 flex justify-end">
            <span className="w-bubble-in flex gap-1 rounded-2xl px-4 py-3">
              {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full" style={{ background: "var(--muted)", animationDelay: `${i * 0.15}s` }} />)}
            </span>
          </div>
        )}
      </div>

      <Composer convId={id} socket={() => socketRef.current} reply={reply} editing={editing}
        onDone={() => { setReply(null); setEditing(null); }}
        onSent={(m) => { stick.current = true; setMsgs((l) => upsert(l, m)); }} />

      {lightbox && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- عرض الصورة كاملة */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-2xl object-contain" />
          <button className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white" aria-label="إغلاق"><Icon name="x" /></button>
        </div>
      )}
    </div>
  );
}

function MessageMenu({ m, mine, onClose, onReply, onEdit, onDelete, onResumeLive }: {
  m: Message; mine: boolean; onClose: () => void; onReply: () => void; onEdit: () => void; onDelete: () => void; onResumeLive?: () => void;
}) {
  const items: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = [
    { icon: "reply", label: "رد", run: onReply },
    ...(m.content ? [{ icon: "copy" as IconName, label: "نسخ", run: () => navigator.clipboard?.writeText(m.content) }] : []),
    ...(mine && ["text", "image", "video", "file"].includes(m.kind) ? [{ icon: "edit" as IconName, label: "تعديل", run: onEdit }] : []),
    ...(onResumeLive ? [{ icon: "navigation" as IconName, label: "تحديث موقعي من هذا الجهاز", run: onResumeLive }] : []),
    ...(mine ? [{ icon: "trash" as IconName, label: "حذف للكل", run: onDelete, danger: true }] : []),
  ];
  return (
    <div className={`w-strong w-shadow absolute top-full z-20 mt-1 w-52 rounded-2xl p-1.5 text-sm ${mine ? "right-0" : "left-0"}`}
      style={{ border: "1px solid var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button key={it.label} onClick={() => { onClose(); it.run(); }}
          className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2 font-bold" style={it.danger ? { color: "var(--danger)" } : undefined}>
          <Icon name={it.icon} size={17} />{it.label}
        </button>
      ))}
    </div>
  );
}
