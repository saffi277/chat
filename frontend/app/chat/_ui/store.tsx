"use client";
/**
 * "المخزن": مكان واحد يحفظ كل بيانات التطبيق (أنا، المحادثات، الناس، الحالات، المكالمة)
 * ويفتح الاتصال العام (presence) اللي يوصلنا منه كل شي مباشر.
 * كل شاشة تاخذ اللي تحتاجه بـ useWasl() بدل ما كل وحدة تجيب البيانات بنفسها.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, getToken, logout, saveMe, type Call, type CallKind, type Conversation, type Me, type Message, type StoryGroup, type User } from "@/lib/api";
import { CallSession, GroupCall, type GroupPeer } from "@/lib/call";
import { auth, calls, contacts as contactsApi, conversations as convApi, messages as msgApi, safety, stories as storyApi, users as usersApi } from "@/lib/endpoints";
import { setLang, t, useLang } from "@/lib/i18n";
import { isDeviceError, permError } from "@/lib/permissions";
import { syncPushSubscription } from "@/lib/push";
import { openSocket, type LiveSocket, type MediaState } from "@/lib/socket";

/** تبويبات الشريط السفلي (المحادثات/المكالمات/جهات الاتصال/الإعدادات) + الحالات (من الإعدادات) */
export type Tab = "chats" | "calls" | "people" | "settings" | "stories";

export type PanelState =
  | { type: "contact"; userId: number }
  | { type: "group"; convId: number }
  | { type: "media"; convId: number; tab?: "media" | "file" | "link" | "voice" }
  | { type: "starred"; convId?: number }
  | { type: "location"; convId: number }
  | { type: "newGroup" }
  | { type: "addContact" }
  | { type: "newChannel" }
  | { type: "channels" }
  | { type: "storyCompose" }
  | { type: "convSettings"; convId: number }
  | { type: "search"; convId: number }
  | null;

export type CallUI = {
  phase: "incoming" | "outgoing" | "connecting" | "active" | "ended";
  call: Call;
  peer: User | null;
  session: CallSession | null;
  local: MediaStream | null;
  remote: MediaStream | null;
  remoteVideo?: boolean; // يصل من الطرف الآخر فيديو فعلاً (قد تبدأ المكالمة صوتية ثم تتحول)
  remoteScreen?: boolean; // وهو شاشته (تُعرض كاملة دون قصّ)
  startedAt: number | null;
  muted: boolean;
  cameraOff: boolean;
  endedText?: string;
  /** المكالمة الجماعية: الجلسة ومن فيها */
  group?: GroupCall | null;
  peers?: GroupPeer[];
  /** أشارك شاشتي الآن */
  sharing?: boolean;
};

type Ctx = {
  me: Me;
  users: User[];
  /** جهات اتصالي (من أضفتهم أنا) */
  contacts: User[];
  isContact: (userId: number) => boolean;
  /** أُضيف أو أُزيل من جهات الاتصال (بعد نجاح الطلب) */
  contactAdded: (u: User) => void;
  contactRemoved: (userId: number) => void;
  /** من حظرتُهم */
  blocked: number[];
  isBlocked: (userId: number) => boolean;
  setBlocked: (userId: number, on: boolean) => Promise<void>;
  convs: Conversation[];
  stories: StoryGroup[];
  theme: "light" | "dark";
  tab: Tab;
  setTab: (t: Tab) => void;
  activeId: number | null;
  openConv: (id: number | null) => void;
  openWith: (userId: number) => Promise<void>;
  openSaved: () => Promise<void>;
  panel: PanelState;
  setPanel: (p: PanelState) => void;
  /** نافذة «كتم الإشعارات» (اختيار المدة) لمحادثة */
  muteDialog: number | null;
  setMuteDialog: (convId: number | null) => void;
  /** الانتقال إلى رسالة (من البحث أو الرسالة المثبّتة): تفتح المحادثة وتُبرز الرسالة */
  jump: { convId: number; messageId: number } | null;
  jumpTo: (convId: number, messageId: number) => void;
  clearJump: () => void;
  /** رابط دعوة فُتح به التطبيق: نعرض المجموعة ونسأل «انضمام؟» */
  joinCode: string | null;
  setJoinCode: (code: string | null) => void;
  storyViewer: { userId: number; index: number } | null;
  /** حلقة الحالة حول صورة الشخص: خضراء إن نشر حالة لم أشاهدها، ورمادية إن شاهدتها كلها */
  storyRing: (userId: number | undefined) => "story" | "seen" | undefined;
  /** يفتح حالات الشخص من أول حالة لم أشاهدها */
  openStory: (userId: number) => void;
  setStoryViewer: (v: { userId: number; index: number } | null) => void;
  userById: (id: number) => User | undefined;
  otherOf: (c: Conversation) => User | null;
  refreshConvs: () => Promise<void>;
  refreshStories: () => Promise<void>;
  updateMe: (m: Me) => void;
  signOut: () => void;
  // المكالمات
  call: CallUI | null;
  startCall: (conv: Conversation, kind: CallKind) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  enableVideo: () => void;
  /** مشاركة الشاشة أو إيقافها */
  toggleScreen: () => void;
  /** إضافة أشخاص إلى المكالمة الجارية (مثل واتساب) */
  inviteToCall: (userIds: number[]) => Promise<void>;
  /** الانضمام إلى مكالمة جماعية جارية */
  joinCall: (call: Call) => Promise<void>;
  // الموقع المباشر
  startLiveShare: (msg: Message) => void;
  stopLiveShare: (msgId: number) => Promise<void>;
  liveShares: number[];
  toast: string | null;
  notify: (text: string) => void;
};

