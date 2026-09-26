// كل الاتصال بالـ Backend يمر من هنا: Request → API → Response (JSON)
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = API_URL.replace(/^http/, "ws");

export type User = { id: number; username: string; is_online: boolean; last_seen: string | null };
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

export function getMe(): User | null {
  const raw = typeof window === "undefined" ? null : localStorage.getItem("user");
  return raw ? (JSON.parse(raw) as User) : null;
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

// دالة عامة: تدز Request وترجع الـ JSON، وترمي خطأ إذا الـ status مو 2xx
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined, // Object → نص JSON
  });
  const data = await res.json().catch(() => ({})); // نص JSON → Object
  if (!res.ok) {
    const detail = (data as { detail?: string }).detail;
    throw new Error(detail ?? Object.values(data).flat().join(" ") ?? `خطأ ${res.status}`);
  }
  return data as T;
}
