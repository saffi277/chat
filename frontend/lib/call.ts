// المكالمات الصوتية والفيديو (WebRTC) بين شخصين.
//
// الفكرة: الصوت والصورة ما يمرن من سيرفرنا. الجهازين يتصلون ببعض مباشرة.
// بس حتى يلكون بعض، لازم يتبادلون "رسائل تعارف" (signaling) عن طريق سيرفرنا:
//   1. description (offer/answer): شنو يدعم كل جهاز (صوت، فيديو، أنواع الترميز)
//   2. candidate: العناوين اللي ممكن يوصلون بيها لبعض على الإنترنت
// هذي الرسائل تمر من الاتصال العام (/ws/presence/) بنوع "call.signal".
//
// الاستخدام:
//   المتصل:   const s = await CallSession.start(convId, "video", peerId, socket, handlers)
//             وبعدين لما يوصل حدث call_answered:  s.onAnswered()
//   المستلم:  لما يوصل call_incoming ويضغط "رد":
//             const s = await CallSession.accept(call, socket, handlers)
//   الطرفين:  كل حدث "call.signal" لهاي المكالمة ← s.handleSignal(e.data)
//             s.hangup() ، s.toggleMute() ، s.toggleCamera() ، s.enableVideo() (تحويل الصوتية إلى فيديو)
import type { Call, CallKind } from "./api";
import { calls } from "./endpoints";
import type { CallSignal, LiveSocket, MediaState, MeetEvent } from "./socket";

export type CallHandlers = {
  /**
   * المستلم: تُحفظ الجلسة قبل إبلاغ الخادم بالرد. فالمتصل يرسل عرضه فور علمه بالرد، وقد يصل العرض قبل ردّ الخادم
   * على طلب «رد» (شبكة الجوال)، فإن لم تكن الجلسة محفوظة يضيع العرض وتبقى المكالمة «جارٍ الاتصال» إلى الأبد
   */
  onCreated?: (session: CallSession) => void;
  onLocalStream?: (stream: MediaStream) => void;
  /** media: هل نعرض فيديو الطرف الآخر الآن، وهل هو شاشة (تُعرض كاملة دون قصّ) */
  onRemoteStream?: (stream: MediaStream, media: MediaState) => void;
  onState?: (state: RTCPeerConnectionState) => void;
  /** دردشة أو تفاعل أو رفع يد من الطرف الآخر */
  onMeet?: (from: number, ev: MeetEvent) => void;
};

/**
 * هل يصل من الطرف الآخر فيديو يُعرض؟ نعتمد على ما أعلنه هو (كاميرتي/شاشتي تعمل)، لأن سفاري (الآيفون) لا يرسل
 * حدث unmute للمسار بانتظام، فكان الفيديو يصل ولا يظهر. إن لم يعلن شيئاً (إصدار أقدم): نعود إلى حالة المسار.
 */
function remoteMedia(stream: MediaStream, announced: MediaState | null): Required<MediaState> {
  const audio = announced?.audio !== false;
  const live = stream.getVideoTracks().filter((t) => t.readyState === "live");
  if (!live.length) return { video: false, screen: false, audio };
  return announced ? { video: announced.video, screen: announced.screen, audio } : { video: live.some((t) => !t.muted), screen: false, audio };
}

/** عدد الكاميرات (في الهاتف: الأمامية والخلفية) لإظهار زر «تبديل الكاميرا» */
export async function cameraCount() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").length;
  } catch {
    return 0;
  }
}

/**
 * الكاميرا التالية (الأمامية ↔ الخلفية). نوقف الحالية أولاً لأن بعض هواتف أندرويد لا تفتح كاميرتين معاً،
 * وإن تعذّر فتح التالية نعيد فتح الحالية حتى لا تنطفئ الكاميرا.
 */
