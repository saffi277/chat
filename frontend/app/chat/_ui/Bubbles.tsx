"use client";
// شكل كل نوع رسالة: نص، صورة، فيديو، صوت، ملف، موقع
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type Message } from "@/lib/api";
import { Avatar, clock, duration, fileSize, MiniMap, nameOf } from "./bits";
import { Icon } from "./icons";

// نحول الروابط بالنص لروابط تنضغط
const urlRe = /(https?:\/\/[^\s]+)/g;
export function RichText({ text }: { text: string }) {
  const parts = text.split(urlRe);
  return (
    <p className="whitespace-pre-wrap break-words leading-7">
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
  return (
    <span className="inline-flex" style={{ color: m.status === "read" ? "var(--tick-read)" : undefined }} aria-label={m.status === "read" ? "مقروءة" : m.status === "delivered" ? "وصلت" : "مرسلة"}>
      <Icon name={m.status === "sent" ? "check" : "checks"} size={14} strokeWidth={2.4} />
    </span>
  );
}

// ------------------------------------------------------------ مشغل الرسالة الصوتية
function bars(seed: number, n = 34) {
  // موجة ثابتة لكل رسالة (نفس الـ id = نفس الشكل)
  let x = seed * 9301 + 49297;
  return Array.from({ length: n }, () => {
    x = (x * 9301 + 49297) % 233280;
    return 0.25 + (x / 233280) * 0.75;
  });
}

/** مثل التصميم: ▶ ، المدة، الموجة، وصورة المرسل */
export function VoicePlayer({ m }: { m: Message }) {
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
      <button onClick={toggle} aria-label={playing ? "إيقاف" : "تشغيل"} className="w-accent-text grid h-9 w-7 shrink-0 place-items-center">
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
export function MessageBody({ m, mine, onImage, onStopLive, sharingLive }: {
  m: Message; mine: boolean; onImage: (url: string) => void; onStopLive?: () => void; sharingLive?: boolean;
}) {
  if (m.is_deleted) {
    return <p className="flex items-center gap-1.5 italic opacity-70"><Icon name="x" size={14} /> تم حذف هذه الرسالة</p>;
  }
  const url = mediaUrl(m.file_url);
  switch (m.kind) {
    case "image":
      return (
        <div className="-mx-1.5 -mt-1">
          <button onClick={() => url && onImage(url)} className="block overflow-hidden rounded-[16px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- صورة مرفوعة من الباك اند */}
            <img src={url ?? ""} alt={m.content || "صورة"} className="max-h-80 w-full min-w-[220px] max-w-[300px] object-cover" loading="lazy" />
          </button>
          {m.content && <div className="px-1.5 pt-2"><RichText text={m.content} /></div>}
        </div>
      );
    case "video":
      return (
        <div className="-mx-1.5 -mt-1">
          <video src={url ?? undefined} controls preload="metadata" className="max-h-80 w-full min-w-[220px] max-w-[300px] rounded-[16px] bg-black" />
          {m.content && <div className="px-1.5 pt-2"><RichText text={m.content} /></div>}
        </div>
      );
    case "voice":
      return <VoicePlayer m={m} />;
    case "file":
      return (
        <a href={url ?? "#"} download={m.file_name} className="flex min-w-[210px] items-center gap-3 py-1" dir="ltr" aria-label={`تنزيل ${m.file_name}`}>
          <span className="w-accent grid h-12 w-12 shrink-0 place-items-center rounded-[14px]"><Icon name="fileText" size={24} /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[15px] font-bold" dir="auto">{m.file_name}</span>
            <span className="w-muted text-xs">{[fileSize(m.file_size), m.file_name.split(".").pop()?.toUpperCase()].filter(Boolean).join(" • ")}</span>
          </span>
        </a>
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
              {m.is_live ? `الموقع المباشر • حتى ${clock(m.live_until!)}` : m.live_until ? "انتهت المشاركة المباشرة" : "الموقع الحالي"}
            </span>
          </div>
          {m.content && <div className="px-1.5 pt-1"><RichText text={m.content} /></div>}
          {mine && m.is_live && onStopLive && (
            <button onClick={onStopLive} className="w-tint mx-1.5 mt-2 w-[calc(100%-12px)] rounded-full py-1.5 text-xs font-bold">
              {sharingLive ? "إيقاف المشاركة" : "إيقاف (المشاركة من جهاز ثاني)"}
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
      className="mb-1.5 block w-full rounded-xl border-r-4 px-2.5 py-1.5 text-right text-xs"
      style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 9%, transparent)" }}>
      <span className="w-accent-text block font-bold">{r.sender_name}</span>
      <span className="line-clamp-1 opacity-80">{r.preview}</span>
    </button>
  );
}

export function SenderName({ m }: { m: Message }) {
  return <span className="w-accent-text mb-0.5 block text-xs font-extrabold">{nameOf(m.sender)}</span>;
}
