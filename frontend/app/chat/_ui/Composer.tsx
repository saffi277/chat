"use client";
// خانة الكتابة: نص، إيموجي، إرفاق (صورة/فيديو/ملف/موقع)، تسجيل صوت، رد وتعديل
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationKind, Member, Message, MessageKind } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { readDraft, writeDraft } from "@/lib/drafts";
import { conversations as convApi, messages as msgApi, type SendFileOpts } from "@/lib/endpoints";
import { permError } from "@/lib/permissions";
import type { LiveSocket } from "@/lib/socket";
import { Avatar, duration, nameOf } from "./bits";
import { ScheduleDialog } from "./ConvSettings";
import { PollDialog } from "./Tools";
import { Icon } from "./icons";
import { useWasl } from "./store";

const EMOJIS = "😀 😂 🥰 😍 😘 😊 😉 😎 🤩 🥳 😅 🤔 😴 😢 😭 😡 👍 👎 👏 🙏 💪 🔥 ✨ ❤️ 💜 💙 💚 🌹 🎉 ✅ 👋 🤝 ☕ 🌙 ⭐ 📍".split(" ");

/** وسائط تُرسل: تظهر في المحادثة فوراً ومعها نسبة الرفع (Conversation.tsx) */
export type MediaSend = (file: File | Blob, opts: SendFileOpts & { kind: MessageKind }, reply: Message | null) => void;

/** حاسوب بفأرة ولوحة مفاتيح: Enter يرسل. في الهاتف Enter سطر جديد وزر الإرسال يرسل (كما في واتساب) */
const hasKeyboard = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const MAX_ROWS_PX = 6 * 24 + 22; // ستة أسطر ثم تمرير داخل الخانة