async function nextCamera(old: MediaStreamTrack) {
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  if (cams.length < 2) return null;
  const current = old.getSettings().deviceId;
  const next = cams[(cams.findIndex((c) => c.deviceId === current) + 1) % cams.length];
  old.stop();
  try {
    return (await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId } } })).getVideoTracks()[0];
  } catch {
    return (await navigator.mediaDevices.getUserMedia({ video: current ? { deviceId: { exact: current } } : true })).getVideoTracks()[0];
  }
}

/** معرّف قصير لرسالة في دردشة المكالمة (يمنع تكرارها إن وصلت مرتين) */
export const meetId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class CallSession {
  readonly pc: RTCPeerConnection;
  local: MediaStream | null = null;
  readonly remote = new MediaStream();
  muted = false;
  cameraOff = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  /** ما أعلنه الطرف الآخر عن كاميرته وشاشته (null: لم يعلن بعد) */
  peerMedia: MediaState | null = null;
  /**
   * رسائل التعارف تُعالج واحدة بعد الأخرى بترتيب وصولها. لو عولجت معاً (ردّ ثم عرض جديد متتاليان) لبدأ العرض قبل
   * انتهاء الرد، فيبدو «تصادماً» ويُتجاهل، فلا تصل الكاميرا أو الشاشة
   */
  private chain: Promise<void> = Promise.resolve();
  /** رسائل تعارف لم تُرسل لأن الاتصال العام منقطع لحظتها (الهاتف يعيد الاتصال): تُرسل حين يعود بدل أن تضيع */
  private outbox: CallSignal[] = [];
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private closed = false;
  /** ظهر لنا عنوان عبر خادم الترحيل (TURN)؟ أي أن الخادم يعمل ومنافذه مفتوحة */
  private relayed = false
  private queue(task: () => Promise<void>) {
    this.chain = this.chain.then(task).catch(() => {});
    return this.chain;
  }

  private constructor(
    public call: Call,
    public peerId: number,
    private socket: Pick<LiveSocket, "send">,
    private handlers: CallHandlers,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: call.ice_servers ?? [] });
    // كل عنوان يلكاه المتصفح ندزه للطرف الثاني
    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (e.candidate.type === "relay" || / typ relay /.test(e.candidate.candidate)) this.relayed = true;
      this.signal({ candidate: e.candidate.toJSON() });
    };
    // صوت/صورة الطرف الآخر تصل هنا (ومسار الفيديو قد يصل لاحقاً إذا حوّل المكالمة إلى فيديو)
    this.pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => this.remote.getTracks().includes(t) || this.remote.addTrack(t));
      if (!this.remote.getTracks().includes(e.track)) this.remote.addTrack(e.track);
      e.track.onunmute = () => this.emitRemote();
      e.track.onmute = () => this.emitRemote();
      e.track.onended = () => this.emitRemote();
      this.emitRemote();
    };
    this.pc.onconnectionstatechange = () => {
      handlers.onState?.(this.pc.connectionState);
      // اتصلنا: نعلن حالة كاميرتي وشاشتي (مكالمة الفيديو تبدأ والكاميرا تعمل)
      if (this.pc.connectionState === "connected") this.announce();
    };
  }

  /** نسخة جديدة من البث في كل مرة، ليعيد عنصر <video> قراءته (سفاري لا يلاحظ المسارات المضافة لاحقاً) */
  private emitRemote() {
    const stream = new MediaStream(this.remote.getTracks());
    this.handlers.onRemoteStream?.(stream, remoteMedia(stream, this.peerMedia));
  }

  /** حالتي الآن: هل يرى الطرف الآخر فيديو مني (كاميرا أو شاشة)؟ وهل مايكي يعمل؟ */
  get media(): MediaState {
    return { video: !!this.screen || (this.hasVideo && !this.cameraOff), screen: !!this.screen, audio: !this.muted };
  }

  /** نخبر الطرف الآخر بحالة كاميرتي وشاشتي (بعد كل تغيير) */
  private announce() {
    if (this.call.id) this.signal({ media: this.media });
  }

  /** المتصل: يبدي المكالمة (يرن عند الطرف الثاني) */
  static async start(conversationId: number, kind: CallKind, peerId: number, socket: Pick<LiveSocket, "send">, handlers: CallHandlers = {}) {
    // نجهز الكاميرا والمايك أول، وبعدين نرن. هيچ إذا رد بسرعة نكون جاهزين
    const { ice_servers } = await calls.iceServers();
    const session = new CallSession({ id: 0, kind, ice_servers } as Call, peerId, socket, handlers);
    await session.openMedia();
    try {
      session.call = await calls.start(conversationId, kind);
    } catch (err) {
      session.close();
      throw err;
    }
    return session;
  }

  /** المستلم: يرد على مكالمة واردة */
  static async accept(incoming: Call, socket: Pick<LiveSocket, "send">, handlers: CallHandlers = {}) {
    const { ice_servers } = await calls.iceServers();
    const session = new CallSession({ ...incoming, ice_servers }, incoming.caller.id, socket, handlers);
    await session.openMedia();
    handlers.onCreated?.(session);
    // بس بعد ما صرنا جاهزين نبلغ المتصل، فهو يدز العرض (offer)
    try {
      session.call = { ...incoming, ...(await calls.answer(incoming.id)) };
    } catch (err) {
      session.close();
      throw err;
    }
    return session;
  }

  /** المتصل: الطرف الثاني رد، هسه ندزله العرض (offer) */
  async onAnswered() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signal({ description: this.pc.localDescription!.toJSON() });
    this.watch(1);
  }

  /**
   * المتصل: إن لم يتصل الجهازان بعد ثوانٍ نعيد المحاولة بدل الانتظار للأبد. رسالة تعارف قد تضيع في الطريق
   * (هاتف الطرف الآخر كان يعيد اتصاله لحظة وصولها): لم يصل رده بعد ← نعيد إرسال العرض (يحمل الآن كل عناويننا)،
   * وفشل الاتصال أو لم يبدأ ← نعيد التفاوض على العناوين من جديد (ICE restart).
   */
  private watch(round: number) {
    clearTimeout(this.watchdog);
    if (round > 4) return;
    this.watchdog = setTimeout(() => this.queue(async () => {
      if (this.closed || this.pc.connectionState === "connected") return;
      if (this.pc.signalingState === "have-local-offer") {
        this.signal({ description: this.pc.localDescription!.toJSON() });
      } else if (this.pc.signalingState === "stable" && ["new", "failed", "disconnected"].includes(this.pc.iceConnectionState)) {
        await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart: true }));
        this.signal({ description: this.pc.localDescription!.toJSON() });
      }
      this.watch(round + 1);
    }), 5000);
  }

  /** إعادة التفاوض على العناوين (ICE restart) بعد انقطاع: تبدّلت الشبكة، أو انتهت صلاحية عنوان الترحيل */
  restart() {
    return this.queue(async () => {
      if (this.closed || this.pc.signalingState !== "stable") return;
      await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart: true }));
      this.signal({ description: this.pc.localDescription!.toJSON() });
    });
  }

  /**
   * لماذا لم يتصل الجهازان؟ no-turn: الخادم بلا خادم ترحيل (TURN)، فلا تنجح المكالمة إلا على الشبكة نفسها.
   * turn-unreachable: خادم الترحيل مذكور لكنه لا يرد (متوقف، أو منافذه مغلقة في جدار الحماية). other: غير ذلك.
   */
  get diagnosis(): "no-turn" | "turn-unreachable" | "other" {
    const turn = (this.call.ice_servers ?? []).some((x) => ([] as string[]).concat(x.urls).some((u) => /^turns?:/.test(u)));
    return !turn ? "no-turn" : this.relayed ? "other" : "turn-unreachable";
  }

  /** هل المتصل أنا؟ (عند تعارض عرضين في اللحظة نفسها يتنازل المستلم، وهو الطرف "المهذب") */
  get polite() {
    return this.call.caller?.id === this.peerId;
  }

  /** أي رسالة تعارف تصل من الطرف الآخر */
  handleSignal(data: CallSignal) {
    return this.queue(() => this.process(data));
  }

  private async process(data: CallSignal) {
    if ("meet" in data) {
      this.handlers.onMeet?.(this.peerId, data.meet);
    } else if ("media" in data) {
      this.peerMedia = data.media;
      this.emitRemote();
    } else if ("description" in data) {
      const offer = data.description.type === "offer";
      if (offer && this.pc.signalingState !== "stable") {
        // أرسل الطرفان عرضاً معاً (مثلاً فعّلا الكاميرا في اللحظة نفسها)
        if (!this.polite) return; // المتصل يتجاهل عرض الآخر، والآخر يسحب عرضه ويقبل
        await this.pc.setLocalDescription({ type: "rollback" });
      }
      await this.pc.setRemoteDescription(data.description);
      // المرشحين اللي وصلوا قبل الـ description ننتظرهم لهسه
      for (const c of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(c);
      if (data.description.type === "offer") {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.signal({ description: this.pc.localDescription!.toJSON() });
      }
    } else if ("candidate" in data) {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate);
      else this.pendingCandidates.push(data.candidate);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this.announce();
    return this.muted;
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    this.announce();
    return this.cameraOff;
  }

  get hasVideo() {
    return !!this.local?.getVideoTracks().length;
  }

  /** دردشة أو تفاعل أو رفع يد: إلى الطرف الآخر */
  sendMeet(ev: MeetEvent) {
    if (this.call.id) this.signal({ meet: ev });
  }

  /** الأمامية ↔ الخلفية: نستبدل مسار الفيديو المرسَل دون إعادة التفاوض. يعيد البث المحلي الجديد للمعاينة */
  async switchCamera() {
    const old = this.local?.getVideoTracks()[0];
    const track = old && await nextCamera(old);
    if (!old || !track || !this.local) return null;
    track.enabled = !this.cameraOff;
    this.local.removeTrack(old);
    this.local.addTrack(track);
    if (this.camera === old) this.camera = track; // أشارك شاشتي: الكاميرا الجديدة تعود بعد إيقاف المشاركة
    await this.pc.getSenders().find((x) => x.track === old)?.replaceTrack(track);
    const view = new MediaStream(this.local.getTracks());
    this.handlers.onLocalStream?.(view);
    return view;
  }

  /**
   * تشغيل الكاميرا أثناء مكالمة صوتية (تحويلها إلى فيديو): نضيف مسار الفيديو ثم نرسل عرضاً جديداً (offer)،
   * والطرف الآخر يرد تلقائياً في handleSignal. لا حاجة لإنهاء المكالمة أو بدء أخرى.
   */
  async enableVideo() {
    if (this.hasVideo) {
      this.cameraOff = false;
      this.local!.getVideoTracks().forEach((t) => (t.enabled = true));
      this.announce();
      return this.local!;
    }
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = cam.getVideoTracks()[0];
    if (!this.local) this.local = new MediaStream();
    this.local.addTrack(track);
    this.cameraOff = false;
    // أشارك شاشتي الآن: تبقى الشاشة هي المعروضة، والكاميرا تحلّ محلها حين أوقف المشاركة
    const sharing = this.pc.getSenders().find((x) => x.track && x.track === this.screen);
    if (sharing) this.camera = track;
    else {
      this.pc.addTrack(track, this.local);
      await this.renegotiate();
    }
    this.announce();
    const view = new MediaStream(this.local.getTracks());
    this.handlers.onLocalStream?.(view);
    return view;
  }

  /**
   * مشاركة الشاشة (في الحاسوب): تحلّ الشاشة محل الكاميرا عند الطرف الآخر، وعند إيقافها تعود الكاميرا.
   * إن لم تكن هناك كاميرا نضيف مسار الشاشة ونرسل عرضاً جديداً.
   */
  async shareScreen(onStop?: () => void) {
    const track = await startScreen();
    const sender = this.pc.getSenders().find((x) => x.track?.kind === "video");
    this.camera = sender?.track ?? null;
    if (sender) await sender.replaceTrack(track);
    else {
      this.pc.addTrack(track, this.local ?? new MediaStream());
      await this.renegotiate();
    }
    this.screen = track;
    track.onended = () => { this.stopScreen(); onStop?.(); };
    this.announce();
    return track;
  }

  async stopScreen() {
    const track = this.screen;
    if (!track) return;
    this.screen = null;
    track.onended = null;
    track.stop();
    const sender = this.pc.getSenders().find((x) => x.track === track);
    if (sender) await sender.replaceTrack(this.camera);
    this.announce();
  }
  screen: MediaStreamTrack | null = null;
  /** الكاميرا التي تعود بعد إيقاف مشاركة الشاشة */
  camera: MediaStreamTrack | null = null;

  private renegotiate() {
    return this.queue(async () => {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signal({ description: this.pc.localDescription!.toJSON() });
    });
  }

  /** إنهاء المكالمة (أو إلغاؤها إذا بعدها ترن) */
  async hangup() {
    this.close();
    await calls.end(this.call.id).catch(() => {});
  }

  /** نسكر كل شي محلياً (مثلاً لما يوصل حدث call_ended) */
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    clearTimeout(this.watchdog);
    this.outbox = [];
    this.local?.getTracks().forEach((t) => t.stop());
    this.pc.close();
  }

  private async openMedia() {
    // المايك (والكاميرا إذا فيديو). المتصفح يطلب إذن المستخدم هنا
    this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.call.kind === "video" });
    this.local.getTracks().forEach((t) => this.pc.addTrack(t, this.local!));
    this.handlers.onLocalStream?.(this.local);
  }

  private signal(data: CallSignal) {
    if (this.closed) return;
    this.outbox.push(data);
    this.flush();
  }

  private flush() {
    while (this.outbox.length) {
      if (!this.socket.send({ type: "call.signal", call_id: this.call.id, to: this.peerId, data: this.outbox[0] })) {
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.flush(), 500);
        return;
      }
      this.outbox.shift();
    }
  }
}

