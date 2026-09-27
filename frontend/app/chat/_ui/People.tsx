"use client";
import { useState } from "react";
import { Avatar, Empty, IconButton, lastSeenText, nameOf } from "./bits";
import { SearchBox } from "./ChatList";
import { Icon } from "./icons";
import { useWasl } from "./store";

/** جهات الاتصال: تبدي منها محادثة أو مجموعة */
export function PeopleView() {
  const { users, openWith, setPanel, setTab } = useWasl();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = users
    .filter((u) => !query || nameOf(u).toLowerCase().includes(query) || u.username.toLowerCase().includes(query) || u.phone.includes(query))
    .sort((a, b) => Number(b.is_online) - Number(a.is_online) || nameOf(a).localeCompare(nameOf(b), "ar"));

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <IconButton icon="back" label="رجوع" onClick={() => setTab("chats")} />
          <h1 className="flex-1 text-[22px] font-extrabold">محادثة جديدة</h1>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو الرقم..." />
      </header>
      <div className="w-scroll mt-2 flex-1 overflow-y-auto pb-4">
        <button onClick={() => setPanel({ type: "newGroup" })} className="w-hover flex w-full items-center gap-3 px-4 py-2.5 text-right">
          <span className="w-accent grid h-[50px] w-[50px] place-items-center rounded-full"><Icon name="users" size={22} /></span>
          <span className="font-bold">مجموعة جديدة</span>
        </button>
        <p className="w-muted px-4 pb-1 pt-3 text-[13px] font-semibold">جهات الاتصال</p>
        {list.length === 0 && <Empty icon="users" title="ماكو أحد بهذا الاسم" />}
        {list.map((u) => (
          <div key={u.id} className="w-hover flex items-center gap-3 px-4 py-2">
            <button onClick={() => setPanel({ type: "contact", userId: u.id })} className="flex min-w-0 flex-1 items-center gap-3 text-right">
              <Avatar user={u} size={50} online={u.is_online} />
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
