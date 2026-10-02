"use client";
import { useEffect, useRef, useState } from "react";
import type { Call } from "@/lib/api";
import { canShareScreen, type GroupPeer } from "@/lib/call";
import { useT } from "@/lib/i18n";
import { calls as callsApi, conversations as convApi } from "@/lib/endpoints";
import { Avatar, Chip, duration, Empty, IconButton, listTime, nameOf } from "./bits";
import { ScreenHeader } from "./ChatList";
import { Icon } from "./icons";
import { PickPeople } from "./Profiles";
import { useWasl } from "./store";

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

export function CallOverlay() {
  const t = useT();
  const { call, me, acceptCall, declineCall, hangup, toggleMute, toggleCamera, enableVideo, toggleScreen } = useWasl();
  const [speaker, setSpeaker] = useState(true);
  const [adding, setAdding] = useState(false);
  const [remoteFrames, setRemoteFrames] = useState(false);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (remoteAudio.current && call?.remote && remoteAudio.current.srcObject !== call.remote) remoteAudio.current.srcObject = call.remote;
  }, [call?.remote]);
  useEffect(() => {
    if (remoteAudio.current) remoteAudio.current.volume = speaker ? 1 : 0.35;
  }, [speaker]);
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
  const videoOn = call.phase === "active" && !!call.remote && !!call.remoteVideo;
  const showVideo = videoOn && remoteFrames;
  const myCamera = !!call.local?.getVideoTracks().length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="w-strong relative flex h-full w-full max-w-md flex-col items-center overflow-hidden md:h-[88dvh] md:rounded-[36px]"
        style={{ border: "1px solid var(--border)", background: showVideo ? "#000" : undefined }}>
        {/* الصوت يخرج من عنصر audio في الأسفل، لذا الفيديو مكتوم كي لا يتكرر الصوت */}
        {/* الشاشة المشاركة تُعرض كاملة (contain) كي لا يُقصّ منها شيء على الهاتف، والكاميرا تملأ الشاشة (cover) */}
        {videoOn && <Video stream={call.remote} muted onFrames={setRemoteFrames}
          className={`absolute inset-0 h-full w-full ${call.remoteScreen ? "object-contain" : "object-cover"} ${showVideo ? "" : "opacity-0"}`} />}
        {myCamera && call.local && call.phase !== "ended" && (
          <Video stream={call.local} muted className="absolute start-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-40 w-28 rounded-2xl object-cover shadow-xl" />
        )}
        <audio ref={remoteAudio} autoPlay />

        {!showVideo && (
          <div className="mt-[18dvh] flex flex-col items-center text-center">
            <div className={`rounded-full p-1.5 ${call.phase === "incoming" || call.phase === "outgoing" ? "w-pulse" : ""}`}>
              <Avatar user={invitedBy ?? call.peer} size={132} ring />
            </div>
            <h2 className="mt-6 text-3xl font-extrabold" dir="auto">{peerName}</h2>
            {invitedBy ? <p className="mt-1 text-sm font-semibold">{t("يدعوك إلى المكالمة")}</p>
              : groupIncoming && call.peer && <p className="mt-1 text-sm font-semibold">{t("{name} يتصل بالمجموعة", { name: nameOf(call.peer) })}</p>}
            <p className="w-muted mt-2 text-lg font-bold" dir="ltr">{statusText ?? (call.startedAt ? <Timer since={call.startedAt} /> : "")}</p>
            {call.phase === "active" && (
              <div className="w-wave mt-8 flex h-10 items-center gap-1" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => <span key={i} className="w-1.5 rounded-full" style={{ height: "100%", background: "var(--accent)", animationDelay: `${(i % 6) * 0.12}s` }} />)}
              </div>
            )}
          </div>
        )}
        {showVideo && (
          <div className="absolute inset-x-0 top-[max(1.5rem,env(safe-area-inset-top))] text-center text-white drop-shadow">
            <div className="text-xl font-extrabold">{peerName}</div>
            <div dir="ltr">{call.startedAt && <Timer since={call.startedAt} />}</div>
          </div>
        )}

        <div className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-6 p-6 pb-[max(2rem,env(safe-area-inset-bottom))] ${showVideo ? "text-white drop-shadow" : ""}`}>
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
              {/* حتى خمسة أزرار: تلتفّ إلى سطرين في الهاتف بدل أن تخرج عن الشاشة */}
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-3 px-2">
                <Ctl icon={call.muted ? "micOff" : "mic"} label={t(call.muted ? "إلغاء الكتم" : "كتم الصوت")} on={call.muted} onClick={toggleMute} />
                {myCamera ? (
                  <Ctl icon={call.cameraOff ? "videoOff" : "video"} label={t(call.cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا")} on={call.cameraOff} onClick={toggleCamera} />
                ) : (
                  // مكالمة صوتية (أو فيديو لم أشغّل فيها كاميرتي بعد): زر للتحويل إلى فيديو
                  <Ctl icon="video" label={t(video ? "تشغيل الكاميرا" : "فيديو")} on={false} onClick={enableVideo}
                    disabled={call.phase !== "active" && call.phase !== "connecting"} />
                )}
                {!myCamera && <Ctl icon="speaker" label={t("مكبّر الصوت")} on={speaker} onClick={() => setSpeaker((s) => !s)} />}
                {canShareScreen() && call.phase === "active" && (
                  <Ctl icon="screen" label={t(call.sharing ? "إيقاف المشاركة" : "مشاركة الشاشة")} on={!!call.sharing} onClick={toggleScreen} />
                )}
                {call.phase === "active" && <Ctl icon="userPlus" label={t("إضافة")} on={false} onClick={() => setAdding(true)} />}
              </div>
              <button onClick={hangup} aria-label={t("إنهاء المكالمة")} className="w-danger grid h-18 w-18 place-items-center rounded-full p-5 shadow-lg">
                <Icon name="phoneOff" size={30} />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {adding && <AddToCall exclude={[me.id, ...(call.peer ? [call.peer.id] : [])]} onClose={() => setAdding(false)} />}
    </div>
  );
}

// ------------------------------------------------------------ المكالمة الجماعية: شبكة المشاركين
function GroupCallView() {
  const t = useT();
  const { call, me, userById, hangup, toggleMute, toggleCamera, enableVideo, toggleScreen } = useWasl();
  const [adding, setAdding] = useState(false);
  if (!call) return null;
  const peers = call.peers ?? [];
  const myCamera = !!call.local?.getVideoTracks().length;
  const tiles = peers.length + 1;
  const cols = tiles <= 1 ? "grid-cols-1" : tiles <= 4 ? "grid-cols-2" : "grid-cols-3";
  const waiting = call.phase === "outgoing" || (call.phase === "active" && peers.length === 0);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0f1a] text-white" role="dialog" aria-label={t("مكالمة جماعية")}>
      <header className="shrink-0 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))] text-center">
        <div className="text-lg font-extrabold" dir="auto">{call.call.title || t("مكالمة جماعية")}</div>
        <div className="text-sm text-white/70" dir="ltr">
          {waiting ? t("يرنّ عند الأعضاء...") : call.startedAt ? <Timer since={call.startedAt} /> : t("جارٍ الاتصال...")}
          {" • "}{t("المشاركون: {n}", { n: tiles })}
        </div>
      </header>
      <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 p-2 ${cols}`}>
        <Tile name={t("أنت")} user={me} stream={call.local} video={myCamera && !call.cameraOff} muted={call.muted} self sharing={call.sharing} />
        {peers.map((p) => <PeerTile key={p.userId} peer={p} name={nameOf(userById(p.userId) ?? { display_name: "", username: t("عضو") })} user={userById(p.userId)} />)}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <RoundBtn icon={call.muted ? "micOff" : "mic"} label={t(call.muted ? "إلغاء الكتم" : "كتم الصوت")} on={call.muted} onClick={toggleMute} />
        {myCamera
          ? <RoundBtn icon={call.cameraOff ? "videoOff" : "video"} label={t(call.cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا")} on={call.cameraOff} onClick={toggleCamera} />
          : <RoundBtn icon="video" label={t("تشغيل الكاميرا")} on={false} onClick={enableVideo} />}
        {canShareScreen() && <RoundBtn icon="screen" label={t(call.sharing ? "إيقاف المشاركة" : "مشاركة الشاشة")} on={!!call.sharing} onClick={toggleScreen} />}
        {call.call.id > 0 && <RoundBtn icon="userPlus" label={t("إضافة")} on={false} onClick={() => setAdding(true)} />}
        <button onClick={hangup} aria-label={t("مغادرة المكالمة")} title={t("مغادرة المكالمة")} className="w-danger grid h-14 w-14 place-items-center rounded-full shadow-lg">
          <Icon name="phoneOff" size={26} />
        </button>
      </div>
      {adding && <AddToCall exclude={[me.id, ...peers.map((p) => p.userId)]} onClose={() => setAdding(false)} />}
    </div>
  );
}

