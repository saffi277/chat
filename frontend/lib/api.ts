// كل الاتصال بالـ Backend يمر من هنا: Request → API → Response (JSON)
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = API_URL.replace(/^http/, "ws");

export type User = {
  id: number;
  username: string;
  display_name: string;
  avatar: string | null; // مسار مثل /media/avatars/x.png
  is_online: boolean;
  last_seen: string | null;
  date_joined: string;
};
export type Message = {
  id: number;
  conversation: number;
  sender: User;
  content: string;
  created_at: string;
  is_read: boolean;
};
export type Conversation = {
  id: number;
  participants: User[];
  created_at: string;
  last_message: Message | null;
  unread_count: number;
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
