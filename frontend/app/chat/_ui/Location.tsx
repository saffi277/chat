"use client";
import { useEffect, useState } from "react";
import { messages as msgApi } from "@/lib/endpoints";
import { permError } from "@/lib/permissions";
import { Avatar, MiniMap, Panel } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

const durations = [
  { minutes: 15, label: "15 دقيقة" },
  { minutes: 60, label: "ساعة" },
  { minutes: 480, label: "8 ساعات" },
];

export function LocationPanel({ convId }: { convId: number }) {
  const { setPanel, me, startLiveShare, notify } = useWasl();
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);
  const [minutes, setMinutes] = useState(60);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  // نطلب موقع الجهاز (المتصفح يسأل المستخدم أول مرة)
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      queueMicrotask(() => setError("جهازك ما يدعم تحديد الموقع"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setError(permError(e, "geolocation")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, []);

  async function share() {
    if (!pos) return;
    setBusy(true);
    try {
      const msg = await msgApi.sendLocation(convId, pos.lat, pos.lng, live ? minutes : undefined, caption.trim() || undefined);
      if (live) startLiveShare(msg); // نبقى نحدّث الموقع طول المدة
      setPanel(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="مشاركة الموقع" onClose={() => setPanel(null)}>
      <div className="w-panel overflow-hidden rounded-[24px]">
        {pos ? (
          <MiniMap lat={pos.lat} lng={pos.lng} height={300} zoom={15}
            pin={<Avatar user={me} size={46} ring />} />
        ) : (
          <div className="grid h-[300px] place-items-center p-6 text-center">
            {error ? <p className="w-muted text-sm leading-7">{error}</p> : <p className="w-muted animate-pulse text-sm">جاري تحديد موقعك...</p>}
          </div>
        )}
      </div>

      <div className="w-panel mt-4 rounded-[24px] p-4">
        <button onClick={() => setLive(true)} className="flex w-full items-center gap-3 text-right">
          <span className={`grid h-11 w-11 place-items-center rounded-2xl ${live ? "w-accent" : "w-card"}`}><Icon name="navigation" size={20} /></span>
          <span className="flex-1"><span className="block font-extrabold">مشاركة موقعي المباشر</span><span className="w-muted text-xs">يتحدث وياك وإنت تتحرك</span></span>
          <span className={`h-5 w-5 rounded-full border-2 ${live ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--divider)]"}`} />
        </button>
        {live && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {durations.map((d) => (
              <button key={d.minutes} onClick={() => setMinutes(d.minutes)} aria-pressed={minutes === d.minutes}
                className="w-chip rounded-2xl py-3 text-sm font-extrabold">{d.label}</button>
            ))}
          </div>
        )}
        <div className="my-4 h-px" style={{ background: "var(--divider)" }} />
        <button onClick={() => setLive(false)} className="flex w-full items-center gap-3 text-right">
          <span className={`grid h-11 w-11 place-items-center rounded-2xl ${!live ? "w-accent" : "w-card"}`}><Icon name="pin" size={20} /></span>
          <span className="flex-1"><span className="block font-extrabold">موقعي الحالي فقط</span><span className="w-muted text-xs">مرة وحدة، ما يتحدث</span></span>
          <span className={`h-5 w-5 rounded-full border-2 ${!live ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--divider)]"}`} />
        </button>
      </div>

      <label className="w-input mt-4 flex items-center gap-3 rounded-[20px] px-4">
        <Icon name="edit" size={18} className="w-muted" />
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="إضافة رسالة (اختياري)"
          className="h-12 flex-1 bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} />
      </label>

      <button onClick={share} disabled={!pos || busy}
        className="w-accent mt-4 flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-extrabold disabled:opacity-50">
        <Icon name="send" size={20} />{busy ? "جاري المشاركة..." : "مشاركة الموقع"}
      </button>
    </Panel>
  );
}