/** مسار الشاشة (المتصفح يسأل المستخدم أي شاشة أو نافذة يشارك) */
async function startScreen() {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c?: object) => Promise<MediaStream> };
  if (!md.getDisplayMedia) throw new Error("screen-unsupported");
  const stream = await md.getDisplayMedia({ video: true, audio: false });
  return stream.getVideoTracks()[0];
}
/** هل يدعم هذا المتصفح مشاركة الشاشة؟ (الحواسيب نعم، والهواتف غالباً لا) */
export const canShareScreen = () => typeof navigator !== "undefined" && !!(navigator.mediaDevices as MediaDevices & { getDisplayMedia?: unknown })?.getDisplayMedia;

// ============================================================ المكالمة الجماعية (حتى 8 أشخاص)
//
// Mesh: كل مشارك يتصل بكل مشارك مباشرة (اتصال WebRTC لكل زوج). لا يمر الصوت ولا الصورة من خادمنا.
//   - من ينضم يأخذ من الخادم قائمة الموجودين (participants) ويرسل عرضاً (offer) لكل واحد منهم.
//   - الموجودون لا يفعلون شيئاً: حين يصلهم عرض من شخص جديد ينشئون له اتصالاً ويردون.
//   - من يغادر: حدث call_left فيغلق الباقون اتصالهم به.
// «التفاوض المهذب» عند تصادم عرضين: الطرف ذو الرقم الأصغر يتنازل.

