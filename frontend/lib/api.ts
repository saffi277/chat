// كل الاتصال بالـ Backend يمر من هنا: Request → API → Response (JSON)
import { getLang, t, type Lang } from "./i18n";
/**
 * عنوان السيرفر:
 *  - إذا محدد NEXT_PUBLIC_API_URL نستخدمه.
 *  - التطوير (الواجهة على 3000): نفس الجهاز على 8000، حتى لو فاتح من الموبايل بالـ IP (192.168.x.x:3000).
 *  - الإنتاج/الرابط المؤقت (خلف Caddy): نفس العنوان اللي فاتحه، والبروكسي يوصل /api و /ws للباك اند.
 */
export function apiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://localhost:8000";
  const { protocol, hostname, port, origin } = window.location;
  return port === "3000" ? `${protocol}//${hostname}:8000` : origin;
}
/** نفس عنوان السيرفر بس ws:// أو wss:// (https ← wss تلقائياً) */
export function wsBase() {
  return apiBase().replace(/^http/, "ws");
}

export type User = {
  id: number;
  username: string;
  display_name: string;
  avatar: string | null; // مسار مثل /media/avatars/x.png (استخدم mediaUrl)
  bio: string;
  phone: string;
  city: string;
  is_online: boolean;
  last_seen: string | null;
  date_joined: string;
  role: Role;
  /** ضمن جهات اتصالي؟ (يصل من قوائم الناس وملف الشخص فقط) */
  is_contact?: boolean;
};

/** الدور بالجامعة */
export type Role = "student" | "faculty" | "staff";
/** النشر في القنوات وإنشاؤها: للتدريسيين والإداريين */
export const canBroadcast = (u: Pick<User, "role">) => u.role === "faculty" || u.role === "staff";
/** اسم الدور بالعربية (مرّره إلى t() للعرض بلغة المستخدم) */
export const ROLE_LABELS: Record<Role, string> = { student: "طالب", faculty: "تدريسي", staff: "إداري" };

/** الوضع: نهاري / ليلي / تلقائي (حسب الجهاز). مو ثيم */
export type Mode = "light" | "dark" | "system";
/** الثيم = لون التطبيق (مستقل عن النهاري والليلي) */
export type Theme = "default" | "green" | "blue" | "pink" | "orange" | "grey";
export const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: "default", label: "البنفسجي", color: "#6c5ce7" },
  { id: "green", label: "الأخضر", color: "#0f9d6b" },
  { id: "blue", label: "الأزرق", color: "#2f6fed" },
  { id: "pink", label: "الوردي", color: "#e0457b" },
  { id: "orange", label: "البرتقالي", color: "#ea7a1f" },
  { id: "grey", label: "الرمادي", color: "#5b6477" },
];
/** خلفية المحادثات (عامة في الإعدادات، أو خاصة بمحادثة) */
export type Wallpaper = "doodles" | "plain" | "gradient" | "dots" | "campus" | "none";
export const WALLPAPERS: { id: Wallpaper; label: string }[] = [
  { id: "doodles", label: "الزخارف" },
  { id: "plain", label: "سادة" },
  { id: "gradient", label: "متدرّجة" },
  { id: "dots", label: "نقاط" },
  { id: "campus", label: "صورة الكلية" },
  { id: "none", label: "بلا خلفية" },
];
/** أنا: نفس User + إعداداتي الخاصة */
export type Audience = "everyone" | "contacts" | "nobody";
export type Me = User & {
  mode: Mode; theme: Theme; wallpaper: Wallpaper; language: Lang; email: string; university_id: string; hide_preview: boolean;
  /** دور طلبه عند التسجيل ولم تعتمده الإدارة بعد ("" = لا طلب) */
  requested_role: Role | "";
  privacy_last_seen: Audience; privacy_photo: Audience; read_receipts: boolean;
  two_step: boolean; two_step_hint: string;
  /** مدير النظام: تظهر له «لوحة الإدارة» في الإعدادات */
  is_admin?: boolean;
};
/** لوحة الإدارة: حساب كما يراه المدير (ومعه البريد والرقم الجامعي) */
export type ManagedPerson = { id: number; username: string; display_name: string; university_id: string; email: string;
  role: Role; requested_role: Role | ""; joined: string };
export type ManageOverview = {
  stats: { users: number; online: number };
  role_requests: ManagedPerson[];
  reports: { id: number; reason: "spam" | "abuse" | "harassment" | "other"; user: ManagedPerson | null; reporter: ManagedPerson | null; message_text: string; details: string; created_at: string }[];
  support: { id: number; kind: "password" | "support"; identifier: string; contact: string; message: string; user: ManagedPerson | null; created_at: string }[];
};
/** جهاز متصل بالحساب */
export type Session = { id: number; device: string; user_agent: string; created: string; last_used: string; current: boolean };

