"use client";
import { useState } from "react";
import { Avatar, Empty, IconButton, lastSeenText, nameOf } from "./bits";
import { ScreenHeader, SearchBox } from "./ChatList";
import { Icon } from "./icons";
import { useUserSearch, useWasl } from "./store";

/** جهات الاتصال: تبدي منها محادثة أو مجموعة */
export function PeopleView() {
  const { openWith, setPanel, openSaved } = useWasl();
  const [q, setQ] = useState("");
  const { list: found, loading } = useUserSearch(q);
  const list = [...found].sort((a, b) => Number(b.is_online) - Number(a.is_online));

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ScreenHeader title="جهات الاتصال" menu={[
          { icon: "users", label: "مجموعة جديدة", run: () => setPanel({ type: "newGroup" }) },
          { icon: "bookmark", label: "الرسائل المحفوظة", run: openSaved },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder="البحث بالاسم أو الرقم" />
      </header>
      <div className="w-scroll mt-2 flex-1 overflow-y-auto pb-4">
        <button onClick={() => setPanel({ type: "newGroup" })} className="w-hover flex w-full items-center gap-3 px-4 py-2.5 text-right">
          <span className="w-tint grid h-[52px] w-[52px] place-items-center rounded-full"><Icon name="users" size={22} filled /></span>
          <span className="font-bold">مجموعة جديدة</span>
        </button>
        <p className="w-muted px-4 pb-1 pt-3 text-[13px] font-semibold">جهات الاتصال</p>
        {!loading && list.length === 0 && <Empty icon="users" title="ماكو أحد بهذا الاسم" />}
        {loading && <p className="w-muted py-6 text-center text-sm">جاري البحث...</p>}
        {list.map((u) => (
          <div key={u.id} className="w-hover flex items-center gap-3 px-4 py-2">
            <button onClick={() => setPanel({ type: "contact", userId: u.id })} className="flex min-w-0 flex-1 items-center gap-3 text-right">
              <Avatar user={u} size={52} online={u.is_online || undefined} />
              <span className="min-w-0">
                <span className="block truncate font-bold">{nameOf(u)}</span>
                <span className="block truncate text-[13px]" style={{ color: u.is_online ? "var(--online)" : "var(--muted)" }}>{u.bio || lastSeenText(u)}</span>
              </span>
            </button>
            <IconButton icon="chats" label={`مراسلة ${nameOf(u)}`} onClick={() => openWith(u.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
