"use client";
import { useEffect, useRef, useState } from "react";
import type { Call } from "@/lib/api";
import { cameraCount, canShareScreen, type GroupPeer } from "@/lib/call";
import { useT } from "@/lib/i18n";
import { calls as callsApi, conversations as convApi } from "@/lib/endpoints";
import { Avatar, Chip, duration, Empty, IconButton, listTime, nameOf } from "./bits";
import { ScreenHeader } from "./ChatList";
import { Icon, type IconName } from "./icons";
import { PickPeople } from "./Profiles";
import { CALL_REACTIONS, useWasl } from "./store";

/** «إضافة» أثناء المكالمة (مثل واتساب): نختار من جهات الاتصال، فيرنّ عندهم وتصير المكالمة جماعية */
function AddToCall({ exclude, onClose }: { exclude: number[]; onClose: () => void }) {
  const t = useT();
  const { inviteToCall } = useWasl();
  return (
    <PickPeople title={t("إضافة إلى المكالمة")} confirmLabel={t("إضافة")} exclude={exclude} onCancel={onClose}
      onConfirm={(ids) => { onClose(); inviteToCall(ids); }} />
  );
}

// ------------------------------------------------------------ سجل المكالمات
export function CallsView() {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "missed">("all");
  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ScreenHeader title={t("المكالمات")} />
        <div className="mt-4 flex gap-2">
          <Chip label={t("الكل")} active={filter === "all"} onClick={() => setFilter("all")} />
          <Chip label={t("الفائتة")} active={filter === "missed"} onClick={() => setFilter("missed")} />
        </div>
      </header>
      <div className="w-scroll mt-2 flex-1 overflow-y-auto pb-4"><CallLog missed={filter === "missed"} /></div>
    </div>
  );
}

/** قائمة المكالمات (في شاشة المكالمات، وفي تبويب "المكالمات" بقائمة المحادثات) */
export function CallLog({ missed }: { missed?: boolean }) {
  const t = useT();
  const { convs, startCall, call, setPanel } = useWasl();
  const [log, setLog] = useState<Call[] | null>(null);
  useEffect(() => {
    callsApi.log(missed ? "missed" : undefined).then(setLog).catch(() => setLog([]));
  }, [missed, call?.phase]);

  const again = async (c: Call) => {
    if (!c.peer) return;
    const conv = convs.find((x) => x.id === c.conversation) ?? (await convApi.openWith(c.peer.id));
    startCall(conv, c.kind);
  };

  return (
    <>
      {log?.length === 0 && <Empty icon="phone" title={t("لا توجد مكالمات")} text={t("اتصل بأي شخص من زر السماعة أعلى المحادثة.")} />}
      {log?.map((c) => {
        const isMissed = c.direction === "missed";
        const name = c.peer ? nameOf(c.peer) : c.title || t("مجموعة");
        return (
          <div key={c.id} className="w-hover flex items-center gap-3 px-4">
            <button className="py-2.5" onClick={() => c.peer && setPanel({ type: "contact", userId: c.peer.id })}>
              <Avatar user={c.peer} name={name} size={52} />
            </button>
            <div className="w-line flex min-w-0 flex-1 items-center gap-3 self-stretch border-b py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-bold" style={isMissed ? { color: "var(--danger)" } : undefined}>{name}</div>
                <div className="w-muted mt-1 flex items-center gap-1 text-[13px]">
                  <span style={{ color: isMissed ? "var(--danger)" : "var(--call)" }}><Icon name={c.direction === "outgoing" ? "outgoing" : "incoming"} size={14} strokeWidth={2.4} /></span>
                  <Icon name={c.kind === "video" ? "video" : "phone"} size={13} />
                  {isMissed ? t("فائتة") : c.status === "declined" ? t("مرفوضة") : c.duration ? duration(c.duration) : t(c.direction === "outgoing" ? "صادرة" : "واردة")}
                  <span>• {listTime(c.created_at)}</span>
                </div>
              </div>
              {c.peer && <IconButton icon={c.kind === "video" ? "video" : "phone"} label={t("اتصل مرة أخرى")} onClick={() => again(c)} />}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------ شاشة المكالمة
/** onFrames: هل وصلت صورة فعلاً؟ (حتى تبقى الصورة الشخصية ظاهرة بدل مربع أسود ريثما يصل الفيديو) */
function Video({ stream, muted, className, onFrames }: { stream: MediaStream | null; muted?: boolean; className: string; onFrames?: (has: boolean) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onFrames) return;
    const check = () => onFrames(el.videoWidth > 0);
    const events = ["loadeddata", "resize", "playing", "emptied"];
    events.forEach((e) => el.addEventListener(e, check));
    check();
    return () => {
      events.forEach((e) => el.removeEventListener(e, check));
      onFrames(false);
    };
  }, [onFrames]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream || el.srcObject === stream) return;
    el.srcObject = stream;
    // سفاري (الآيفون) لا يبدأ أحياناً بثاً أُسند بعد ظهور العنصر رغم autoPlay: نطلب التشغيل صراحة
    el.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{duration((now - since) / 1000)}</>;
}

// ------------------------------------------------------------ من يتكلم الآن؟
// نقيس مستوى الصوت على الجهاز نفسه (Web Audio)، بسياق صوتي واحد مشترك لكل المربعات
let audioCtx: AudioContext | null = null;
function sharedAudio() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
    // سفاري يبدأ السياق متوقفاً حتى يلمس المستخدم الشاشة
    if (audioCtx.state === "suspended") document.addEventListener("pointerdown", () => audioCtx?.resume().catch(() => {}), { once: true });
  }
  return audioCtx;
}

function useSpeaking(stream: MediaStream | null, enabled = true) {
  const track = enabled ? stream?.getAudioTracks()[0] ?? null : null;
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const ctx = track && sharedAudio();
    if (!track || !ctx) return;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // نحو 43 جزءاً من الثانية في كل قياس، فلا تفوتنا الأصوات القصيرة
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let on = false;
    let quietSince = 0;
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const loud = Math.sqrt(sum / buf.length) > 0.04;
      const now = Date.now();
      if (loud) {
        quietSince = 0;
        if (!on) { on = true; setSpeaking(true); }
      } else if (on) {
        // نصف ثانية من الهدوء قبل إطفاء الإبراز، كي لا يومض بين الكلمات
        if (!quietSince) quietSince = now;
        else if (now - quietSince > 600) { on = false; setSpeaking(false); }
      }
    }, 100);
    return () => {
      clearInterval(timer);
      source.disconnect();
      setSpeaking(false);
    };
  }, [track]);
  return speaking && !!track;
}

