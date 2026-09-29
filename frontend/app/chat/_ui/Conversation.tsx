"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Call, Conversation as Conv, Message, MessageKind } from "@/lib/api";
import { t as tr, useT } from "@/lib/i18n";
import { calls as callsApi, contacts as contactsApi, conversations as convApi, messages as msgApi, type SendFileOpts } from "@/lib/endpoints";
import { openSocket, type LiveSocket, type SocketStatus } from "@/lib/socket";
import { localPreviews, MessageBody, ReplyQuote, SenderName, Ticks, type UploadState } from "./Bubbles";
import { clock, ConvAvatar, dayLabel, IconButton, ImageViewer, lastSeenText, nameOf, preview, StoryTap, systemText } from "./bits";
import { Composer, type MediaSend } from "./Composer";
import { disappearLabel, ScheduleDialog, useMuteToggle } from "./ConvSettings";
import { Icon, type IconName } from "./icons";
import { useWasl } from "./store";

// نضيف رسالة إلى القائمة أو نستبدلها بحسب المعرّف
const upsert = (list: Message[], m: Message) => {
  const i = list.findIndex((x) => x.id === m.id);
  if (i === -1) return [...list, m].sort((a, b) => a.id - b.id);
  const copy = list.slice();
  copy[i] = m;
  return copy;
};

/** وسائط تُرفع الآن: تظهر في المحادثة فوراً (رسالة محلية بمعرّف سالب) حتى يردّ الخادم */
type Outgoing = { key: number; file: File | Blob; opts: SendFileOpts & { kind: MessageKind }; msg: Message; progress: number; failed: boolean };

/** أبعاد الصورة أو الفيديو قبل الرفع: يُحجز مكانها بالقياس الصحيح عند الطرفين */
function mediaSize(url: string, kind: MessageKind): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const done = (w: number, h: number) => resolve(w && h ? { width: w, height: h } : null);
    setTimeout(() => resolve(null), 3000);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = () => resolve(null);
      img.src = url;
    } else if (kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
      v.onerror = () => resolve(null);
      v.src = url;
    } else resolve(null);
  });
}

/** مدة الضغط المطوّل التي تفتح قائمة الرسالة في الهاتف */
const LONG_PRESS_MS = 450;

