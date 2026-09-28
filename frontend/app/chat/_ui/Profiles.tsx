"use client";
// ملف جهة الاتصال، معلومات المجموعة، الوسائط المشتركة، إنشاء مجموعة
import { useEffect, useRef, useState } from "react";
import { mediaUrl, ROLE_LABELS, type Member, type Message, type User } from "@/lib/api";
import { conversations as convApi, messages as msgApi, users as usersApi } from "@/lib/endpoints";
import { Avatar, Chip, ConvAvatar, fileSize, IconButton, lastSeenText, listTime, nameOf, Panel, preview, Section } from "./bits";
import { Icon, type IconName } from "./icons";
import { useUserSearch, useWasl } from "./store";

function Action({ icon, label, onClick, active }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`grid min-w-0 flex-1 justify-items-center gap-1.5 whitespace-nowrap rounded-[18px] px-1 py-3.5 text-[11px] font-semibold transition active:scale-95 ${active ? "w-tint" : ""}`}
      style={active ? { border: "1px solid var(--tint-border)" } : { background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>
      <span className={active ? "" : "w-accent-text"}><Icon name={icon} size={24} filled={active} /></span>{label}
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

/** صف بقائمة: الأيقونة يمين، النص، والسهم يسار */
function NavRow({ icon, label, onClick, danger, extra }: { icon: IconName; label: string; onClick: () => void; danger?: boolean; extra?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-right text-[15px] font-semibold"
      style={danger ? { color: "var(--danger)" } : undefined}>
      <Icon name={icon} size={22} className={danger ? "" : ""} />
      <span className="flex-1">{label}</span>
      {extra}
      {!danger && <Icon name="chevron" size={18} className="w-muted" />}
    </button>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`mt-3 rounded-[22px] px-4 py-1 ${className}`} style={{ background: "var(--panel)", boxShadow: "var(--soft-shadow)" }}>{children}</section>;
}

type MediaTab = "media" | "file" | "link" | "voice";

/** "الوسائط والملفات": 3 صور + "+N"، وتحتها الصور/الملفات/الروابط/الرسائل المميزة */
function MediaCard({ convId }: { convId: number }) {
  const { setPanel } = useWasl();
  const [data, setData] = useState<{ counts: Record<string, number>; results: Message[] } | null>(null);
  useEffect(() => {
    convApi.media(convId, "media").then(setData).catch(() => {});
  }, [convId]);
  const open = (tab: MediaTab) => setPanel({ type: "media", convId, tab });
  const pics = data?.results.slice(0, 3) ?? [];
  const more = (data?.counts.media ?? 0) - pics.length;
  return (
    <Card className="pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold">الوسائط والملفات</h3>
        <button onClick={() => open("media")} className="w-accent-text flex items-center gap-0.5 text-sm font-semibold">الكل<Icon name="chevron" size={16} /></button>
      </div>
      {pics.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {pics.map((m) => <button key={m.id} onClick={() => open("media")}><Thumb m={m} /></button>)}
          {more > 0 && (
            <button onClick={() => open("media")} className="grid aspect-square place-items-center rounded-2xl text-lg font-bold" style={{ background: "var(--card)" }}>+{more}</button>
          )}
        </div>
      ) : (
        <p className="w-muted mt-2 text-sm">ماكو صور أو فيديو بعد.</p>
      )}
      <div className="w-divide mt-2">
        <NavRow icon="image" label="الصور" onClick={() => open("media")} />
        <NavRow icon="file" label="الملفات" onClick={() => open("file")} />
        <NavRow icon="link" label="الروابط" onClick={() => open("link")} />
        <NavRow icon="star" label="الرسائل المميزة" onClick={() => setPanel({ type: "starred", convId })} />
      </div>
    </Card>
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

/** "حذف المحادثة" عندي بس */
function useClearChat() {
  const { refreshConvs, openConv, activeId, setPanel, notify } = useWasl();
  return async (convId: number) => {
    if (!confirm("تحذف المحادثة من عندك؟ الطرف الثاني تبقى عنده.")) return;
    try {
      await convApi.clear(convId);
      await refreshConvs();
      setPanel(null);
      if (activeId === convId) openConv(null);
      notify("انحذفت المحادثة");
    } catch (e) {
      notify((e as Error).message);
    }
  };
}

// ------------------------------------------------------------ ملف جهة الاتصال
export function ContactPanel({ userId }: { userId: number }) {
  const { userById, convs, openWith, startCall, setPanel, refreshConvs, notify } = useWasl();
  const [user, setUser] = useState<User | null>(userById(userId) ?? null);
  const [menu, setMenu] = useState(false);
  const [info, setInfo] = useState(false);
  const clearChat = useClearChat();
  useEffect(() => {
    usersApi.get(userId).then(setUser).catch(() => {});
  }, [userId]);
  const live = userById(userId) ?? user;
  const conv = convs.find((c) => c.kind === "direct" && c.participants.some((p) => p.id === userId));
  if (!live) return <Panel title="جهة الاتصال" onClose={() => setPanel(null)}><p className="w-muted p-6 text-center">جاري التحميل...</p></Panel>;
  const u = { ...live, ...(user ?? {}), is_online: live.is_online, last_seen: live.last_seen };

  const ensureConv = async () => conv ?? (await convApi.openWith(userId));
  const call = async (kind: "audio" | "video") => {
    const c = await ensureConv();
    setPanel(null);
    await startCall(c, kind);
  };
  const pref = async (key: "is_favorite" | "is_muted" | "is_pinned") => {
    setMenu(false);
    const c = await ensureConv();
    await convApi.setPrefs(c.id, { [key]: !c[key] });
    refreshConvs();
  };

  const menuItems: { icon: IconName; label: string; run: () => void }[] = [
    { icon: "info", label: info ? "إخفاء المعلومات" : "معلومات الاتصال", run: () => { setMenu(false); setInfo((v) => !v); } },
    { icon: "bookmark", label: conv?.is_favorite ? "إزالة من المفضلة" : "إضافة للمفضلة", run: () => pref("is_favorite") },
    { icon: "pinned", label: conv?.is_pinned ? "إلغاء التثبيت" : "تثبيت المحادثة", run: () => pref("is_pinned") },
  ];

  return (
    <Panel title="جهة الاتصال" bare onClose={() => setPanel(null)} actions={
      <div className="relative">
        <IconButton icon="more" label="المزيد" onClick={() => setMenu((m) => !m)} plain size={38} />
        {menu && (
          <div className="w-strong w-shadow absolute left-0 top-11 z-20 w-56 rounded-2xl p-1.5" style={{ border: "1px solid var(--border)" }}>
            {menuItems.map((it) => (
              <button key={it.label} onClick={it.run} className="w-hover flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold">
                <Icon name={it.icon} size={18} className="w-accent-text" />{it.label}
              </button>
            ))}
          </div>
        )}
      </div>
    }>
      <div className="flex flex-col items-center text-center">
        <Avatar user={u} size={112} />
        <h3 className="mt-3 text-[24px] font-extrabold">{nameOf(u)}</h3>
        <p className="w-muted mt-0.5 flex items-center gap-1.5 text-sm">
          {u.is_online && <span className="h-2 w-2 rounded-full" style={{ background: "var(--online)" }} />}{lastSeenText(u)}
        </p>
        {u.role && <span className="w-tint mt-2 rounded-full px-3 py-0.5 text-xs font-bold">{ROLE_LABELS[u.role]}</span>}
      </div>
      <div className="mt-5 flex gap-2">
        <Action icon="chats" label="مراسلة" active onClick={() => openWith(userId)} />
        <Action icon="phone" label="مكالمة صوتية" onClick={() => call("audio")} />
        <Action icon="video" label="مكالمة فيديو" onClick={() => call("video")} />
        <Action icon={conv?.is_muted ? "bellOff" : "bell"} label={conv?.is_muted ? "إلغاء الكتم" : "كتم الإشعارات"} onClick={() => pref("is_muted")} />
      </div>
      {info && (
        <Card>
          <div className="w-divide">
            <InfoRow icon="user" label="اسم المستخدم" value={`@${u.username}`} />
            {u.phone && <InfoRow icon="phone" label="رقم الهاتف" value={u.phone} href={`tel:${u.phone}`} />}
            {u.city && <InfoRow icon="pin" label="المدينة" value={u.city} />}
            {u.bio && <InfoRow icon="info" label="حول" value={u.bio} />}
          </div>
        </Card>
      )}
      {conv && <MediaCard convId={conv.id} />}
      <Card>
        <div className="w-divide">
          <NavRow icon="pin" label="مشاركة الموقع" onClick={async () => setPanel({ type: "location", convId: (await ensureConv()).id })} />
          <NavRow icon="lock" label="المحادثة السرية" onClick={() => notify("المحادثة السرية قريباً 🔒")}
            extra={<span className="w-tint rounded-full px-2 py-0.5 text-[10px] font-bold">قريباً</span>} />
        </div>
      </Card>
      {conv && (
        <Card>
          <NavRow icon="trash" label="حذف المحادثة" danger onClick={() => clearChat(conv.id)} />
        </Card>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ الرسائل المميزة ⭐
export function StarredPanel({ convId }: { convId?: number }) {
  const { setPanel, openConv, me } = useWasl();
  const [list, setList] = useState<Message[] | null>(null);
  useEffect(() => {
    msgApi.starred(convId).then(setList).catch(() => setList([]));
  }, [convId]);
  const remove = async (m: Message) => {
    await msgApi.unstar(m.id).catch(() => {});
    setList((l) => l?.filter((x) => x.id !== m.id) ?? null);
  };
  return (
    <Panel title="الرسائل المميزة" onClose={() => setPanel(null)}>
      {list?.length === 0 && (
        <div className="w-muted py-12 text-center text-sm">
          <Icon name="star" size={36} className="mx-auto mb-3" />
          ماكو رسائل مميزة. اضغط على أي رسالة واختار &quot;تمييز بنجمة&quot;.
        </div>
      )}
      {list?.map((m) => {
        const p = preview(m, me.id);
        return (
          <Card key={m.id}>
            <div className="flex items-center gap-3 py-3">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => { setPanel(null); openConv(m.conversation); }}>
                <Avatar user={m.sender} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold">{m.sender.id === me.id ? "أنت" : nameOf(m.sender)}</span>
                    <span className="w-muted shrink-0 text-[11px]" dir="ltr">{listTime(m.created_at)}</span>
                  </span>
                  <span className="w-muted mt-0.5 flex items-center gap-1 text-[13px]">
                    {p.icon && <Icon name={p.icon} size={14} className="shrink-0" />}<span className="truncate">{p.text}</span>
                  </span>
                </span>
              </button>
              <IconButton icon="star" label="إلغاء التمييز" onClick={() => remove(m)} size={34} />
            </div>
          </Card>
        );
      })}
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
  const clearChat = useClearChat();
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
        <p className="w-muted mt-0.5 text-sm">مجموعة • {conv.member_count} أعضاء</p>
        {conv.description && <p className="mt-2 text-sm">{conv.description}</p>}
      </div>
      <div className="mt-5 flex gap-2">
        <Action icon="chats" label="مراسلة" active onClick={() => { setPanel(null); openConv(convId); }} />
        {admin && <Action icon="userPlus" label="إضافة أعضاء" onClick={() => setAdding(true)} />}
        <Action icon="pinned" label={conv.is_pinned ? "إلغاء التثبيت" : "تثبيت"} onClick={() => act(() => convApi.setPrefs(convId, { is_pinned: !conv.is_pinned }))} />
        <Action icon={conv.is_muted ? "bellOff" : "bell"} label={conv.is_muted ? "إلغاء الكتم" : "كتم الإشعارات"} onClick={() => act(() => convApi.setPrefs(convId, { is_muted: !conv.is_muted }))} />
      </div>
      <MediaCard convId={convId} />
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
      <Card>
        <div className="w-divide">
          <NavRow icon="trash" label="حذف المحادثة" danger onClick={() => clearChat(convId)} />
          <NavRow icon="logout" label="مغادرة المجموعة" danger
            onClick={() => { if (confirm("تريد تغادر المجموعة؟")) act(async () => { await convApi.leave(convId); setPanel(null); openConv(null); }); }} />
        </div>
      </Card>
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
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const list = useUserSearch(q).list.filter((u) => !exclude.includes(u.id));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-strong w-shadow flex max-h-[85dvh] w-full max-w-md flex-col rounded-3xl p-4" style={{ border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
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

export function MediaPanel({ convId, initial = "media" }: { convId: number; initial?: MediaTab }) {
  const { setPanel } = useWasl();
  const [tab, setTab] = useState<(typeof mediaTabs)[number]["id"]>(initial);
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