// ------------------------------------------------------------ أدوات أعلى الشاشة: ملء الشاشة، والنافذة العائمة، وتبديل الكاميرا، والتكبير
function useFullscreen(ref: React.RefObject<HTMLDivElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else ref.current?.requestFullscreen().catch(() => {});
  };
  // الآيفون لا يسمح بملء الشاشة إلا لعنصر الفيديو نفسه، والتطبيق المثبّت يملأ الشاشة أصلاً
  const supported = typeof document !== "undefined" && !!document.fullscreenEnabled;
  return { on, toggle, supported };
}

/** الفيديو المعروض في الوسط (المكبَّر): للنافذة العائمة (Picture-in-Picture) */
function pipVideo() {
  return document.querySelector<HTMLVideoElement>("[data-pip] video");
}
async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await pipVideo()?.requestPictureInPicture();
  } catch { /* المتصفح رفض (مثلاً لا فيديو بعد) */ }
}

function TopTools({ fs, video, camera, zoom, onZoom, dark }: {
  fs: ReturnType<typeof useFullscreen>; video: boolean; camera: boolean; zoom?: boolean; onZoom?: () => void; dark?: boolean;
}) {
  const t = useT();
  const { switchCamera } = useWasl();
  const [cams, setCams] = useState(0);
  useEffect(() => {
    if (camera) cameraCount().then(setCams);
  }, [camera]);
  const pip = typeof document !== "undefined" && !!document.pictureInPictureEnabled && video;
  const cls = `grid h-10 w-10 place-items-center rounded-full backdrop-blur ${dark ? "bg-black/45 text-white" : "w-card"}`;
  return (
    <div className="absolute end-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex flex-col gap-2">
      {camera && cams > 1 && <button onClick={switchCamera} className={cls} aria-label={t("تبديل الكاميرا")} title={t("تبديل الكاميرا")}><Icon name="switchCamera" size={19} /></button>}
      {onZoom && <button onClick={onZoom} className={cls} aria-label={t(zoom ? "تصغير" : "تكبير")} title={t(zoom ? "تصغير" : "تكبير")} aria-pressed={zoom}><Icon name={zoom ? "zoomOut" : "zoomIn"} size={19} /></button>}
      {pip && <button onClick={togglePip} className={cls} aria-label={t("نافذة عائمة")} title={t("نافذة عائمة")}><Icon name="pip" size={19} /></button>}
      {fs.supported && <button onClick={fs.toggle} className={cls} aria-label={t(fs.on ? "الخروج من ملء الشاشة" : "ملء الشاشة")} title={t(fs.on ? "الخروج من ملء الشاشة" : "ملء الشاشة")} aria-pressed={fs.on}>
        <Icon name={fs.on ? "minimize" : "maximize"} size={19} /></button>}
    </div>
  );
}