export function Conversation({ conv }: { conv: Conv }) {
  const t = useT();
  const { me, otherOf, openConv, panel, storyRing, openStory, storyViewer, call, joinCall, setPanel, startCall, liveShares, stopLiveShare, startLiveShare, refreshConvs, notify, isContact, contactAdded } = useWasl();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState<string | null>(null);
  const [conn, setConn] = useState<SocketStatus>("open");
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  // القائمة تُفتح فوق الرسالة إن لم يبقَ تحتها مكان كافٍ
  const [menuFor, setMenuFor] = useState<{ id: number; up: boolean } | null>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const uploads = useRef(new Map<number, AbortController>());
  const seq = useRef(0);
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [starred, setStarred] = useState<Set<number>>(new Set());
  const socketRef = useRef<LiveSocket | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // نبقى تحت إذا المستخدم أصلاً تحت
  const keepFrom = useRef<number | null>(null); // حتى الشاشة ما تنط لما نحمل رسائل أقدم
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const other = otherOf(conv);
  const id = conv.id;
  // القناة (ومجموعة «الإرسال للمشرفين فقط»): المشرفون فقط يرسلون، والباقون يقرؤون ويتفاعلون
  const channel = conv.kind === "channel";
  const canPost = conv.can_post ?? (!channel || conv.my_role === "admin");
  const toggleMute = useMuteToggle();
  // مكالمة جماعية جارية في هذه المجموعة لست فيها: شريط «انضمام»
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  useEffect(() => {
    if (conv.kind !== "group") return;
    let alive = true;
    const load = () => callsApi.active(conv.id).then((c) => alive && setActiveCall(c)).catch(() => {});
    load();
    window.addEventListener("wasl:calls", load);
    return () => { alive = false; window.removeEventListener("wasl:calls", load); };
  }, [conv.id, conv.kind]);
  // (رنين لم أرد عليه لا يعني أني فيها: يبقى زر «انضمام» متاحاً بعد الرفض)
  const inThisCall = !!call && call.phase !== "ended" && call.phase !== "incoming" && call.call.id === activeCall?.id;
  const [scheduledCount, setScheduledCount] = useState(0);
  const [scheduling, setScheduling] = useState(false);
  const loadScheduled = useCallback(() => {
    if (conv.kind === "saved" || !canPost) return;
    msgApi.scheduled(conv.id).then((l) => setScheduledCount(l.filter((s) => s.status === "pending").length)).catch(() => {});
  }, [conv.id, conv.kind, canPost]);
  useEffect(() => {
    loadScheduled();
    // أُرسلت رسالة مجدولة (الحدث يصل على الاتصال العام في store.tsx)
    const on = (e: Event) => (e as CustomEvent<number>).detail === conv.id && loadScheduled();
    window.addEventListener("wasl:scheduled", on);
    return () => window.removeEventListener("wasl:scheduled", on);
  }, [conv.id, loadScheduled]);
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
      } else if (e.type === "error" && e.detail === "rate_limited") {
        notify(tr("أرسلت رسائل كثيرة بسرعة. انتظر قليلاً ثم أعد المحاولة."));
      } else if (e.type === "error") {
        notify(e.message || tr("لا يمكنك الإرسال في هذه المحادثة"));
      } else if (e.type === "message_removed") {
        // رسالة مختفية انتهت مدتها
        setMsgs((l) => l.filter((m) => m.id !== e.message_id));
      } else if (e.type === "message_updated") {
        setMsgs((l) => upsert(l, e.message));
      } else if (e.type === "typing" && e.user_id !== me.id) {
        const c = convRef.current;
        const u = c.participants.find((p) => p.id === e.user_id);
        const who = e.name || (u ? nameOf(u) : "");
        setTyping(c.kind === "group" && who ? tr("{name} يكتب...", { name: who }) : tr("يكتب الآن..."));
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
  }, [id, me.id, markRead, notify]);

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

  // ------------------------------------------------ إرسال الوسائط مثل واتساب
  const patchOut = (key: number, patch: Partial<Outgoing>) => setOutgoing((l) => l.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  function runUpload(o: Outgoing) {
    const ctrl = new AbortController();
    uploads.current.set(o.key, ctrl);
    patchOut(o.key, { progress: 0, failed: false });
    msgApi.sendFile(id, o.file, { ...o.opts, onProgress: (p) => patchOut(o.key, { progress: p }), signal: ctrl.signal })
      .then((m) => {
        // نبقي النسخة المحلية للصورة والفيديو فلا تومض الرسالة وهي تُحمَّل من الخادم
        if (o.msg.kind === "image" || o.msg.kind === "video") localPreviews.set(m.id, o.msg.file_url!);
        else URL.revokeObjectURL(o.msg.file_url!);
        stick.current = true;
        setMsgs((l) => upsert(l, m));
        setOutgoing((l) => l.filter((x) => x.key !== o.key));
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        patchOut(o.key, { failed: true });
        notify(e.message);
      })
      .finally(() => uploads.current.delete(o.key));
  }

  const sendMedia: MediaSend = async (file, opts, replyMsg) => {
    const key = ++seq.current;
    const url = URL.createObjectURL(file);
    const size = await mediaSize(url, opts.kind);
    const r = replyMsg ? { id: replyMsg.id, kind: replyMsg.kind, sender_id: replyMsg.sender.id, sender_name: nameOf(replyMsg.sender), preview: preview(replyMsg).text } : null;
    const msg: Message = {
      id: -key, conversation: id, sender: me, kind: opts.kind, content: opts.caption ?? "", file_url: url,
      file_name: opts.name ?? (file instanceof File ? file.name : "voice"), file_size: file.size, duration: opts.duration ?? null,
      width: size?.width ?? null, height: size?.height ?? null, latitude: null, longitude: null, live_until: null, is_live: false,
      reply_to: r, created_at: new Date().toISOString(), edited_at: null, is_deleted: false, status: "sent", is_read: false, reactions: [],
    };
    const o: Outgoing = { key, file, opts: { ...opts, ...(opts.kind === "video" && size ? size : {}) }, msg, progress: 0, failed: false };
    stick.current = true;
    setOutgoing((l) => [...l, o]);
    runUpload(o);
  };

  function cancelUpload(o: Outgoing) {
    uploads.current.get(o.key)?.abort();
    URL.revokeObjectURL(o.msg.file_url!);
    setOutgoing((l) => l.filter((x) => x.key !== o.key));
  }

  // ------------------------------------------------ قائمة الرسالة: ضغط مطوّل (الهاتف)، نقر أيمن (الحاسوب)، أو زر ⌄
  function openMenu(msgId: number, el: HTMLElement) {
    const box = scroller.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const below = box ? box.bottom - r.bottom : 999;
    const above = box ? r.top - box.top : 0;
    setMoreOpen(false);
    setMenuFor({ id: msgId, up: below < 340 && above > below });
  }
  const pressStart = (e: React.PointerEvent<HTMLElement>, msgId: number) => {
    press.current.fired = false;
    if (e.pointerType === "mouse") return;
    const el = e.currentTarget;
    press.current.x = e.clientX;
    press.current.y = e.clientY;
    clearTimeout(press.current.timer);
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      navigator.vibrate?.(15);
      openMenu(msgId, el);
    }, LONG_PRESS_MS);
  };
  const pressMove = (e: React.PointerEvent) => {
    if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) clearTimeout(press.current.timer);
  };
  const pressEnd = () => clearTimeout(press.current.timer);

  // Esc في الحاسوب: يلغي الرد أو التعديل أولاً، ثم يغلق القائمة، ثم يغلق المحادثة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || panel || storyViewer || call) return;
      if (menuFor || moreOpen) { setMenuFor(null); setMoreOpen(false); return; }
      if (reply || editing) { setReply(null); setEditing(null); return; }
      openConv(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, storyViewer, call, menuFor, moreOpen, reply, editing, openConv]);

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
  const status = conn !== "open" ? t("جارٍ الاتصال...") : typing ?? (conv.kind === "group" ? t("{n} أعضاء", { n: conv.member_count }) : channel ? t("قناة • المشتركون: {n}", { n: conv.member_count }) : conv.kind === "saved" ? t("مساحتك الخاصة") : other ? lastSeenText(other) : "");
  const openInfo = () => (conv.kind === "group" || channel ? setPanel({ type: "group", convId: id }) : other ? setPanel({ type: "contact", userId: other.id }) : setPanel({ type: "media", convId: id }));
  // محادثة مع شخص ليس في جهات اتصالي (راسلني هو، أو أزلته): شريط «إضافة» كما في واتساب
  const stranger = conv.kind === "direct" && other && !isContact(other.id) ? other : null;
  async function addStranger() {
    if (!stranger) return;
    try {
      contactAdded(await contactsApi.add({ user_id: stranger.id }));
      notify(t("أُضيف {name} إلى جهات اتصالك", { name: nameOf(stranger) }));
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function togglePref(key: "is_favorite" | "is_muted" | "is_archived" | "is_pinned") {
    setMoreOpen(false);
    await convApi.setPrefs(id, { [key]: !conv[key] });
    await refreshConvs();
    if (key === "is_archived" && !conv.is_archived) openConv(null);
  }

  async function clearChat() {
    setMoreOpen(false);
    if (!confirm(t("حذف المحادثة من عندك؟ ستبقى لدى الطرف الآخر."))) return;
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
    notify(on ? t("أُضيفت إلى الرسائل المميزة ⭐") : t("أُزيلت من الرسائل المميزة"));
  }

  const menuItems: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = [
    { icon: "info", label: t(conv.kind === "group" ? "معلومات المجموعة" : channel ? "معلومات القناة" : "معلومات الاتصال"), run: () => { setMoreOpen(false); openInfo(); } },
    { icon: "image", label: t("الوسائط والملفات"), run: () => { setMoreOpen(false); setPanel({ type: "media", convId: id }); } },
    ...(canPost ? [{ icon: "pin" as IconName, label: t("مشاركة الموقع"), run: () => { setMoreOpen(false); setPanel({ type: "location", convId: id }); } }] : []),
    { icon: "star", label: t("الرسائل المميزة"), run: () => { setMoreOpen(false); setPanel({ type: "starred", convId: id }); } },
    ...(canPost && conv.kind !== "saved" ? [{ icon: "clock" as IconName, label: t("جدولة رسالة"), run: () => { setMoreOpen(false); setScheduling(true); } }] : []),
    { icon: "settings", label: t("إعدادات المحادثة"), run: () => { setMoreOpen(false); setPanel({ type: "convSettings", convId: id }); } },
    ...(conv.kind !== "saved" ? [
      { icon: "pinned" as IconName, label: t(conv.is_pinned ? "إلغاء التثبيت" : "تثبيت المحادثة"), run: () => togglePref("is_pinned") },
      { icon: "bookmark" as IconName, label: t(conv.is_favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"), run: () => togglePref("is_favorite") },
      { icon: (conv.is_muted ? "bell" : "bellOff") as IconName, label: t(conv.is_muted ? "إلغاء الكتم" : "كتم الإشعارات"), run: () => { setMoreOpen(false); toggleMute(conv); } },
      { icon: "archive" as IconName, label: t(conv.is_archived ? "إلغاء الأرشفة" : "أرشفة المحادثة"), run: () => togglePref("is_archived") },
      { icon: "trash" as IconName, label: t("حذف المحادثة"), run: clearChat, danger: true },
    ] : []),
  ];

  return (
    // خلفية هذه المحادثة (إن اختار المستخدم لها خلفية خاصة) تغطي خلفية الثيم العامة
    <div className={`flex h-full min-h-0 flex-col ${conv.wallpaper ? "w-chat-bg" : ""}`} data-wallpaper={conv.wallpaper || undefined}
      onClick={() => { setMenuFor(null); setMoreOpen(false); }}>
      {/* الترويسة */}
      <header className="w-shadow relative z-10 flex items-center gap-2 rounded-b-[26px] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:rounded-none md:shadow-none md:border-b md:w-split"
        style={{ background: "var(--panel)" }}>
        <IconButton icon="back" label={t("رجوع")} onClick={() => openConv(null)} className="md:hidden" plain size={34} />
        <button onClick={openInfo} className="flex min-w-0 flex-1 items-center gap-3 text-start">
          <StoryTap ring={storyRing(other?.id)} onOpen={() => other && openStory(other.id)}>
            <ConvAvatar conv={conv} other={other} size={46} ring={storyRing(other?.id)} />
          </StoryTap>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold" dir="auto">{title}</div>
            <div className="w-muted flex items-center gap-1.5 truncate text-xs" style={{ color: conn !== "open" ? "#f59e0b" : typing ? "var(--accent)" : undefined }}>
              {conn === "open" && !typing && other?.is_online && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--online)" }} />}
              {status}
            </div>
          </div>
        </button>
        {(conv.kind === "direct" || conv.kind === "group") && (
          <>
            <IconButton icon="video" label={t("مكالمة فيديو")} onClick={() => startCall(conv, "video")} size={42} />
            <IconButton icon="phone" label={t("مكالمة صوتية")} onClick={() => startCall(conv, "audio")} size={42} />
          </>
        )}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <IconButton icon="more" label={t("المزيد")} onClick={() => setMoreOpen((o) => !o)} plain size={34} />
          {moreOpen && (
            <div className="w-strong w-shadow absolute end-0 top-12 z-20 w-60 rounded-2xl p-1.5" style={{ border: "1px solid var(--border)" }}>
              {menuItems.map((it) => (
                <button key={it.label} onClick={it.run} className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold"
                  style={it.danger ? { color: "var(--danger)" } : undefined}>
                  <Icon name={it.icon} size={18} className={it.danger ? "" : "w-accent-text"} />{it.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* في الحاسوب: زر لإغلاق المحادثة (أو Esc) */}
        <span className="hidden md:block">
          <IconButton icon="x" label={t("إغلاق المحادثة")} onClick={() => openConv(null)} plain size={38} />
        </span>
      </header>

      {activeCall && !inThisCall && activeCall.status === "ongoing" && (
        <div className="w-panel mx-3 mt-2 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm md:mx-6" role="status">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: "var(--online)" }}>
            <Icon name={activeCall.kind === "video" ? "video" : "phone"} size={17} />
          </span>
          <span className="min-w-0 flex-1 font-semibold">{t("مكالمة جماعية جارية • المشاركون: {n}", { n: activeCall.participants?.length ?? 0 })}</span>
          <button onClick={() => joinCall(activeCall)} className="shrink-0 rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: "var(--online)" }}>{t("انضمام")}</button>
        </div>
      )}
      {stranger && (
        <div className="w-panel mx-3 mt-2 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm md:mx-6" role="note">
          <Icon name="info" size={18} className="w-accent-text shrink-0" />
          <span className="min-w-0 flex-1">{t("{name} ليس ضمن جهات اتصالك", { name: nameOf(stranger) })}</span>
          <button onClick={addStranger} className="w-accent shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold">{t("إضافة")}</button>
        </div>
      )}

      {/* الرسائل */}
      <div ref={scroller} onScroll={onScroll}
        // الصور تُحمَّل بعد الرسائل فتطول الصفحة: إن كنا في الأسفل نبقى فيه
        onLoadCapture={() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }}
        className="w-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-2 md:px-6">
        {conv.disappear_after > 0 && (
          <div className="mt-3 flex justify-center">
            <button onClick={() => setPanel({ type: "convSettings", convId: id })} className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: "var(--pill)" }}>
              <Icon name="clock" size={13} />{t("الرسائل المختفية مفعّلة: {time}", { time: t(disappearLabel(conv.disappear_after)) })}
            </button>
          </div>
        )}
        {loading && <p className="w-muted py-10 text-center text-sm">{t("جارٍ التحميل...")}</p>}
        {hasMore && !loading && <button onClick={loadOlder} className="w-chip mx-auto my-3 block rounded-full px-4 py-1.5 text-xs">{t("رسائل أقدم")}</button>}
        {!loading && msgs.length === 0 && (
          <div className="w-panel mx-auto mt-10 max-w-xs rounded-2xl p-5 text-center text-sm">
            <p className="font-bold">{t(conv.kind === "saved" ? "احفظ هنا ما تشاء" : "ابدأ المحادثة 👋")}</p>
            <p className="w-muted mt-1 text-xs">{t("تصل الرسائل فوراً، ومعها الصور والرسائل الصوتية.")}</p>
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
                    <span dir="auto">{systemText(m.content)}</span>{m.kind === "call" && <span className="w-muted">• {clock(m.created_at)}</span>}
                  </span>
                </div>
              ) : (
                <div id={`m-${m.id}`} className={`group flex items-end gap-1 ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-1.5" : "mt-3"} ${m.reactions.length ? "mb-3.5" : ""}`}>
                  <div className={`relative max-w-[80%] rounded-[20px] px-3.5 py-2 [-webkit-touch-callout:none] [@media(hover:none)]:select-none md:max-w-[62%] ${mine ? "w-bubble-out" : "w-bubble-in"}`}
                    // بعد الضغط المطوّل يصل «نقر» عند رفع الإصبع: نوقفه قبل أن يصل إلى الصورة (فلا يُفتح العارض) أو يغلق القائمة
                    onClickCapture={(e) => { if (press.current.fired) { press.current.fired = false; e.stopPropagation(); e.preventDefault(); } }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuFor?.id === m.id) setMenuFor(null); else openMenu(m.id, e.currentTarget);
                    }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(m.id, e.currentTarget); }}
                    onPointerDown={(e) => pressStart(e, m.id)} onPointerMove={pressMove} onPointerUp={pressEnd} onPointerCancel={pressEnd} onPointerLeave={pressEnd}>
                    {!m.is_deleted && (
                      // زر ⌄: ظاهر دائماً على الصور والفيديو (فالضغط عليها يفتح العارض)، وعند المرور بالفأرة على غيرها
                      <button type="button" aria-label={t("خيارات الرسالة")} onClick={(e) => { e.stopPropagation(); openMenu(m.id, e.currentTarget.parentElement!); }}
                        className={`absolute end-1.5 top-1.5 z-[1] h-7 w-7 place-items-center rounded-full ${media(m) ? "grid bg-black/45 text-white" : "hidden group-hover:grid"}`}
                        style={media(m) ? undefined : { background: mine ? "var(--bubble-out)" : "var(--bubble-in)", color: "var(--muted)" }}>
                        <Icon name="chevronDown" size={17} strokeWidth={2.4} />
                      </button>
                    )}
                    {conv.kind === "group" && !mine && !grouped && <SenderName m={m} />}
                    {m.reply_to && <ReplyQuote r={m.reply_to} mine={mine} onClick={() => document.getElementById(`m-${m.reply_to!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
                    <MessageBody m={m} mine={mine} onImage={setLightbox}
                      sharingLive={liveShares.includes(m.id)} onStopLive={() => stopLiveShare(m.id)} />
                    <div className="w-muted mt-1 flex items-center justify-start gap-1 text-[11px]" dir="ltr">
                      {mine && !m.is_deleted && !channel && <Ticks m={m} />}
                      <span>{clock(m.created_at)}</span>
                      {m.expires_at && <span title={t("رسالة مختفية")}><Icon name="clock" size={11} /></span>}
                      {starred.has(m.id) && <Icon name="star" size={11} filled />}
                      {m.edited_at && !m.is_deleted && <span>{t("معدّلة")}</span>}
                    </div>
                    {m.reactions.length > 0 && (
                      <div className={`absolute -bottom-3.5 flex gap-0.5 rounded-full px-1.5 py-0.5 text-[13px] ${mine ? "start-3" : "end-3"}`}
                        style={{ background: "var(--panel)", boxShadow: "var(--shadow)" }}>
                        {m.reactions.map((r) => (
                          <button key={r.emoji} onClick={(e) => { e.stopPropagation(); react(m, r.emoji); }}
                            aria-label={`${r.emoji} ${r.count}`} className="flex items-center gap-0.5 leading-5">
                            {r.emoji}{r.count > 1 && <span className="w-muted text-[10px] font-bold">{r.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {menuFor?.id === m.id && !m.is_deleted && (
                      <MessageMenu m={m} mine={mine} up={menuFor.up} onClose={() => setMenuFor(null)} meId={me.id}
                        onReact={(e) => react(m, e)} starred={starred.has(m.id)} onStar={() => toggleStar(m)}
                        onReply={canPost ? () => { setEditing(null); setReply(m); } : undefined}
                        onEdit={() => { setReply(null); setEditing(m); }}
                        onDelete={async () => { if (confirm(t("حذف الرسالة لدى الجميع؟"))) await msgApi.remove(m.id).catch((e) => notify(e.message)); }}
                        onResumeLive={m.is_live && mine && !liveShares.includes(m.id) ? () => startLiveShare(m) : undefined} />
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
        {outgoing.map((o) => {
          const up: UploadState = { progress: o.progress, failed: o.failed, onCancel: () => cancelUpload(o), onRetry: () => runUpload(o) };
          return (
            <div key={`up-${o.key}`} className="mt-3 flex justify-end">
              <div className="w-bubble-out relative max-w-[80%] rounded-[20px] px-3.5 py-2 md:max-w-[62%]">
                {o.msg.reply_to && <ReplyQuote r={o.msg.reply_to} mine />}
                <MessageBody m={o.msg} mine onImage={() => {}} upload={up} />
                <div className="w-muted mt-1 flex items-center justify-start gap-1 text-[11px]" dir="ltr">
                  {o.failed
                    ? <span className="flex items-center gap-1 font-bold" style={{ color: "var(--danger)" }}><Icon name="info" size={13} />{t("لم تُرسل")}</span>
                    : <span className="flex items-center gap-1" aria-label={t("جارٍ الإرسال...")}><Icon name="clock" size={12} />{Math.round(o.progress * 100)}%</span>}
                </div>
              </div>
            </div>
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

      {scheduledCount > 0 && canPost && (
        <button onClick={() => setPanel({ type: "convSettings", convId: id })}
          className="w-strong w-shadow mx-auto mb-2 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold" style={{ border: "1px solid var(--border)" }}>
          <Icon name="clock" size={14} className="w-accent-text" />{t("رسائل مجدولة: {n}", { n: scheduledCount })}
        </button>
      )}
      {scheduling && <ScheduleDialog convId={id} replyTo={reply?.id} onClose={() => setScheduling(false)} onDone={loadScheduled} />}
      {canPost ? (
        <Composer onScheduled={loadScheduled} convId={id} socket={() => socketRef.current} reply={reply} editing={editing}
          onDone={() => { setReply(null); setEditing(null); }}
          onSent={(m) => { stick.current = true; setMsgs((l) => upsert(l, m)); }} onMedia={sendMedia} />
      ) : (
        // القناة للمشترك: لا خانة كتابة، بل سطر يوضح ذلك وزر كتم الإشعارات
        <div className="flex items-center gap-3 rounded-t-[26px] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:rounded-none md:border-t md:w-line"
          style={{ background: "var(--panel)", boxShadow: "0 -6px 24px rgba(40, 36, 90, .06)" }}>
          <Icon name={channel ? "megaphone" : "lock"} size={20} className="w-muted shrink-0" />
          <span className="w-muted min-w-0 flex-1 text-sm">{t(channel ? "النشر في هذه القناة لمشرفيها فقط" : "الإرسال في هذه المجموعة للمشرفين فقط")}</span>
          <button onClick={() => toggleMute(conv)} className="w-tint flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold">
            <Icon name={conv.is_muted ? "bell" : "bellOff"} size={16} />{t(conv.is_muted ? "إلغاء الكتم" : "كتم")}
          </button>
        </div>
      )}

      {lightbox && <ImageViewer src={lightbox} onClose={closeLightbox} />}
    </div>
  );
}

const QUICK = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

/** رسالة وسائط: الضغط عليها يفتح العارض أو المشغّل، فقائمتها من زر ⌄ أو الضغط المطوّل */
const media = (m: Message) => m.kind === "image" || m.kind === "video";

function MessageMenu({ m, mine, up, meId, onClose, onReply, onEdit, onDelete, onResumeLive, onReact, starred, onStar }: {
  m: Message; mine: boolean; up?: boolean; meId: number; onClose: () => void; onReply?: () => void; onEdit: () => void; onDelete: () => void;
  onResumeLive?: () => void; onReact: (emoji: string) => void; starred: boolean; onStar: () => void;
}) {
  const t = useT();
  const myReaction = m.reactions.find((r) => r.user_ids.includes(meId))?.emoji;
  const items: { icon: IconName; label: string; run: () => void; danger?: boolean }[] = [
    ...(onReply ? [{ icon: "reply" as IconName, label: t("رد"), run: onReply }] : []),
    { icon: "star", label: t(starred ? "إلغاء التمييز" : "تمييز بنجمة"), run: onStar },
    ...(m.content ? [{ icon: "copy" as IconName, label: t("نسخ"), run: () => navigator.clipboard?.writeText(m.content) }] : []),
    ...(mine && ["text", "image", "video", "file"].includes(m.kind) ? [{ icon: "edit" as IconName, label: t("تعديل"), run: onEdit }] : []),
    ...(onResumeLive ? [{ icon: "navigation" as IconName, label: t("تحديث موقعي من هذا الجهاز"), run: onResumeLive }] : []),
    ...(mine ? [{ icon: "trash" as IconName, label: t("حذف للجميع"), run: onDelete, danger: true }] : []),
  ];
  return (
    <div className={`w-strong w-shadow absolute z-20 w-60 rounded-2xl p-1.5 text-sm ${up ? "bottom-full mb-1" : "top-full mt-1"} ${mine ? "end-0" : "start-0"}`}
      style={{ border: "1px solid var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
      {m.kind !== "system" && m.kind !== "call" && (
        <div className="w-line mb-1 flex justify-between border-b px-1 pb-1.5" role="group" aria-label={t("تفاعل")}>
          {QUICK.map((e) => (
            <button key={e} onClick={() => { onClose(); onReact(e); }} aria-label={`${t("تفاعل")} ${e}`} aria-pressed={myReaction === e}
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