/** audio: مايكه يعمل (لعلامة «كتم الصوت» على مربعه) */
export type GroupPeer = { userId: number; stream: MediaStream; video: boolean; screen: boolean; audio: boolean; state: RTCPeerConnectionState };
export type GroupHandlers = {
  /** يُستدعى فور إنشاء الجلسة، قبل أي رسالة تعارف: ليحفظها المخزن فلا يفوته ردّ سريع */
  onCreated?: (g: GroupCall) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onPeers?: (peers: GroupPeer[]) => void;
  onMeet?: (from: number, ev: MeetEvent) => void;
};
/** chain: رسائل تعارف هذا المشارك تُعالج بالترتيب واحدة بعد الأخرى (انظر CallSession.chain) */
type Link = { pc: RTCPeerConnection; remote: MediaStream; pending: RTCIceCandidateInit[]; makingOffer: boolean; media: MediaState | null; chain: Promise<void> };

export class GroupCall {
  local: MediaStream | null = null;
  muted = false;
  cameraOff = false;
  screen: MediaStreamTrack | null = null;
  private links = new Map<number, Link>();
  private camera: MediaStreamTrack | null = null;

  private constructor(
    public call: Call,
    private meId: number,
    private socket: Pick<LiveSocket, "send">,
    private handlers: GroupHandlers,
    private ice: RTCIceServer[],
  ) {}