// ------------------------------------------------------------ الدردشة والتفاعلات ورفع اليد
function ChatSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { call, me, userById, sendCallChat, readCallChat } = useWasl();
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const chat = call?.chat ?? [];
  useEffect(() => {
    readCallChat();
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, readCallChat]);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    sendCallChat(text);
    setText("");
  };
  return (
    <div role="dialog" aria-label={t("دردشة المكالمة")} className="w-strong absolute inset-x-0 bottom-0 z-30 flex h-[62%] flex-col rounded-t-[28px] shadow-2xl md:inset-y-0 md:start-auto md:end-0 md:h-full md:w-80 md:rounded-none"
      style={{ color: "var(--text)", border: "1px solid var(--border)" }}>
      <header className="flex items-center gap-2 px-4 pt-4">
        <h3 className="flex-1 text-base font-extrabold">{t("دردشة المكالمة")}</h3>
        <button onClick={onClose} className="w-muted" aria-label={t("إغلاق")}><Icon name="x" size={20} /></button>
      </header>
      <p className="w-muted px-4 text-[11px]">{t("تراها في هذه المكالمة فقط، ولا تُحفظ بعد انتهائها.")}</p>
      <div ref={list} className="w-scroll flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {!chat.length && <p className="w-muted pt-6 text-center text-sm">{t("لا رسائل بعد")}</p>}
        {chat.map((m) => {
          const mine = m.from === me.id;
          const who = mine ? t("أنت") : nameOf(userById(m.from) ?? call?.peer ?? { display_name: "", username: t("عضو") });
          return (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? "w-bubble-out ms-auto" : "w-bubble-in"}`} data-testid="call-chat-message">
              <div className="text-[11px] font-bold opacity-70">{who}</div>
              <div dir="auto" className="whitespace-pre-wrap break-words">{m.text}</div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} dir="auto" placeholder={t("اكتب رسالة...")} aria-label={t("رسالة في المكالمة")}
          className="w-input h-11 min-w-0 flex-1 rounded-full px-4 text-base outline-none md:text-sm" />
        <button type="submit" disabled={!text.trim()} aria-label={t("إرسال")} className="w-accent grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40"><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}

/** التفاعلات السريعة ورفع اليد: شريط صغير فوق أزرار المكالمة */
function ReactBar({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { call, me, sendReaction, toggleHand } = useWasl();
  const handUp = (call?.hands ?? []).includes(me.id);
  return (
    <div role="menu" aria-label={t("تفاعل")} className="w-strong flex items-center gap-1 rounded-full p-1.5 shadow-2xl" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
      {CALL_REACTIONS.map((e) => (
        <button key={e} role="menuitem" onClick={() => sendReaction(e)} className="w-hover grid h-10 w-10 place-items-center rounded-full text-2xl" aria-label={e}>{e}</button>
      ))}
      <button role="menuitemcheckbox" onClick={() => { toggleHand(); onClose(); }} aria-checked={handUp}
        className={`flex h-10 items-center gap-1 rounded-full px-3 text-sm font-bold ${handUp ? "w-accent" : "w-tint"}`}>
        <Icon name="hand" size={17} />{t(handUp ? "إنزال اليد" : "رفع اليد")}
      </button>
    </div>
  );
}

/** التفاعلات تطفو من أسفل الشاشة ومعها اسم صاحبها */
function FloatingReactions() {
  const { call, me, userById } = useWasl();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 h-0" aria-live="polite">
      {(call?.reactions ?? []).map((r) => {
        const x = 12 + ([...r.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 70);
        const who = r.from === me.id ? "" : nameOf(userById(r.from) ?? call?.peer ?? { display_name: "", username: "" });
        return (
          <span key={r.id} className="w-float absolute bottom-0 grid justify-items-center" style={{ insetInlineStart: `${x}%` }} data-testid="call-reaction">
            <span className="text-4xl drop-shadow">{r.emoji}</span>
            {who && <span className="mt-0.5 rounded-full bg-black/55 px-2 text-[11px] font-bold text-white">{who}</span>}
          </span>
        );
      })}
    </div>
  );
}

export function CallOverlay() {
  const t = useT();
  const { call, me, acceptCall, declineCall, hangup, toggleMute, toggleCamera, enableVideo, toggleScreen } = useWasl();
  const [speaker, setSpeaker] = useState(true);
  const [adding, setAdding] = useState(false);
  const [remoteFrames, setRemoteFrames] = useState(false);
  const [sheet, setSheet] = useState<"chat" | "react" | null>(null);
  const [zoom, setZoom] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(shell);
  const zoomBox = useRef<HTMLDivElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const live = call?.phase === "active";
  const peerSpeaking = useSpeaking(call?.remote ?? null, live && call?.remoteAudio !== false);
  useEffect(() => {
    if (remoteAudio.current && call?.remote && remoteAudio.current.srcObject !== call.remote) remoteAudio.current.srcObject = call.remote;
  }, [call?.remote]);
  useEffect(() => {
    if (remoteAudio.current) remoteAudio.current.volume = speaker ? 1 : 0.35;
  }, [speaker]);
  // التكبير يبدأ من وسط الشاشة المشاركة (في العربية يكون التمرير الأفقي بالسالب)
  useEffect(() => {
    const el = zoomBox.current;
    if (!zoom || !el) return;
    const x = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTo({ left: getComputedStyle(el).direction === "rtl" ? -x : x, top: (el.scrollHeight - el.clientHeight) / 2 });
  }, [zoom]);
  if (!call) return null;
  // المكالمة الجماعية (أو الثنائية بعد إضافة أحد إليها) بعد الرد: شبكة المشاركين
  if ((call.call.conversation_kind === "group" || call.call.multi) && call.phase !== "incoming" && call.phase !== "ended") return <GroupCallView />;

  const video = call.call.kind === "video";
  const groupIncoming = call.call.conversation_kind === "group" || !!call.call.multi;
  const invitedBy = call.call.invited_by;
  // المجموعة: اسمها في الأعلى، ومن يتصل تحته. والدعوة إلى مكالمة جارية: من دعاني
  const peerName = invitedBy ? nameOf(invitedBy) : groupIncoming ? call.call.title || t("مكالمة جماعية") : call.peer ? nameOf(call.peer) : "";
  const statusText =
    call.phase === "incoming" ? t(video ? "مكالمة فيديو واردة..." : "مكالمة صوتية واردة...")
      : call.phase === "outgoing" ? t("يرنّ...")
        : call.phase === "connecting" ? t("جارٍ الاتصال...")
          : call.phase === "ended" ? call.endedText ?? t("انتهت المكالمة") : null;
  // نعرض الفيديو متى وصل مسار فيديو فعلاً (حتى لو بدأت المكالمة صوتية ثم تحوّلت)
  const videoOn = live && !!call.remote && !!call.remoteVideo;
  const showVideo = videoOn && remoteFrames;
  const myCamera = !!call.local?.getVideoTracks().length;
  const peerMuted = live && call.remoteAudio === false;
  const peerHand = !!call.peer && (call.hands ?? []).includes(call.peer.id);
  // الشاشة المشاركة على الهاتف صغيرة: «تكبير» يضاعف حجمها ويمكن تحريكها بالسحب
  const zoomed = zoom && showVideo && !!call.remoteScreen;

  return (
    <div ref={shell} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className={`w-strong relative flex h-full w-full flex-col items-center overflow-hidden ${fs.on ? "" : "md:h-[88dvh] md:max-w-2xl md:rounded-[36px]"}`}
        style={{ border: "1px solid var(--border)", background: showVideo ? "#000" : undefined }}>
        {/* الصوت يخرج من عنصر audio في الأسفل، لذا الفيديو مكتوم كي لا يتكرر الصوت */}
        {/* الشاشة المشاركة تُعرض كاملة (contain) كي لا يُقصّ منها شيء على الهاتف، والكاميرا تملأ الشاشة (cover) */}
        {videoOn && (
          <div ref={zoomBox} data-pip className={`absolute inset-0 ${zoomed ? "w-scroll flex items-center overflow-auto" : "overflow-hidden"}`}>
            <Video stream={call.remote} muted onFrames={setRemoteFrames}
              className={`${zoomed ? "h-auto w-[200%] max-w-none shrink-0" : `h-full w-full ${call.remoteScreen ? "object-contain" : "object-cover"}`} ${showVideo ? "" : "opacity-0"}`} />
          </div>
        )}
        {myCamera && call.local && call.phase !== "ended" && (
          <Video stream={call.local} muted className="absolute start-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-40 w-28 rounded-2xl object-cover shadow-xl" />
        )}
        <audio ref={remoteAudio} autoPlay />
        {(live || call.phase === "connecting") && (
          <TopTools fs={fs} video={showVideo} camera={myCamera && !call.cameraOff} dark={showVideo}
            zoom={zoom} onZoom={showVideo && call.remoteScreen ? () => setZoom((z) => !z) : undefined} />
        )}

        {!showVideo && (
          <div className="mt-[12dvh] flex flex-col items-center text-center">
            <div className={`rounded-full p-1.5 transition-shadow ${call.phase === "incoming" || call.phase === "outgoing" ? "w-pulse" : ""}`}
              style={peerSpeaking ? { boxShadow: "0 0 0 5px var(--accent)" } : undefined} data-speaking={peerSpeaking || undefined}>
              <Avatar user={invitedBy ?? call.peer} size={132} ring />
            </div>
            <h2 className="mt-6 text-3xl font-extrabold" dir="auto">{peerName}</h2>
            {invitedBy ? <p className="mt-1 text-sm font-semibold">{t("يدعوك إلى المكالمة")}</p>
              : groupIncoming && call.peer && <p className="mt-1 text-sm font-semibold">{t("{name} يتصل بالمجموعة", { name: nameOf(call.peer) })}</p>}
            <p className="w-muted mt-2 text-lg font-bold" dir="ltr">{statusText ?? (call.startedAt ? <Timer since={call.startedAt} /> : "")}</p>
            <PeerBadges muted={peerMuted} hand={peerHand} />
            {live && (
              <div className="w-wave mt-8 flex h-10 items-center gap-1" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => <span key={i} className="w-1.5 rounded-full" style={{ height: "100%", background: "var(--accent)", animationDelay: `${(i % 6) * 0.12}s` }} />)}
              </div>
            )}
          </div>
        )}
        {showVideo && (
          <div className="pointer-events-none absolute inset-x-0 top-[max(1.5rem,env(safe-area-inset-top))] grid justify-items-center text-center text-white drop-shadow">
            <div className="text-xl font-extrabold">{peerName}</div>
            <div dir="ltr">{call.startedAt && <Timer since={call.startedAt} />}</div>
            <PeerBadges muted={peerMuted} hand={peerHand} dark />
          </div>
        )}
        {live && <FloatingReactions />}

        {/* فوق الفيديو: تدرّج داكن خلف الأزرار حتى تبقى مقروءة فوق أي محتوى (مثل شاشة بيضاء) */}
        <div className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-5 p-6 pb-[max(2rem,env(safe-area-inset-bottom))] ${showVideo ? "bg-gradient-to-t from-black/75 via-black/40 to-transparent pt-16 text-white" : ""}`}>
          {call.phase === "incoming" ? (
            <div className="flex w-full justify-around">
              <button onClick={declineCall} className="grid justify-items-center gap-2 font-bold" aria-label={t("رفض")}>
                <span className="w-danger grid h-18 w-18 place-items-center rounded-full p-5 shadow-lg"><Icon name="phoneOff" size={30} /></span>{t("رفض")}
              </button>
              <button onClick={acceptCall} className="grid justify-items-center gap-2 font-bold" aria-label={t("رد")}>
                <span className="grid h-18 w-18 place-items-center rounded-full p-5 text-white shadow-lg w-pulse" style={{ background: "var(--online)" }}><Icon name={video ? "video" : "phone"} size={30} /></span>{t("رد")}
              </button>
            </div>
          ) : call.phase !== "ended" ? (
            <>
              {sheet === "react" && <ReactBar onClose={() => setSheet(null)} />}
              {/* الأزرار تلتفّ إلى سطرين في الهاتف بدل أن تخرج عن الشاشة */}
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-3 px-1">
                <Ctl dark={showVideo} icon={call.muted ? "micOff" : "mic"} label={t(call.muted ? "إلغاء الكتم" : "كتم الصوت")} on={call.muted} onClick={toggleMute} />
                {myCamera ? (
                  <Ctl dark={showVideo} icon={call.cameraOff ? "videoOff" : "video"} label={t(call.cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا")} on={call.cameraOff} onClick={toggleCamera} />
                ) : (
                  // مكالمة صوتية (أو فيديو لم أشغّل فيها كاميرتي بعد): زر للتحويل إلى فيديو
                  <Ctl dark={showVideo} icon="video" label={t(video ? "تشغيل الكاميرا" : "فيديو")} on={false} onClick={enableVideo}
                    disabled={call.phase !== "active" && call.phase !== "connecting"} />
                )}
                {!myCamera && <Ctl dark={showVideo} icon="speaker" label={t("مكبّر الصوت")} on={speaker} onClick={() => setSpeaker((s) => !s)} />}
                {canShareScreen() && live && (
                  <Ctl dark={showVideo} icon="screen" label={t(call.sharing ? "إيقاف المشاركة" : "مشاركة الشاشة")} on={!!call.sharing} onClick={toggleScreen} />
                )}
                {live && <Ctl dark={showVideo} icon="chats" label={t("الدردشة")} on={sheet === "chat"} badge={call.unread} onClick={() => setSheet((s) => (s === "chat" ? null : "chat"))} />}
                {live && <Ctl dark={showVideo} icon="smile" label={t("تفاعل")} on={sheet === "react" || (call.hands ?? []).includes(me.id)} onClick={() => setSheet((s) => (s === "react" ? null : "react"))} />}
                {live && <Ctl dark={showVideo} icon="userPlus" label={t("إضافة")} on={false} onClick={() => setAdding(true)} />}
              </div>
              <button onClick={hangup} aria-label={t("إنهاء المكالمة")} className="w-danger grid h-18 w-18 place-items-center rounded-full p-5 shadow-lg">
                <Icon name="phoneOff" size={30} />
              </button>
            </>
          ) : null}
        </div>
        {sheet === "chat" && live && <ChatSheet onClose={() => setSheet(null)} />}
      </div>
      {adding && <AddToCall exclude={[me.id, ...(call.peer ? [call.peer.id] : [])]} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** تحت اسم الطرف الآخر: كتم صوته، أو رفع يده */
function PeerBadges({ muted, hand, dark }: { muted: boolean; hand: boolean; dark?: boolean }) {
  const t = useT();
  if (!muted && !hand) return null;
  const cls = `flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${dark ? "bg-black/55 text-white" : "w-tint"}`;
  return (
    <div className="mt-2 flex gap-2">
      {muted && <span className={cls} data-testid="peer-muted"><Icon name="micOff" size={13} />{t("كتم صوته")}</span>}
      {hand && <span className={cls} data-testid="peer-hand">✋ {t("رفع يده")}</span>}
    </div>
  );
}

// ------------------------------------------------------------ المكالمة الجماعية: شبكة المشاركين
function GroupCallView() {
  const t = useT();
  const { call, me, userById, hangup, toggleMute, toggleCamera, enableVideo, toggleScreen } = useWasl();
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<"chat" | "react" | null>(null);
  // المربع المكبَّر: ما يختاره المستخدم بالضغط، وإلا من يشارك شاشته (كما في Google Meet)
  const [pin, setPin] = useState<number | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(shell);
  if (!call) return null;
  const peers = call.peers ?? [];
  const myCamera = !!call.local?.getVideoTracks().length;
  const hands = call.hands ?? [];
  const sharer = peers.find((p) => p.screen)?.userId ?? null;
  const pinned = pin !== null && (pin === me.id || peers.some((p) => p.userId === pin)) ? pin : sharer;
  const togglePin = (id: number) => setPin((p) => (p === id || (p === null && pinned === id) ? -1 : id));
  const shown = pin === -1 ? null : pinned;
  const tiles = peers.length + 1;
  const cols = tiles <= 1 ? "grid-cols-1" : tiles <= 4 ? "grid-cols-2" : "grid-cols-3";
  const waiting = call.phase === "outgoing" || (call.phase === "active" && peers.length === 0);
  const nameFor = (id: number) => nameOf(userById(id) ?? { display_name: "", username: t("عضو") });
  const self = (
    <Tile key="me" name={t("أنت")} user={me} stream={call.local} video={myCamera && !call.cameraOff} muted={call.muted} self sharing={call.sharing}
      hand={hands.includes(me.id)} pinned={shown === me.id} onPin={() => togglePin(me.id)} small={shown !== null && shown !== me.id} />
  );
  const peerTiles = peers.map((p) => (
    <PeerTile key={p.userId} peer={p} name={nameFor(p.userId)} user={userById(p.userId)} hand={hands.includes(p.userId)}
      pinned={shown === p.userId} onPin={() => togglePin(p.userId)} small={shown !== null && shown !== p.userId} />
  ));
  const all = [self, ...peerTiles];
  const big = shown === null ? null : all.find((el) => el.key === (shown === me.id ? "me" : String(shown)));
  return (
    <div ref={shell} className="fixed inset-0 z-[60] flex flex-col bg-[#0b0f1a] text-white" role="dialog" aria-label={t("مكالمة جماعية")}>
      <header className="relative shrink-0 px-14 pb-2 pt-[max(1rem,env(safe-area-inset-top))] text-center">
        <div className="text-lg font-extrabold" dir="auto">{call.call.title || t("مكالمة جماعية")}</div>
        <div className="text-sm text-white/70" dir="ltr">
          {waiting ? t("يرنّ عند الأعضاء...") : call.startedAt ? <Timer since={call.startedAt} /> : t("جارٍ الاتصال...")}
          {" • "}{t("المشاركون: {n}", { n: tiles })}
          {hands.length > 0 && <span className="ms-2 rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">✋ {hands.length}</span>}
        </div>
      </header>
      <TopTools fs={fs} video={shown !== null} camera={myCamera && !call.cameraOff} dark />
      {big ? (
        // مربع مكبَّر، وتحته شريط بالباقين
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <div className="grid min-h-0 flex-1" data-pip>{big}</div>
          <div className="w-scroll flex h-28 shrink-0 gap-2 overflow-x-auto">{all.filter((el) => el !== big)}</div>
        </div>
      ) : (
        <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 p-2 ${cols}`}>{all}</div>
      )}
      <FloatingReactions />
      <div className="flex shrink-0 flex-col items-center gap-3 p-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {sheet === "react" && <ReactBar onClose={() => setSheet(null)} />}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <RoundBtn icon={call.muted ? "micOff" : "mic"} label={t(call.muted ? "إلغاء الكتم" : "كتم الصوت")} on={call.muted} onClick={toggleMute} />
          {myCamera
            ? <RoundBtn icon={call.cameraOff ? "videoOff" : "video"} label={t(call.cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا")} on={call.cameraOff} onClick={toggleCamera} />
            : <RoundBtn icon="video" label={t("تشغيل الكاميرا")} on={false} onClick={enableVideo} />}
          {canShareScreen() && <RoundBtn icon="screen" label={t(call.sharing ? "إيقاف المشاركة" : "مشاركة الشاشة")} on={!!call.sharing} onClick={toggleScreen} />}
          <RoundBtn icon="chats" label={t("الدردشة")} on={sheet === "chat"} badge={call.unread} onClick={() => setSheet((s) => (s === "chat" ? null : "chat"))} />
          <RoundBtn icon="smile" label={t("تفاعل")} on={sheet === "react" || hands.includes(me.id)} onClick={() => setSheet((s) => (s === "react" ? null : "react"))} />
          {call.call.id > 0 && <RoundBtn icon="userPlus" label={t("إضافة")} on={false} onClick={() => setAdding(true)} />}
          <button onClick={hangup} aria-label={t("مغادرة المكالمة")} title={t("مغادرة المكالمة")} className="w-danger grid h-12 w-12 place-items-center rounded-full shadow-lg sm:h-14 sm:w-14">
            <Icon name="phoneOff" size={24} />
          </button>
        </div>
      </div>
      {sheet === "chat" && <ChatSheet onClose={() => setSheet(null)} />}
      {adding && <AddToCall exclude={[me.id, ...peers.map((p) => p.userId)]} onClose={() => setAdding(false)} />}
    </div>
  );
}

type TileExtras = { hand?: boolean; pinned?: boolean; onPin?: () => void; small?: boolean };

function PeerTile({ peer, name, user, ...extra }: { peer: GroupPeer; name: string; user?: Parameters<typeof Avatar>[0]["user"] } & TileExtras) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audio.current && audio.current.srcObject !== peer.stream) audio.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <>
      <Tile name={name} user={user} stream={peer.stream} video={peer.video} sharing={peer.screen} muted={!peer.audio}
        connecting={peer.state !== "connected"} {...extra} />
      {/* الصوت من عنصر audio (الفيديو مكتوم كي لا يتكرر الصوت) */}
      <audio ref={audio} autoPlay />
    </>
  );
}

function Tile({ name, user, stream, video, muted, self, sharing, connecting, hand, pinned, onPin, small }: {
  name: string; user?: Parameters<typeof Avatar>[0]["user"]; stream: MediaStream | null; video: boolean; muted?: boolean; self?: boolean; sharing?: boolean; connecting?: boolean;
} & TileExtras) {
  const t = useT();
  const [frames, setFrames] = useState(false);
  const live = video && !!stream;
  const speaking = useSpeaking(stream, !muted);
  return (
    <div role="button" tabIndex={0} onClick={onPin} onKeyDown={(e) => e.key === "Enter" && onPin?.()}
      aria-label={t(pinned ? "إلغاء التكبير: {name}" : "تكبير: {name}", { name })} aria-pressed={!!pinned}
      className={`relative grid min-h-0 cursor-pointer place-items-center overflow-hidden rounded-2xl bg-white/[.06] transition-shadow ${small ? "aspect-video h-full shrink-0" : ""}`}
      style={speaking ? { boxShadow: "inset 0 0 0 3px var(--accent)" } : undefined}
      data-testid="call-tile" data-speaking={speaking || undefined} data-pinned={pinned || undefined}>
      {live && <Video stream={stream} muted onFrames={setFrames}
        className={`absolute inset-0 h-full w-full ${sharing ? "object-contain" : "object-cover"} ${self && !sharing ? "-scale-x-100" : ""} ${frames ? "" : "opacity-0"}`} />}
      {!(live && frames) && <Avatar user={user ?? null} name={name} size={small ? 44 : 72} />}
      <span className="absolute bottom-2 start-2 flex max-w-[calc(100%-1rem)] items-center gap-1 truncate rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold">
        {muted && <span data-testid="tile-muted" aria-label={t("كتم صوته")}><Icon name="micOff" size={12} /></span>}{name}{sharing && ` • ${t("يشارك الشاشة")}`}
      </span>
      {hand && <span className="absolute start-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-sm text-black" data-testid="tile-hand" aria-label={t("رفع يده")}>✋</span>}
      {pinned && <span className="absolute end-2 bottom-2 rounded-full bg-black/55 p-1"><Icon name="pinned" size={13} /></span>}
      {connecting && <span className="absolute top-2 end-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px]">{t("جارٍ الاتصال...")}</span>}
    </div>
  );
}

function Badge({ n }: { n?: number }) {
  return n ? <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white" data-testid="chat-unread">{n}</span> : null;
}

function RoundBtn({ icon, label, on, onClick, badge }: { icon: IconName; label: string; on: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={on}
      className={`relative grid h-12 w-12 place-items-center rounded-full transition sm:h-14 sm:w-14 ${on ? "bg-white text-[#0b0f1a]" : "bg-white/15 text-white"}`}>
      <Icon name={icon} size={22} />
      <Badge n={badge} />
    </button>
  );
}

/** dark: فوق الفيديو (أزرار شفافة داكنة وأيقونات بيضاء تُقرأ فوق أي صورة) */
function Ctl({ icon, label, on, onClick, disabled, badge, dark }: { icon: IconName; label: string; on: boolean; onClick: () => void; disabled?: boolean; badge?: number; dark?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="grid w-[68px] justify-items-center gap-1.5 text-center text-xs font-bold disabled:opacity-40" aria-label={label} aria-pressed={on}>
      <span className={`relative grid h-14 w-14 place-items-center rounded-full ${on ? "w-accent" : dark ? "bg-white/20 text-white backdrop-blur" : "w-card"}`}><Icon name={icon} size={24} /><Badge n={badge} /></span>
      {label}
    </button>
  );
}
