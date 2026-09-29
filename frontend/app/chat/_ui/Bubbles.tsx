"use client";
// شكل كل نوع من الرسائل: نص، صورة، فيديو، صوت، ملف، موقع
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type Message } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Avatar, clock, duration, fileSize, MiniMap, nameOf, previewText } from "./bits";
import { Icon } from "./icons";

// نحوّل الروابط في النص إلى روابط قابلة للضغط
const urlRe = /(https?:\/\/[^\s]+)/g;
export function RichText({ text }: { text: string }) {
  const parts = text.split(urlRe);
  return (
    <p className="whitespace-pre-wrap break-words leading-7" dir="auto">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2" dir="ltr">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

export function Ticks({ m }: { m: Message }) {
  const t = useT();
  return (
    <span className="inline-flex" style={{ color: m.status === "read" ? "var(--tick-read)" : undefined }} aria-label={t(m.status === "read" ? "مقروءة" : m.status === "delivered" ? "وصلت" : "أُرسلت")}>
      <Icon name={m.status === "sent" ? "check" : "checks"} size={14} strokeWidth={2.4} />
    </span>
  );
}

// ------------------------------------------------------------ مشغل الرسالة الصوتية
function bars(seed: number, n = 34) {
  // موجة ثابتة لكل رسالة (المعرّف نفسه = الشكل نفسه)
  let x = seed * 9301 + 49297;
  return Array.from({ length: n }, () => {
    x = (x * 9301 + 49297) % 233280;
    return 0.25 + (x / 233280) * 0.75;
  });
}

/** كما في التصميم: ▶ ، المدة، الموجة، وصورة المرسل */
export function VoicePlayer({ m }: { m: Message }) {
  const t = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const heights = bars(m.id);
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const tick = () => {
      const total = m.duration || a.duration || 1;
      setElapsed(a.currentTime);
      setProgress(Math.min(1, a.currentTime / total));
    };
    const end = () => { setPlaying(false); setProgress(0); setElapsed(0); };
    a.addEventListener("timeupdate", tick);
    a.addEventListener("ended", end);
    return () => { a.removeEventListener("timeupdate", tick); a.removeEventListener("ended", end); };
  }, [m.duration]);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); } else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };
  return (
    <div className="flex min-w-[230px] items-center gap-2.5 py-0.5" dir="ltr">
      <button onClick={toggle} aria-label={t(playing ? "إيقاف" : "تشغيل")} className="w-accent-text grid h-9 w-7 shrink-0 place-items-center">
        <Icon name={playing ? "pause" : "play"} size={20} filled />
      </button>
      <span className="w-9 shrink-0 text-[12px]">{duration(playing || elapsed ? elapsed : m.duration)}</span>
      <div className="flex h-7 flex-1 items-center gap-[2px]">
        {heights.map((h, i) => (
          <span key={i} className="w-[2.5px] rounded-full transition-colors"
            style={{ height: `${h * 100}%`, background: i / heights.length <= progress ? "var(--accent)" : "var(--muted)", opacity: i / heights.length <= progress ? 1 : 0.55 }} />
        ))}
      </div>
      <Avatar user={m.sender} size={38} />
      <audio ref={audio} src={mediaUrl(m.file_url) ?? undefined} preload="none" />
    </div>
  );
}

// ------------------------------------------------------------ محتوى الرسالة حسب نوعها
/** صور رفعتُها من هذا الجهاز: نعرض النسخة المحلية حتى لا تختفي الصورة لحظة وصول نسخة الخادم */
export const localPreviews = new Map<number, string>();

/** حالة رسالة ما زالت تُرفع (عند المرسل فقط) */
export type UploadState = { progress: number; failed: boolean; onCancel: () => void; onRetry: () => void };

/** حجم مكان الصورة أو الفيديو: عرض ثابت، والارتفاع من أبعاد الملف (مع حدود معقولة للصور الطويلة جداً أو العريضة جداً) */
function boxStyle(w?: number | null, h?: number | null): React.CSSProperties {
  const ratio = w && h ? Math.min(1.9, Math.max(0.75, w / h)) : 4 / 3;
  return { width: 264, maxWidth: "100%", aspectRatio: String(ratio) };
}

