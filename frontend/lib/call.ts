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
//             s.hangup() ، s.toggleMute() ، s.toggleCamera()
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
    // صوت/صورة الطرف الثاني توصل هنا
    this.pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => this.remote.getTracks().includes(t) || this.remote.addTrack(t));
      if (!e.streams[0]) this.remote.addTrack(e.track);
      handlers.onRemoteStream?.(this.remote);
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

  /** أي رسالة تعارف توصل من الطرف الثاني */
  async handleSignal(data: CallSignal) {
    if ("description" in data) {
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
