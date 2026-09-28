"use client";
// قطع صغيرة تتكرر في كل الشاشات
import { useEffect } from "react";
import { mediaUrl, type Conversation, type Message, type User } from "@/lib/api";
import { dateLocale, getLang, t, useT } from "@/lib/i18n";
import { Icon, type IconName } from "./icons";

export const nameOf = (u: Pick<User, "display_name" | "username">) => u.display_name || u.username;

// ------------------------------------------------------------ الوقت
const pad = (n: number) => String(n).padStart(2, "0");
/** 9:41 AM (أرقام إنجليزية كما في التصميم) */
export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
/** التاريخ بلغة المستخدم، بأرقام إنجليزية */
const arDate = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(dateLocale(getLang()), o);
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
/** وقت السطر في القائمة: 9:41 AM / أمس / الاثنين / 12/9 */
export function listTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return clock(iso);
  if (sameDay(d, y)) return t("أمس");
  if (now.getTime() - d.getTime() < 6 * 86400000) return arDate(d, { weekday: "long" });
  return arDate(d, { day: "numeric", month: "numeric" });
}
/** فاصل الأيام في المحادثة: اليوم / أمس / الاثنين 12 أيلول */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return t("اليوم");
  if (sameDay(d, y)) return t("أمس");
  return arDate(d, { weekday: "long", day: "numeric", month: "long" });
}
export function duration(sec: number | null | undefined) {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
export function lastSeenText(u: User) {
  if (u.is_online) return t("متصل الآن");
  if (!u.last_seen) return t("غير متصل");
  const d = new Date(u.last_seen);
  const now = new Date();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return t("آخر ظهور اليوم {time}", { time: clock(u.last_seen) });
  if (sameDay(d, y)) return t("آخر ظهور أمس {time}", { time: clock(u.last_seen) });
  return t("آخر ظهور {date}", { date: arDate(d, { day: "numeric", month: "numeric", year: "numeric" }) });
}
export function fileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ------------------------------------------------------------ نص مختصر للرسالة
export function preview(m: Message | null, meId?: number): { icon?: IconName; text: string } {
  if (!m) return { text: t("ابدأ محادثة جديدة") };
  if (m.is_deleted) return { text: `🚫 ${t("حُذفت هذه الرسالة")}` };
  switch (m.kind) {
    case "image": return { icon: "image", text: m.content || t("صورة") };
    case "video": return { icon: "video", text: m.content || t("فيديو") };
    case "voice": return { icon: "mic", text: t("رسالة صوتية {time}", { time: duration(m.duration) }) };
    case "file": return { icon: "file", text: m.file_name || t("ملف") };
    case "location": return { icon: "pin", text: t(m.is_live ? "الموقع المباشر" : "الموقع الحالي") };
    case "call": return { icon: "phone", text: systemText(m.content) };
    case "system": return { text: systemText(m.content) };
    default: return { text: (m.sender.id === meId ? t("أنت: ") : "") + m.content };
  }
}

/**
 * رسائل النظام والمكالمات تُحفظ في الخادم نصاً عربياً (مثل: علي أضاف زينب).
 * في الواجهة الإنجليزية نتعرف على شكلها ونترجمها، والأسماء تبقى كما هي.
 */
const SYSTEM_PATTERNS: [RegExp, string][] = [
  [/^(.+) أنشأ المجموعة "(.*)"$/, '{0} created the group "{1}"'],
  [/^(.+) غيّر اسم المجموعة إلى "(.*)"$/, '{0} renamed the group to "{1}"'],
  [/^(.+) أضاف (.+)$/, "{0} added {1}"],
  [/^(.+) أزال (.+)$/, "{0} removed {1}"],
  [/^(.+) غادر المجموعة$/, "{0} left the group"],
  [/^(.+) جعل (.+) مشرفاً$/, "{0} made {1} an admin"],
  [/^(.+) أصبح مشرفاً$/, "{0} is now an admin"],
  [/^مكالمة صوتية • (.+)$/, "Voice call • {0}"],
  [/^مكالمة فيديو • (.+)$/, "Video call • {0}"],
];
/** النص المختصر القادم من الخادم (مثل الرد على رسالة: "📷 صورة: تعليق") بلغة المستخدم */
const PREVIEW_PREFIXES = ["📷 صورة", "🎬 فيديو", "🎤 رسالة صوتية", "📎 ملف", "📍 موقع مباشر", "📍 موقع", "🚫 تم حذف هذه الرسالة"];
export function previewText(text: string) {
  if (getLang() !== "en") return text;
  const hit = PREVIEW_PREFIXES.find((p) => text.startsWith(p));
  if (hit) return t(hit) + text.slice(hit.length);
  return text.startsWith("📞 ") ? `📞 ${systemText(text.slice(3))}` : text;
}

export function systemText(text: string) {
  if (getLang() !== "en") return text;
  const direct = t(text);
  if (direct !== text) return direct; // نص ثابت (مثل: مكالمة صوتية فائتة)
  for (const [re, en] of SYSTEM_PATTERNS) {
    const m = text.match(re);
    if (m) return en.replace(/\{(\d)\}/g, (_, i) => m[Number(i) + 1]);
  }
  return text;
}

// ------------------------------------------------------------ الصورة الشخصية
const palette = ["#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#6366f1", "#06b6d4", "#ef4444"];
export function Avatar({ user, src, name, size = 48, online, ring, square }: {
  user?: User | null; src?: string | null; name?: string; size?: number; online?: boolean; ring?: boolean | "seen"; square?: boolean;
}) {
  const label = name ?? (user ? nameOf(user) : "?");
  const url = mediaUrl(src !== undefined ? src : user?.avatar ?? null);
  const color = palette[(user?.id ?? label.length) % palette.length];
  const radius = square ? "rounded-[30%]" : "rounded-full";
  const inner = (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden font-bold text-white ${radius}`}
      style={{ width: size, height: size, background: url ? undefined : `linear-gradient(135deg, ${color}, ${color}bb)`, fontSize: size * 0.36 }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- الصورة من سيرفر الباك اند
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        label.trim().slice(0, 1)
      )}
    </div>
  );
  return (
    <div className="relative shrink-0" style={{ width: size + (ring ? 6 : 0), height: size + (ring ? 6 : 0) }}>
      {ring ? (
        <div className={`grid h-full w-full place-items-center ${radius} ${ring === "seen" ? "" : "w-ring"}`}
          style={ring === "seen" ? { background: "var(--divider)" } : undefined}>
          <div className={`${radius} p-[2px]`} style={{ background: "var(--panel-strong)" }}>{inner}</div>
        </div>
      ) : inner}
      {online !== undefined && (
        <span className="absolute bottom-0 end-0 rounded-full border-2"
          style={{ width: size * 0.26, height: size * 0.26, background: online ? "var(--online)" : "#94a3b8", borderColor: "var(--panel-strong)" }} />
      )}
    </div>
  );
}

/** صورة المحادثة: مجموعة = صورتها، ثنائية = الطرف الآخر، محفوظة = علامة */
export function ConvAvatar({ conv, other, size = 52, online }: { conv: Conversation; other: User | null; size?: number; online?: boolean }) {
  if (conv.kind === "saved") {
    return <div className="w-tint grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size }}><Icon name="bookmark" size={size * 0.42} filled /></div>;
  }
  if (conv.kind === "group") {
    // مجموعة بلا صورة: دائرة بنفسجية فاتحة مع أيقونة أشخاص (كما في التصميم)
    if (!conv.avatar) return <div className="w-tint grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size }}><Icon name="users" size={size * 0.44} filled /></div>;
    return <Avatar src={conv.avatar} name={conv.title} size={size} user={null} />;
  }
  return <Avatar user={other} size={size} online={online} />;
}

// ------------------------------------------------------------ أزرار
/** plain: بلا خلفية (للترويسات)، والأيقونة بلون التطبيق */
export function IconButton({ icon, label, onClick, active, size = 40, className = "", plain }: {
  icon: IconName; label: string; onClick?: () => void; active?: boolean; size?: number; className?: string; plain?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={`grid shrink-0 place-items-center rounded-full transition active:scale-95 ${active ? "w-accent" : plain ? "w-hover" : "w-tint"} ${className}`}
      style={{ width: size, height: size }}>
      <Icon name={icon} size={size * 0.46} />
    </button>
  );
}

export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className="w-chip shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition">
      {label}
    </button>
  );
}

/** المفتاح: "مفعّل" = الدائرة على اليمين، في اللغتين (كما هو معتاد في الهواتف) */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "w-accent" : "w-card"}`}>
      <span className="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ right: on ? 4 : 24 }} />
    </button>
  );
}

