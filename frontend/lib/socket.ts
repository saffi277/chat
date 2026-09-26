// WebSocket: اتصال يبقى مفتوح، السيرفر يكدر يدزلنا رسائل بدون ما نطلب (بدون Refresh)
import { getToken, WS_URL, type Message } from "./api";

// كل الأحداث اللي ممكن السيرفر يدزها
export type ChatEvent =
  | { type: "message"; message: Message }
  | { type: "inbox"; message: Message }
  | { type: "read"; reader_id: number }
  | { type: "typing"; user_id: number }
  | { type: "presence"; user_id: number; is_online: boolean };

export function openSocket(path: string, onEvent: (data: ChatEvent) => void) {
  const ws = new WebSocket(`${WS_URL}${path}?token=${getToken()}`);
  ws.onmessage = (e) => onEvent(JSON.parse(e.data));
  return ws;
}
