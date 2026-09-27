// WebSocket: اتصال يبقى مفتوح، السيرفر يكدر يدزلنا رسائل بدون ما نطلب (بدون Refresh)
import { getToken, WS_URL, type Message } from "./api";

// كل الأحداث اللي ممكن السيرفر يدزها
export type ChatEvent =
  | { type: "message"; message: Message }
  | { type: "inbox"; message: Message }
  | { type: "read"; reader_id: number }
  | { type: "typing"; user_id: number }
  | { type: "presence"; user_id: number; is_online: boolean };

export type SocketStatus = "connecting" | "open" | "closed";

export type LiveSocket = {
  send: (data: object) => boolean;
  close: () => void;
};

/**
 * يفتح WebSocket ويرجع يتصل وحده إذا انقطع (الإنترنت طفى، السيرفر رجع اشتغل...).
 * بين كل محاولة وثانية ننتظر أكثر: 1ث، 2ث، 4ث... لحد 30ث، حتى ما نضغط على السيرفر.
 * onOpen تنادى بكل مرة يرجع الاتصال، حتى نجيب اللي فاتنا بـ HTTP.
 */
export function openSocket(
  path: string,
  onEvent: (data: ChatEvent) => void,
  opts: { onStatus?: (s: SocketStatus) => void; onOpen?: (reconnected: boolean) => void } = {},
): LiveSocket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everOpened = false;

  const connect = () => {
    opts.onStatus?.("connecting");
    ws = new WebSocket(`${WS_URL}${path}?token=${getToken()}`);
    ws.onopen = () => {
      attempt = 0;
      opts.onStatus?.("open");
      opts.onOpen?.(everOpened);
      everOpened = true;
    };
    ws.onmessage = (e) => onEvent(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (stopped) return;
      // 4401/4403 = السيرفر رفضنا (Token غلط أو مو مشارك). إعادة المحاولة ما تفيد
      if (e.code === 4401 || e.code === 4403) {
        opts.onStatus?.("closed");
        return;
      }
      opts.onStatus?.("connecting");
      const delay = Math.min(30000, 1000 * 2 ** attempt++);
      timer = setTimeout(connect, delay);
    };
  };

  // لما النت يرجع ما ننتظر المؤقت، نتصل فوراً
  const onOnline = () => {
    if (ws?.readyState === WebSocket.CLOSED) {
      clearTimeout(timer);
      attempt = 0;
      connect();
    }
  };
  window.addEventListener("online", onOnline);
  connect();

  return {
    send(data) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(data));
      return true;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      ws?.close();
    },
  };
}