  /** بدء مكالمة في المجموعة (ترنّ عند الجميع) */
  static async start(conversationId: number, kind: CallKind, meId: number, socket: Pick<LiveSocket, "send">, handlers: GroupHandlers = {}) {
    const { ice_servers } = await calls.iceServers();
    const g = new GroupCall({ id: 0, kind } as Call, meId, socket, handlers, ice_servers);
    handlers.onCreated?.(g);
    await g.openMedia(kind);
    try {
      g.call = await calls.start(conversationId, kind);
    } catch (err) {
      g.close();
      throw err;
    }
    return g;
  }

  /** الرد على مكالمة جماعية أو الانضمام إلى مكالمة جارية */
  static async join(call: Call, meId: number, socket: Pick<LiveSocket, "send">, handlers: GroupHandlers = {}) {
    const { ice_servers } = await calls.iceServers();
    const g = new GroupCall(call, meId, socket, handlers, ice_servers);
    handlers.onCreated?.(g);
    await g.openMedia(call.kind);
    try {
      g.call = { ...call, ...(await calls.answer(call.id)) };
    } catch (err) {
      g.close();
      throw err;
    }
    for (const id of g.call.participants ?? []) if (id !== meId) await g.offer(id);
    return g;
  }

  get peers(): GroupPeer[] {
    return [...this.links.entries()].map(([userId, l]) => ({
      userId, stream: l.remote, state: l.pc.connectionState, ...remoteMedia(l.remote, l.media),
    }));
  }

