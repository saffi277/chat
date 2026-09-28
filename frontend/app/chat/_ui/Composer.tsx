"use client";
// خانة الكتابة: نص، إيموجي، إرفاق (صورة/فيديو/ملف/موقع)، تسجيل صوت، رد وتعديل
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { messages as msgApi } from "@/lib/endpoints";
import { permError } from "@/lib/permissions";
import type { LiveSocket } from "@/lib/socket";
import { duration, nameOf } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

const EMOJIS = "😀 😂 🥰 😍 😘 😊 😉 😎 🤩 🥳 😅 🤔 😴 😢 😭 😡 👍 👎 👏 🙏 💪 🔥 ✨ ❤️ 💜 💙 💚 🌹 🎉 ✅ 👋 🤝 ☕ 🌙 ⭐ 📍".split(" ");

export function Composer({ convId, socket, reply, editing, onDone, onSent }: {
  convId: number;
  socket: () => LiveSocket | null;
  reply: Message | null;
  editing: Message | null;
  onDone: () => void;
  onSent: (m: Message) => void;
}) {
  const t = useT();
  const { setPanel, notify } = useWasl();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<"emoji" | "attach" | null>(null);
  const [pending, setPending] = useState<{ file: File; url: string; kind: "image" | "video" } | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelRec = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const mediaPick = useRef<HTMLInputElement>(null);
  const filePick = useRef<HTMLInputElement>(null);
  const cameraPick = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  // لما نبدي تعديل، نحط النص القديم بالخانة
  const [editingId, setEditingId] = useState<number | null>(null);
  if (editing && editing.id !== editingId) {
    setEditingId(editing.id);
    setText(editing.content);
  } else if (!editing && editingId !== null) {
    setEditingId(null);
    setText("");
  }
  useEffect(() => {
    if (reply || editing) input.current?.focus();
  }, [reply, editing]);

  // عداد التسجيل
  useEffect(() => {
    if (!rec) return;
    const timer = setInterval(() => setRec((r) => (r ? { ...r, secs: (Date.now() - r.start) / 1000 } : r)), 250);
    return () => clearInterval(timer);
  }, [rec]);

  function onType(v: string) {
    setText(v);
    if (Date.now() - lastTyping.current > 1000) {
      lastTyping.current = Date.now();
      socket()?.send({ type: "typing" });
    }
  }

  async function sendText() {
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
    onDone();
    // الطريق السريع: WebSocket. إذا مقطوع نرجع للـ HTTP حتى الرسالة ما تضيع
    if (socket()?.send({ type: "message", content, reply_to: reply?.id })) return;
    try {
      onSent(await msgApi.sendText(convId, content, reply?.id));
    } catch {
      setText(content);
    }
  }

  async function upload(file: File | Blob, opts: Parameters<typeof msgApi.sendFile>[2]) {
    setBusy(true);
    try {
      onSent(await msgApi.sendFile(convId, file, { ...opts, replyTo: reply?.id }));
      onDone();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="relative rounded-t-[26px] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:rounded-none md:border-t md:w-line"
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
      {menu === "attach" && (
        <div className="w-strong w-shadow absolute bottom-full end-3 z-10 mb-2 grid w-56 gap-1 rounded-2xl p-2" style={{ border: "1px solid var(--border)" }}>
          <AttachItem icon="image" label={t("صورة أو فيديو")} onClick={() => mediaPick.current?.click()} />
          <AttachItem icon="file" label={t("ملف")} onClick={() => filePick.current?.click()} />
          <AttachItem icon="pin" label={t("الموقع")} onClick={() => { setMenu(null); setPanel({ type: "location", convId }); }} />
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
        <form onSubmit={(e) => { e.preventDefault(); sendText(); }} className="flex items-center gap-1.5">
          {hasText || editing ? (
            <button type="submit" disabled={busy || !hasText} aria-label={t(editing ? "حفظ التعديل" : "إرسال")}
              className="w-accent grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-50"><Icon name={editing ? "check" : "send"} size={21} /></button>
          ) : (
            <button type="button" onClick={startRecording} disabled={busy} aria-label={t("تسجيل رسالة صوتية")}
              className="w-accent grid h-12 w-12 shrink-0 place-items-center rounded-full disabled:opacity-50"><Icon name="mic" size={22} /></button>
          )}
          <div className="w-input flex h-12 min-w-0 flex-1 items-center rounded-full ps-4">
            <input ref={input} value={text} onChange={(e) => onType(e.target.value)} onFocus={() => setMenu(null)}
              placeholder={t("اكتب رسالة...")} enterKeyHint="send" aria-label={t("الرسالة")} dir="auto"
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} />
            <button type="button" aria-label={t("إيموجي")} onClick={() => setMenu(menu === "emoji" ? null : "emoji")}
              className="w-muted grid h-10 w-10 shrink-0 place-items-center rounded-full"><Icon name="smile" size={22} /></button>
          </div>
          {!editing && (
            <>
              <button type="button" aria-label={t("صورة أو فيديو")} onClick={() => { setMenu(null); mediaPick.current?.click(); }}
                className="w-muted grid h-10 w-9 shrink-0 place-items-center rounded-full"><Icon name="image" size={22} /></button>
              <button type="button" aria-label={t("الكاميرا")} onClick={() => { setMenu(null); cameraPick.current?.click(); }}
                className="w-muted grid h-10 w-9 shrink-0 place-items-center rounded-full"><Icon name="camera" size={22} /></button>
              <button type="button" aria-label={t("إرفاق")} onClick={() => setMenu(menu === "attach" ? null : "attach")}
                className="w-accent grid h-11 w-11 shrink-0 place-items-center rounded-full"><Icon name="plus" size={22} strokeWidth={2.4} /></button>
            </>
          )}
        </form>
      )}
      {busy && <p className="w-muted mt-1 text-center text-xs">{t("جارٍ الإرسال...")}</p>}

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
              <button disabled={busy} onClick={async () => { const p = pending; setPending(null); await upload(p.file, { kind: p.kind, caption }); }}
                className="w-accent grid h-12 w-12 place-items-center rounded-full" aria-label={t("إرسال")}><Icon name="send" size={20} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachItem({ icon, label, onClick }: { icon: "image" | "file" | "pin"; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-hover flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold">
      <span className="w-accent grid h-9 w-9 place-items-center rounded-full"><Icon name={icon} size={17} /></span>{label}
    </button>
  );
}
