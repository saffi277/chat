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
  const [starred, setStarred] = useState<Set<number>>(new Set());
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
    msgApi.starred(id).then((l) => alive && setStarred(new Set(l.map((m) => m.id)))).catch(() => {});
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

  async function togglePref(key: "is_favorite" | "is_muted" | "is_archived" | "is_pinned") {
    setMoreOpen(false);
    await convApi.setPrefs(id, { [key]: !conv[key] });
    await refreshConvs();
    if (key === "is_archived" && !conv.is_archived) openConv(null);
  }

  async function clearChat() {
    setMoreOpen(false);
    if (!confirm("تحذف المحادثة من عندك؟ الطرف الثاني تبقى عنده.")) return;
    await convApi.clear(id).catch((e) => notify(e.message));
    await refreshConvs();
    openConv(null);
  }

  async function react(m: Message, emoji: string) {
    try {
      const updated = await msgApi.react(m.id, emoji);
      setMsgs((l) => upsert(l, updated));
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function toggleStar(m: Message) {
    const on = !starred.has(m.id);
    await (on ? msgApi.star(m.id) : msgApi.unstar(m.id)).catch(() => {});
    setStarred((s) => { const n = new Set(s); if (on) n.add(m.id); else n.delete(m.id); return n; });
    notify(on ? "انضافت للرسائل المميزة ⭐" : "انشالت من الرسائل المميزة");
  }

  const menuItems: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = [
    { icon: "info", label: conv.kind === "group" ? "معلومات المجموعة" : "معلومات الاتصال", run: () => { setMoreOpen(false); openInfo(); } },
    { icon: "image", label: "الوسائط والملفات", run: () => { setMoreOpen(false); setPanel({ type: "media", convId: id }); } },
    { icon: "pin", label: "مشاركة الموقع", run: () => { setMoreOpen(false); setPanel({ type: "location", convId: id }); } },
    { icon: "star", label: "الرسائل المميزة", run: () => { setMoreOpen(false); setPanel({ type: "starred", convId: id }); } },
    ...(conv.kind !== "saved" ? [
      { icon: "pinned" as IconName, label: conv.is_pinned ? "إلغاء التثبيت" : "تثبيت المحادثة", run: () => togglePref("is_pinned") },
      { icon: "bookmark" as IconName, label: conv.is_favorite ? "إزالة من المفضلة" : "إضافة للمفضلة", run: () => togglePref("is_favorite") },
      { icon: (conv.is_muted ? "bell" : "bellOff") as IconName, label: conv.is_muted ? "إلغاء الكتم" : "كتم الإشعارات", run: () => togglePref("is_muted") },
      { icon: "archive" as IconName, label: conv.is_archived ? "إلغاء الأرشفة" : "أرشفة المحادثة", run: () => togglePref("is_archived") },
      { icon: "trash" as IconName, label: "حذف المحادثة", run: clearChat, danger: true },
    ] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" onClick={() => { setMenuFor(null); setMoreOpen(false); }}>
      {/* الهيدر */}
      <header className="w-shadow relative z-10 flex items-center gap-2 rounded-b-[26px] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:rounded-none md:shadow-none md:border-b md:w-line"
        style={{ background: "var(--panel)" }}>
        <IconButton icon="back" label="رجوع" onClick={() => openConv(null)} className="md:hidden" plain size={34} />
        <button onClick={openInfo} className="flex min-w-0 flex-1 items-center gap-3 text-right">
          <ConvAvatar conv={conv} other={other} size={46} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold">{title}</div>
            <div className="w-muted flex items-center gap-1.5 truncate text-xs" style={{ color: conn !== "open" ? "#f59e0b" : typing ? "var(--accent)" : undefined }}>
              {conn === "open" && !typing && other?.is_online && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--online)" }} />}
              {status}
            </div>
          </div>
        </button>
        {conv.kind === "direct" && (
          <>
            <IconButton icon="video" label="مكالمة فيديو" onClick={() => startCall(conv, "video")} size={42} />
            <IconButton icon="phone" label="مكالمة صوتية" onClick={() => startCall(conv, "audio")} size={42} />
          </>
        )}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <IconButton icon="more" label="المزيد" onClick={() => setMoreOpen((o) => !o)} plain size={34} />
          {moreOpen && (
            <div className="w-strong w-shadow absolute left-0 top-12 z-20 w-60 rounded-2xl p-1.5" style={{ border: "1px solid var(--border)" }}>
              {menuItems.map((it) => (
                <button key={it.label} onClick={it.run} className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold"
                  style={it.danger ? { color: "var(--danger)" } : undefined}>
                  <Icon name={it.icon} size={18} className={it.danger ? "" : "w-accent-text"} />{it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* الرسائل */}
      <div ref={scroller} onScroll={onScroll}
        // الصور تحمل بعد الرسائل وتطول الصفحة: إذا كنا تحت نبقى تحت
        onLoadCapture={() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }}
        className="w-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-2 md:px-6">
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
                  <span className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: "var(--pill)" }}>{dayLabel(m.created_at)}</span>
                </div>
              )}
              {m.kind === "system" || m.kind === "call" ? (
                <div className="my-3 flex justify-center">
                  <span className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs" style={{ background: "var(--pill)" }}>
                    {m.kind === "call" && <Icon name="phone" size={13} className="w-call" />}
                    {m.content}{m.kind === "call" && <span className="w-muted">• {clock(m.created_at)}</span>}
                  </span>
                </div>
              ) : (
                <div id={`m-${m.id}`} className={`group flex items-end gap-1 ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-1.5" : "mt-3"} ${m.reactions.length ? "mb-3.5" : ""}`}>
                  <div className={`relative max-w-[80%] rounded-[20px] px-3.5 py-2 md:max-w-[62%] ${mine ? "w-bubble-out" : "w-bubble-in"}`}
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}>
                    {conv.kind === "group" && !mine && !grouped && <SenderName m={m} />}
                    {m.reply_to && <ReplyQuote r={m.reply_to} mine={mine} onClick={() => document.getElementById(`m-${m.reply_to!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
                    <MessageBody m={m} mine={mine} onImage={setLightbox}
                      sharingLive={liveShares.includes(m.id)} onStopLive={() => stopLiveShare(m.id)} />
                    <div className="w-muted mt-1 flex items-center justify-start gap-1 text-[11px]" dir="ltr">
                      {mine && !m.is_deleted && <Ticks m={m} />}
                      <span>{clock(m.created_at)}</span>
                      {starred.has(m.id) && <Icon name="star" size={11} filled />}
                      {m.edited_at && !m.is_deleted && <span>معدّلة</span>}
                    </div>
                    {m.reactions.length > 0 && (
                      <div className={`absolute -bottom-3.5 flex gap-0.5 rounded-full px-1.5 py-0.5 text-[13px] ${mine ? "right-3" : "left-3"}`}
                        style={{ background: "var(--panel)", boxShadow: "var(--shadow)" }}>
                        {m.reactions.map((r) => (
                          <button key={r.emoji} onClick={(e) => { e.stopPropagation(); react(m, r.emoji); }}
                            aria-label={`${r.emoji} ${r.count}`} className="flex items-center gap-0.5 leading-5">
                            {r.emoji}{r.count > 1 && <span className="w-muted text-[10px] font-bold">{r.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {menuFor === m.id && !m.is_deleted && (
                      <MessageMenu m={m} mine={mine} onClose={() => setMenuFor(null)} meId={me.id}
                        onReact={(e) => react(m, e)} starred={starred.has(m.id)} onStar={() => toggleStar(m)}
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
          <div className="mt-3 flex justify-start">
            <span className="w-bubble-in flex gap-1 rounded-[20px] px-4 py-3">
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

const QUICK = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

function MessageMenu({ m, mine, meId, onClose, onReply, onEdit, onDelete, onResumeLive, onReact, starred, onStar }: {
  m: Message; mine: boolean; meId: number; onClose: () => void; onReply: () => void; onEdit: () => void; onDelete: () => void;
  onResumeLive?: () => void; onReact: (emoji: string) => void; starred: boolean; onStar: () => void;
}) {
  const myReaction = m.reactions.find((r) => r.user_ids.includes(meId))?.emoji;
  const items: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = [
    { icon: "reply", label: "رد", run: onReply },
    { icon: "star", label: starred ? "إلغاء التمييز" : "تمييز بنجمة", run: onStar },
    ...(m.content ? [{ icon: "copy" as IconName, label: "نسخ", run: () => navigator.clipboard?.writeText(m.content) }] : []),
    ...(mine && ["text", "image", "video", "file"].includes(m.kind) ? [{ icon: "edit" as IconName, label: "تعديل", run: onEdit }] : []),
    ...(onResumeLive ? [{ icon: "navigation" as IconName, label: "تحديث موقعي من هذا الجهاز", run: onResumeLive }] : []),
    ...(mine ? [{ icon: "trash" as IconName, label: "حذف للكل", run: onDelete, danger: true }] : []),
  ];
  return (
    <div className={`w-strong w-shadow absolute top-full z-20 mt-1 w-60 rounded-2xl p-1.5 text-sm ${mine ? "left-0" : "right-0"}`}
      style={{ border: "1px solid var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
      {m.kind !== "system" && m.kind !== "call" && (
        <div className="w-line mb-1 flex justify-between border-b px-1 pb-1.5" role="group" aria-label="تفاعل">
          {QUICK.map((e) => (
            <button key={e} onClick={() => { onClose(); onReact(e); }} aria-label={`تفاعل ${e}`} aria-pressed={myReaction === e}
              className={`grid h-9 w-9 place-items-center rounded-full text-xl transition hover:scale-110 ${myReaction === e ? "w-tint" : ""}`}>{e}</button>
          ))}
        </div>
      )}
      {items.map((it) => (
        <button key={it.label} onClick={() => { onClose(); it.run(); }}
          className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2 font-semibold" style={it.danger ? { color: "var(--danger)" } : undefined}>
          <Icon name={it.icon} size={17} />{it.label}
        </button>
      ))}
    </div>
  );
}
