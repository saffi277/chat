"use client";
// ملف جهة الاتصال، معلومات المجموعة، الوسائط المشتركة، إنشاء مجموعة
import { useCallback, useEffect, useRef, useState } from "react";
import { canBroadcast, mediaUrl, ROLE_LABELS, type ChannelInfo, type Member, type Message, type User } from "@/lib/api";
import { channels as channelsApi, contacts as contactsApi, conversations as convApi, messages as msgApi, users as usersApi } from "@/lib/endpoints";
import { dateLocale, t as tr, useLang, useT } from "@/lib/i18n";
import { Avatar, Chip, ConvAvatar, fileSize, IconButton, ImageViewer, lastSeenText, listTime, nameOf, Panel, preview, Section, StoryTap } from "./bits";
import { Icon, type IconName } from "./icons";
import { useMuteToggle } from "./ConvSettings";
import { ReportDialog } from "./Safety";
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

/** صف في قائمة: الأيقونة في البداية، ثم النص، والسهم في النهاية */
function NavRow({ icon, label, onClick, danger, extra }: { icon: IconName; label: string; onClick: () => void; danger?: boolean; extra?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-start text-[15px] font-semibold"
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
  const t = useT();
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
        <h3 className="text-[16px] font-extrabold">{t("الوسائط والملفات")}</h3>
        <button onClick={() => open("media")} className="w-accent-text flex items-center gap-0.5 text-sm font-semibold">{t("الكل")}<Icon name="chevron" size={16} /></button>
      </div>
      {pics.length > 0 ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {pics.map((m) => <button key={m.id} onClick={() => open("media")}><Thumb m={m} /></button>)}
          {more > 0 && (
            <button onClick={() => open("media")} className="grid aspect-square place-items-center rounded-2xl text-lg font-bold" style={{ background: "var(--card)" }}>+{more}</button>
          )}
        </div>
      ) : (
        <p className="w-muted mt-2 text-sm">{t("لا توجد صور أو مقاطع فيديو بعد.")}</p>
      )}
      <div className="w-divide mt-2">
        <NavRow icon="image" label={t("الصور")} onClick={() => open("media")} />
        <NavRow icon="file" label={t("الملفات")} onClick={() => open("file")} />
        <NavRow icon="link" label={t("الروابط")} onClick={() => open("link")} />
        <NavRow icon="star" label={t("الرسائل المميزة")} onClick={() => setPanel({ type: "starred", convId })} />
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

/** "حذف المحادثة" لديّ فقط */
function useClearChat() {
  const { refreshConvs, openConv, activeId, setPanel, notify } = useWasl();
  return async (convId: number) => {
    if (!confirm(tr("حذف المحادثة من عندك؟ ستبقى لدى الطرف الآخر."))) return;
    try {
      await convApi.clear(convId);
      await refreshConvs();
      setPanel(null);
      if (activeId === convId) openConv(null);
      notify(tr("حُذفت المحادثة"));
    } catch (e) {
      notify((e as Error).message);
    }
  };
}

// ------------------------------------------------------------ ملف جهة الاتصال
export function ContactPanel({ userId }: { userId: number }) {
  const t = useT();
  const { userById, convs, openWith, startCall, setPanel, refreshConvs, notify, isContact, contactAdded, contactRemoved, storyRing, openStory, isBlocked, setBlocked } = useWasl();
  const toggleMute = useMuteToggle();
  const [reporting, setReporting] = useState(false);
  const [user, setUser] = useState<User | null>(userById(userId) ?? null);
  const [menu, setMenu] = useState(false);
  const [info, setInfo] = useState(false);
  const clearChat = useClearChat();
  useEffect(() => {
    usersApi.get(userId).then(setUser).catch(() => {});
  }, [userId]);
  const live = userById(userId) ?? user;
  const conv = convs.find((c) => c.kind === "direct" && c.participants.some((p) => p.id === userId));
  if (!live) return <Panel title={t("جهة الاتصال")} onClose={() => setPanel(null)}><p className="w-muted p-6 text-center">{t("جارٍ التحميل...")}</p></Panel>;
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

  const saved = isContact(userId);
  const toggleContact = async () => {
    setMenu(false);
    try {
      if (saved) {
        if (!confirm(t("إزالة {name} من جهات اتصالك؟ تبقى المحادثة كما هي.", { name: nameOf(u) }))) return;
        await contactsApi.remove(userId);
        contactRemoved(userId);
      } else {
        contactAdded(await contactsApi.add({ user_id: userId }));
        notify(t("أُضيف {name} إلى جهات اتصالك", { name: nameOf(u) }));
      }
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const menuItems: { icon: IconName; label: string; run: () => void }[] = [
    { icon: "info", label: t(info ? "إخفاء المعلومات" : "معلومات الاتصال"), run: () => { setMenu(false); setInfo((v) => !v); } },
    { icon: saved ? "userMinus" : "userPlus", label: t(saved ? "إزالة من جهات الاتصال" : "إضافة إلى جهات الاتصال"), run: toggleContact },
    { icon: "bookmark", label: t(conv?.is_favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"), run: () => pref("is_favorite") },
    { icon: "pinned", label: t(conv?.is_pinned ? "إلغاء التثبيت" : "تثبيت المحادثة"), run: () => pref("is_pinned") },
  ];
  const blockedNow = isBlocked(userId);
  const toggleBlock = async () => {
    setMenu(false);
    if (!blockedNow && !confirm(t("حظر {name}؟ لن يستطيع مراسلتك أو الاتصال بك، ولن يرى آخر ظهورك ولا صورتك.", { name: nameOf(live) }))) return;
    try {
      await setBlocked(userId, !blockedNow);
      notify(t(blockedNow ? "أُلغي حظر {name}" : "حُظر {name}", { name: nameOf(live) }));
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Panel title={t("جهة الاتصال")} bare onClose={() => setPanel(null)} actions={
      <div className="relative">
        <IconButton icon="more" label={t("المزيد")} onClick={() => setMenu((m) => !m)} plain size={38} />
        {menu && (
          <div className="w-strong w-shadow absolute end-0 top-11 z-20 w-56 rounded-2xl p-1.5" style={{ border: "1px solid var(--border)" }}>
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
        <StoryTap ring={storyRing(u.id)} onOpen={() => openStory(u.id)}>
          <Avatar user={u} size={storyRing(u.id) ? 106 : 112} ring={storyRing(u.id)} />
        </StoryTap>
        <h3 className="mt-3 text-[24px] font-extrabold" dir="auto">{nameOf(u)}</h3>
        <p className="w-muted mt-0.5 flex items-center gap-1.5 text-sm">
          {u.is_online && <span className="h-2 w-2 rounded-full" style={{ background: "var(--online)" }} />}{lastSeenText(u)}
        </p>
        {u.role && <span className="w-tint mt-2 rounded-full px-3 py-0.5 text-xs font-bold">{t(ROLE_LABELS[u.role])}</span>}
        {!saved && (
          <button onClick={toggleContact} className="w-accent mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold">
            <Icon name="userPlus" size={16} />{t("إضافة إلى جهات الاتصال")}
          </button>
        )}
      </div>
      <div className="mt-5 flex gap-2">
        <Action icon="chats" label={t("مراسلة")} active onClick={() => openWith(userId)} />
        <Action icon="phone" label={t("مكالمة صوتية")} onClick={() => call("audio")} />
        <Action icon="video" label={t("مكالمة فيديو")} onClick={() => call("video")} />
        <Action icon={conv?.is_muted ? "bellOff" : "bell"} label={t(conv?.is_muted ? "إلغاء الكتم" : "كتم الإشعارات")} onClick={() => (conv ? toggleMute(conv) : pref("is_muted"))} />
      </div>
      {info && (
        <Card>
          <div className="w-divide">
            <InfoRow icon="user" label={t("اسم المستخدم")} value={`@${u.username}`} />
            {u.phone && <InfoRow icon="phone" label={t("رقم الهاتف")} value={u.phone} href={`tel:${u.phone}`} />}
            {u.city && <InfoRow icon="pin" label={t("المدينة")} value={u.city} />}
            {u.bio && <InfoRow icon="info" label={t("نبذة")} value={u.bio} />}
          </div>
        </Card>
      )}
      {conv && <MediaCard convId={conv.id} />}
      <Card>
        <div className="w-divide">
          <NavRow icon="settings" label={t("إعدادات المحادثة")} onClick={async () => setPanel({ type: "convSettings", convId: (await ensureConv()).id })} />
          <NavRow icon="pin" label={t("مشاركة الموقع")} onClick={async () => setPanel({ type: "location", convId: (await ensureConv()).id })} />
          <NavRow icon="lock" label={t("المحادثة السرية")} onClick={() => notify(t("المحادثة السرية قريباً 🔒"))}
            extra={<span className="w-tint rounded-full px-2 py-0.5 text-[10px] font-bold">{t("قريباً")}</span>} />
        </div>
      </Card>
      <Card>
        <div className="w-divide">
          <NavRow icon="x" label={t(blockedNow ? "إلغاء حظر {name}" : "حظر {name}", { name: nameOf(live) })} danger onClick={toggleBlock} />
          <NavRow icon="info" label={t("إبلاغ عن {name}", { name: nameOf(live) })} danger onClick={() => setReporting(true)} />
          {conv && <NavRow icon="trash" label={t("حذف المحادثة")} danger onClick={() => clearChat(conv.id)} />}
        </div>
      </Card>
      {reporting && <ReportDialog user={live} onClose={() => setReporting(false)} />}
    </Panel>
  );
}

// ------------------------------------------------------------ الرسائل المميزة ⭐
export function StarredPanel({ convId }: { convId?: number }) {
  const t = useT();
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
    <Panel title={t("الرسائل المميزة")} onClose={() => setPanel(null)}>
      {list?.length === 0 && (
        <div className="w-muted py-12 text-center text-sm">
          <Icon name="star" size={36} className="mx-auto mb-3" />
          {t("لا توجد رسائل مميزة. اضغط على أي رسالة واختر \"تمييز بنجمة\".")}
        </div>
      )}
      {list?.map((m) => {
        const p = preview(m, me.id);
        return (
          <Card key={m.id}>
            <div className="flex items-center gap-3 py-3">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => { setPanel(null); openConv(m.conversation); }}>
                <Avatar user={m.sender} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold">{m.sender.id === me.id ? t("أنت") : nameOf(m.sender)}</span>
                    <span className="w-muted shrink-0 text-[11px]" dir="ltr">{listTime(m.created_at)}</span>
                  </span>
                  <span className="w-muted mt-0.5 flex items-center gap-1 text-[13px]">
                    {p.icon && <Icon name={p.icon} size={14} className="shrink-0" />}<span className="truncate" dir="auto">{p.text}</span>
                  </span>
                </span>
              </button>
              <IconButton icon="star" label={t("إلغاء التمييز")} onClick={() => remove(m)} size={34} />
            </div>
          </Card>
        );
      })}
    </Panel>
  );
}

// ------------------------------------------------------------ معلومات المجموعة أو القناة
export function GroupPanel({ convId }: { convId: number }) {
  const t = useT();
  const { convs, me, setPanel, refreshConvs, openConv, notify } = useWasl();
  const conv = convs.find((c) => c.id === convId);
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [memberMenu, setMemberMenu] = useState<number | null>(null);
  const avatarPick = useRef<HTMLInputElement>(null);
  const clearChat = useClearChat();
  const toggleMute = useMuteToggle();
  const load = () => convApi.members(convId).then(setMembers).catch(() => {});
  useEffect(() => {
    convApi.members(convId).then(setMembers).catch(() => {});
  }, [convId]);
  if (!conv) return null;
  const admin = conv.my_role === "admin";
  // الاسم والصورة: للمشرف، أو لكل عضو إن سمح المشرفون (can_edit_info)
  const canEdit = conv.can_edit_info ?? admin;
  // القناة: المشترك يرى المشرفين فقط، والمشرف يرى المشتركين ويعيّن مشرفين من التدريسيين والإداريين
  const channel = conv.kind === "channel";

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await Promise.all([load(), refreshConvs()]);
    } catch (e) {
      notify((e as Error).message);
    }
  };

  return (
    <Panel title={t(channel ? "معلومات القناة" : "معلومات المجموعة")} onClose={() => setPanel(null)}>
      <div className="flex flex-col items-center pt-2 text-center">
        <button className="relative" disabled={!canEdit} onClick={() => avatarPick.current?.click()} aria-label={t(channel ? "تغيير صورة القناة" : "تغيير صورة المجموعة")}>
          <ConvAvatar conv={conv} other={null} size={112} />
          {canEdit && <span className="w-accent absolute bottom-1 end-1 grid h-9 w-9 place-items-center rounded-full"><Icon name="camera" size={17} /></span>}
        </button>
        <input ref={avatarPick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) act(() => convApi.setGroupAvatar(convId, f)); e.target.value = ""; }} />
        {editTitle !== null ? (
          <form className="mt-3 flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); act(() => convApi.updateGroup(convId, { title: editTitle })).then(() => setEditTitle(null)); }}>
            <input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-input h-11 flex-1 rounded-full px-4 text-base outline-none" />
            <IconButton icon="check" label={t("حفظ")} active />
          </form>
        ) : (
          <h3 className="mt-3 flex items-center gap-2 text-2xl font-extrabold">
            {conv.title}
            {canEdit && <button onClick={() => setEditTitle(conv.title)} aria-label={t("تعديل الاسم")} className="w-muted"><Icon name="edit" size={17} /></button>}
          </h3>
        )}
        <p className="w-muted mt-0.5 text-sm">{channel ? t("قناة • المشتركون: {n}", { n: conv.member_count }) : t("مجموعة • {n} أعضاء", { n: conv.member_count })}</p>
        {conv.description && <p className="mt-2 text-sm" dir="auto">{conv.description}</p>}
      </div>
      <div className="mt-5 flex gap-2">
        <Action icon={channel ? "megaphone" : "chats"} label={t(channel ? "المنشورات" : "مراسلة")} active onClick={() => { setPanel(null); openConv(convId); }} />
        {admin && <Action icon="userPlus" label={t(channel ? "إضافة مشتركين" : "إضافة أعضاء")} onClick={() => setAdding(true)} />}
        <Action icon="pinned" label={t(conv.is_pinned ? "إلغاء التثبيت" : "تثبيت")} onClick={() => act(() => convApi.setPrefs(convId, { is_pinned: !conv.is_pinned }))} />
        <Action icon={conv.is_muted ? "bellOff" : "bell"} label={t(conv.is_muted ? "إلغاء الكتم" : "كتم الإشعارات")} onClick={() => toggleMute(conv)} />
      </div>
      <MediaCard convId={convId} />
      <Section title={channel ? (admin ? t("المشتركون ({n})", { n: members.length }) : t("المشرفون")) : t("أعضاء المجموعة ({n})", { n: members.length })}>
        {members.map((m) => (
          <div key={m.user.id} className="relative flex items-center gap-3 py-2">
            <Avatar user={m.user} size={42} online={m.user.is_online} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold" dir="auto">{m.user.id === me.id ? `${nameOf(m.user)} (${t("أنت")})` : nameOf(m.user)}</div>
              <div className="w-muted text-xs">{lastSeenText(m.user)}</div>
            </div>
            {m.role === "admin" && <span className="w-accent-text flex items-center gap-1 text-xs font-bold"><Icon name="crown" size={14} />{t("المشرف")}</span>}
            {admin && m.user.id !== me.id && (
              <button onClick={() => setMemberMenu(memberMenu === m.user.id ? null : m.user.id)} className="w-muted" aria-label={t("خيارات العضو")}><Icon name="more" size={18} /></button>
            )}
            {memberMenu === m.user.id && (
              <div className="w-strong w-shadow absolute end-0 top-12 z-10 w-48 rounded-2xl p-1.5 text-sm" style={{ border: "1px solid var(--border)" }}>
                {/* مشرفو القناة ينشرون فيها، فلا يكونون إلا من التدريسيين والإداريين */}
                {(!channel || m.role === "admin" || canBroadcast(m.user)) && (
                  <button className="w-hover w-full rounded-xl px-3 py-2 text-start font-bold" onClick={() => { setMemberMenu(null); act(() => convApi.setRole(convId, m.user.id, m.role === "admin" ? "member" : "admin")); }}>
                    {t(m.role === "admin" ? "إلغاء الإشراف" : "تعيين مشرفاً")}
                  </button>
                )}
                <button className="w-hover w-full rounded-xl px-3 py-2 text-start font-bold" style={{ color: "var(--danger)" }} onClick={() => { setMemberMenu(null); act(() => convApi.removeMember(convId, m.user.id)); }}>
                  {t(channel ? "إزالة من القناة" : "إزالة من المجموعة")}
                </button>
              </div>
            )}
          </div>
        ))}
      </Section>
      <Card>
        <div className="w-divide">
          <NavRow icon="settings" label={t(channel ? "إعدادات القناة" : "إعدادات المحادثة")} onClick={() => setPanel({ type: "convSettings", convId })} />
          <NavRow icon="trash" label={t("حذف المحادثة")} danger onClick={() => clearChat(convId)} />
          <NavRow icon="logout" label={t(channel ? "إلغاء الاشتراك" : "مغادرة المجموعة")} danger
            onClick={() => { if (confirm(t(channel ? "هل تريد إلغاء الاشتراك في القناة؟" : "هل تريد مغادرة المجموعة؟"))) act(async () => { await convApi.leave(convId); setPanel(null); openConv(null); }); }} />
        </div>
      </Card>
      {adding && (
        <PickPeople title={t(channel ? "إضافة مشتركين" : "إضافة أعضاء")} exclude={members.map((m) => m.user.id)} confirmLabel={t("إضافة")}
          onCancel={() => setAdding(false)} onConfirm={(ids) => act(() => convApi.addMembers(convId, ids)).then(() => setAdding(false))} />
      )}
    </Panel>
  );
}

/** اختيار أشخاص (لإنشاء مجموعة أو إضافة أعضاء) */
export function PickPeople({ title, exclude = [], confirmLabel, onConfirm, onCancel, children }: {
  title: string; exclude?: number[]; confirmLabel: string; onConfirm: (ids: number[]) => void; onCancel: () => void; children?: React.ReactNode;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const list = useUserSearch(q).list.filter((u) => !exclude.includes(u.id));
  return (
    // فوق شاشة المكالمة أيضاً (z-[60]): منها يُضاف أشخاص إلى المكالمة
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-strong w-shadow flex max-h-[85dvh] w-full max-w-md flex-col rounded-3xl p-4" style={{ border: "1px solid var(--border)", color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-extrabold">{title}</h3>
        {children}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ابحث...")} className="w-input mb-2 h-11 rounded-full px-4 text-base outline-none md:text-sm" />
        <div className="w-scroll flex-1 overflow-y-auto">
          {list.map((u) => {
            const on = picked.includes(u.id);
            return (
              <button key={u.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== u.id) : [...p, u.id]))}
                className="w-hover flex w-full items-center gap-3 rounded-2xl p-2 text-start">
                <Avatar user={u} size={42} />
                <span className="flex-1 font-bold">{nameOf(u)}</span>
                <span className={`grid h-6 w-6 place-items-center rounded-full ${on ? "w-accent" : "w-card"}`}>{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onCancel} className="w-card flex-1 rounded-full py-3 font-bold">{t("إلغاء")}</button>
          <button onClick={() => onConfirm(picked)} disabled={!picked.length} className="w-accent flex-1 rounded-full py-3 font-bold disabled:opacity-40">
            {confirmLabel} {picked.length > 0 && `(${picked.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewGroupPanel() {
  const t = useT();
  const { setPanel, refreshConvs, openConv, setTab, notify } = useWasl();
  const [title, setTitle] = useState("");
  return (
    <PickPeople title={t("مجموعة جديدة")} confirmLabel={t("إنشاء")} onCancel={() => setPanel(null)}
      onConfirm={async (ids) => {
        if (!title.trim()) return notify(t("اكتب اسم المجموعة"));
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
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("اسم المجموعة")}
        className="w-input mb-2 h-12 rounded-full px-4 text-base font-bold outline-none" />
    </PickPeople>
  );
}

// ------------------------------------------------------------ القنوات
/** قناة جديدة: للتدريسيين والإداريين. ينشر فيها المشرفون فقط، ويشترك فيها الطلاب ليقرؤوا */
export function NewChannelPanel() {
  const t = useT();
  const { setPanel, refreshConvs, openConv, setTab, notify } = useWasl();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return notify(t("اكتب اسم القناة"));
    setBusy(true);
    try {
      const c = await channelsApi.create(title.trim(), description.trim());
      await refreshConvs();
      setPanel(null);
      setTab("chats");
      openConv(c.id);
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t("قناة جديدة")} onClose={() => setPanel(null)}>
      <div className="mt-2 flex flex-col items-center text-center">
        <span className="w-tint grid h-20 w-20 place-items-center rounded-full"><Icon name="megaphone" size={36} /></span>
        <p className="w-muted mt-3 text-sm leading-7">{t("القناة للإعلانات: تنشر فيها أنت ومن تعيّنه مشرفاً من التدريسيين والإداريين، ويقرأ المشتركون ويتفاعلون دون أن يرسلوا.")}</p>
      </div>
      <form onSubmit={create} className="mt-4 grid gap-2">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("اسم القناة")} maxLength={80} dir="auto"
          className="w-input h-12 rounded-full px-4 text-base font-bold outline-none" style={{ color: "var(--text)" }} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("وصف القناة (اختياري)")} maxLength={300} rows={3} dir="auto"
          className="w-input rounded-3xl px-4 py-3 text-base outline-none" style={{ color: "var(--text)" }} />
        <button type="submit" disabled={busy || !title.trim()} className="w-accent mt-2 rounded-full py-3 font-bold disabled:opacity-50">{t("إنشاء القناة")}</button>
      </form>
    </Panel>
  );
}

/** دليل قنوات الجامعة: بحث واشتراك */
export function ChannelsPanel() {
  const t = useT();
  const { setPanel, refreshConvs, openConv, setTab, notify } = useWasl();
  const [q, setQ] = useState("");
  const [list, setList] = useState<ChannelInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => channelsApi.list(q.trim()).then((l) => alive && setList(l)).catch(() => alive && setList([])), 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);
  const open = async (c: ChannelInfo) => {
    try {
      if (!c.is_subscribed) await channelsApi.subscribe(c.id);
      await refreshConvs();
      setPanel(null);
      setTab("chats");
      openConv(c.id);
    } catch (err) {
      notify((err as Error).message);
    }
  };
  return (
    <Panel title={t("استكشاف القنوات")} onClose={() => setPanel(null)}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ابحث عن قناة...")} aria-label={t("بحث")} dir="auto"
        className="w-input mb-2 mt-1 h-12 w-full rounded-full px-4 text-base outline-none" style={{ color: "var(--text)" }} />
      {list === null && <p className="w-muted py-8 text-center text-sm">{t("جارٍ التحميل...")}</p>}
      {list?.length === 0 && <p className="w-muted py-8 text-center text-sm">{t(q.trim() ? "لا توجد نتائج" : "لا توجد قنوات بعد")}</p>}
      {list?.map((c) => (
        <div key={c.id} className="flex items-center gap-3 py-2.5">
          {c.avatar ? <Avatar src={c.avatar} name={c.title} size={50} /> : (
            <span className="w-tint grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full"><Icon name="megaphone" size={22} /></span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold" dir="auto">{c.title}</div>
            <div className="w-muted truncate text-[13px]" dir="auto">{c.description || t("المشتركون: {n}", { n: c.member_count })}</div>
          </div>
          <button onClick={() => open(c)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${c.is_subscribed ? "w-card" : "w-accent"}`}>
            {t(c.is_subscribed ? "فتح" : "اشتراك")}
          </button>
        </div>
      ))}
    </Panel>
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
  const t = useT();
  const { setPanel } = useWasl();
  const [tab, setTab] = useState<(typeof mediaTabs)[number]["id"]>(initial);
  const [data, setData] = useState<{ counts: Record<string, number>; results: Message[] } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const closeView = useCallback(() => setView(null), []);
  useEffect(() => {
    convApi.media(convId, tab).then(setData).catch(() => {});
  }, [convId, tab]);
  // نجمع بحسب الشهر كما في التصميم: "أكتوبر 2024"
  const locale = dateLocale(useLang());
  const groups = new Map<string, Message[]>();
  data?.results.forEach((m) => {
    const k = new Date(m.created_at).toLocaleDateString(locale, { month: "long", year: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), m]);
  });
  return (
    <Panel title={t("الوسائط")} onClose={() => setPanel(null)} wide>
      <div className="w-noscroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {mediaTabs.map((mt) => (
          <Chip key={mt.id} active={tab === mt.id} onClick={() => setTab(mt.id)}
            label={`${t(mt.label)}${data?.counts[mt.id] ? ` ${data.counts[mt.id]}` : ""}`} />
        ))}
      </div>
      {data && data.results.length === 0 && <p className="w-muted py-10 text-center text-sm">{t("لا يوجد شيء هنا بعد")}</p>}
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
                    <span className="block truncate font-bold" dir="auto">{tab === "file" ? m.file_name : tab === "link" ? m.content : tab === "voice" ? t("رسالة صوتية من {name}", { name: nameOf(m.sender) }) : t(m.is_live ? "موقع مباشر" : "موقع")}</span>
                    <span className="w-muted text-xs">{new Date(m.created_at).toLocaleDateString(locale)} {tab === "file" && `• ${fileSize(m.file_size)}`}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
      {view && <ImageViewer src={view} onClose={closeView} />}
    </Panel>
  );
}