export type MessageKind = "text" | "image" | "video" | "voice" | "file" | "location" | "system" | "call" | "poll";

/** استطلاع: السؤال هو نص الرسالة (content) */
export type Poll = { multiple: boolean; total_voters: number; options: { id: number; text: string; votes: number; voter_ids: number[] }[] };
/** معاينة رابط (يجلبها الخادم بأمان) */
export type LinkPreview = { url: string; title: string; description: string; image: string; site: string };
/** نتيجة بحث في الرسائل */
export type SearchHit = { message: Message; conversation: { id: number; kind: ConversationKind; title: string } };
/** sent = ✓ ، delivered = ✓✓ رمادي ، read = ✓✓ أزرق */
export type MessageStatus = "sent" | "delivered" | "read";

/** تفاعل: الإيموجي، كم واحد، ومنو (حتى نعرف إذا أني تفاعلت) */
export type Reaction = { emoji: string; count: number; user_ids: number[] };

export type ReplyPreview = { id: number; kind: MessageKind; sender_id: number; sender_name: string; preview: string };

export type Message = {
  id: number;
  conversation: number;
  sender: User;
  kind: MessageKind;
  content: string; // النص، أو تعليق على الصورة/الملف
  file_url: string | null;
  file_name: string;
  file_size: number | null;
  duration: number | null; // ثواني (صوت/فيديو)
  /** أبعاد الصورة أو الفيديو (إن عُرفت): نحجز مكانها بالقياس الصحيح قبل أن تكتمل */
  width?: number | null;
  height?: number | null;
  latitude: number | null;
  longitude: number | null;
  live_until: string | null;
  is_live: boolean;
  reply_to: ReplyPreview | null;
  created_at: string;
  edited_at: string | null;
  /** الرسائل المختفية: وقت حذفها */
  expires_at?: string | null;
  is_deleted: boolean;
  status: MessageStatus;
  is_read: boolean;
  reactions: Reaction[];
  /** أُعيد توجيهها من محادثة أخرى */
  forwarded?: boolean;
  /** معرّف وضعه جهاز المرسل: تظهر الرسالة عنده فوراً «قيد الإرسال» ثم تُطابق بما يصل من الخادم */
  client_id?: string;
  poll?: Poll | null;
  /** مشاهدات منشور القناة (للمشرف فقط) */
  views?: number;
};

/** channel = قناة: ينشر فيها مشرفوها (تدريسيون وإداريون) ويقرأ المشتركون */
export type ConversationKind = "direct" | "group" | "saved" | "channel";

export type Conversation = {
  id: number;
  kind: ConversationKind;
  title: string; // للمجموعة و"الرسائل المحفوظة". للثنائية فارغ: اعرض اسم الطرف الثاني
  description: string;
  avatar: string | null;
  participants: User[];
  member_count: number;
  my_role: "admin" | "member" | null;
  is_favorite: boolean;
  is_muted: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  last_message: Message | null;
  unread_count: number;
  created_at: string;
  /** الكتم لمدة: حتى متى (null = دائم أو غير مكتومة) */
  muted_until: string | null;
  /** خلفية هذه المحادثة عندي ("" = خلفية الثيم) */
  wallpaper: Wallpaper | "";
  /** الرسائل المختفية بعد كم ثانية (0 = لا) */
  disappear_after: number;
  only_admins_post: boolean;
  only_admins_edit: boolean;
  /** الوضع البطيء: ثوانٍ بين رسالتين لغير المشرف */
  slow_mode: number;
  /** أستطيع الإرسال؟ (القناة ومجموعة «للمشرفين فقط») */
  can_post: boolean;
  can_edit_info: boolean;
  /** رابط الدعوة (للمشرف، في صفحة المحادثة فقط) */
  invite_code?: string | null;
  /** الرسالة المثبّتة أعلى المحادثة */
  pinned_message?: { id: number; kind: MessageKind; sender_name: string; preview: string } | null;
};

/** رسالة مجدولة (نص) */
export type ScheduledMessage = {
  id: number; conversation: number; content: string; send_at: string; silent: boolean;
  status: "pending" | "sending" | "failed"; error: string; reply_to: number | null; created_at: string;
};
/** معاينة مجموعة من رابط دعوة */
export type InvitePreview = { id: number; title: string; description: string; avatar: string | null; member_count: number; is_member: boolean };

export type Member = { user: User; role: "admin" | "member"; joined_at: string };

