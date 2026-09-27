"use client";
// ملف جهة الاتصال، معلومات المجموعة، الوسائط المشتركة، إنشاء مجموعة
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type Member, type Message, type User } from "@/lib/api";
import { conversations as convApi, users as usersApi } from "@/lib/endpoints";
import { Avatar, Chip, ConvAvatar, fileSize, IconButton, lastSeenText, nameOf, Panel, Section, Toggle } from "./bits";
import { Icon, type IconName } from "./icons";
import { useWasl } from "./store";

function Action({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-card w-hover grid flex-1 justify-items-center gap-1.5 rounded-[18px] py-3 text-xs font-bold">
      <span className="w-accent-text"><Icon name={icon} size={22} /></span>{label}
    </button>
  );
}

function InfoRow({ icon, label, value, href }: { icon: IconName; label: string; value: string; href?: string }) {
  const body = (
    <>
      <span className="w-accent-text"><Icon name={icon} size={20} /></span>
      <span className="min-w-0 flex-1">
        <span className="w-muted block text-xs">{label}</span>
        <span className="block truncate font-bold" dir="auto">{value}</span>
      </span>
      {href && <Icon name="chevron" size={18} className="w-muted" />}
    </>
  );
  return href ? <a href={href} className="flex items-center gap-3 py-2.5">{body}</a> : <div className="flex items-center gap-3 py-2.5">{body}</div>;
}

/** أربع صور من الوسائط المشتركة + العدد */
function MediaPreview({ convId, onOpen }: { convId: number; onOpen: () => void }) {
  const [data, setData] = useState<{ counts: Record<string, number>; results: Message[] } | null>(null);
  useEffect(() => {
    convApi.media(convId, "media").then(setData).catch(() => {});
  }, [convId]);
  const total = data ? (data.counts.media ?? 0) + (data.counts.file ?? 0) + (data.counts.link ?? 0) + (data.counts.voice ?? 0) : 0;
  return (
    <Section title="الوسائط المشتركة" extra={<button onClick={onOpen} className="w-accent-text flex items-center gap-1 text-sm font-bold">{total}<Icon name="chevron" size={16} /></button>}>
      {data && data.results.length > 0 ? (
        <button onClick={onOpen} className="grid w-full grid-cols-4 gap-2">
          {data.results.slice(0, 4).map((m) => <Thumb key={m.id} m={m} />)}
        </button>
      ) : (
        <p className="w-muted text-sm">ماكو صور أو فيديو بعد.</p>
      )}
    </Section>
  );
}