function Spinner({ size = 34 }: { size?: number }) {
  return <span className="block animate-spin rounded-full border-[3px] border-white/35 border-t-white" style={{ width: size, height: size }} />;
}

/** دائرة التقدّم فوق الصورة أو الفيديو: ✕ يلغي الرفع، وعند الفشل زر «إعادة المحاولة» */
function UploadOverlay({ up }: { up: UploadState }) {
  const t = useT();
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/35" onClick={(e) => e.stopPropagation()}>
      {up.failed ? (
        <button type="button" onClick={up.onRetry} className="flex items-center gap-2 rounded-full bg-black/65 px-4 py-2.5 text-sm font-bold text-white">
          <Icon name="retry" size={18} strokeWidth={2.4} />{t("إعادة المحاولة")}
        </button>
      ) : (
        <button type="button" onClick={up.onCancel} aria-label={t("إلغاء الإرسال")} className="relative grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white">
          <svg viewBox="0 0 52 52" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="3" />
            <circle cx="26" cy="26" r={r} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, up.progress))} className="transition-[stroke-dashoffset] duration-200" />
          </svg>
          <Icon name="x" size={20} strokeWidth={2.6} />
        </button>
      )}
    </div>
  );
}

/** شريط التقدّم تحت الملف أو الرسالة الصوتية أثناء الرفع */
function UploadBar({ up }: { up: UploadState }) {
  const t = useT();
  return (
    <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {up.failed ? (
        <button type="button" onClick={up.onRetry} className="w-accent-text flex items-center gap-1.5 text-xs font-bold">
          <Icon name="retry" size={15} strokeWidth={2.4} />{t("إعادة المحاولة")}
        </button>
      ) : (
        <>
          <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--muted) 30%, transparent)" }}>
            <span className="block h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.max(4, up.progress * 100)}%`, background: "var(--accent)" }} />
          </span>
          <button type="button" onClick={up.onCancel} aria-label={t("إلغاء الإرسال")} className="w-muted"><Icon name="x" size={15} /></button>
        </>
      )}
    </div>
  );
}

/**
 * الصورة في الرسالة: مكانها محجوز بقياسها الصحيح منذ البداية، وفوقه مؤشر تحميل حتى تكتمل
 * (فلا يرى المستقبل «رسالة فارغة»). الضغط يفتح العارض، ولا يفتح قائمة الرسالة.
 */
function ImageThumb({ m, onOpen, up }: { m: Message; onOpen: (url: string) => void; up?: UploadState }) {
  const t = useT();
  const src = localPreviews.get(m.id) ?? mediaUrl(m.file_url) ?? "";
  // النسخة المحلية (blob:) جاهزة فوراً، فلا ننتظر تحميلها
  const [loaded, setLoaded] = useState(src.startsWith("blob:"));
  const [broken, setBroken] = useState(false);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); if (up) return; if (broken) { setBroken(false); setAttempt((a) => a + 1); } else if (loaded) onOpen(src); }}
      className="relative block overflow-hidden rounded-[16px]" aria-label={t("عرض الصورة")}
      style={{ ...boxStyle(m.width ?? natural?.[0], m.height ?? natural?.[1]), background: "color-mix(in srgb, var(--muted) 22%, transparent)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- صورة مرفوعة من الباك اند */}
      <img key={attempt} src={src} alt={m.content || t("صورة")} draggable={false}
        onLoad={(e) => { setLoaded(true); setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight]); }}
        onError={() => setBroken(true)}
        className={`h-full w-full select-none object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`} style={{ WebkitTouchCallout: "none" }} />
      {!loaded && !broken && !up && <span className="absolute inset-0 grid place-items-center"><Spinner /></span>}
      {broken && (
        <span className="w-muted absolute inset-0 grid place-content-center justify-items-center gap-1.5 text-xs font-semibold">
          <Icon name="retry" size={22} />{t("تعذّر تحميل الصورة. اضغط لإعادة المحاولة")}
        </span>
      )}
      {up && <UploadOverlay up={up} />}
    </button>
  );
}