/** قناة في دليل القنوات */
export type ChannelInfo = { id: number; kind: "channel"; title: string; description: string; avatar: string | null; member_count: number; is_subscribed: boolean };

export type StoryItem = {
  id: number;
  kind: "image" | "video" | "text";
  file_url: string | null;
  text: string;
  background: string;
  duration: number | null;
  created_at: string;
  expires_at: string;
  views_count: number;
  seen: boolean;
};
export type StoryGroup = { user: User; is_me: boolean; all_seen: boolean; stories: StoryItem[] };

export type CallKind = "audio" | "video";
export type Call = {
  id: number;
  conversation: number;
  conversation_kind: ConversationKind;
  title: string;
  caller: User;
  peer: User | null;
  kind: CallKind;
  status: "ringing" | "ongoing" | "ended" | "missed" | "declined";
  direction: "outgoing" | "incoming" | "missed";
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration: number | null;
  /** من في المكالمة الآن (المجموعة) */
  participants?: number[];
  /** بين أكثر من شخصين (مجموعة، أو ثنائية أُضيف إليها أحد): يتصل كل مشارك بالجميع */
  multi?: boolean;
  /** دُعيتُ إليها أثناءها (لستُ عضواً في محادثتها): من دعاني */
  invited_by?: User | null;
  ice_servers?: RTCIceServer[];
};

/**
 * وين نحفظ الدخول: "تذكرني" = localStorage (يبقى حتى لو سديت المتصفح)،
 * وبدونها sessionStorage (ينمسح لما تسد المتصفح).
 */
function sessionStore(): Storage {
  return sessionStorage.getItem("token") ? sessionStorage : localStorage;
}

export function getToken() {
  return typeof window === "undefined" ? null : sessionStore().getItem("token");
}

export function saveSession(token: string, user: User, remember = true) {
  logout();
  const store = remember ? localStorage : sessionStorage;
  store.setItem("token", token);
  store.setItem("user", JSON.stringify(user));
}

// الصور تنخدم من سيرفر الـ Backend، فنضيف عنوانه على المسار
export function mediaUrl(path: string | null) {
  if (!path) return null;
  // blob: = معاينة محلية لملف ما زال يُرفع
  return /^(https?:|blob:)/.test(path) ? path : `${apiBase()}${path}`;
}

export function saveMe(user: User) {
  sessionStore().setItem("user", JSON.stringify(user));
}

export function getMe(): User | null {
  const raw = typeof window === "undefined" ? null : sessionStore().getItem("user");
  return raw ? (JSON.parse(raw) as User) : null;
}

export function logout() {
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem("token");
    store.removeItem("user");
  }
}

export class ApiError extends Error {
  /** data: نص رد الخادم كاملاً (مثلاً مكالمة واردة مع 409 حين نتصل ببعض في اللحظة نفسها) */
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}
export class NetworkError extends Error {}

// دالة عامة: تدز Request وترجع الـ JSON، وترمي خطأ إذا الـ status مو 2xx
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api${path}`, {
    method,
    headers: {
      // FormData (رفع ملفات) المتصفح يحط نوعه بنفسه، والباقي JSON
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Token ${token}` } : {}),
      // رسائل الخطأ من الخادم تأتي بلغة المستخدم
      "Accept-Language": getLang(),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, // Object → نص JSON
    });
  } catch {
    // الطلب ما وصل أصلاً (السيرفر طافي، أو CORS رفضه). التفاصيل تطلع بـ Console (F12)
    throw new NetworkError(t("تعذّر الوصول إلى الخادم. تحقق من اتصالك بالإنترنت."));
  }
  const data = await res.json().catch(() => ({})); // نص JSON → Object
  if (!res.ok) throw errorOf(res.status, data);
  return data as T;
}

function errorOf(status: number, data: unknown) {
  const detail = (data as { detail?: string }).detail;
  return new ApiError(status, detail || Object.values(data as object).flat().join(" ") || t("خطأ {status}", { status }), data);
}

/**
 * رفع ملف مع نسبة التقدّم (0 إلى 1). نستعمل XMLHttpRequest لأن fetch لا يخبرنا كم رُفع.
 * signal: لإلغاء الرفع (زر ✕ على الرسالة).
 */
export function upload<T>(path: string, form: FormData, onProgress: (p: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Token ${token}`);
    xhr.setRequestHeader("Accept-Language", getLang());
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ليس JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(errorOf(xhr.status, data));
    };
    xhr.onerror = () => reject(new NetworkError(t("تعذّر الوصول إلى الخادم. تحقق من اتصالك بالإنترنت.")));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