function Thumb({ m, onClick }: { m: Message; onClick?: () => void }) {
  const url = mediaUrl(m.file_url);
  return (
    <span onClick={onClick} className="relative block aspect-square overflow-hidden rounded-2xl bg-black/10">
      {m.kind === "video" ? (
        <>
          <video src={url ?? undefined} preload="metadata" muted className="h-full w-full object-cover" />
          <span className="absolute inset-0 grid place-items-center text-white"><span className="grid h-8 w-8 place-items-center rounded-full bg-black/45"><Icon name="play" size={14} /></span></span>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- صورة مرفوعة
        <img src={url ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

// ------------------------------------------------------------ ملف جهة الاتصال
export function ContactPanel({ userId }: { userId: number }) {
  const { userById, convs, openWith, startCall, setPanel, refreshConvs } = useWasl();
  const [user, setUser] = useState<User | null>(userById(userId) ?? null);
  useEffect(() => {
    usersApi.get(userId).then(setUser).catch(() => {});
  }, [userId]);
  const live = userById(userId) ?? user;
  const conv = convs.find((c) => c.kind === "direct" && c.participants.some((p) => p.id === userId));
  if (!live) return <Panel title="جهة الاتصال" onClose={() => setPanel(null)}><p className="w-muted p-6 text-center">جاري التحميل...</p></Panel>;
  const u = { ...live, ...(user ?? {}), is_online: live.is_online, last_seen: live.last_seen };

  const call = async (kind: "audio" | "video") => {
    const c = conv ?? (await convApi.openWith(userId));
    setPanel(null);
    await startCall(c, kind);
  };
  const pref = async (key: "is_favorite" | "is_muted") => {
    if (!conv) return;
    await convApi.setPrefs(conv.id, { [key]: !conv[key] });
    refreshConvs();
  };

  return (
    <Panel title="جهة الاتصال" onClose={() => setPanel(null)}>
      <div className="flex flex-col items-center pt-2 text-center">
        <Avatar user={u} size={116} ring />
        <h3 className="mt-3 flex items-center gap-1.5 text-2xl font-extrabold">{nameOf(u)}</h3>
        <p className="text-sm font-bold" style={{ color: u.is_online ? "var(--online)" : "var(--muted)" }}>{lastSeenText(u)}</p>
      </div>
      <div className="mt-5 flex gap-2">
        <Action icon="chats" label="مراسلة" onClick={() => openWith(userId)} />
        <Action icon="phone" label="مكالمة" onClick={() => call("audio")} />
        <Action icon="video" label="فيديو" onClick={() => call("video")} />
        <Action icon="star" label={conv?.is_favorite ? "بالمفضلة" : "المفضلة"} onClick={() => pref("is_favorite")} />
      </div>
      <Section title="معلومات الاتصال">
        <div className="w-divide">
          <InfoRow icon="user" label="اسم المستخدم" value={`@${u.username}`} />
          {u.phone && <InfoRow icon="phone" label="رقم الهاتف" value={u.phone} href={`tel:${u.phone}`} />}
          {u.city && <InfoRow icon="pin" label="الموقع الحالي" value={u.city} />}
          {u.bio && <InfoRow icon="info" label="حول" value={u.bio} />}
        </div>
      </Section>
      {conv && <MediaPreview convId={conv.id} onOpen={() => setPanel({ type: "media", convId: conv.id })} />}
      {conv && (
        <Section>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-bold"><Icon name="bellOff" size={18} className="w-accent-text" />كتم الإشعارات</span>
            <Toggle on={conv.is_muted} onChange={() => pref("is_muted")} label="كتم الإشعارات" />
          </div>
        </Section>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ معلومات المجموعة
export function GroupPanel({ convId }: { convId: number }) {
  const { convs, me, setPanel, refreshConvs, openConv, notify } = useWasl();
  const conv = convs.find((c) => c.id === convId);
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [memberMenu, setMemberMenu] = useState<number | null>(null);
  const avatarPick = useRef<HTMLInputElement>(null);
  const load = () => convApi.members(convId).then(setMembers).catch(() => {});
  useEffect(() => {
    convApi.members(convId).then(setMembers).catch(() => {});
  }, [convId]);
  if (!conv) return null;
  const admin = conv.my_role === "admin";

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await Promise.all([load(), refreshConvs()]);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Panel title="معلومات المجموعة" onClose={() => setPanel(null)}>
      <div className="flex flex-col items-center pt-2 text-center">
        <button className="relative" disabled={!admin} onClick={() => avatarPick.current?.click()} aria-label="تغيير صورة المجموعة">
          <ConvAvatar conv={conv} other={null} size={112} />
          {admin && <span className="w-accent absolute bottom-1 left-1 grid h-9 w-9 place-items-center rounded-full"><Icon name="camera" size={17} /></span>}
        </button>
        <input ref={avatarPick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) act(() => convApi.setGroupAvatar(convId, f)); e.target.value = ""; }} />
        {editTitle !== null ? (
          <form className="mt-3 flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); act(() => convApi.updateGroup(convId, { title: editTitle })).then(() => setEditTitle(null)); }}>
            <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-input h-11 flex-1 rounded-full px-4 text-base outline-none" />
            <IconButton icon="check" label="حفظ" active />
          </form>
        ) : (
          <h3 className="mt-3 flex items-center gap-2 text-2xl font-extrabold">
            {conv.title}
            {admin && <button onClick={() => setEditTitle(conv.title)} aria-label="تعديل الاسم" className="w-muted"><Icon name="edit" size={17} /></button>}
          </h3>
        )}
        <p className="w-muted text-sm">مجموعة • {conv.member_count} أعضاء</p>
        {conv.description && <p className="mt-2 text-sm">{conv.description}</p>}
      </div>
      <div className="mt-5 flex gap-2">
        {admin && <Action icon="userPlus" label="إضافة" onClick={() => setAdding(true)} />}
        <Action icon="image" label="الوسائط" onClick={() => setPanel({ type: "media", convId })} />
        <Action icon={conv.is_muted ? "bell" : "bellOff"} label={conv.is_muted ? "إلغاء الكتم" : "كتم"} onClick={() => act(() => convApi.setPrefs(convId, { is_muted: !conv.is_muted }))} />
        <Action icon="star" label={conv.is_favorite ? "بالمفضلة" : "المفضلة"} onClick={() => act(() => convApi.setPrefs(convId, { is_favorite: !conv.is_favorite }))} />
      </div>
      <Section title={`أعضاء المجموعة (${members.length})`}>
        {members.map((m) => (
          <div key={m.user.id} className="relative flex items-center gap-3 py-2">
            <Avatar user={m.user} size={42} online={m.user.is_online} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{m.user.id === me.id ? `${nameOf(m.user)} (أنت)` : nameOf(m.user)}</div>
              <div className="w-muted text-xs">{lastSeenText(m.user)}</div>
            </div>
            {m.role === "admin" && <span className="w-accent-text flex items-center gap-1 text-xs font-bold"><Icon name="crown" size={14} />المشرف</span>}
            {admin && m.user.id !== me.id && (
              <button onClick={() => setMemberMenu(memberMenu === m.user.id ? null : m.user.id)} className="w-muted" aria-label="خيارات العضو"><Icon name="more" size={18} /></button>
            )}
            {memberMenu === m.user.id && (
              <div className="w-strong w-shadow absolute left-0 top-12 z-10 w-48 rounded-2xl p-1.5 text-sm" style={{ border: "1px solid var(--border)" }}>
                <button className="w-hover w-full rounded-xl px-3 py-2 text-right font-bold" onClick={() => { setMemberMenu(null); act(() => convApi.setRole(convId, m.user.id, m.role === "admin" ? "member" : "admin")); }}>
                  {m.role === "admin" ? "إلغاء الإشراف" : "تعيين مشرف"}
                </button>
                <button className="w-hover w-full rounded-xl px-3 py-2 text-right font-bold" style={{ color: "var(--danger)" }} onClick={() => { setMemberMenu(null); act(() => convApi.removeMember(convId, m.user.id)); }}>
                  إزالة من المجموعة
                </button>
              </div>
            )}
          </div>
        ))}
      </Section>
      <button onClick={() => { if (confirm("تريد تغادر المجموعة؟")) act(async () => { await convApi.leave(convId); setPanel(null); openConv(null); }); }}
        className="mt-4 w-full rounded-[18px] py-3 font-bold" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }}>
        مغادرة المجموعة
      </button>
      {adding && (
        <PickPeople title="إضافة أعضاء" exclude={members.map((m) => m.user.id)} confirmLabel="إضافة"
          onCancel={() => setAdding(false)} onConfirm={(ids) => act(() => convApi.addMembers(convId, ids)).then(() => setAdding(false))} />
      )}
    </Panel>
  );
}

/** اختيار أشخاص (لإنشاء مجموعة أو إضافة أعضاء) */
function PickPeople({ title, exclude = [], confirmLabel, onConfirm, onCancel, children }: {
  title: string; exclude?: number[]; confirmLabel: string; onConfirm: (ids: number[]) => void; onCancel: () => void; children?: React.ReactNode;
}) {
  const { users } = useWasl();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const list = users.filter((u) => !exclude.includes(u.id) && (!q || nameOf(u).includes(q) || u.username.includes(q)));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-strong w-shadow flex max-h-[85dvh] w-full max-w-md flex-col rounded-[28px] p-4" style={{ border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-extrabold">{title}</h3>
        {children}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث..." className="w-input mb-2 h-11 rounded-full px-4 text-base outline-none md:text-sm" />
        <div className="w-scroll flex-1 overflow-y-auto">
          {list.map((u) => {
            const on = picked.includes(u.id);
            return (
              <button key={u.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== u.id) : [...p, u.id]))}
                className="w-hover flex w-full items-center gap-3 rounded-2xl p-2 text-right">
                <Avatar user={u} size={42} />
                <span className="flex-1 font-bold">{nameOf(u)}</span>
                <span className={`grid h-6 w-6 place-items-center rounded-full ${on ? "w-accent" : "w-card"}`}>{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onCancel} className="w-card flex-1 rounded-full py-3 font-bold">إلغاء</button>
          <button onClick={() => onConfirm(picked)} disabled={!picked.length} className="w-accent flex-1 rounded-full py-3 font-bold disabled:opacity-40">
            {confirmLabel} {picked.length > 0 && `(${picked.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewGroupPanel() {
  const { setPanel, refreshConvs, openConv, setTab, notify } = useWasl();
  const [title, setTitle] = useState("");
  return (
    <PickPeople title="مجموعة جديدة" confirmLabel="إنشاء" onCancel={() => setPanel(null)}
      onConfirm={async (ids) => {
        if (!title.trim()) return notify("اكتب اسم المجموعة");
        try {
          const c = await convApi.createGroup(title.trim(), ids);
          await refreshConvs();
          setPanel(null);
          setTab("chats");
          openConv(c.id);
        } catch (e) {
          notify((e as Error).message);
        }
      }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اسم المجموعة"
        className="w-input mb-2 h-12 rounded-full px-4 text-base font-bold outline-none" />
    </PickPeople>
  );
}

// ------------------------------------------------------------ الوسائط المشتركة
const mediaTabs = [
  { id: "media", label: "صور وفيديو" },
  { id: "file", label: "مستندات" },
  { id: "voice", label: "صوتيات" },
  { id: "link", label: "روابط" },
  { id: "location", label: "مواقع" },
] as const;

export function MediaPanel({ convId }: { convId: number }) {
  const { setPanel } = useWasl();
  const [tab, setTab] = useState<(typeof mediaTabs)[number]["id"]>("media");
  const [data, setData] = useState<{ counts: Record<string, number>; results: Message[] } | null>(null);
  const [view, setView] = useState<string | null>(null);
  useEffect(() => {
    convApi.media(convId, tab).then(setData).catch(() => {});
  }, [convId, tab]);
  // نجمع حسب الشهر مثل التصميم: "أكتوبر 2024"
  const groups = new Map<string, Message[]>();
  data?.results.forEach((m) => {
    const k = new Date(m.created_at).toLocaleDateString("ar", { month: "long", year: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), m]);
  });
  return (
    <Panel title="الوسائط" onClose={() => setPanel(null)} wide>
      <div className="w-noscroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {mediaTabs.map((t) => (
          <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}
            label={`${t.label}${data?.counts[t.id] ? ` ${data.counts[t.id]}` : ""}`} />
        ))}
      </div>
      {data && data.results.length === 0 && <p className="w-muted py-10 text-center text-sm">ماكو شي هنا بعد</p>}
      {[...groups.entries()].map(([month, items]) => (
        <div key={month} className="mt-4">
          <h4 className="w-muted mb-2 text-sm font-bold">{month}</h4>
          {tab === "media" ? (
            <div className="grid grid-cols-3 gap-2">
              {items.map((m) => <Thumb key={m.id} m={m} onClick={() => m.kind === "image" && setView(mediaUrl(m.file_url))} />)}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((m) => (
                <a key={m.id} href={tab === "link" ? m.content.match(/https?:\/\/\S+/)?.[0] : tab === "location" ? `https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=16/${m.latitude}/${m.longitude}` : mediaUrl(m.file_url) ?? "#"}
                  target="_blank" rel="noreferrer" className="w-card flex items-center gap-3 rounded-2xl p-3">
                  <span className="w-accent grid h-10 w-10 shrink-0 place-items-center rounded-xl"><Icon name={tab === "file" ? "file" : tab === "voice" ? "mic" : tab === "link" ? "link" : "pin"} size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" dir="auto">{tab === "file" ? m.file_name : tab === "link" ? m.content : tab === "voice" ? `رسالة صوتية من ${nameOf(m.sender)}` : m.is_live ? "موقع مباشر" : "موقع"}</span>
                    <span className="w-muted text-xs">{new Date(m.created_at).toLocaleDateString("ar")} {tab === "file" && `• ${fileSize(m.file_size)}`}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
      {view && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setView(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- عرض الصورة */}
          <img src={view} alt="" className="max-h-full max-w-full rounded-2xl object-contain" />
        </div>
      )}
    </Panel>
  );
}
