"use client";
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type StoryItem, type User } from "@/lib/api";
import { stories as storyApi } from "@/lib/endpoints";
import { useT } from "@/lib/i18n";
import { Avatar, Chip, Empty, IconButton, listTime, nameOf, Panel } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

type Kind = "all" | "image" | "video" | "text";
const kinds: { id: Kind; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "image", label: "الصور" },
  { id: "video", label: "الفيديوهات" },
  { id: "text", label: "النصوص" },
];

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function StoriesView() {
  const t = useT();
  const { stories, me, setPanel, setStoryViewer, setTab, openStory } = useWasl();
  const [kind, setKind] = useState<Kind>("all");
  const mine = stories.find((g) => g.is_me);
  // كل الحالات بشبكة وحدة، الأحدث أول
  const cards = stories
    .flatMap((g) => g.stories.map((s, index) => ({ s, index, user: g.user })))
    .filter(({ s }) => kind === "all" || s.kind === kind)
    .sort((a, b) => +new Date(b.s.created_at) - +new Date(a.s.created_at));

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <IconButton icon="back" label={t("رجوع")} onClick={() => setTab("settings")} />
          <h1 className="flex-1 text-[22px] font-extrabold">{t("الحالات")}</h1>
          <button onClick={() => setPanel({ type: "storyCompose" })} aria-label={t("حالة جديدة")} title={t("حالة جديدة")}
            className="w-tint grid h-10 w-10 place-items-center rounded-full"><Icon name="plus" size={22} strokeWidth={2.4} /></button>
        </div>
        <div className="w-noscroll -mx-4 mt-4 flex gap-3 overflow-x-auto px-4">
          <button className="grid shrink-0 justify-items-center gap-1 text-[11px]"
            onClick={() => (mine ? setStoryViewer({ userId: me.id, index: 0 }) : setPanel({ type: "storyCompose" }))}>
            <div className="relative">
              <Avatar user={me} size={60} ring={mine ? "story" : undefined} />
              <span className="w-accent absolute -bottom-0.5 -end-0.5 grid h-6 w-6 place-items-center rounded-full border-2" style={{ borderColor: "var(--panel-strong)" }}
                onClick={(e) => { e.stopPropagation(); setPanel({ type: "storyCompose" }); }}><Icon name="plus" size={13} strokeWidth={3} /></span>
            </div>
            <span className="w-muted">{t("قصتي")}</span>
          </button>
          {stories.filter((g) => !g.is_me).map((g) => (
            <button key={g.user.id} className="grid shrink-0 justify-items-center gap-1 text-[11px]" onClick={() => openStory(g.user.id)}>
              <Avatar user={g.user} size={60} ring={g.all_seen ? "seen" : "story"} />
              <span className="w-muted max-w-16 truncate">{nameOf(g.user)}</span>
            </button>
          ))}
        </div>
        <div className="w-noscroll -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {kinds.map((k) => <Chip key={k.id} label={t(k.label)} active={kind === k.id} onClick={() => setKind(k.id)} />)}
        </div>
      </header>
      <div className="w-scroll mt-3 flex-1 overflow-y-auto px-3 pb-4">
        {cards.length === 0 ? (
          <Empty icon="stories" title={t("لا توجد حالات بعد")} text={t("شارك صورة أو فيديو أو كلمة، وتختفي بعد 24 ساعة.")}>
            <button onClick={() => setPanel({ type: "storyCompose" })} className="w-accent mt-4 rounded-full px-6 py-2.5 font-bold">{t("أضف حالة")}</button>
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cards.map(({ s, index, user }) => (
              <button key={s.id} onClick={() => setStoryViewer({ userId: user.id, index })}
                className="relative aspect-[3/4] overflow-hidden rounded-2xl text-start text-white">
                <StoryMedia s={s} thumb />
                <span className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/50 to-transparent p-2.5">
                  <Avatar user={user} size={28} />
                  <span className="truncate text-xs font-bold">{nameOf(user)}</span>
                </span>
                {s.kind === "video" && <span className="absolute inset-0 grid place-items-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-black/40 backdrop-blur"><Icon name="play" size={20} /></span></span>}
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent p-2.5 text-xs font-bold" dir="ltr">
                  <span className="flex items-center gap-1"><Icon name="eye" size={14} />{compact(s.views_count)}</span>
                  <span>{s.kind === "video" && s.duration ? `0:${String(Math.round(s.duration)).padStart(2, "0")}` : listTime(s.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StoryMedia({ s, thumb }: { s: StoryItem; thumb?: boolean }) {
  const url = mediaUrl(s.file_url);
  if (s.kind === "text") {
    return (
      <div className="absolute inset-0 grid place-items-center p-4 text-center" style={{ background: `linear-gradient(135deg, ${s.background}, ${s.background}aa)` }}>
        <p className={`${thumb ? "line-clamp-5 text-base" : "text-3xl"} font-extrabold leading-relaxed`} dir="auto">{s.text}</p>
      </div>
    );
  }
  if (s.kind === "video") {
    return <video src={url ?? undefined} className="absolute inset-0 h-full w-full object-cover" muted={thumb} autoPlay={!thumb} playsInline preload="metadata" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- حالة مرفوعة
  return <img src={url ?? ""} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />;
}

// ------------------------------------------------------------ عارض الحالات (شاشة كاملة)
export function StoryViewer() {
  const t = useT();
  const { stories, storyViewer, setStoryViewer, openWith, refreshStories } = useWasl();
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState<{ user: User; viewed_at: string }[] | null>(null);
  const [paused, setPaused] = useState(false);
  const group = stories.find((g) => g.user.id === storyViewer?.userId);
  const index = storyViewer?.index ?? 0;
  const story = group?.stories[index];
  const seen = useRef(new Set<number>());
  const progressRef = useRef(0);
  const goRef = useRef<(dir: 1 | -1) => void>(() => {});

  useEffect(() => {
    if (!story) return;
    progressRef.current = 0;
    queueMicrotask(() => { setProgress(0); setViewers(null); });
    if (!group!.is_me && !story.seen && !seen.current.has(story.id)) {
      seen.current.add(story.id);
      storyApi.markViewed(story.id).catch(() => {});
    }
  }, [story, group]);

  // كل حالة 5 ثواني (الفيديو حسب طوله). مؤقت واحد لكل حالة، ويوكف لما تضغط مطولاً
  useEffect(() => {
    if (!story || paused || viewers) return;
    const total = (story.kind === "video" && story.duration ? story.duration : 5) * 1000;
    const from = progressRef.current * total;
    const t0 = Date.now();
    const t = setInterval(() => {
      const p = Math.min(1, (from + Date.now() - t0) / total);
      progressRef.current = p;
      setProgress(p);
      if (p >= 1) {
        clearInterval(t);
        goRef.current(1);
      }
    }, 50);
    return () => clearInterval(t);
  }, [story, paused, viewers]);

  const go = (dir: 1 | -1) => {
    if (!group || !storyViewer) return;
    const next = index + dir;
    if (next >= 0 && next < group.stories.length) return setStoryViewer({ userId: group.user.id, index: next });
    // نروح للشخص اللي بعده
    const gi = stories.findIndex((g) => g.user.id === group.user.id) + dir;
    if (gi >= 0 && gi < stories.length) return setStoryViewer({ userId: stories[gi].user.id, index: dir === 1 ? 0 : stories[gi].stories.length - 1 });
    close();
  };
  const close = () => {
    setStoryViewer(null);
    refreshStories();
  };
  useEffect(() => {
    goRef.current = go;
  });

  if (!group || !story) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="relative h-full w-full max-w-md overflow-hidden text-white md:h-[92dvh] md:rounded-[28px]"
        onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
        <StoryMedia s={story} />
        {story.text && story.kind !== "text" && (
          <p className="absolute inset-x-4 bottom-24 rounded-2xl bg-black/40 p-3 text-center font-bold backdrop-blur" dir="auto">{story.text}</p>
        )}
        <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex gap-1" dir="ltr">
          {group.stories.map((s, i) => (
            <span key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white" style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-[max(1.6rem,calc(env(safe-area-inset-top)+0.9rem))] flex items-center gap-3">
          <Avatar user={group.user} size={40} />
          <div className="flex-1"><div className="font-bold">{group.is_me ? t("قصتي") : nameOf(group.user)}</div><div className="text-xs opacity-80">{listTime(story.created_at)}</div></div>
          <button onClick={close} className="grid h-10 w-10 place-items-center rounded-full bg-black/30" aria-label={t("إغلاق")}><Icon name="x" /></button>
        </div>
        {/* مناطق الضغط: البداية = السابقة، والنهاية = التالية (تنقلب مع اتجاه اللغة) */}
        <button className="absolute inset-y-20 start-0 w-1/3" aria-label={t("السابقة")} onClick={() => go(-1)} />
        <button className="absolute inset-y-20 end-0 w-1/3" aria-label={t("التالية")} onClick={() => go(1)} />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {group.is_me ? (
            <>
              <button onClick={() => storyApi.viewers(story.id).then(setViewers)} className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 font-bold backdrop-blur">
                <Icon name="eye" size={18} />{t("{n} مشاهدة", { n: story.views_count })}
              </button>
              <button onClick={async () => { if (confirm(t("حذف هذه الحالة؟"))) { await storyApi.remove(story.id); await refreshStories(); close(); } }}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur" aria-label={t("حذف")}><Icon name="trash" size={18} /></button>
            </>
          ) : (
            <button onClick={() => { close(); openWith(group.user.id); }} className="flex items-center gap-2 rounded-full bg-white/20 px-5 py-2.5 font-bold backdrop-blur">
              <Icon name="reply" size={18} />{t("رد")}
            </button>
          )}
        </div>
        {viewers && (
          <div className="absolute inset-x-0 bottom-0 max-h-[60%] overflow-y-auto rounded-t-[28px] bg-white p-4 text-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-extrabold">{t("شاهدها {n}", { n: viewers.length })}</h3><button onClick={() => setViewers(null)}><Icon name="x" /></button></div>
            {viewers.length === 0 && <p className="py-4 text-center text-sm text-slate-500">{t("لم يشاهدها أحد بعد")}</p>}
            {viewers.map((v) => (
              <div key={v.user.id} className="flex items-center gap-3 py-2">
                <Avatar user={v.user} size={38} /><span className="flex-1 font-bold">{nameOf(v.user)}</span><span className="text-xs text-slate-500">{listTime(v.viewed_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ نشر حالة
const colors = ["#1f7bff", "#7c3aed", "#db2777", "#059669", "#ea580c", "#0f172a"];

export function StoryComposer() {
  const t = useT();
  const { setPanel, refreshStories, notify } = useWasl();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [bg, setBg] = useState(colors[0]);
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  async function post() {
    setBusy(true);
    try {
      if (file) await storyApi.postMedia(file, text.trim());
      else await storyApi.postText(text.trim(), bg);
      await refreshStories();
      setPanel(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t("حالة جديدة")} onClose={() => setPanel(null)}>
      <div className="relative mx-auto aspect-[9/14] w-full max-w-xs overflow-hidden rounded-[28px] text-white shadow-xl"
        style={!file ? { background: `linear-gradient(135deg, ${bg}, ${bg}aa)` } : undefined}>
        {file && preview ? (
          file.type.startsWith("video/") ? <video src={preview} autoPlay muted loop className="absolute inset-0 h-full w-full object-cover" />
            // eslint-disable-next-line @next/next/no-img-element -- معاينة محلية
            : <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={t("اكتب حالتك...")}
            className="absolute inset-0 resize-none bg-transparent p-6 pt-24 text-center text-2xl font-extrabold outline-none placeholder:text-white/60" />
        )}
      </div>
      {file ? (
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("أضف تعليقاً...")}
          className="w-input mt-4 h-12 w-full rounded-full px-4 text-base outline-none" />
      ) : (
        <div className="mt-4 flex justify-center gap-2">
          {colors.map((c) => (
            <button key={c} onClick={() => setBg(c)} aria-label={`${t("لون")} ${c}`} className={`h-9 w-9 rounded-full ${bg === c ? "ring-4 ring-white/70" : ""}`} style={{ background: c }} />
          ))}
        </div>
      )}
      <input ref={pick} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPreview(URL.createObjectURL(f)); } e.target.value = ""; }} />
      <div className="mt-4 flex gap-2">
        {file ? (
          <button onClick={() => { setFile(null); setPreview(null); }} className="w-card flex-1 rounded-full py-3 font-bold">{t("نص بدل الصورة")}</button>
        ) : (
          <button onClick={() => pick.current?.click()} className="w-card flex flex-1 items-center justify-center gap-2 rounded-full py-3 font-bold"><Icon name="image" size={18} />{t("صورة أو فيديو")}</button>
        )}
        <button onClick={post} disabled={busy || (!file && !text.trim())} className="w-accent flex-1 rounded-full py-3 font-extrabold disabled:opacity-50">
          {t(busy ? "جارٍ النشر..." : "نشر")}
        </button>
      </div>
    </Panel>
  );
}
