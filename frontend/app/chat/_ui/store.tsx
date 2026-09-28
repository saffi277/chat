"use client";
/**
 * "المخزن": مكان واحد يحفظ كل بيانات التطبيق (أنا، المحادثات، الناس، الحالات، المكالمة)
 * ويفتح الاتصال العام (presence) اللي يوصلنا منه كل شي مباشر.
 * كل شاشة تاخذ اللي تحتاجه بـ useWasl() بدل ما كل وحدة تجيب البيانات بنفسها.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, getToken, logout, saveMe, type Call, type CallKind, type Conversation, type Me, type Message, type StoryGroup, type User } from "@/lib/api";
import { CallSession } from "@/lib/call";
import { auth, calls, contacts as contactsApi, conversations as convApi, messages as msgApi, stories as storyApi, users as usersApi } from "@/lib/endpoints";
import { setLang, t, useLang } from "@/lib/i18n";
import { isDeviceError, permError } from "@/lib/permissions";
import { syncPushSubscription } from "@/lib/push";
import { openSocket, type LiveSocket } from "@/lib/socket";

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
  | null;

export type CallUI = {
  phase: "incoming" | "outgoing" | "connecting" | "active" | "ended";
  call: Call;
  peer: User | null;
  session: CallSession | null;
  local: MediaStream | null;
  remote: MediaStream | null;
  remoteVideo?: boolean; // يصل من الطرف الآخر فيديو فعلاً (قد تبدأ المكالمة صوتية ثم تتحول)
  startedAt: number | null;
  muted: boolean;
  cameraOff: boolean;
  endedText?: string;
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
  storyViewer: { userId: number; index: number } | null;
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
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [tab, setTab] = useState<Tab>("chats");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [panel, setPanel] = useState<PanelState>(null);
  const [storyViewer, setStoryViewer] = useState<{ userId: number; index: number } | null>(null);
  const [call, setCall] = useState<CallUI | null>(null);
  const [liveShares, setLiveShares] = useState<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const callRef = useRef<CallUI | null>(null);
  const meRef = useRef<Me | null>(null);
  // الجلسة نحفظها بـ ref فوراً (الـ state يتحدث بعد الرسم) حتى ما يفوتنا "رد" سريع
  const sessionRef = useRef<CallSession | null>(null);
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
    if (!cur) return;
    setCall({ ...cur, phase: "ended", endedText: text, session: null });
    setTimeout(() => setCall((c) => (c?.phase === "ended" && c.call.id === cur.call.id ? null : c)), 1800);
  }, []);

  const handlers = useCallback(() => ({
    onLocalStream: (s: MediaStream) => setCall((c) => (c ? { ...c, local: s } : c)),
    onRemoteStream: (s: MediaStream) => setCall((c) => (c ? { ...c, remote: s, remoteVideo: s.getVideoTracks().some((tr) => tr.readyState === "live" && !tr.muted) } : c)),
    onState: (state: RTCPeerConnectionState) => {
      if (state === "connected") setCall((c) => (c ? { ...c, phase: "active", startedAt: c.startedAt ?? Date.now() } : c));
      if (state === "failed") endCallUI(t("تعذّر الاتصال"));
    },
  }), [endCallUI]);

  // مكالمة ترنّ لي ولم يصلني حدثها (التطبيق كان مغلقاً وفُتح من إشعار المكالمة، أو انقطع الاتصال): نسأل الخادم
  const checkRinging = useCallback(async () => {
    if (callRef.current && callRef.current.phase !== "ended") return;
    const ringing = await calls.ringing().catch(() => null);
    if (ringing?.id && !(callRef.current && callRef.current.phase !== "ended")) {
      setCall({ phase: "incoming", call: ringing, peer: ringing.caller, session: null, local: null, remote: null, startedAt: null, muted: false, cameraOff: false });
    }
  }, []);

  // «جارٍ الاتصال» لا يبقى للأبد: إن لم يتصل الجهازان خلال 25 ثانية فالشبكتان تحتاجان خادم ترحيل (TURN)
  useEffect(() => {
    if (call?.phase !== "connecting") return;
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
  }, [call?.phase, call?.call.id, endCallUI]);

  // ------------------------------------------------ أول تحميل + الاتصال العام
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const wanted = Number(new URLSearchParams(window.location.search).get("c"));
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
          break;
        }
        case "call_answered": {
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
          break;
        }
        case "call.signal": {
          const s = sessionRef.current;
          if (s && s.call.id === e.call_id) await s.handleSignal(e.data);
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
  }, [router, signOut, endCallUI, checkRinging]);

  // ------------------------------------------------ مساعدات
  const userById = useCallback((id: number) => users.find((u) => u.id === id) ?? contacts.find((u) => u.id === id) ?? (me?.id === id ? me : undefined), [users, contacts, me]);
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
  const otherOf = useCallback((c: Conversation) => {
    if (c.kind !== "direct") return null;
    const p = c.participants.find((x) => x.id !== me?.id) ?? c.participants[0];
    return p ? users.find((u) => u.id === p.id) ?? p : null;
  }, [users, me]);

  const openConv = useCallback((id: number | null) => {
    setActiveId(id);
    window.history.replaceState(null, "", id ? `/chat?c=${id}` : "/chat");
  }, []);

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
    const peer = otherOf(conv);
    if (!peer || !socketRef.current) {
      notify(t("المكالمات حالياً بين شخصين فقط"));
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
  }, [otherOf, handlers, notify]);

  const acceptCall = useCallback(async () => {
    const cur = callRef.current;
    if (!cur || cur.phase !== "incoming" || !socketRef.current) return;
    setCall({ ...cur, phase: "connecting" });
    try {
      const session = await CallSession.accept(cur.call, socketRef.current, handlers());
      sessionRef.current = session;
      setCall((c) => (c ? { ...c, session, local: session.local } : c));
    } catch (err) {
      setCall(null);
      calls.decline(cur.call.id).catch(() => {});
      notify(callError(err, cur.call.kind));
    }
  }, [handlers, notify]);

  const declineCall = useCallback(async () => {
    const cur = callRef.current;
    if (!cur) return;
    setCall(null);
    await calls.decline(cur.call.id).catch(() => {});
  }, []);

  const hangup = useCallback(async () => {
    const cur = callRef.current;
    if (!cur) return;
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) await s.hangup();
    else if (cur.call.id) await calls.end(cur.call.id).catch(() => {});
    endCallUI(t("انتهت المكالمة"));
  }, [endCallUI]);

  const toggleMute = useCallback(() => {
    const cur = callRef.current;
    if (cur?.session) setCall({ ...cur, muted: cur.session.toggleMute() });
  }, []);
  const toggleCamera = useCallback(() => {
    const cur = callRef.current;
    if (cur?.session) setCall({ ...cur, cameraOff: cur.session.toggleCamera() });
  }, []);
  // تحويل المكالمة الصوتية إلى فيديو (أو تشغيل كاميرتي بعد أن حوّلها الطرف الآخر)
  const enableVideo = useCallback(async () => {
    const cur = callRef.current;
    const s = cur?.session;
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
    me, users, contacts, isContact, contactAdded, contactRemoved, convs, stories, theme, tab, setTab, activeId, openConv, openWith, openSaved, panel, setPanel,
    storyViewer, setStoryViewer, userById, otherOf, refreshConvs, refreshStories, updateMe, signOut,
    call, startCall, acceptCall, declineCall, hangup, toggleMute, toggleCamera, enableVideo,
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
