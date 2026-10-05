// WebSocket: اتصال يبقى مفتوح، السيرفر يكدر يدزلنا رسائل بدون ما نطلب (بدون Refresh)
import { getToken, wsBase, type Call, type Message } from "./api";

// كل الأحداث اللي ممكن السيرفر يدزها
// (بالتفصيل بـ docs/API.md)
export type ChatEvent =
  // على اتصال المحادثة /ws/chat/<id>/
  | { type: "message"; message: Message } // رسالة جديدة
  | { type: "message_updated"; message: Message } // تعدلت، انحذفت، أو الموقع المباشر تحرك
  | { type: "read"; reader_id: number; message_id: number } // ✓✓ أزرق
  | { type: "delivered"; user_id: number; message_id: number } // ✓✓ رمادي
  | { type: "typing"; user_id: number; name?: string }
  | { type: "error"; detail: "rate_limited" | "not_allowed" | "slow_mode"; message?: string; client_id?: string } // حدّ السرعة، أو مجموعة للمشرفين، أو الوضع البطيء
  | { type: "message_removed"; message_id: number } // رسالة مختفية انتهت مدتها
  | { type: "pinned"; conversation_id: number } // تغيّرت الرسالة المثبّتة
  // على الاتصال العام /ws/presence/
  | { type: "inbox"; message: Message } // أي رسالة بأي محادثة (حدّث القائمة)
  | { type: "presence"; user_id: number; is_online: boolean }
  | { type: "conversation_updated"; conversation_id: number } // اسم/صورة/أعضاء المجموعة
  | { type: "story"; user_id: number } // حالة جديدة
  | { type: "story_viewed"; story_id: number; viewer_id: number }
  | { type: "call_incoming"; call: Call }
  | { type: "call_answered"; call_id: number; user_id: number }
  | { type: "call_left"; call_id: number; user_id: number } // غادر أحدهم المكالمة الجماعية
  | { type: "call_invited"; call_id: number; user_ids: number[] } // أُضيف أشخاص إلى المكالمة: صارت جماعية
  | { type: "call_invite_declined"; call_id: number; user_id: number } // رفض أحدهم الدعوة
  | { type: "scheduled_changed"; conversation_id: number } // أُرسلت رسالة مجدولة (أو تعذّر إرسالها)
  | { type: "call_ended"; call_id: number; status: Call["status"] }
  | { type: "call_video"; call_id: number; user_id: number } // الطرف الآخر حوّل المكالمة إلى فيديو
  | { type: "call.signal"; call_id: number; from: number; data: CallSignal };

export type CallSignal =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit }
  /** كل طرف يعلن متى تعمل كاميرته أو شاشته أو مايكه (لا نعتمد على حدث mute/unmute للمسار: سفاري لا يرسله بانتظام) */
  | { media: MediaState }
  /** أحداث داخل المكالمة (مثل Google Meet): تمرّ بين المشاركين مباشرة ولا تُحفظ */
  | { meet: MeetEvent };

/** audio: المايك يعمل (غائب في الإصدارات الأقدم من التطبيق = يعمل) */
export type MediaState = { video: boolean; screen: boolean; audio?: boolean };

export type MeetEvent =
  | { type: "chat"; id: string; text: string } // رسالة في دردشة المكالمة
  | { type: "react"; emoji: string } // تفاعل سريع يطفو على الشاشة
  | { type: "hand"; up: boolean }; // رفع اليد أو إنزالها

export type SocketStatus = "connecting" | "open" | "closed";

export type LiveSocket = {
  send: (data: object) => boolean;
  close: () => void;
};

/**
 * يفتح WebSocket ويرجع يتصل وحده إذا انقطع (الإنترنت طفى، السيرفر رجع اشتغل...).
 * onOpen تنادى بكل مرة يرجع الاتصال، حتى نجيب اللي فاتنا بـ HTTP.
 *
 * النبض: الهاتف قد «يقتل» الاتصال بصمت (الآيفون يجمّد التطبيق في الخلفية، أو تتبدّل الشبكة) فيبقى المتصفح يظنه مفتوحاً
 * ولا يصل شيء: لا رسائل ولا مكالمات. لذلك نرسل {"type":"ping"} كل PING_EVERY، وإن لم يصل أي شيء خلال PONG_WAIT
 * نغلقه ونتصل من جديد فوراً. وعند العودة إلى التطبيق (أو عودة الإنترنت) نفحصه في الحال بدل انتظار النبض التالي.
 * إعادة المحاولة سريعة في البداية (نصف ثانية، ثم 1، 2، 4) ولا تتجاوز 8 ثوانٍ، مع تفاوت عشوائي حتى لا تعود آلاف
 * الأجهزة في اللحظة نفسها بعد إعادة تشغيل الخادم.
 */
const PING_EVERY = 15000;
const PONG_WAIT = 6000;
const QUICK_CHECK = 3500;

export function openSocket(
  path: string,
  onEvent: (data: ChatEvent) => void,
  opts: { onStatus?: (s: SocketStatus) => void; onOpen?: (reconnected: boolean) => void } = {},
): LiveSocket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let everOpened = false;

  // أي شيء يصل من الخادم دليل على أن الاتصال حيّ
  const alive = () => clearTimeout(deadline);
  // نرسل نبضاً، وإن لم يصل شيء خلال wait فالاتصال ميت: نغلقه فيتصل من جديد (onclose)
  const probe = (wait: number) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      /* سيُغلق وحده */
    }
    clearTimeout(deadline);
    const current = ws;
    deadline = setTimeout(() => {
      if (current === ws && current.readyState === WebSocket.OPEN) reconnectNow();
    }, wait);
  };
  const reconnectNow = () => {
    if (stopped) return;
    clearTimeout(timer);
    clearTimeout(deadline);
    clearInterval(beat);
    const old = ws;
    ws = null;
    attempt = 0;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {
        /* مغلق أصلاً */
      }
    }
    connect();
  };

  const connect = () => {
    opts.onStatus?.("connecting");
    const socket = new WebSocket(`${wsBase()}${path}?token=${getToken()}`);
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      opts.onStatus?.("open");
      opts.onOpen?.(everOpened);
      everOpened = true;
      clearInterval(beat);
      beat = setInterval(() => probe(PONG_WAIT), PING_EVERY);
    };
    socket.onmessage = (e) => {
      alive();
      const data = JSON.parse(e.data);
      if (data.type !== "pong") onEvent(data);
    };
    socket.onclose = (e) => {
      if (stopped || socket !== ws) return;
      clearInterval(beat);
      clearTimeout(deadline);
      // 4401/4403 = السيرفر رفضنا (Token غلط أو مو مشارك). إعادة المحاولة ما تفيد
      if (e.code === 4401 || e.code === 4403) {
        opts.onStatus?.("closed");
        return;
      }
      opts.onStatus?.("connecting");
      const delay = Math.min(8000, 500 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
      timer = setTimeout(connect, delay);
    };
  };

  // عاد المستخدم إلى التطبيق، أو رجع الإنترنت: نفحص الاتصال الآن (أو نتصل فوراً إن كان مغلقاً)
  const wake = () => {
    if (stopped || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) reconnectNow();
    else if (ws.readyState === WebSocket.OPEN) probe(QUICK_CHECK);
  };
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  document.addEventListener("visibilitychange", wake);
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
      clearTimeout(deadline);
      clearInterval(beat);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
      ws?.close();
    },
  };
}