  private emit() {
    this.handlers.onPeers?.(this.peers);
  }

  /**
   * مكالمة ثنائية جارية أُضيف إليها أحد: تصير جماعية دون انقطاع. نأخذ اتصالها القائم كما هو (الصوت والصورة
   * مستمران) ليكون أول رابط في الشبكة، ثم يتصل المنضمّون الجدد بكل مشارك.
   */
  static adopt(s: CallSession, meId: number, socket: Pick<LiveSocket, "send">, handlers: GroupHandlers = {}) {
    const g = new GroupCall({ ...s.call, multi: true }, meId, socket, handlers, s.call.ice_servers ?? []);
    handlers.onCreated?.(g);
    g.local = s.local;
    g.muted = s.muted;
    g.cameraOff = s.cameraOff;
    g.screen = s.screen;
    g.camera = s.camera;
    if (s.screen) s.screen.onended = () => g.stopScreen();
    const l: Link = { pc: s.pc, remote: new MediaStream(s.remote.getTracks()), pending: [], makingOffer: false, media: s.peerMedia, chain: Promise.resolve() };
    l.remote.getTracks().forEach((t) => {
      t.onunmute = () => g.emit();
      t.onmute = () => g.emit();
      t.onended = () => g.emit();
    });
    g.links.set(s.peerId, l);
    g.attach(s.peerId, l);
    g.emit();
    return g;
  }

