"use client";
import { useEffect, useRef, useState } from "react";
import type { Call } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { calls as callsApi, conversations as convApi } from "@/lib/endpoints";
import { Avatar, Chip, duration, Empty, IconButton, listTime, nameOf } from "./bits";
import { ScreenHeader } from "./ChatList";
import { Icon } from "./icons";
import { useWasl } from "./store";

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
function Video({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream && ref.current.srcObject !== stream) ref.current.srcObject = stream;
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
  const { call, acceptCall, declineCall, hangup, toggleMute, toggleCamera } = useWasl();
  const [speaker, setSpeaker] = useState(true);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (remoteAudio.current && call?.remote && remoteAudio.current.srcObject !== call.remote) remoteAudio.current.srcObject = call.remote;
  }, [call?.remote]);
  useEffect(() => {
    if (remoteAudio.current) remoteAudio.current.volume = speaker ? 1 : 0.35;
  }, [speaker]);
  if (!call) return null;

  const video = call.call.kind === "video";
  const peerName = call.peer ? nameOf(call.peer) : "";
  const statusText =
    call.phase === "incoming" ? t(video ? "مكالمة فيديو واردة..." : "مكالمة صوتية واردة...")
      : call.phase === "outgoing" ? t("يرنّ...")
        : call.phase === "connecting" ? t("جارٍ الاتصال...")
          : call.phase === "ended" ? call.endedText ?? t("انتهت المكالمة") : null;
  const showVideo = video && call.phase === "active" && call.remote;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="w-strong relative flex h-full w-full max-w-md flex-col items-center overflow-hidden md:h-[88dvh] md:rounded-[36px]"
        style={{ border: "1px solid var(--border)", background: showVideo ? "#000" : undefined }}>
        {/* الصوت يخرج من عنصر audio في الأسفل، لذا الفيديو مكتوم كي لا يتكرر الصوت */}
        {showVideo && <Video stream={call.remote} muted className="absolute inset-0 h-full w-full object-cover" />}
        {video && call.local && call.phase !== "ended" && (
          <Video stream={call.local} muted className="absolute start-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-40 w-28 rounded-2xl object-cover shadow-xl" />
        )}
        <audio ref={remoteAudio} autoPlay />

        {!showVideo && (
          <div className="mt-[18dvh] flex flex-col items-center text-center">
            <div className={`rounded-full p-1.5 ${call.phase === "incoming" || call.phase === "outgoing" ? "w-pulse" : ""}`}>
              <Avatar user={call.peer} size={132} ring />
            </div>
            <h2 className="mt-6 text-3xl font-extrabold">{peerName}</h2>
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

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-6 p-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
              <div className="flex gap-6">
                <Ctl icon={call.muted ? "micOff" : "mic"} label={t(call.muted ? "إلغاء الكتم" : "كتم الصوت")} on={call.muted} onClick={toggleMute} />
                {video ? (
                  <Ctl icon={call.cameraOff ? "videoOff" : "video"} label={t(call.cameraOff ? "تشغيل الكاميرا" : "إيقاف الكاميرا")} on={call.cameraOff} onClick={toggleCamera} />
                ) : (
                  <Ctl icon="speaker" label={t("مكبّر الصوت")} on={speaker} onClick={() => setSpeaker((s) => !s)} />
                )}
              </div>
              <button onClick={hangup} aria-label={t("إنهاء المكالمة")} className="w-danger grid h-18 w-18 place-items-center rounded-full p-5 shadow-lg">
                <Icon name="phoneOff" size={30} />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Ctl({ icon, label, on, onClick }: { icon: "mic" | "micOff" | "video" | "videoOff" | "speaker"; label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="grid justify-items-center gap-1.5 text-xs font-bold" aria-label={label} aria-pressed={on}>
      <span className={`grid h-16 w-16 place-items-center rounded-full ${on ? "w-accent" : "w-card"}`}><Icon name={icon} size={26} /></span>
      {label}
    </button>
  );
}
