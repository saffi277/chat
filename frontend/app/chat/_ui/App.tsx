"use client";
/**
 * هيكل التطبيق:
 *  - بالموبايل: شاشة وحدة بالوقت (القائمة ويا الشريط السفلي، أو المحادثة).
 *  - بالكمبيوتر: عمودين: القائمة يمين، والمحادثة يسار. والتفاصيل تطلع كلوحة جانبية.
 * الشكل (فاتح/داكن) يتحدد بـ data-theme، والألوان كلها بـ app/wasl.css
 */
import { CallOverlay, CallsView } from "./Calls";
import { ChatList, NavBar } from "./ChatList";
import { Conversation } from "./Conversation";
import { GroupsView } from "./Groups";
import { Icon } from "./icons";
import { LocationPanel } from "./Location";
import { PeopleView } from "./People";
import { ContactPanel, GroupPanel, MediaPanel, NewGroupPanel } from "./Profiles";
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
  return (
    <div className="grid h-dvh place-items-center bg-white dark:bg-[#0b141a]">
      <div className="grid justify-items-center gap-3 text-[#1f7bff]">
        <div className="grid h-20 w-20 animate-pulse place-items-center rounded-full bg-[#1f7bff] text-white"><Icon name="chats" size={38} filled /></div>
        <p className="font-bold">وَصل</p>
      </div>
    </div>
  );
}

function Shell() {
  const { theme, tab, activeId, convs, panel, storyViewer, call, toast } = useWasl();
  const active = convs.find((c) => c.id === activeId);
  return (
    <div className="wasl h-dvh overflow-hidden" data-theme={theme}>
      <div className="mx-auto flex h-full max-w-[1600px]">
        <aside className={`${active ? "hidden md:flex" : "flex"} w-line relative w-full shrink-0 flex-col overflow-hidden md:w-[400px] md:border-l`}
          style={{ background: "var(--panel)" }}>
          <div className="min-h-0 flex-1">
            {tab === "chats" && <ChatList />}
            {tab === "calls" && <CallsView />}
            {tab === "groups" && <GroupsView />}
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
      {panel?.type === "media" && <MediaPanel convId={panel.convId} />}
      {panel?.type === "location" && <LocationPanel convId={panel.convId} />}
      {panel?.type === "newGroup" && <NewGroupPanel />}
      {panel?.type === "storyCompose" && <StoryComposer />}
      {storyViewer && <StoryViewer />}
      {call && <CallOverlay />}
      {toast && (
        <div className="fixed inset-x-4 bottom-24 z-[70] mx-auto w-fit max-w-sm rounded-full bg-[#1f2937] px-5 py-3 text-center text-sm font-semibold text-white shadow-lg" role="status">{toast}</div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="m-auto grid max-w-sm justify-items-center px-8 text-center">
      <div className="w-accent grid h-24 w-24 place-items-center rounded-full"><Icon name="chats" size={44} filled /></div>
      <h2 className="mt-6 text-2xl font-extrabold">وَصل للكمبيوتر</h2>
      <p className="w-muted mt-2 text-sm leading-7">اختار محادثة من القائمة، أو اضغط ＋ وابدأ وحدة جديدة.</p>
      <p className="w-muted mt-8 flex items-center gap-1.5 text-xs"><Icon name="lock" size={13} />رسائلك محفوظة بحسابك</p>
    </div>
  );
}
