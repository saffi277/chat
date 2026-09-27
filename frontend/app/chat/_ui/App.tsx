"use client";
/**
 * هيكل التطبيق:
 *  - بالموبايل: شاشة وحدة بالوقت (القائمة ويا الشريط السفلي، أو المحادثة).
 *  - بالكمبيوتر: عمودين: القائمة يمين، والمحادثة يسار. والتفاصيل تطلع كلوحة جانبية.
 * الشكل (زجاجي/داكن) يتحدد بـ data-theme، والألوان كلها بـ app/wasl.css
 */
import { CallOverlay, CallsView } from "./Calls";
import { ChatList, NavBar } from "./ChatList";
import { Conversation } from "./Conversation";
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
    <div className="grid h-dvh place-items-center bg-[#6fa8d8]" style={{ background: "url(/bg/glass-landscape.svg) center / cover" }}>
      <div className="grid justify-items-center gap-3 text-white">
        <div className="grid h-20 w-20 animate-pulse place-items-center rounded-[28px] bg-white/30 backdrop-blur-xl"><Icon name="chats" size={40} /></div>
        <p className="font-bold drop-shadow">وَصل</p>
      </div>
    </div>
  );
}

function Shell() {
  const { theme, tab, activeId, convs, panel, storyViewer, call, toast } = useWasl();
  const active = convs.find((c) => c.id === activeId);
  return (
    <div className="wasl h-dvh overflow-hidden" data-theme={theme}>
      <div className="mx-auto flex h-full max-w-[1500px] gap-4 md:p-4">
        <aside className={`${active ? "hidden md:flex" : "flex"} w-panel relative w-full shrink-0 flex-col overflow-hidden md:w-[410px] md:rounded-[32px]`}>
          {tab === "chats" && <ChatList />}
          {tab === "calls" && <CallsView />}
          {tab === "people" && <PeopleView />}
          {tab === "stories" && <StoriesView />}
          {tab === "settings" && <SettingsView />}
          <NavBar />
        </aside>
        <main className={`${active ? "flex" : "hidden md:flex"} w-chat-bg min-w-0 flex-1 flex-col overflow-hidden md:rounded-[32px]`}
          style={{ border: "1px solid var(--border)" }}>
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
        <div className="w-strong w-shadow fixed inset-x-4 bottom-28 z-[70] mx-auto w-fit max-w-sm rounded-full px-5 py-3 text-center text-sm font-bold"
          style={{ border: "1px solid var(--border)" }} role="status">{toast}</div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="m-auto grid max-w-sm justify-items-center px-8 text-center">
      <div className="w-panel grid h-24 w-24 place-items-center rounded-[32px]"><span className="w-accent-text"><Icon name="chats" size={44} /></span></div>
      <h2 className="mt-6 text-3xl font-extrabold drop-shadow-sm">أقرب لما يهمك</h2>
      <p className="w-panel mt-3 rounded-2xl px-4 py-2 text-sm">اختار محادثة من القائمة، أو اضغط الزر الأزرق وابدأ وحدة جديدة.</p>
    </div>
  );
}
