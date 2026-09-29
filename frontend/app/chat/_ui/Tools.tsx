"use client";
/**
 * أدوات الرسائل: إعادة التوجيه (اختيار المحادثات)، والبحث في الرسائل (في محادثة أو في الكل)، والاستطلاع الجديد.
 */
import { useEffect, useState } from "react";
import type { Conversation, SearchHit } from "@/lib/api";
import { folders as foldersApi, messages as msgApi, type ChatFolder } from "@/lib/endpoints";
import { useT } from "@/lib/i18n";
import { ConvAvatar, listTime, nameOf, Panel, preview, Toggle } from "./bits";
import { Sheet } from "./ConvSettings";
import { Icon } from "./icons";
import { useWasl } from "./store";

/** اسم المحادثة كما يظهر في القائمة */
export function useConvTitle() {
  const { otherOf } = useWasl();
  return (c: Conversation) => (c.kind === "direct" ? (otherOf(c) ? nameOf(otherOf(c)!) : "") : c.title);
}

// ------------------------------------------------------------ إعادة التوجيه
export function ForwardDialog({ messageIds, onClose }: { messageIds: number[]; onClose: () => void }) {
  const t = useT();
  const { convs, notify, refreshConvs } = useWasl();
  const title = useConvTitle();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const list = convs.filter((c) => c.can_post !== false).filter((c) => !q.trim() || title(c).toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 10 ? p : [...p, id]));
  async function send() {
    setBusy(true);
    try {
      await msgApi.forward(messageIds, picked);
      notify(t("أُعيد التوجيه إلى {n} محادثة", { n: picked.length }));
      refreshConvs();
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("إعادة التوجيه إلى...")} onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("بحث")} aria-label={t("بحث")} dir="auto"
        className="w-input mb-2 h-11 w-full rounded-full px-4 text-base outline-none md:text-sm" />
      <div className="w-scroll -mx-2 max-h-[45dvh] overflow-y-auto">
        {list.map((c) => (
          <button key={c.id} onClick={() => toggle(c.id)} role="checkbox" aria-checked={picked.includes(c.id)}
            className="w-hover flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start">
            <ConvAvatar conv={c} other={null} size={40} />
            <span className="min-w-0 flex-1 truncate font-semibold" dir="auto">{title(c)}</span>
            <span className="grid h-6 w-6 place-items-center rounded-full border-2" style={{ borderColor: picked.includes(c.id) ? "var(--accent)" : "var(--muted)", background: picked.includes(c.id) ? "var(--accent)" : undefined }}>
              {picked.includes(c.id) && <Icon name="check" size={13} strokeWidth={3.5} className="text-white" />}
            </span>
          </button>
        ))}
      </div>
      <button onClick={send} disabled={busy || !picked.length}
        className="w-accent mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-bold disabled:opacity-50">
        <Icon name="forward" size={18} />{t("إرسال ({n})", { n: picked.length })}
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------ البحث في الرسائل
/** نتائج البحث (مشتركة بين لوحة البحث في المحادثة وقائمة المحادثات) */
export function useMessageSearch(q: string, convId?: number) {
  const [state, setState] = useState<{ q: string; hits: SearchHit[] } | null>(null);
  const query = q.trim();
  useEffect(() => {
    if (query.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => msgApi.search(query, convId).then((hits) => alive && setState({ q: query, hits })).catch(() => {}), 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, convId]);
  if (query.length < 2) return { hits: [], loading: false };
  return { hits: state?.q === query ? state.hits : [], loading: state?.q !== query };
}

/** إبراز الكلمة المبحوث عنها داخل النص */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return <>{text}</>;
  const start = Math.max(0, i - 30);
  return (
    <>
      {start > 0 && "…"}{text.slice(start, i)}
      <mark className="rounded px-0.5" style={{ background: "color-mix(in srgb, var(--accent) 30%, transparent)", color: "inherit" }}>{text.slice(i, i + q.trim().length)}</mark>
      {text.slice(i + q.trim().length)}
    </>
  );
}

