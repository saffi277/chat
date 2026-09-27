"use client";
import { useState } from "react";
import { Avatar, Empty, IconButton, lastSeenText, nameOf } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

/** جهات الاتصال: تبدي منها محادثة أو مجموعة */
export function PeopleView() {
  const { users, openWith, setPanel } = useWasl();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = users
    .filter((u) => !query || nameOf(u).toLowerCase().includes(query) || u.username.toLowerCase().includes(query) || u.phone.includes(query))
    .sort((a, b) => Number(b.is_online) - Number(a.is_online) || nameOf(a).localeCompare(nameOf(b), "ar"));

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-extrabold">جهات الاتصال</h1>
        <label className="w-input mt-4 flex items-center gap-2 rounded-full px-4">
          <Icon name="search" size={18} className="w-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم..." aria-label="بحث"
            className="h-11 w-full bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} />
        </label>
      </header>
      <div className="w-scroll mt-3 flex-1 overflow-y-auto px-2 pb-28">
        <button onClick={() => setPanel({ type: "newGroup" })} className="w-hover flex w-full items-center gap-3 rounded-[20px] px-3 py-3 text-right">
          <span className="w-accent grid h-[50px] w-[50px] place-items-center rounded-full"><Icon name="users" size={22} /></span>
          <span className="font-extrabold">مجموعة جديدة</span>
        </button>
        {list.length === 0 && <Empty icon="users" title="ماكو أحد بهذا الاسم" />}
        {list.map((u) => (
          <div key={u.id} className="w-hover flex items-center gap-3 rounded-[20px] px-3 py-2.5">
            <button onClick={() => setPanel({ type: "contact", userId: u.id })} className="flex min-w-0 flex-1 items-center gap-3 text-right">
              <Avatar user={u} size={50} online={u.is_online} />
              <span className="min-w-0">
                <span className="block truncate font-extrabold">{nameOf(u)}</span>
                <span className="block truncate text-xs" style={{ color: u.is_online ? "var(--online)" : "var(--muted)" }}>{u.bio || lastSeenText(u)}</span>
              </span>
            </button>
            <IconButton icon="chats" label={`مراسلة ${nameOf(u)}`} onClick={() => openWith(u.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
