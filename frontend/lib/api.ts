// كل الاتصال بالـ Backend يمر من هنا: Request → API → Response (JSON)
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = API_URL.replace(/^http/, "ws");

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
};

/** الوضع: نهاري / ليلي / تلقائي (حسب الجهاز). مو ثيم */
export type Mode = "light" | "dark" | "system";
/** الثيم = شكل التطبيق. هسه بس الأساسي، والثيمات الثانية تنضاف بعدين */
export type Theme = "default";
/** أنا: نفس User + إعداداتي الخاصة */
export type Me = User & { mode: Mode; theme: Theme };

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

export function getToken() {
  return typeof window === "undefined" ? null : localStorage.getItem("token");
}

export function saveSession(token: string, user: User) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

// الصور تنخدم من سيرفر الـ Backend، فنضيف عنوانه على المسار
export function mediaUrl(path: string | null) {
  return path ? `${API_URL}${path}` : null;
}

export function saveMe(user: User) {
  localStorage.setItem("user", JSON.stringify(user));
}

export function getMe(): User | null {
  const raw = typeof window === "undefined" ? null : localStorage.getItem("user");
  return raw ? (JSON.parse(raw) as User) : null;
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
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
    res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      // FormData (رفع ملفات) المتصفح يحط نوعه بنفسه، والباقي JSON
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, // Object → نص JSON
    });
  } catch {
    // الطلب ما وصل أصلاً (السيرفر طافي، أو CORS رفضه). التفاصيل تطلع بـ Console (F12)
    throw new NetworkError("ما كدرنا نوصل للسيرفر. تأكد إن الباك اند شغال.");
  }
  const data = await res.json().catch(() => ({})); // نص JSON → Object
  if (!res.ok) {
    const detail = (data as { detail?: string }).detail;
    throw new ApiError(res.status, detail || Object.values(data).flat().join(" ") || `خطأ ${res.status}`);
  }
  return data as T;
}
