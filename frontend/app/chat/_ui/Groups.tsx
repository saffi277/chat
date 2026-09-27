"use client";
import { useState } from "react";
import { ChatRow, ScreenHeader, SearchBox } from "./ChatList";
import { Empty } from "./bits";
import { Icon } from "./icons";
import { useWasl } from "./store";

/** تبويب المجموعات: مجموعاتي + زر مجموعة جديدة */
export function GroupsView() {
  const { convs, setPanel } = useWasl();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = convs.filter((c) => c.kind === "group" && (!query || c.title.toLowerCase().includes(query)));
  const newGroup = () => setPanel({ type: "newGroup" });

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <ScreenHeader title="المجموعات" action={{ icon: "plus", label: "مجموعة جديدة", onClick: newGroup }} />
        <SearchBox value={q} onChange={setQ} placeholder="بحث في المجموعات..." />
      </header>
      <div className="w-scroll mt-2 flex-1 overflow-y-auto pb-4">
        <button onClick={newGroup} className="w-hover flex w-full items-center gap-3 px-4 py-2.5 text-right">
          <span className="w-accent grid h-[52px] w-[52px] place-items-center rounded-full"><Icon name="users" size={22} /></span>
          <span>
            <span className="block font-bold">مجموعة جديدة</span>
            <span className="w-muted block text-[13px]">اختار الأعضاء وسمّي المجموعة</span>
          </span>
        </button>
        {groups.length > 0 && <p className="w-muted px-4 pb-1 pt-3 text-[13px] font-semibold">مجموعاتك ({groups.length})</p>}
        {groups.map((c) => <ChatRow key={c.id} conv={c} subtitle={c.last_message ? undefined : `${c.member_count} أعضاء`} />)}
        {groups.length === 0 && (
          <Empty icon="users" title={query ? "ماكو نتائج" : "ماعندك مجموعات بعد"} text={query ? undefined : "سوّي مجموعة وضيف أصدقائك حتى تحچون سوه."} />
        )}
      </div>
    </div>
  );
}