// ------------------------------------------------------------ لوحة جانبية
/** في الهاتف تأخذ الشاشة كلها، وفي الحاسوب تظهر من الجانب */
/** bare: بلا عنوان مكتوب (زر الرجوع في البداية والأزرار في النهاية، مثل ملف جهة الاتصال) */
export function Panel({ title, onClose, children, actions, wide, bare }: {
  title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode; wide?: boolean; bare?: boolean;
}) {
  const tr = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-start bg-black/40 md:p-4" onClick={onClose}>
      <section role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full flex-col overflow-hidden md:rounded-3xl ${wide ? "md:w-[520px]" : "md:w-[430px]"}`}
        style={{ background: "var(--bg)", boxShadow: "var(--shadow)" }}>
        <header className="flex items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <IconButton icon="back" label={tr("رجوع")} onClick={onClose} plain size={38} />
          <h2 className={`flex-1 text-lg font-extrabold ${bare ? "sr-only" : ""}`}>{title}</h2>
          {bare && <span className="flex-1" />}
          {actions}
        </header>
        <div className="w-scroll flex-1 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    </div>
  );
}

export function Section({ title, extra, children }: { title?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-3 rounded-[22px] p-4" style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-extrabold">{title}</h3>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="m-auto max-w-xs px-6 py-10 text-center">
      <div className="w-card w-accent-text mx-auto grid h-20 w-20 place-items-center rounded-full"><Icon name={icon} size={34} /></div>
      <h3 className="mt-5 text-lg font-extrabold">{title}</h3>
      {text && <p className="w-muted mt-2 text-sm leading-7">{text}</p>}
      {children}
    </div>
  );
}

// ------------------------------------------------------------ خريطة صغيرة (بلاطات OpenStreetMap)
function tileOf(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}
/** خريطة بلا مكتبات: نجلب 3×3 صور من خرائط OpenStreetMap ونضع الدبوس في المنتصف */
export function MiniMap({ lat, lng, height = 150, zoom = 15, pin }: { lat: number; lng: number; height?: number; zoom?: number; pin?: React.ReactNode }) {
  const { x, y } = tileOf(lat, lng, zoom);
  const tx = Math.floor(x), ty = Math.floor(y);
  const fx = (x - tx) * 256, fy = (y - ty) * 256;
  const tiles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push({ dx, dy });
  return (
    <div className="w-map relative w-full overflow-hidden" style={{ height }} dir="ltr">
      <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(${-fx}px, ${-fy}px)` }}>
        {tiles.map(({ dx, dy }) => (
          // eslint-disable-next-line @next/next/no-img-element -- بلاطات خريطة خارجية
          <img key={`${dx},${dy}`} alt="" draggable={false} width={256} height={256}
            src={`https://tile.openstreetmap.org/${zoom}/${tx + dx}/${ty + dy}.png`}
            className="absolute max-w-none select-none" style={{ left: dx * 256, top: dy * 256 }}
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        ))}
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        {pin ?? <div className="w-accent grid h-9 w-9 place-items-center rounded-full"><Icon name="pin" size={18} /></div>}
      </div>
      <span className="absolute bottom-1 start-1 rounded bg-white/70 px-1 text-[9px] text-slate-600">© OpenStreetMap</span>
    </div>
  );
}