  private link(peerId: number) {
    const existing = this.links.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const l: Link = { pc, remote: new MediaStream(), pending: [], makingOffer: false, media: null, chain: Promise.resolve() };
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    if (this.screen) {
      const sender = pc.getSenders().find((x) => x.track?.kind === "video");
      if (sender) sender.replaceTrack(this.screen);
      else pc.addTrack(this.screen, this.local ?? new MediaStream());
    }
    this.links.set(peerId, l);
    this.attach(peerId, l);
    this.emit();
    return l;
  }

  /** أحداث اتصال مشارك واحد: عناوينه، ومساراته، وحالته */
  private attach(peerId: number, l: Link) {
    const pc = l.pc;
    pc.onicecandidate = (e) => e.candidate && this.signal(peerId, { candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      // نسخة جديدة في كل مرة ليعيد عنصر <video> قراءتها (سفاري)
      if (!l.remote.getTracks().includes(e.track)) l.remote.addTrack(e.track);
      l.remote = new MediaStream(l.remote.getTracks());
      e.track.onunmute = () => this.emit();
      e.track.onmute = () => this.emit();
      e.track.onended = () => this.emit();
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      // اتصلنا به: نعلن له حالة كاميرتي وشاشتي
      if (pc.connectionState === "connected") this.signal(peerId, { media: this.media });
      this.emit();
    };
  }

  private queue(peerId: number, task: (l: Link) => Promise<void>) {
    const l = this.link(peerId);
    l.chain = l.chain.then(() => task(l)).catch(() => {});
    return l.chain;
  }

  /** عرض جديد لمشارك (بعد ما في الطابور من رسائله) */
  private offer(peerId: number) {
    return this.queue(peerId, () => this.makeOffer(peerId));
  }

  private async makeOffer(peerId: number) {
    const l = this.link(peerId);
    try {
      l.makingOffer = true;
      await l.pc.setLocalDescription(await l.pc.createOffer());
      this.signal(peerId, { description: l.pc.localDescription!.toJSON() });
    } finally {
      l.makingOffer = false;
    }
  }

  /** رسالة تعارف من مشارك (قد يكون جديداً لم نعرفه بعد) */
  handleSignal(from: number, data: CallSignal) {
    return this.queue(from, (l) => this.process(l, from, data));
  }

  private async process(l: Link, from: number, data: CallSignal) {
    const polite = this.meId < from;
    if ("meet" in data) {
      this.handlers.onMeet?.(from, data.meet);
    } else if ("media" in data) {
      l.media = data.media;
      this.emit();
    } else if ("description" in data) {
      const offer = data.description.type === "offer";
      const collision = offer && (l.makingOffer || l.pc.signalingState !== "stable");
      if (collision && !polite) return;
      if (collision) await l.pc.setLocalDescription({ type: "rollback" });
      await l.pc.setRemoteDescription(data.description);
      for (const c of l.pending.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
      if (offer) {
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        this.signal(from, { description: l.pc.localDescription!.toJSON() });
        // عرضه بلا مكان لكاميرتي أو شاشتي (انضمّ بالصوت فقط): نرسل له عرضاً جديداً حتى يراهما
        if (l.pc.getTransceivers().some((tr) => tr.sender.track && !tr.mid)) await this.makeOffer(from);
      }
    } else if ("candidate" in data) {
      if (l.pc.remoteDescription) await l.pc.addIceCandidate(data.candidate).catch(() => {});
      else l.pending.push(data.candidate);
    }
  }

  /** غادر أحدهم */
  peerLeft(userId: number) {
    const l = this.links.get(userId);
    if (!l) return;
    l.pc.close();
    this.links.delete(userId);
    this.emit();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this.announce();
    return this.muted;
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    this.announce();
    return this.cameraOff;
  }

  get hasVideo() {
    return !!this.local?.getVideoTracks().length;
  }

  get media(): MediaState {
    return { video: !!this.screen || (this.hasVideo && !this.cameraOff), screen: !!this.screen, audio: !this.muted };
  }

  /** دردشة أو تفاعل أو رفع يد: إلى كل المشاركين */
  sendMeet(ev: MeetEvent) {
    for (const peerId of this.links.keys()) this.signal(peerId, { meet: ev });
  }

  /** الأمامية ↔ الخلفية لكل المشاركين (دون إعادة التفاوض) */
  async switchCamera() {
    const old = this.local?.getVideoTracks()[0];
    const track = old && await nextCamera(old);
    if (!old || !track || !this.local) return null;
    track.enabled = !this.cameraOff;
    this.local.removeTrack(old);
    this.local.addTrack(track);
    if (this.camera === old) this.camera = track;
    for (const l of this.links.values()) await l.pc.getSenders().find((x) => x.track === old)?.replaceTrack(track);
    const view = new MediaStream(this.local.getTracks());
    this.handlers.onLocalStream?.(view);
    return view;
  }

  /** نخبر الجميع بحالة كاميرتي وشاشتي (بعد كل تغيير) */
  private announce() {
    for (const peerId of this.links.keys()) this.signal(peerId, { media: this.media });
  }

  /** تشغيل الكاميرا أثناء مكالمة صوتية: نضيف المسار لكل اتصال ونعيد التفاوض معه */
  async enableVideo() {
    if (this.hasVideo) {
      this.cameraOff = false;
      this.local!.getVideoTracks().forEach((t) => (t.enabled = true));
      this.announce();
      return this.local!;
    }
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = cam.getVideoTracks()[0];
    if (!this.local) this.local = new MediaStream();
    this.local.addTrack(track);
    this.cameraOff = false;
    if (this.screen) this.camera = track; // تبقى الشاشة معروضة، والكاميرا بعد إيقافها
    else {
      for (const [peerId, l] of this.links) {
        l.pc.addTrack(track, this.local);
        await this.offer(peerId);
      }
    }
    this.announce();
    const view = new MediaStream(this.local.getTracks());
    this.handlers.onLocalStream?.(view);
    return view;
  }

  /** مشاركة الشاشة مع الجميع (تحلّ محل الكاميرا حتى تتوقف) */
  async shareScreen(onStop?: () => void) {
    const track = await startScreen();
    this.camera = this.local?.getVideoTracks()[0] ?? null;
    this.screen = track;
    for (const [peerId, l] of this.links) {
      const sender = l.pc.getSenders().find((x) => x.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
      else {
        l.pc.addTrack(track, this.local ?? new MediaStream());
        await this.offer(peerId);
      }
    }
    track.onended = () => { this.stopScreen(); onStop?.(); };
    this.announce();
    return track;
  }

  async stopScreen() {
    const track = this.screen;
    if (!track) return;
    this.screen = null;
    track.onended = null;
    track.stop();
    for (const l of this.links.values()) {
      const sender = l.pc.getSenders().find((x) => x.track === track);
      if (sender) await sender.replaceTrack(this.camera);
    }
    this.announce();
  }

  /** مغادرة المكالمة (تبقى لمن بقي، وتنتهي حين يغادر الأخير) */
  async leave() {
    this.close();
    if (this.call.id) await calls.leave(this.call.id).catch(() => {});
  }

  close() {
    this.screen?.stop();
    this.local?.getTracks().forEach((t) => t.stop());
    for (const l of this.links.values()) l.pc.close();
    this.links.clear();
  }

  private async openMedia(kind: CallKind) {
    this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "video" });
    this.handlers.onLocalStream?.(this.local);
  }

  private signal(to: number, data: CallSignal) {
    this.socket.send({ type: "call.signal", call_id: this.call.id, to, data });
  }
}