const WaslContext = createContext<Ctx | null>(null);

/** خطأ المكالمة: إذا من المايك/الكاميرا نشرح شلون يسمح، وإلا رسالة السيرفر */
function callError(err: unknown, kind: CallKind) {
  return isDeviceError(err) ? permError(err, kind === "video" ? "camera" : "microphone") : (err as Error).message;
}

export function useWasl() {
  const ctx = useContext(WaslContext);
  if (!ctx) throw new Error("useWasl must be used inside WaslProvider");
  return ctx;
}

const darkQuery = "(prefers-color-scheme: dark)";
const subscribeDark = (cb: () => void) => {
  const mq = window.matchMedia(darkQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function WaslProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [contacts, setContacts] = useState<User[]>([]);
  const [blocked, setBlockedIds] = useState<number[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [tab, setTab] = useState<Tab>("chats");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [panel, setPanel] = useState<PanelState>(null);
  const [muteDialog, setMuteDialog] = useState<number | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [jump, setJump] = useState<{ convId: number; messageId: number } | null>(null);
  const [storyViewer, setStoryViewer] = useState<{ userId: number; index: number } | null>(null);
  const [call, setCall] = useState<CallUI | null>(null);
  const [liveShares, setLiveShares] = useState<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const callRef = useRef<CallUI | null>(null);
  const meRef = useRef<Me | null>(null);
  const userByIdRef = useRef<(id: number) => User | undefined>(() => undefined);
  // الجلسة نحفظها بـ ref فوراً (الـ state يتحدث بعد الرسم) حتى ما يفوتنا "رد" سريع
  const sessionRef = useRef<CallSession | null>(null);
  const groupRef = useRef<GroupCall | null>(null);
  const watchers = useRef(new Map<number, number>());

  useEffect(() => {
    callRef.current = call;
  }, [call]);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  const notify = useCallback((text: string) => {
    setToast(text);
    // الرسائل الطويلة (مثل خطوات تفعيل الإذن) تبقى وقت أطول حتى تنقرا
    setTimeout(() => setToast((t) => (t === text ? null : t)), Math.max(3500, text.length * 70));
  }, []);

  const signOut = useCallback(() => {
    // نمسح التوكن من السيرفر أول (حتى لو أحد نسخه ما يشتغل بعد)، وبعدين من المتصفح
    auth.logout().catch(() => {}).finally(() => {
      logout();
      router.replace("/login");
    });
  }, [router]);

  const refreshConvs = useCallback(async () => setConvs(await convApi.list("all")), []);
  const refreshStories = useCallback(async () => setStories(await storyApi.feed()), []);

  // ------------------------------------------------ المكالمات
  const endCallUI = useCallback((text: string) => {
    const cur = callRef.current;
    sessionRef.current?.close();
    sessionRef.current = null;
    groupRef.current?.close();
    groupRef.current = null;
    if (!cur) return;
    setCall({ ...cur, phase: "ended", endedText: text, session: null });
    setTimeout(() => setCall((c) => (c?.phase === "ended" && c.call.id === cur.call.id ? null : c)), 1800);
  }, []);

  const handlers = useCallback(() => ({
    onCreated: (s: CallSession) => { sessionRef.current = s; },
    onLocalStream: (s: MediaStream) => setCall((c) => (c ? { ...c, local: s } : c)),
    onRemoteStream: (s: MediaStream, media: MediaState) => setCall((c) => (c ? { ...c, remote: s, remoteVideo: media.video, remoteScreen: media.screen } : c)),
    onState: (state: RTCPeerConnectionState) => {
      if (state === "connected") setCall((c) => (c ? { ...c, phase: "active", startedAt: c.startedAt ?? Date.now() } : c));
      if (state === "failed") endCallUI(t("تعذّر الاتصال"));
    },
  }), [endCallUI]);

  // المكالمة الجماعية: الجلسة تُحفظ فور إنشائها، ومن يتصل يظهر في الشبكة
  const groupHandlers = useCallback(() => ({
    onCreated: (g: GroupCall) => { groupRef.current = g; },
    onLocalStream: (s: MediaStream) => setCall((c) => (c ? { ...c, local: s } : c)),
    onPeers: (peers: GroupPeer[]) => setCall((c) => {
      if (!c) return c;
      // أول من يتصل من الأعضاء: تبدأ المكالمة عند المتصل
      const live = c.phase === "outgoing" && peers.some((p) => p.state === "connected");
      return { ...c, peers, ...(live ? { phase: "active" as const, startedAt: c.startedAt ?? Date.now() } : {}) };
    }),
  }), []);

  // مكالمتي الثنائية صارت جماعية (أُضيف إليها أحد): ننقل اتصالها القائم إلى شبكة المكالمة الجماعية دون انقطاع
  const adoptGroup = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !socketRef.current || !meRef.current) return;
    sessionRef.current = null;
    const g = GroupCall.adopt(s, meRef.current.id, socketRef.current, groupHandlers());
    setCall((c) => (c ? { ...c, call: g.call, session: null, group: g, peers: g.peers, local: g.local, sharing: !!g.screen } : c));
  }, [groupHandlers]);

  // مكالمة ترنّ لي ولم يصلني حدثها (التطبيق كان مغلقاً وفُتح من إشعار المكالمة، أو انقطع الاتصال): نسأل الخادم
  const checkRinging = useCallback(async () => {
    if (callRef.current && callRef.current.phase !== "ended") return;
    const ringing = await calls.ringing().catch(() => null);
    if (ringing?.id && !(callRef.current && callRef.current.phase !== "ended")) {
      setCall({ phase: "incoming", call: ringing, peer: ringing.caller, session: null, local: null, remote: null, startedAt: null, muted: false, cameraOff: false });
    }
  }, []);

  // مكالمة جماعية ترنّ عندي ولم أرد: تتوقف بعد 45 ثانية (تبقى جارية لمن رد، وأستطيع الانضمام من المحادثة)
  useEffect(() => {
    if (call?.phase !== "incoming" || (call.call.conversation_kind !== "group" && !call.call.multi)) return;
    const id = call.call.id;
    const timer = setTimeout(() => setCall((c) => (c?.phase === "incoming" && c.call.id === id ? null : c)), 45000);
    return () => clearTimeout(timer);
  }, [call?.phase, call?.call.id, call?.call.conversation_kind, call?.call.multi]);

  // «جارٍ الاتصال» لا يبقى للأبد: إن لم يتصل الجهازان خلال 25 ثانية فالشبكتان تحتاجان خادم ترحيل (TURN)
  useEffect(() => {
    // المكالمة الجماعية لها حالة لكل مشارك، فلا تنطبق عليها هذه المهلة
    if (call?.phase !== "connecting" || call.call.conversation_kind === "group") return;
    const id = call.call.id;
    const timer = setTimeout(() => {
      const cur = callRef.current;
      if (cur?.phase !== "connecting" || cur.call.id !== id) return;
      const s = sessionRef.current;
      sessionRef.current = null;
      (s ? s.hangup() : calls.end(id).catch(() => {})).finally(() =>
        endCallUI(t("تعذّر الاتصال بين الشبكتين. جرّبا على شبكة الواي فاي نفسها، أو فعّل خادم TURN.")));
    }, 25000);
    return () => clearTimeout(timer);
  }, [call?.phase, call?.call.id, call?.call.conversation_kind, endCallUI]);

  // ------------------------------------------------ أول تحميل + الاتصال العام
  useEffect(() => {
    // رابط دعوة (/chat?join=...): نحفظه حتى لو احتاج المستخدم تسجيل الدخول أولاً
    const params = new URLSearchParams(window.location.search);
    try {
      if (params.get("join")) sessionStorage.setItem("wasl-join", params.get("join")!);
    } catch { /* التخزين غير متاح */ }
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    let pendingJoin: string | null = null;
    try {
      pendingJoin = sessionStorage.getItem("wasl-join");
      sessionStorage.removeItem("wasl-join");
    } catch { /* التخزين غير متاح */ }
    if (params.get("join")) window.history.replaceState(null, "", "/chat");
    const wanted = Number(params.get("c"));
    // جهات الاتصال ليست شرطاً لفتح التطبيق: إن تعذّر تحميلها تبقى القائمة فارغة
    Promise.all([auth.me(), usersApi.list(), convApi.list("all"), storyApi.feed(), contactsApi.list().catch(() => [] as User[])])
      .then(([m, u, c, s, k]) => {
        saveMe(m);
        setMe(m);
        setLang(m.language); // اللغة محفوظة بالحساب: تتبع المستخدم على كل أجهزته
        setUsers(u);
        setContacts(k);
        setConvs(c);
        setStories(s);
        if (c.some((x) => x.id === wanted)) setActiveId(wanted);
        if (pendingJoin) setJoinCode(pendingJoin);
        safety.blocked().then((l) => setBlockedIds(l.map((u) => u.id))).catch(() => {});
        syncPushSubscription();
        checkRinging(); // فُتح التطبيق من إشعار مكالمة؟ نعرضها مباشرة للرد
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) signOut();
      });

    let convTimer: ReturnType<typeof setTimeout> | undefined;
    const softRefreshConvs = () => {
      clearTimeout(convTimer);
      convTimer = setTimeout(() => convApi.list("all").then(setConvs), 250);
    };

    const socket = openSocket("/ws/presence/", async (e) => {
      switch (e.type) {
        case "presence": {
          const seen = new Date().toISOString();
          const upd = (u: User) => (u.id === e.user_id ? { ...u, is_online: e.is_online, last_seen: e.is_online ? u.last_seen : seen } : u);
          setUsers((list) => list.map(upd));
          setContacts((list) => list.map(upd));
          setConvs((list) => list.map((c) => ({ ...c, participants: c.participants.map(upd) })));
          break;
        }
        case "inbox":
        case "conversation_updated":
          softRefreshConvs();
          break;
        case "scheduled_changed":
          // المحادثة المفتوحة تحدّث عدد رسائلها المجدولة (Conversation.tsx)
          window.dispatchEvent(new CustomEvent("wasl:scheduled", { detail: e.conversation_id }));
          break;
        case "story":
        case "story_viewed":
          storyApi.feed().then(setStories);
          break;
        case "call_incoming": {
          if (callRef.current && callRef.current.phase !== "ended") {
            calls.decline(e.call.id).catch(() => {}); // مشغول بمكالمة ثانية
            break;
          }
          setCall({ phase: "incoming", call: e.call, peer: e.call.caller, session: null, local: null, remote: null, startedAt: null, muted: false, cameraOff: false });
          window.dispatchEvent(new Event("wasl:calls"));
          break;
        }
        case "call_left": {
          if (groupRef.current?.call.id === e.call_id) groupRef.current.peerLeft(e.user_id);
          window.dispatchEvent(new Event("wasl:calls"));
          break;
        }
        case "call_invited": {
          // أُضيف أحد إلى مكالمتي الثنائية: تصير جماعية (يبقى الاتصال القائم، ويتصل بنا المنضمّ الجديد)
          if (sessionRef.current?.call.id === e.call_id) adoptGroup();
          break;
        }
        case "call_invite_declined": {
          if (callRef.current?.call.id === e.call_id) {
            const who = userByIdRef.current(e.user_id);
            notify(t("{name} رفض الانضمام", { name: who ? who.display_name || who.username : t("عضو") }));
          }
          break;
        }
        case "call_answered": {
          window.dispatchEvent(new Event("wasl:calls")); // زر «انضمام» في المحادثة
          // أحدهم رد على مكالمتي الجماعية: الاتصال به يبدأ حين يرسل عرضه
          if (groupRef.current?.call.id === e.call_id) break;
          // مكالمة جماعية لم أرد عليها ورد غيري: تبقى ترنّ عندي (أستطيع الانضمام)
          const s = sessionRef.current;
          if (s && s.call.id === e.call_id && e.user_id !== meRef.current?.id && s.call.caller?.id === meRef.current?.id) {
            setCall((c) => (c ? { ...c, phase: "connecting" } : c));
            await s.onAnswered();
          }
          break;
        }
        case "call_video": {
          // الطرف الآخر شغّل الكاميرا: نعرض واجهة الفيديو (وزر "تشغيل الكاميرا" لنا)
          setCall((c) => (c && c.call.id === e.call_id ? { ...c, call: { ...c.call, kind: "video" } } : c));
          break;
        }
        case "call_ended": {
          const cur = callRef.current;
          if (cur && cur.call.id === e.call_id && cur.phase !== "ended") {
            endCallUI(t(e.status === "declined" ? "رُفضت المكالمة" : e.status === "missed" ? "لم يُجب" : "انتهت المكالمة"));
          }
          window.dispatchEvent(new Event("wasl:calls"));
          break;
        }
        case "call.signal": {
          const s = sessionRef.current;
          // من مشارك ثالث في مكالمتي الثنائية (أُضيف إليها، وسبق عرضُه حدثَ الإضافة): تصير جماعية أولاً
          if (s && s.call.id === e.call_id && e.from !== s.peerId) adoptGroup();
          const g = groupRef.current;
          if (g && g.call.id === e.call_id) {
            await g.handleSignal(e.from, e.data);
            break;
          }
          if (sessionRef.current && sessionRef.current.call.id === e.call_id) await sessionRef.current.handleSignal(e.data);
          break;
        }
      }
    }, { onOpen: (again) => { if (again) { softRefreshConvs(); usersApi.list().then(setUsers); contactsApi.list().then(setContacts); checkRinging(); } } });
    socketRef.current = socket;

    // الضغط على إشعار والتطبيق مفتوح: الـ Service Worker يرسل الرابط بدل إعادة تحميل الصفحة
    const onSwMessage = (ev: MessageEvent) => {
      if (ev.data?.type !== "open") return;
      const params = new URL(ev.data.url, window.location.origin).searchParams;
      const conv = Number(params.get("c"));
      if (conv) {
        setActiveId(conv);
        window.history.replaceState(null, "", `/chat?c=${conv}`);
      }
      if (params.get("call")) checkRinging();
    };
    // عند العودة إلى التطبيق من الخلفية قد تكون هناك مكالمة ترنّ
    const onVisible = () => document.visibilityState === "visible" && checkRinging();
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      socket.close();
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, signOut, endCallUI, checkRinging, adoptGroup, notify]);

  // ------------------------------------------------ مساعدات
  const storyRing = useCallback((userId: number | undefined) => {
    const g = stories.find((x) => x.user.id === userId && !x.is_me);
    return g && g.stories.length ? (g.all_seen ? "seen" : "story") : undefined;
  }, [stories]);
  const openStory = useCallback((userId: number) => {
    const g = stories.find((x) => x.user.id === userId);
    if (!g) return;
    const first = g.stories.findIndex((x) => !x.seen);
    setStoryViewer({ userId, index: first === -1 ? 0 : first });
  }, [stories]);
  const userById = useCallback((id: number) => users.find((u) => u.id === id) ?? contacts.find((u) => u.id === id) ?? (me?.id === id ? me : undefined), [users, contacts, me]);
  useEffect(() => {
    userByIdRef.current = userById;
  }, [userById]);
  const isContact = useCallback((id: number) => contacts.some((u) => u.id === id), [contacts]);
  const contactAdded = useCallback((u: User) => {
    const saved = { ...u, is_contact: true };
    const byName = (a: User, b: User) => (a.display_name || a.username).localeCompare(b.display_name || b.username);
    setContacts((list) => [...list.filter((x) => x.id !== u.id), saved].sort(byName));
    setUsers((list) => [saved, ...list.filter((x) => x.id !== u.id)]);
  }, []);
  const contactRemoved = useCallback((id: number) => {
    setContacts((list) => list.filter((x) => x.id !== id));
    setUsers((list) => list.map((x) => (x.id === id ? { ...x, is_contact: false } : x)));
  }, []);
  const isBlocked = useCallback((id: number) => blocked.includes(id), [blocked]);
  const setBlocked = useCallback(async (id: number, on: boolean) => {
    await (on ? safety.block(id) : safety.unblock(id));
    setBlockedIds((l) => (on ? [...l.filter((x) => x !== id), id] : l.filter((x) => x !== id)));
  }, []);
  const otherOf = useCallback((c: Conversation) => {
    if (c.kind !== "direct") return null;
    const p = c.participants.find((x) => x.id !== me?.id) ?? c.participants[0];
    return p ? users.find((u) => u.id === p.id) ?? p : null;
  }, [users, me]);

  const openConv = useCallback((id: number | null) => {
    setActiveId(id);
    window.history.replaceState(window.history.state, "", id ? `/chat?c=${id}` : "/chat");
  }, []);

  // السحب للخلف في الآيفون (وزر الرجوع في أندرويد) يرجع خطوة داخل التطبيق: يغلق الحالة المفتوحة، ثم اللوحة، ثم المحادثة،
  // ولا يخرج أبداً إلى صفحة الدخول. نضع خطوة في سجل المتصفح يستهلكها الرجوع، ونعيدها عند أول لمسة بعده
  // (خطوة تُضاف دون تفاعل من المستخدم يتخطاها كروم عند الرجوع، فلا نضيفها إلا مع لمسة أو ضغطة زر).
  const backRef = useRef<() => void>(() => {});
  useEffect(() => {
    backRef.current = () => {
      if (storyViewer) setStoryViewer(null);
      else if (panel) setPanel(null);
      else if (activeId) openConv(null);
    };
  }, [storyViewer, panel, activeId, openConv]);
  useEffect(() => {
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      window.history.pushState({ ...window.history.state, waslBack: true }, "", window.location.href);
    };
    const onPop = () => {
      if (!armed) return;
      armed = false;
      backRef.current();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pointerdown", arm, true);
    window.addEventListener("keydown", arm, true);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pointerdown", arm, true);
      window.removeEventListener("keydown", arm, true);
    };
  }, []);

  const jumpTo = useCallback((convId: number, messageId: number) => {
    setPanel(null);
    setTab("chats");
    openConv(convId);
    setJump({ convId, messageId });
  }, [openConv]);
  const clearJump = useCallback(() => setJump(null), []);

  const openWith = useCallback(async (userId: number) => {
    const c = await convApi.openWith(userId);
    setConvs((list) => (list.some((x) => x.id === c.id) ? list : [c, ...list]));
    setPanel(null);
    setTab("chats");
    openConv(c.id);
  }, [openConv]);

  const openSaved = useCallback(async () => {
    const c = await convApi.saved();
    setConvs((list) => (list.some((x) => x.id === c.id) ? list : [c, ...list]));
    setTab("chats");
    openConv(c.id);
  }, [openConv]);

  const updateMe = useCallback((m: Me) => {
    saveMe(m);
    setMe(m);
  }, []);

  // ------------------------------------------------ أوامر المكالمات
  const startCall = useCallback(async (conv: Conversation, kind: CallKind) => {
    if (callRef.current && callRef.current.phase !== "ended") return;
    if (conv.kind === "group" && socketRef.current) {
      // المكالمة الجماعية: ترنّ عند كل الأعضاء، ويتصل كل من يرد بالجميع
      setCall({ phase: "outgoing", call: { id: 0, kind, caller: meRef.current!, conversation: conv.id, conversation_kind: "group", title: conv.title } as unknown as Call,
        peer: null, session: null, local: null, remote: null, startedAt: null, muted: false, cameraOff: false, group: null, peers: [] });
      try {
        const g = await GroupCall.start(conv.id, kind, meRef.current!.id, socketRef.current, groupHandlers());
        setCall((c) => (c ? { ...c, call: g.call, group: g, local: g.local } : c));
      } catch (err) {
        groupRef.current = null;
        setCall(null);
        notify(callError(err, kind));
      }
      return;
    }
    const peer = otherOf(conv);
    if (!peer || !socketRef.current) {
      notify(t("لا يمكن الاتصال في هذه المحادثة"));
      return;
    }
    const base: CallUI = { phase: "outgoing", call: { id: 0, kind, caller: meRef.current! } as unknown as Call, peer, session: null, local: null, remote: null, startedAt: null, muted: false, cameraOff: false };
    setCall(base);
    try {
      const session = await CallSession.start(conv.id, kind, peer.id, socketRef.current, handlers());
      sessionRef.current = session;
      setCall((c) => (c ? { ...c, call: session.call, session, local: session.local } : c));
    } catch (err) {
      setCall(null);
      notify(callError(err, kind));
    }
  }, [otherOf, handlers, groupHandlers, notify]);

  // الرد على مكالمة جماعية، أو الانضمام إلى مكالمة جارية من زر «انضمام»
  const joinGroupCall = useCallback(async (incoming: Call) => {
    if (!socketRef.current) return;
    setCall({ phase: "connecting", call: incoming, peer: incoming.caller, session: null, local: null, remote: null, startedAt: null,
      muted: false, cameraOff: false, group: null, peers: [] });
    try {
      const g = await GroupCall.join(incoming, meRef.current!.id, socketRef.current, groupHandlers());
      setCall((c) => (c ? { ...c, call: g.call, group: g, local: g.local, phase: "active", startedAt: Date.now() } : c));
    } catch (err) {
      groupRef.current = null;
      setCall(null);
      notify(callError(err, incoming.kind));
    }
  }, [groupHandlers, notify]);

  const joinCall = useCallback(async (c: Call) => {
    if (callRef.current && callRef.current.phase !== "ended") return;
    await joinGroupCall(c);
  }, [joinGroupCall]);

  const acceptCall = useCallback(async () => {
    const cur = callRef.current;
    if (!cur || cur.phase !== "incoming" || !socketRef.current) return;
    if (cur.call.conversation_kind === "group" || cur.call.multi) return joinGroupCall(cur.call);
    setCall({ ...cur, phase: "connecting" });
    try {
      const session = await CallSession.accept(cur.call, socketRef.current, handlers());
      sessionRef.current = session;
      setCall((c) => (c ? { ...c, session, local: session.local } : c));
    } catch (err) {
      sessionRef.current = null;
      setCall(null);
      calls.decline(cur.call.id).catch(() => {});
      notify(callError(err, cur.call.kind));
    }
  }, [handlers, joinGroupCall, notify]);

  const declineCall = useCallback(async () => {
    const cur = callRef.current;
    if (!cur) return;
    setCall(null);
    await calls.decline(cur.call.id).catch(() => {});
  }, []);

  const hangup = useCallback(async () => {
    const cur = callRef.current;
    if (!cur) return;
    const g = groupRef.current;
    if (g || cur.call.conversation_kind === "group" || cur.call.multi) {
      // المجموعة: أغادر أنا فقط، وتبقى المكالمة لمن بقي
      groupRef.current = null;
      if (g) await g.leave();
      else if (cur.call.id) await calls.leave(cur.call.id).catch(() => {});
      endCallUI(t("غادرت المكالمة"));
      return;
    }
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) await s.hangup();
    else if (cur.call.id) await calls.end(cur.call.id).catch(() => {});
    endCallUI(t("انتهت المكالمة"));
  }, [endCallUI]);

  const inviteToCall = useCallback(async (userIds: number[]) => {
    const cur = callRef.current;
    if (!cur?.call.id || !userIds.length) return;
    try {
      await calls.invite(cur.call.id, userIds);
      notify(t("يرنّ عندهم الآن..."));
    } catch (e) {
      notify((e as Error).message);
    }
  }, [notify]);

  const toggleMute = useCallback(() => {
    const cur = callRef.current;
    const s = groupRef.current ?? cur?.session;
    if (cur && s) setCall({ ...cur, muted: s.toggleMute() });
  }, []);
  const toggleCamera = useCallback(() => {
    const cur = callRef.current;
    const s = groupRef.current ?? cur?.session;
    if (cur && s) setCall({ ...cur, cameraOff: s.toggleCamera() });
  }, []);
  const toggleScreen = useCallback(async () => {
    const cur = callRef.current;
    const s = groupRef.current ?? cur?.session;
    if (!cur || !s) return;
    if (cur.sharing) {
      await s.stopScreen();
      setCall((c) => (c ? { ...c, sharing: false } : c));
      return;
    }
    try {
      await s.shareScreen(() => setCall((c) => (c ? { ...c, sharing: false } : c)));
      setCall((c) => (c ? { ...c, sharing: true } : c));
    } catch (err) {
      // رفض المستخدم اختيار شاشة: لا خطأ نعرضه
      if ((err as Error).name !== "NotAllowedError") notify(t("تعذّرت مشاركة الشاشة في هذا المتصفح"));
    }
  }, [notify]);
  // تحويل المكالمة الصوتية إلى فيديو (أو تشغيل كاميرتي بعد أن حوّلها الطرف الآخر)
  const enableVideo = useCallback(async () => {
    const cur = callRef.current;
    const s = groupRef.current ?? cur?.session;
    if (!cur || !s) return;
    try {
      const local = await s.enableVideo();
      setCall((c) => (c ? { ...c, local, cameraOff: false, call: { ...c.call, kind: "video" } } : c));
      if (cur.call.kind !== "video") calls.video(cur.call.id).catch(() => {});
    } catch (err) {
      notify(callError(err, "video"));
    }
  }, [notify]);

  // ------------------------------------------------ الموقع المباشر: نحدّثه كل ما الجهاز يتحرك
  const stopWatch = useCallback((msgId: number) => {
    const w = watchers.current.get(msgId);
    if (w !== undefined) navigator.geolocation.clearWatch(w);
    watchers.current.delete(msgId);
    setLiveShares((l) => l.filter((x) => x !== msgId));
  }, []);

  const startLiveShare = useCallback((msg: Message) => {
    if (!msg.live_until || !("geolocation" in navigator)) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition((pos) => {
      if (msg.live_until && new Date(msg.live_until).getTime() < Date.now()) return stopWatch(msg.id);
      if (Date.now() - last < 10000) return; // مرة كل 10 ثواني تكفي
      last = Date.now();
      msgApi.updateLiveLocation(msg.id, pos.coords.latitude, pos.coords.longitude).catch(() => stopWatch(msg.id));
    }, () => stopWatch(msg.id), { enableHighAccuracy: true });
    watchers.current.set(msg.id, id);
    setLiveShares((l) => [...l, msg.id]);
  }, [stopWatch]);

  const stopLiveShare = useCallback(async (msgId: number) => {
    stopWatch(msgId);
    await msgApi.stopLiveLocation(msgId).catch(() => {});
  }, [stopWatch]);

  // ------------------------------------------------ الوضع: نهاري أو ليلي (تلقائي = حسب الجهاز)
  const deviceDark = useSyncExternalStore(subscribeDark, () => window.matchMedia(darkQuery).matches, () => false);
  const theme: "light" | "dark" = me?.mode === "dark" || (me?.mode !== "light" && deviceDark) ? "dark" : "light";

  // عدد غير المقروء بعنوان التبويب
  const unread = convs.reduce((n, c) => n + c.unread_count, 0);
  const lang = useLang();
  useEffect(() => {
    document.title = unread ? `(${unread}) ${t("وَصل")}` : t("وَصل | محادثاتك في مكان واحد");
    // عدّاد على أيقونة التطبيق بالشاشة الرئيسية (أندرويد/آيفون لما يكون مثبت، وكروم بالحاسبة)
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
  }, [unread, lang]);

  if (!me) return <>{fallback}</>;
  const value: Ctx = {
    me, users, contacts, isContact, contactAdded, contactRemoved, blocked, isBlocked, setBlocked, convs, stories, theme, tab, setTab, activeId, openConv, openWith, openSaved, panel, setPanel,
    muteDialog, setMuteDialog, joinCode, setJoinCode, jump, jumpTo, clearJump,
    storyViewer, setStoryViewer, storyRing, openStory, userById, otherOf, refreshConvs, refreshStories, updateMe, signOut,
    call, startCall, acceptCall, declineCall, hangup, toggleMute, toggleCamera, enableVideo, toggleScreen, joinCall, inviteToCall,
    startLiveShare, stopLiveShare, liveShares, toast, notify,
  };
  return <WaslContext.Provider value={value}>{children}</WaslContext.Provider>;
}

/**
 * البحث عن ناس: بالجامعة آلاف المستخدمين، فما نحملهم كلهم.
 * بدون بحث: أول 50 (اللي تحچي وياهم أول). ويا بحث: نسأل السيرفر بعد ما يوقف الكتابة ربع ثانية.
 */
export function useUserSearch(q: string) {
  const { users } = useWasl();
  const query = q.trim();
  const [found, setFound] = useState<{ q: string; list: User[] } | null>(null);
  useEffect(() => {
    if (!query) return;
    let alive = true;
    const t = setTimeout(() => {
      usersApi.list(query).then((list) => alive && setFound({ q: query, list })).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);
  if (!query) return { list: users, loading: false };
  // الحالة (متصل) من المخزن إذا عندنا نسخة أحدث
  const list = found?.q === query ? found.list.map((u) => users.find((x) => x.id === u.id) ?? u) : [];
  return { list, loading: found?.q !== query };
}
