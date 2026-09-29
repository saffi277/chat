"use client";
/**
 * هيكل التطبيق:
 *  - في الهاتف: شاشة واحدة في كل مرة (القائمة مع الشريط السفلي، أو المحادثة).
 *  - في الحاسوب: عمودان: القائمة في البداية (يمين العربية/يسار الإنجليزية) والمحادثة بجانبها، والتفاصيل تظهر كلوحة جانبية.
 * الوضع (نهاري/ليلي) يُحدَّد بـ data-theme، والألوان كلها في app/wasl.css
 */
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { CallOverlay, CallsView } from "./Calls";
import { ChatList, NavBar } from "./ChatList";
import { Conversation } from "./Conversation";
import { ConvSettingsPanel, JoinDialog, MuteDialog } from "./ConvSettings";
import { SearchPanel } from "./Tools";
import { Icon } from "./icons";
import { LocationPanel } from "./Location";
import { AddContactPanel, PeopleView } from "./People";
import { ChannelsPanel, ContactPanel, GroupPanel, MediaPanel, NewChannelPanel, NewGroupPanel, StarredPanel } from "./Profiles";
import { SettingsView } from "./Settings";
import { StoriesView, StoryComposer, StoryViewer } from "./Stories";
import { useWasl, WaslProvider } from "./store";

export function WaslApp() {
  return (
    <WaslProvider fallback={<Splash />}>
      <Shell />
    </WaslProvider>
  );
}

function Splash() {
  const t = useT();
  return (
    <div className="grid h-dvh place-items-center bg-[#f6f6fb] dark:bg-[#121726]">
      <div className="grid justify-items-center gap-3 text-[#6c5ce7]">
        <div className="grid h-20 w-20 animate-pulse place-items-center rounded-full bg-[#6c5ce7] text-white"><Icon name="chats" size={38} filled /></div>
        <p className="font-bold">{t("وَصل")}</p>
      </div>
    </div>
  );
}

/**
 * لوحة المفاتيح في الآيفون لا تُصغّر الصفحة بل تدفعها للأعلى، فتختفي ترويسة المحادثة.
 * الحل: نجعل التطبيق بارتفاع الجزء الظاهر فعلاً من الشاشة (visualViewport) وفي موضعه،
 * فتبقى الترويسة ثابتة وتتقلّص الرسائل فوق اللوحة (كما في واتساب).
 */
function useVisibleViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
      // لوحة المفاتيح ظاهرة: الجزء الظاهر أقصر من الصفحة بوضوح (clientHeight لا يتقلص في iOS)
      if (root.clientHeight - vv.height > 120) root.dataset.kb = "open";
      else delete root.dataset.kb;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
      delete root.dataset.kb;
    };
  }, []);
}

function Shell() {
  const { me, theme, tab, activeId, convs, panel, storyViewer, call, toast, muteDialog, setMuteDialog, joinCode, setJoinCode } = useWasl();
  useT(); // يعيد رسم الهيكل كله عند تغيير اللغة
  useVisibleViewport();
  // لون شريط الحالة في الهاتف يتبع وضع التطبيق (لا وضع الجهاز)
  useEffect(() => {
    const color = theme === "dark" ? "#121726" : "#f6f6fb";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  }, [theme]);
  const active = convs.find((c) => c.id === activeId);
  return (
    // الوضع (نهاري/ليلي) والثيم (اللون) والخلفية ثلاثة اختيارات مستقلة
    <div className="wasl wasl-shell overflow-hidden" data-theme={theme} data-accent={me.theme || "default"} data-wallpaper={me.wallpaper || "doodles"}>
      {/* في الحاسوب يمتد التطبيق على الشاشة كلها، وعرض القائمة يتدرج مع حجم الشاشة */}
      <div className="flex h-full">
        <aside className={`${active ? "hidden md:flex" : "flex"} w-split relative w-full shrink-0 flex-col overflow-hidden md:w-[360px] md:border-e lg:w-[400px] 2xl:w-[440px]`}
          style={{ background: "var(--panel)" }}>
          <div className="min-h-0 flex-1">
            {tab === "chats" && <ChatList />}
            {tab === "calls" && <CallsView />}
            {tab === "people" && <PeopleView />}
            {tab === "stories" && <StoriesView />}
            {tab === "settings" && <SettingsView />}
          </div>
          <NavBar />
        </aside>
        <main className={`${active ? "flex" : "hidden md:flex"} w-chat-bg min-w-0 flex-1 flex-col overflow-hidden`}>
          {active ? <Conversation key={active.id} conv={active} /> : <Welcome />}
        </main>
      </div>

      {panel?.type === "contact" && <ContactPanel userId={panel.userId} />}
      {panel?.type === "group" && <GroupPanel convId={panel.convId} />}
      {panel?.type === "media" && <MediaPanel convId={panel.convId} initial={panel.tab} />}
      {panel?.type === "starred" && <StarredPanel convId={panel.convId} />}
      {panel?.type === "location" && <LocationPanel convId={panel.convId} />}
      {panel?.type === "newGroup" && <NewGroupPanel />}
      {panel?.type === "addContact" && <AddContactPanel />}
      {panel?.type === "newChannel" && <NewChannelPanel />}
      {panel?.type === "channels" && <ChannelsPanel />}
      {panel?.type === "storyCompose" && <StoryComposer />}
      {panel?.type === "convSettings" && <ConvSettingsPanel convId={panel.convId} />}
      {panel?.type === "search" && <SearchPanel convId={panel.convId} />}
      {muteDialog !== null && <MuteDialog convId={muteDialog} onClose={() => setMuteDialog(null)} />}
      {joinCode && <JoinDialog code={joinCode} onClose={() => setJoinCode(null)} />}
      {storyViewer && <StoryViewer />}
      {call && <CallOverlay />}
      {toast && (
        // أثناء المكالمة يظهر في الأعلى حتى لا يغطي زري الرد والرفض
        <div className={`fixed inset-x-4 z-[70] mx-auto w-fit max-w-sm rounded-full bg-[#1f2937] px-5 py-3 text-center text-sm font-semibold text-white shadow-lg ${call ? "top-[max(1rem,env(safe-area-inset-top))]" : "bottom-24"}`} role="status">{toast}</div>
      )}
    </div>
  );
}

function Welcome() {
  const t = useT();
  return (
    <div className="m-auto grid max-w-sm justify-items-center px-8 text-center">
      <div className="w-accent grid h-24 w-24 place-items-center rounded-full"><Icon name="chats" size={44} filled /></div>
      <h2 className="mt-6 text-2xl font-extrabold">{t("وَصل للحاسوب")}</h2>
      <p className="w-muted mt-2 text-sm leading-7">{t("اختر محادثة من القائمة، أو انتقل إلى جهات الاتصال وابدأ محادثة جديدة.")}</p>
      <p className="w-muted mt-8 flex items-center gap-1.5 text-xs"><Icon name="lock" size={13} />{t("رسائلك محفوظة ومشفّرة في حسابك")}</p>
    </div>
  );
}