export function SearchHitRow({ hit, q, showConv }: { hit: SearchHit; q: string; showConv?: boolean }) {
  const { convs, jumpTo } = useWasl();
  const title = useConvTitle();
  const conv = convs.find((c) => c.id === hit.conversation.id);
  const m = hit.message;
  return (
    <button onClick={() => jumpTo(hit.conversation.id, m.id)} className="w-hover flex w-full items-start gap-3 px-4 py-2.5 text-start" data-testid="search-hit">
      {showConv && conv && <ConvAvatar conv={conv} other={null} size={42} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <strong className="truncate text-sm" dir="auto">{showConv && conv ? title(conv) : nameOf(m.sender)}</strong>
          <time className="w-muted shrink-0 text-xs" dir="ltr">{listTime(m.created_at)}</time>
        </span>
        <span className="w-muted line-clamp-2 block text-[13px]" dir="auto">
          {showConv && conv?.kind === "group" && `${nameOf(m.sender)}: `}<Highlight text={m.content || m.file_name || preview(m).text} q={q} />
        </span>
      </span>
    </button>
  );
}

export function SearchPanel({ convId }: { convId: number }) {
  const t = useT();
  const { setPanel } = useWasl();
  const [q, setQ] = useState("");
  const { hits, loading } = useMessageSearch(q, convId);
  return (
    <Panel title={t("البحث في المحادثة")} onClose={() => setPanel(null)}>
      <label className="w-input mt-1 flex items-center gap-2 rounded-2xl px-4">
        <Icon name="search" size={20} className="w-muted" />
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ابحث في الرسائل...")} aria-label={t("ابحث في الرسائل...")}
          className="h-12 w-full bg-transparent text-base outline-none md:text-sm" style={{ color: "var(--text)" }} dir="auto" />
      </label>
      <div className="-mx-4 mt-2">
        {q.trim().length >= 2 && !loading && hits.length === 0 && <p className="w-muted p-6 text-center text-sm">{t("لا توجد نتائج")}</p>}
        {hits.map((h) => <SearchHitRow key={h.message.id} hit={h} q={q} />)}
      </div>
      <p className="w-muted mt-4 text-center text-xs">{t("يُبحث في آخر 5000 رسالة من محادثاتك.")}</p>
    </Panel>
  );
}

// ------------------------------------------------------------ استطلاع جديد
export function PollDialog({ convId, onClose }: { convId: number; onClose: () => void }) {
  const t = useT();
  const { notify } = useWasl();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  async function send() {
    setBusy(true);
    try {
      await msgApi.sendPoll(convId, question.trim(), filled, multiple);
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = "w-input h-11 w-full rounded-2xl px-4 text-base outline-none md:text-sm";
  return (
    <Sheet title={t("استطلاع جديد")} onClose={onClose}>
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("السؤال")} aria-label={t("السؤال")} dir="auto" autoFocus maxLength={300} className={input} />
      <div className="mt-3 grid gap-2">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={o} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? e.target.value : x)))} dir="auto" maxLength={100}
              placeholder={t("الخيار {n}", { n: i + 1 })} aria-label={t("الخيار {n}", { n: i + 1 })} className={input} />
            {options.length > 2 && (
              <button onClick={() => setOptions((l) => l.filter((_, j) => j !== i))} aria-label={t("حذف الخيار")} className="w-muted grid h-9 w-9 shrink-0 place-items-center rounded-full"><Icon name="x" size={16} /></button>
            )}
          </div>
        ))}
      </div>
      {options.length < 12 && (
        <button onClick={() => setOptions((l) => [...l, ""])} className="w-accent-text mt-2 flex items-center gap-1 text-sm font-bold"><Icon name="plus" size={16} />{t("إضافة خيار")}</button>
      )}
      <div className="mt-3 flex items-center gap-3">
        <span className="flex-1 text-sm font-semibold">{t("السماح بأكثر من إجابة")}</span>
        <Toggle on={multiple} onChange={setMultiple} label={t("السماح بأكثر من إجابة")} />
      </div>
      <button onClick={send} disabled={busy || !question.trim() || filled.length < 2}
        className="w-accent mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-bold disabled:opacity-50">
        <Icon name="poll" size={18} />{t("إرسال الاستطلاع")}
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------ مجلد محادثات (جديد أو تعديل)
export function FolderDialog({ folder, onClose, onSaved }: { folder?: ChatFolder; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { convs, notify } = useWasl();
  const title = useConvTitle();
  const [name, setName] = useState(folder?.name ?? "");
  const [picked, setPicked] = useState<number[]>(folder?.conversation_ids ?? []);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onSaved();
      onClose();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <Sheet title={t(folder ? "تعديل المجلد" : "مجلد جديد")} onClose={onClose}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("اسم المجلد (مثل: الدراسة)")} aria-label={t("اسم المجلد")}
        maxLength={30} dir="auto" autoFocus={!folder} className="w-input h-11 w-full rounded-full px-4 text-base outline-none md:text-sm" />
      <p className="w-muted mb-1 mt-3 text-xs font-semibold">{t("المحادثات في المجلد ({n})", { n: picked.length })}</p>
      <div className="w-scroll -mx-2 max-h-[40dvh] overflow-y-auto">
        {convs.map((c) => (
          <button key={c.id} onClick={() => toggle(c.id)} role="checkbox" aria-checked={picked.includes(c.id)}
            className="w-hover flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start">
            <ConvAvatar conv={c} other={null} size={36} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">{title(c)}</span>
            <span className="grid h-5 w-5 place-items-center rounded border-2" style={{ borderColor: picked.includes(c.id) ? "var(--accent)" : "var(--muted)", background: picked.includes(c.id) ? "var(--accent)" : undefined }}>
              {picked.includes(c.id) && <Icon name="check" size={11} strokeWidth={3.5} className="text-white" />}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {folder && (
          <button onClick={() => confirm(t("حذف المجلد؟ تبقى المحادثات كما هي.")) && run(() => foldersApi.remove(folder.id))}
            className="h-12 flex-1 rounded-full text-sm font-bold" style={{ color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}>{t("حذف المجلد")}</button>
        )}
        <button disabled={!name.trim()} onClick={() => run(() => (folder ? foldersApi.update(folder.id, { name, conversation_ids: picked }) : foldersApi.create(name, picked)))}
          className="w-accent h-12 flex-[2] rounded-full text-[15px] font-bold disabled:opacity-50">{t("حفظ")}</button>
      </div>
    </Sheet>
  );
}
