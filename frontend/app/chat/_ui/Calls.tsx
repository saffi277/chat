"use client";
import { useEffect, useRef, useState } from "react";
import type { Call } from "@/lib/api";
import { calls as callsApi, conversations as convApi } from "@/lib/endpoints";
import { Avatar, Chip, duration, Empty, IconButton, listTime, nameOf } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

// ------------------------------------------------------------ سجل المكالمات
export function CallsView() {
  const { convs, startCall, call, setPanel } = useWasl();
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [log, setLog] = useState<Call[] | null>(null);
  useEffect(() => {
    callsApi.log(filter === "missed" ? "missed" : undefined).then(setLog).catch(() => setLog([]));
  }, [filter, call?.phase]);

  const again = async (c: Call) => {
    if (!c.peer) return;
    const conv = convs.find((x) => x.id === c.conversation) ?? (await convApi.openWith(c.peer.id));
    startCall(conv, c.kind);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-extrabold">المكالمات</h1>
        <div className="mt-4 flex gap-2">
          <Chip label="الكل" active={filter === "all"} onClick={() => setFilter("all")} />
          <Chip label="الفائتة" active={filter === "missed"} onClick={() => setFilter("missed")} />
        </div>
      </header>
      <div className="w-scroll mt-3 flex-1 overflow-y-auto px-2 pb-28">
        {log?.length === 0 && <Empty icon="phone" title="ماكو مكالمات" text="اتصل بأي شخص من زر السماعة فوك المحادثة." />}
        {log?.map((c) => {
          const missed = c.direction === "missed";
          const name = c.peer ? nameOf(c.peer) : c.title || "مجموعة";
          return (
            <div key={c.id} className="w-hover flex items-center gap-3 rounded-[20px] px-3 py-2.5">
              <button onClick={() => c.peer && setPanel({ type: "contact", userId: c.peer.id })}>
                <Avatar user={c.peer} name={name} size={50} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-extrabold" style={missed ? { color: "var(--danger)" } : undefined}>{name}</div>
                <div className="w-muted flex items-center gap-1 text-xs">
                  <span style={{ color: missed ? "var(--danger)" : "var(--online)" }}><Icon name={c.direction === "outgoing" ? "outgoing" : "incoming"} size={14} strokeWidth={2.4} /></span>
                  <Icon name={c.kind === "video" ? "video" : "phone"} size={13} />
                  {missed ? "فائتة" : c.status === "declined" ? "مرفوضة" : c.duration ? duration(c.duration) : c.direction === "outgoing" ? "صادرة" : "واردة"}
                  <span>• {listTime(c.created_at)}</span>
                </div>
              </div>
              {c.peer && <IconButton icon={c.kind === "video" ? "video" : "phone"} label="اتصل مرة ثانية" onClick={() => again(c)} />}
            </div>
          );
        })}
      </div>
    </div>
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
    call.phase === "incoming" ? (video ? "مكالمة فيديو واردة..." : "مكالمة صوتية واردة...")
      : call.phase === "outgoing" ? "يرن..."
        : call.phase === "connecting" ? "جاري الاتصال..."
          : call.phase === "ended" ? call.endedText ?? "انتهت المكالمة" : null;
  const showVideo = video && call.phase === "active" && call.remote;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="w-strong relative flex h-full w-full max-w-md flex-col items-center overflow-hidden md:h-[88dvh] md:rounded-[36px]"
        style={{ border: "1px solid var(--border)", background: showVideo ? "#000" : undefined }}>
        {/* الصوت يطلع من عنصر audio تحت، فالفيديو مكتوم حتى ما يتكرر الصوت */}
        {showVideo && <Video stream={call.remote} muted className="absolute inset-0 h-full w-full object-cover" />}
        {video && call.local && call.phase !== "ended" && (
          <Video stream={call.local} muted className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 h-40 w-28 rounded-2xl object-cover shadow-xl" />
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
              <button onClick={declineCall} className="grid justify-items-center gap-2 font-bold" aria-label="رفض">
                <span className="w-danger grid h-18 w-18 place-items-center rounded-full p-5 shadow-lg"><Icon name="phoneOff" size={30} /></span>رفض
              </button>
              <button onClick={acceptCall} className="grid justify-items-center gap-2 font-bold" aria-label="رد">
                <span className="grid h-18 w-18 place-items-center rounded-full p-5 text-white shadow-lg w-pulse" style={{ background: "var(--online)" }}><Icon name={video ? "video" : "phone"} size={30} /></span>رد
              </button>
            </div>
          ) : call.phase !== "ended" ? (
            <>
              <div className="flex gap-6">
                <Ctl icon={call.muted ? "micOff" : "mic"} label={call.muted ? "إلغاء الكتم" : "كتم الصوت"} on={call.muted} onClick={toggleMute} />
                {video ? (
                  <Ctl icon={call.cameraOff ? "videoOff" : "video"} label={call.cameraOff ? "تشغيل الكاميرا" : "إطفاء الكاميرا"} on={call.cameraOff} onClick={toggleCamera} />
                ) : (
                  <Ctl icon="speaker" label="مكبر الصوت" on={speaker} onClick={() => setSpeaker((s) => !s)} />
                )}
              </div>
              <button onClick={hangup} aria-label="إنهاء المكالمة" className="w-danger grid h-18 w-18 place-items-center rounded-full p-5 shadow-lg">
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
