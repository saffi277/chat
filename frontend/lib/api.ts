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
};

/** الدور بالجامعة */
export type Role = "student" | "faculty" | "staff";
/** اسم الدور بالعربية (مرّره إلى t() للعرض بلغة المستخدم) */
export const ROLE_LABELS: Record<Role, string> = { student: "طالب", faculty: "تدريسي", staff: "إداري" };

/** الوضع: نهاري / ليلي / تلقائي (حسب الجهاز). مو ثيم */
export type Mode = "light" | "dark" | "system";
/** الثيم = شكل التطبيق. هسه بس الأساسي، والثيمات الثانية تنضاف بعدين */
export type Theme = "default";
/** أنا: نفس User + إعداداتي الخاصة */
export type Me = User & { mode: Mode; theme: Theme; language: Lang; email: string; university_id: string; hide_preview: boolean };

export type MessageKind = "text" | "image" | "video" | "voice" | "file" | "location" | "system" | "call";
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
  latitude: number | null;
  longitude: number | null;
  live_until: string | null;
  is_live: boolean;
  reply_to: ReplyPreview | null;
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  status: MessageStatus;
  is_read: boolean;
  reactions: Reaction[];
};

export type ConversationKind = "direct" | "group" | "saved";

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
};

export type Member = { user: User; role: "admin" | "member"; joined_at: string };

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
  return /^https?:\/\//.test(path) ? path : `${apiBase()}${path}`;
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
  constructor(public status: number, message: string) {
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
  if (!res.ok) {
    const detail = (data as { detail?: string }).detail;
    throw new ApiError(res.status, detail || Object.values(data).flat().join(" ") || t("خطأ {status}", { status: res.status }));
  }
  return data as T;
}