function VideoThumb({ m, up }: { m: Message; up?: UploadState }) {
  const [ready, setReady] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-[16px] bg-black" style={boxStyle(m.width, m.height)} onClick={up ? (e) => e.stopPropagation() : undefined}>
      <video src={localPreviews.get(m.id) ?? mediaUrl(m.file_url) ?? undefined} controls={!up} preload="metadata" playsInline
        onLoadedData={() => setReady(true)} className="h-full w-full object-contain" />
      {!ready && !up && <span className="pointer-events-none absolute inset-0 grid place-items-center"><Spinner /></span>}
      {up && <UploadOverlay up={up} />}
    </div>
  );
}

export function MessageBody({ m, mine, onImage, onStopLive, sharingLive, upload }: {
  m: Message; mine: boolean; onImage: (url: string) => void; onStopLive?: () => void; sharingLive?: boolean; upload?: UploadState;
}) {
  const t = useT();
  if (m.is_deleted) {
    return <p className="flex items-center gap-1.5 italic opacity-70"><Icon name="x" size={14} /> {t("حُذفت هذه الرسالة")}</p>;
  }
  const url = mediaUrl(m.file_url);
  switch (m.kind) {
    case "image":
      return (
        <div className="-mx-1.5 -mt-1">
          <ImageThumb m={m} onOpen={onImage} up={upload} />
          {m.content && <div className="px-1.5 pt-2"><RichText text={m.content} /></div>}
        </div>
      );
    case "video":
      return (
        <div className="-mx-1.5 -mt-1">
          <VideoThumb m={m} up={upload} />
          {m.content && <div className="px-1.5 pt-2"><RichText text={m.content} /></div>}
        </div>
      );
    case "voice":
      return <><VoicePlayer m={m} />{upload && <UploadBar up={upload} />}</>;
    case "file":
      return (
        <>
        <a href={upload ? undefined : url ?? "#"} download={m.file_name} onClick={(e) => e.stopPropagation()} className="flex min-w-[210px] items-center gap-3 py-1" dir="ltr" aria-label={t("تنزيل {name}", { name: m.file_name })}>
          <span className="w-accent grid h-12 w-12 shrink-0 place-items-center rounded-[14px]"><Icon name="fileText" size={24} /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[15px] font-bold" dir="auto">{m.file_name}</span>
            <span className="w-muted text-xs">{[fileSize(m.file_size), m.file_name.split(".").pop()?.toUpperCase()].filter(Boolean).join(" • ")}</span>
          </span>
        </a>
        {upload && <UploadBar up={upload} />}
        </>
      );
    case "location": {
      const lat = m.latitude ?? 0, lng = m.longitude ?? 0;
      return (
        <div className="-mx-1.5 -mt-1 w-[260px] max-w-full">
          <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`} target="_blank" rel="noreferrer"
            className="block overflow-hidden rounded-[16px]">
            <MiniMap lat={lat} lng={lng} height={140} />
          </a>
          <div className="flex items-center gap-2 px-1.5 pt-2">
            <Icon name={m.is_live ? "navigation" : "pin"} size={16} />
            <span className="flex-1 text-sm font-bold">
              {m.is_live ? t("الموقع المباشر • حتى {time}", { time: clock(m.live_until!) }) : t(m.live_until ? "انتهت المشاركة المباشرة" : "الموقع الحالي")}
            </span>
          </div>
          {m.content && <div className="px-1.5 pt-1"><RichText text={m.content} /></div>}
          {mine && m.is_live && onStopLive && (
            <button onClick={onStopLive} className="w-tint mx-1.5 mt-2 w-[calc(100%-12px)] rounded-full py-1.5 text-xs font-bold">
              {t(sharingLive ? "إيقاف المشاركة" : "إيقاف (المشاركة من جهاز آخر)")}
            </button>
          )}
        </div>
      );
    }
    default:
      return <RichText text={m.content} />;
  }
}

export function ReplyQuote({ r, onClick }: { r: NonNullable<Message["reply_to"]>; mine?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="mb-1.5 block w-full rounded-xl border-s-4 px-2.5 py-1.5 text-start text-xs"
      style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 9%, transparent)" }}>
      <span className="w-accent-text block font-bold" dir="auto">{r.sender_name}</span>
      <span className="line-clamp-1 opacity-80" dir="auto">{previewText(r.preview)}</span>
    </button>
  );
}

export function SenderName({ m }: { m: Message }) {
  return <span className="w-accent-text mb-0.5 block text-xs font-extrabold" dir="auto">{nameOf(m.sender)}</span>;
}