export function Composer({ convId, kind, socket, reply, editing, onDone, onSent, onMedia, onScheduled }: {
  convId: number;
  kind: ConversationKind;
  socket: () => LiveSocket | null;
  reply: Message | null;
  editing: Message | null;
  onDone: () => void;
  onSent: (m: Message) => void;
  onMedia: MediaSend;
  onScheduled?: () => void;
}) {
  const t = useT();
  const { me, setPanel, notify } = useWasl();
  // المسودة المحفوظة لهذه المحادثة (Composer يُنشأ من جديد لكل محادثة)
  const [text, setText] = useState(() => readDraft(convId));
  const [polling, setPolling] = useState(false);
  // الإشارة بـ @ في المجموعات: أعضاؤها، وما يُكتب بعد @ الآن
  const [members, setMembers] = useState<Member[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  useEffect(() => {
    if (kind === "group") convApi.members(convId).then(setMembers).catch(() => {});
  }, [convId, kind]);
  const [menu, setMenu] = useState<"emoji" | "attach" | "send" | null>(null);
  const [scheduleText, setScheduleText] = useState<string | null>(null);
  const sendPress = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean }>({ fired: false });
  const [pending, setPending] = useState<{ file: File; url: string; kind: "image" | "video" } | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelRec = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const mediaPick = useRef<HTMLInputElement>(null);
  const filePick = useRef<HTMLInputElement>(null);
  const cameraPick = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const caretTo = useRef<number | null>(null);

  // لما نبدي تعديل، نحط النص القديم بالخانة
  const [editingId, setEditingId] = useState<number | null>(null);
  if (editing && editing.id !== editingId) {
    setEditingId(editing.id);
    setText(editing.content);
  } else if (!editing && editingId !== null) {
    setEditingId(null);
    setText(readDraft(convId));
  }
  useEffect(() => {
    if (reply || editing) input.current?.focus();
  }, [reply, editing]);

  // الخانة تتمدد مع النص حتى ستة أسطر
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_ROWS_PX ? "auto" : "hidden";
    if (caretTo.current !== null) {
      el.focus();
      el.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = null;
    }
  }, [text]);

  // عداد التسجيل
  useEffect(() => {
    if (!rec) return;
    const timer = setInterval(() => setRec((r) => (r ? { ...r, secs: (Date.now() - r.start) / 1000 } : r)), 250);
    return () => clearInterval(timer);
  }, [rec]);

  function onType(v: string, caret?: number) {
    setText(v);
    if (!editing) writeDraft(convId, v);
    // «@» ثم حروف قبل المؤشر مباشرة: نقترح الأعضاء
    const before = v.slice(0, caret ?? v.length);
    const m = kind === "group" ? before.match(/(^|\s)@([\w.]*)$/) : null;
    setMention(m ? { start: before.length - m[2].length - 1, query: m[2].toLowerCase() } : null);
    if (Date.now() - lastTyping.current > 1000) {
      lastTyping.current = Date.now();
      socket()?.send({ type: "typing" });
    }
  }

  async function sendText(silent = false) {
    const content = text.trim();
    if (!content) return;
    if (editing) {
      setBusy(true);
      try {
        await msgApi.edit(editing.id, content);
        onDone();
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    setText("");
    writeDraft(convId, "");
    setMention(null);
    onDone();
    // الطريق السريع: WebSocket. إذا مقطوع نرجع للـ HTTP حتى الرسالة ما تضيع
    if (socket()?.send({ type: "message", content, reply_to: reply?.id, ...(silent ? { silent: true } : {}) })) {
      if (silent) notify(t("أُرسلت دون إشعار"));
      return;
    }
    try {
      onSent(await msgApi.sendText(convId, content, reply?.id, silent));
    } catch {
      setText(content);
    }
  }

  // الوسائط لا تنتظر الخادم: تظهر في المحادثة فوراً مع دائرة التقدّم
  function upload(file: File | Blob, opts: SendFileOpts & { kind: MessageKind }) {
    onMedia(file, { ...opts, replyTo: reply?.id }, reply);
    onDone();
  }

  function pickMedia(f: File | undefined) {
    setMenu(null);
    if (!f) return;
    const kind = f.type.startsWith("video/") ? "video" : "image";
    setPending({ file: f, url: URL.createObjectURL(f), kind });
    setCaption("");
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((mime) => MediaRecorder.isTypeSupported(mime));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      cancelRec.current = false;
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const secs = (Date.now() - start) / 1000;
        setRec(null);
        if (cancelRec.current || secs < 0.8) return;
        const mime = r.mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type: mime });
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        upload(new File([blob], `voice.${ext}`, { type: mime.split(";")[0] }), { kind: "voice", duration: Math.round(secs * 10) / 10 });
      };
      const start = Date.now();
      r.start();
      recorder.current = r;
      setRec({ start, secs: 0 });
    } catch (e) {
      notify(permError(e, "microphone"));
    }
  }
  function stopRecording(cancel = false) {
    cancelRec.current = cancel;
    recorder.current?.stop();
    recorder.current = null;
  }

  const hasText = text.trim().length > 0;
  const mentionList = mention
    ? members.filter((mb) => mb.user.id !== me.id && (!mention.query || mb.user.username.toLowerCase().includes(mention.query)
      || nameOf(mb.user).toLowerCase().includes(mention.query))).slice(0, 6)
    : [];
  // اختيار عضو من الاقتراحات: نضع @اسم_المستخدم مكان ما كُتب بعد @
  function pickMention(username: string) {
    if (!mention) return;
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${username} ${text.slice(caret)}`;
    const pos = mention.start + username.length + 2;
    // المؤشر يوضع بعد الاسم فور عرض النص الجديد (useLayoutEffect أعلاه)، لا في إطار لاحق:
    // لو تأخر الإطار (جهاز بطيء) لعاد المؤشر إلى الوراء وقد كُتبت حروف بعده فتنقلب مواضعها
    caretTo.current = pos;
    setText(next);
    writeDraft(convId, next);
    setMention(null);
  }

  return (
    <div className="w-composer relative rounded-t-[26px] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:rounded-none md:border-t md:w-split"
      style={{ background: "var(--panel)", boxShadow: "0 -6px 24px rgba(40, 36, 90, .06)" }}>
      {(reply || editing) && (
        <div className="w-card mb-2 flex items-center gap-3 rounded-xl border-s-4 px-3 py-2" style={{ borderColor: "var(--accent)" }}>
          <Icon name={editing ? "edit" : "reply"} size={18} className="w-accent-text" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="w-accent-text font-extrabold">{editing ? t("تعديل الرسالة") : t("رد على {name}", { name: nameOf((reply as Message).sender) })}</div>
            <div className="w-muted truncate">{(editing ?? reply)!.content || t("مرفق")}</div>
          </div>
          <button onClick={onDone} aria-label={t("إلغاء")} className="w-muted"><Icon name="x" size={18} /></button>
        </div>
      )}

      {menu === "emoji" && (
        <div className="w-strong w-shadow absolute bottom-full end-16 z-10 mb-2 grid w-[292px] max-w-[calc(100vw-5rem)] grid-cols-8 gap-1 rounded-2xl p-2" style={{ border: "1px solid var(--border)" }}>
          {EMOJIS.map((e) => (
            <button key={e} className="rounded-lg p-1 text-xl hover:bg-black/5" onClick={() => { setText((cur) => cur + e); input.current?.focus(); }}>{e}</button>
          ))}
        </div>
      )}
      {/* الضغط خارج أي قائمة يغلقها. عند بدء الضغط لا عند النقر: رفع الإصبع بعد الضغط المطوّل يولّد نقرة
          تقع على هذه الطبقة، فلو أغلقنا عند النقر لأُغلقت القائمة لحظة فتحها */}
      {menu && <div className="fixed inset-0 z-[5]" onPointerDown={() => setMenu(null)} aria-hidden />}
      {menu === "send" && (
        <div className="w-strong w-shadow absolute bottom-full start-3 z-10 mb-2 grid w-60 gap-1 rounded-2xl p-2" role="menu" style={{ border: "1px solid var(--border)" }}>
          <button role="menuitem" onClick={() => { setMenu(null); sendText(true); }} className="w-hover flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold">
            <span className="w-tint grid h-9 w-9 place-items-center rounded-full"><Icon name="bellOff" size={17} /></span>{t("إرسال دون إشعار")}
          </button>
          <button role="menuitem" onClick={() => { setMenu(null); setScheduleText(text); }} className="w-hover flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold">
            <span className="w-tint grid h-9 w-9 place-items-center rounded-full"><Icon name="clock" size={17} /></span>{t("جدولة الإرسال")}
          </button>
        </div>
      )}
      {scheduleText !== null && (
        <ScheduleDialog convId={convId} text={scheduleText} replyTo={reply?.id} onClose={() => setScheduleText(null)}
          onDone={() => { setText(""); writeDraft(convId, ""); onDone(); onScheduled?.(); }} />
      )}
      {polling && <PollDialog convId={convId} onClose={() => setPolling(false)} />}
      {mentionList.length > 0 && (
          <div className="w-strong w-shadow absolute bottom-full inset-x-3 z-10 mb-2 max-w-sm rounded-2xl p-1.5" role="listbox" aria-label={t("الإشارة إلى عضو")} style={{ border: "1px solid var(--border)" }}>
            {mentionList.map((mb) => (
              <button key={mb.user.id} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(mb.user.username)}
                className="w-hover flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start">
                <Avatar user={mb.user} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold" dir="auto">{nameOf(mb.user)}</span>
                  <span className="w-muted block text-xs" dir="ltr">@{mb.user.username}</span>
                </span>
              </button>
            ))}
          </div>
      )}
      {menu === "attach" && (
        <div className="w-strong w-shadow absolute bottom-full end-3 z-10 mb-2 grid w-56 gap-1 rounded-2xl p-2" style={{ border: "1px solid var(--border)" }}>
          <AttachItem icon="image" label={t("صورة أو فيديو")} onClick={() => mediaPick.current?.click()} />
          <AttachItem icon="file" label={t("ملف")} onClick={() => filePick.current?.click()} />
          <AttachItem icon="pin" label={t("الموقع")} onClick={() => { setMenu(null); setPanel({ type: "location", convId }); }} />
          {kind !== "saved" && <AttachItem icon="poll" label={t("استطلاع")} onClick={() => { setMenu(null); setPolling(true); }} />}
        </div>
      )}
      <input ref={mediaPick} type="file" accept="image/*,video/*" hidden onChange={(e) => { pickMedia(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={cameraPick} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickMedia(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={filePick} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; setMenu(null); if (f) upload(f, { kind: "file" }); e.target.value = ""; }} />

      {rec ? (
        <div className="flex items-center gap-3 p-0.5 ps-3">
          <span className="h-3 w-3 animate-pulse rounded-full" style={{ background: "var(--danger)" }} />
          <span className="flex-1 text-sm font-bold">{t("جارٍ التسجيل {time}", { time: duration(rec.secs) })}</span>
          <button onClick={() => stopRecording(true)} aria-label={t("إلغاء التسجيل")} className="grid h-11 w-11 place-items-center rounded-full w-card"><Icon name="trash" size={19} /></button>
          <button onClick={() => stopRecording(false)} aria-label={t("إرسال التسجيل")} className="w-accent grid h-12 w-12 place-items-center rounded-full"><Icon name="send" size={20} /></button>
        </div>
      ) : (
        // من اليمين: المايك/الإرسال، خانة الكتابة ويا 🙂، المعرض، الكاميرا، ＋
        <form onSubmit={(e) => { e.preventDefault(); sendText(); }} className="flex items-end gap-1.5">
          {hasText || editing ? (
            // onMouseDown: لا ننقل التركيز إلى الزر، فتبقى لوحة المفاتيح مفتوحة بعد الإرسال
            // ضغط مطوّل (أو نقر أيمن) على زر الإرسال: «إرسال دون إشعار» و«جدولة الإرسال»
            <button type="submit" disabled={busy || !hasText} aria-label={t(editing ? "حفظ التعديل" : "إرسال")} onMouseDown={(e) => e.preventDefault()}
              aria-haspopup={editing ? undefined : "menu"}
              onContextMenu={(e) => { if (editing) return; e.preventDefault(); setMenu("send"); }}
              onPointerDown={(e) => {
                sendPress.current.fired = false;
                if (editing || e.pointerType === "mouse") return;
                sendPress.current.timer = setTimeout(() => { sendPress.current.fired = true; navigator.vibrate?.(15); setMenu("send"); }, 450);
              }}
              onPointerUp={() => clearTimeout(sendPress.current.timer)} onPointerLeave={() => clearTimeout(sendPress.current.timer)}
              onClickCapture={(e) => { if (sendPress.current.fired) { sendPress.current.fired = false; e.preventDefault(); e.stopPropagation(); } }}
              className="w-accent grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-50"><Icon name={editing ? "check" : "send"} size={21} /></button>
          ) : (
            <button type="button" onClick={startRecording} disabled={busy} aria-label={t("تسجيل رسالة صوتية")}
              className="w-accent grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-50"><Icon name="mic" size={22} /></button>
          )}
          <div className="w-input flex min-h-12 min-w-0 flex-1 items-end rounded-[24px] ps-4">
            <textarea ref={input} value={text} rows={1} onChange={(e) => onType(e.target.value, e.target.selectionStart)} onFocus={() => setMenu(null)}
              onKeyDown={(e) => {
                // Enter يرسل في الحاسوب، وShift+Enter سطر جديد. (isComposing: لا نقطع كتابة لوحات المفاتيح المركّبة)
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && hasKeyboard()) {
                  e.preventDefault();
                  sendText();
                } else if (e.key === "Escape" && (reply || editing)) {
                  e.stopPropagation();
                  onDone();
                }
              }}
              placeholder={t("اكتب رسالة...")} enterKeyHint={hasKeyboard() ? "send" : "enter"} aria-label={t("الرسالة")} dir="auto"
              className="block max-h-[166px] min-w-0 flex-1 resize-none self-center bg-transparent py-3 text-base leading-6 outline-none md:text-sm md:leading-6" style={{ color: "var(--text)" }} />
            <button type="button" aria-label={t("إيموجي")} onClick={() => setMenu(menu === "emoji" ? null : "emoji")}
              className="w-muted mb-1 grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="smile" size={22} /></button>
          </div>
          {!editing && (
            <>
              <button type="button" aria-label={t("صورة أو فيديو")} onClick={() => { setMenu(null); mediaPick.current?.click(); }}
                className="w-muted mb-1 grid h-10 w-9 shrink-0 place-items-center rounded-full"><Icon name="image" size={22} /></button>
              <button type="button" aria-label={t("الكاميرا")} onClick={() => { setMenu(null); cameraPick.current?.click(); }}
                className="w-muted mb-1 grid h-10 w-9 shrink-0 place-items-center rounded-full"><Icon name="camera" size={22} /></button>
              <button type="button" aria-label={t("إرفاق")} onClick={() => setMenu(menu === "attach" ? null : "attach")}
                className="w-accent mb-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full"><Icon name="plus" size={22} strokeWidth={2.4} /></button>
            </>
          )}
        </form>
      )}
      {busy && <p className="w-muted mt-1 text-center text-xs">{t("جارٍ الحفظ...")}</p>}

      {pending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setPending(null)}>
          <div className="w-strong w-shadow w-full max-w-md rounded-2xl p-4" onClick={(e) => e.stopPropagation()} style={{ border: "1px solid var(--border)" }}>
            {pending.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- معاينة محلية قبل الرفع
              <img src={pending.url} alt="" className="max-h-[55dvh] w-full rounded-2xl object-contain" />
            ) : (
              <video src={pending.url} controls className="max-h-[55dvh] w-full rounded-2xl bg-black" />
            )}
            <div className="mt-3 flex items-center gap-2">
              <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t("أضف تعليقاً...")} dir="auto"
                className="w-input h-12 flex-1 rounded-full px-4 text-base outline-none md:text-sm" />
              <button disabled={busy} onClick={() => { const p = pending; setPending(null); upload(p.file, { kind: p.kind, caption }); }}
                className="w-accent grid h-12 w-12 place-items-center rounded-full" aria-label={t("إرسال")}><Icon name="send" size={20} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachItem({ icon, label, onClick }: { icon: "image" | "file" | "pin" | "poll"; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-hover flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold">
      <span className="w-accent grid h-9 w-9 place-items-center rounded-full"><Icon name={icon} size={17} /></span>{label}
    </button>
  );
}