function PeerTile({ peer, name, user }: { peer: GroupPeer; name: string; user?: Parameters<typeof Avatar>[0]["user"] }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audio.current && audio.current.srcObject !== peer.stream) audio.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <>
      <Tile name={name} user={user} stream={peer.stream} video={peer.video} sharing={peer.screen} connecting={peer.state !== "connected"} />
      {/* الصوت من عنصر audio (الفيديو مكتوم كي لا يتكرر الصوت) */}
      <audio ref={audio} autoPlay />
    </>
  );
}

function Tile({ name, user, stream, video, muted, self, sharing, connecting }: {
  name: string; user?: Parameters<typeof Avatar>[0]["user"]; stream: MediaStream | null; video: boolean; muted?: boolean; self?: boolean; sharing?: boolean; connecting?: boolean;
}) {
  const t = useT();
  const [frames, setFrames] = useState(false);
  const live = video && !!stream;
  return (
    <div className="relative grid min-h-0 place-items-center overflow-hidden rounded-2xl bg-white/[.06]" data-testid="call-tile">
      {live && <Video stream={stream} muted onFrames={setFrames}
        className={`absolute inset-0 h-full w-full ${sharing ? "object-contain" : "object-cover"} ${self && !sharing ? "-scale-x-100" : ""} ${frames ? "" : "opacity-0"}`} />}
      {!(live && frames) && <Avatar user={user ?? null} name={name} size={72} />}
      <span className="absolute bottom-2 start-2 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold">
        {muted && <Icon name="micOff" size={12} />}{name}{sharing && ` • ${t("يشارك الشاشة")}`}
      </span>
      {connecting && <span className="absolute top-2 end-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px]">{t("جارٍ الاتصال...")}</span>}
    </div>
  );
}

function RoundBtn({ icon, label, on, onClick }: { icon: "mic" | "micOff" | "video" | "videoOff" | "screen" | "userPlus"; label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={on}
      className={`grid h-14 w-14 place-items-center rounded-full transition ${on ? "bg-white text-[#0b0f1a]" : "bg-white/15 text-white"}`}>
      <Icon name={icon} size={24} />
    </button>
  );
}

function Ctl({ icon, label, on, onClick, disabled }: { icon: "mic" | "micOff" | "video" | "videoOff" | "speaker" | "screen" | "userPlus"; label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="grid w-[72px] justify-items-center gap-1.5 text-center text-xs font-bold disabled:opacity-40" aria-label={label} aria-pressed={on}>
      <span className={`grid h-16 w-16 place-items-center rounded-full ${on ? "w-accent" : "w-card"}`}><Icon name={icon} size={26} /></span>
      {label}
    </button>
  );
}
