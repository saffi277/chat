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
import type { CallSignal, LiveSocket } from "./socket";

export type CallHandlers = {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onState?: (state: RTCPeerConnectionState) => void;
};

export class CallSession {
  readonly pc: RTCPeerConnection;
  local: MediaStream | null = null;
  readonly remote = new MediaStream();
  muted = false;
  cameraOff = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  private constructor(
    public call: Call,
    public peerId: number,
    private socket: Pick<LiveSocket, "send">,
    private handlers: CallHandlers,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: call.ice_servers ?? [] });
    // كل عنوان يلكاه المتصفح ندزه للطرف الثاني
    this.pc.onicecandidate = (e) => e.candidate && this.signal({ candidate: e.candidate.toJSON() });
    // صوت/صورة الطرف الآخر تصل هنا (ومسار الفيديو قد يصل لاحقاً إذا حوّل المكالمة إلى فيديو)
    this.pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => this.remote.getTracks().includes(t) || this.remote.addTrack(t));
      if (!this.remote.getTracks().includes(e.track)) this.remote.addTrack(e.track);
      // نسخة جديدة من البث في كل مرة، ليعيد عنصر <video> قراءته (سفاري لا يلاحظ المسارات المضافة لاحقاً)
      const emit = () => handlers.onRemoteStream?.(new MediaStream(this.remote.getTracks()));
      e.track.onunmute = emit;
      emit();
    };
    this.pc.onconnectionstatechange = () => handlers.onState?.(this.pc.connectionState);
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
  }

  /** هل المتصل أنا؟ (عند تعارض عرضين في اللحظة نفسها يتنازل المستلم، وهو الطرف "المهذب") */
  get polite() {
    return this.call.caller?.id === this.peerId;
  }

  /** أي رسالة تعارف تصل من الطرف الآخر */
  async handleSignal(data: CallSignal) {
    if ("description" in data) {
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
    return this.muted;
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    return this.cameraOff;
  }

  get hasVideo() {
    return !!this.local?.getVideoTracks().length;
  }

  /**
   * تشغيل الكاميرا أثناء مكالمة صوتية (تحويلها إلى فيديو): نضيف مسار الفيديو ثم نرسل عرضاً جديداً (offer)،
   * والطرف الآخر يرد تلقائياً في handleSignal. لا حاجة لإنهاء المكالمة أو بدء أخرى.
   */
  async enableVideo() {
    if (this.hasVideo) {
      this.cameraOff = false;
      this.local!.getVideoTracks().forEach((t) => (t.enabled = true));
      return this.local!;
    }
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = cam.getVideoTracks()[0];
    if (!this.local) this.local = new MediaStream();
    this.local.addTrack(track);
    this.pc.addTrack(track, this.local);
    this.cameraOff = false;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signal({ description: this.pc.localDescription!.toJSON() });
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
  }
  screen: MediaStreamTrack | null = null;
  private camera: MediaStreamTrack | null = null;

  private async renegotiate() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signal({ description: this.pc.localDescription!.toJSON() });
  }

  /** إنهاء المكالمة (أو إلغاؤها إذا بعدها ترن) */
  async hangup() {
    this.close();
    await calls.end(this.call.id).catch(() => {});
  }

  /** نسكر كل شي محلياً (مثلاً لما يوصل حدث call_ended) */
  close() {
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
    this.socket.send({ type: "call.signal", call_id: this.call.id, to: this.peerId, data });
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

export type GroupPeer = { userId: number; stream: MediaStream; video: boolean; state: RTCPeerConnectionState };
export type GroupHandlers = {
  /** يُستدعى فور إنشاء الجلسة، قبل أي رسالة تعارف: ليحفظها المخزن فلا يفوته ردّ سريع */
  onCreated?: (g: GroupCall) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onPeers?: (peers: GroupPeer[]) => void;
};
type Link = { pc: RTCPeerConnection; remote: MediaStream; pending: RTCIceCandidateInit[]; makingOffer: boolean };

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
      userId, stream: l.remote, state: l.pc.connectionState,
      video: l.remote.getVideoTracks().some((t) => t.readyState === "live" && !t.muted),
    }));
  }

  private emit() {
    this.handlers.onPeers?.(this.peers);
  }

  private link(peerId: number) {
    const existing = this.links.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const l: Link = { pc, remote: new MediaStream(), pending: [], makingOffer: false };
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    if (this.screen) {
      const sender = pc.getSenders().find((x) => x.track?.kind === "video");
      if (sender) sender.replaceTrack(this.screen);
      else pc.addTrack(this.screen, this.local ?? new MediaStream());
    }
    pc.onicecandidate = (e) => e.candidate && this.signal(peerId, { candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      // نسخة جديدة في كل مرة ليعيد عنصر <video> قراءتها (سفاري)
      if (!l.remote.getTracks().includes(e.track)) l.remote.addTrack(e.track);
      l.remote = new MediaStream(l.remote.getTracks());
      e.track.onunmute = () => this.emit();
      e.track.onmute = () => this.emit();
      this.emit();
    };
    pc.onconnectionstatechange = () => this.emit();
    this.links.set(peerId, l);
    this.emit();
    return l;
  }

  private async offer(peerId: number) {
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
  async handleSignal(from: number, data: CallSignal) {
    const l = this.link(from);
    const polite = this.meId < from;
    if ("description" in data) {
      const offer = data.description.type === "offer";
      const collision = offer && (l.makingOffer || l.pc.signalingState !== "stable");
      if (collision && !polite) return;
      if (collision) await l.pc.setLocalDescription({ type: "rollback" });
      await l.pc.setRemoteDescription(data.description);
      for (const c of l.pending.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
      if (offer) {
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        this.signal(from, { description: l.pc.localDescription!.toJSON() });
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
    return this.muted;
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff));
    return this.cameraOff;
  }

  get hasVideo() {
    return !!this.local?.getVideoTracks().length;
  }

  /** تشغيل الكاميرا أثناء مكالمة صوتية: نضيف المسار لكل اتصال ونعيد التفاوض معه */
  async enableVideo() {
    if (this.hasVideo) {
      this.cameraOff = false;
      this.local!.getVideoTracks().forEach((t) => (t.enabled = true));
      return this.local!;
    }
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = cam.getVideoTracks()[0];
    if (!this.local) this.local = new MediaStream();
    this.local.addTrack(track);
    this.cameraOff = false;
    for (const [peerId, l] of this.links) {
      l.pc.addTrack(track, this.local);
      await this.offer(peerId);
    }
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
