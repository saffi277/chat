// كل روابط الـ API كدوال جاهزة. الواجهة تنادي هذني بدل ما تكتب الروابط بإيدها.
// التفاصيل الكاملة (شنو يرجع كل واحد، والأخطاء) بملف docs/API.md
import {
  api,
  upload,
  type Call,
  type CallKind,
  type ChannelInfo,
  type Conversation,
  type Me,
  type Member,
  type ScheduledMessage,
  type InvitePreview,
  type Message,
  type MessageKind,
  type Role,
  type StoryGroup,
  type StoryItem,
  type User,
} from "./api";

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ---------------------------------------------------------------- الحساب
export const auth = {
  /** identifier = اسم المستخدم أو البريد الجامعي أو الرقم الجامعي. role لازم يطابق دور الحساب */
  login: (identifier: string, password: string, role?: Role) =>
    api<{ token: string; user: Me }>("/auth/login/", "POST", { identifier, password, role }),
  register: (data: { username: string; password: string; display_name?: string; role?: Role; email?: string; university_id?: string }) =>
    api<{ token: string; user: Me }>("/auth/register/", "POST", data),
  /** من صفحة الدخول: نسيت كلمة المرور أو دعم فني (يوصل للإداري) */
  help: (data: { kind: "password" | "support"; identifier?: string; contact?: string; message?: string }) =>
    api<{ detail: string }>("/auth/help/", "POST", data),
  me: () => api<Me>("/auth/me/"),
  /** تسجيل خروج: التوكن ينمسح من السيرفر (all = من كل الأجهزة) */
  logout: (all = false) => api("/auth/logout/", "POST", { all }),
  updateMe: (data: Partial<Pick<Me, "display_name" | "bio" | "phone" | "city" | "email" | "mode" | "theme" | "wallpaper" | "language" | "hide_preview">>) =>
    api<Me>("/auth/me/", "PATCH", data),
  setAvatar: (file: File | null) => {
    if (!file) return api<Me>("/auth/me/", "PATCH", { avatar: null });
    const form = new FormData();
    form.append("avatar", file);
    return api<Me>("/auth/me/", "PATCH", form);
  },
};

// ---------------------------------------------------------------- الناس
export const users = {
  /** الناس الذين أعرفهم فقط: جهات اتصالي ومن يشاركني محادثة (لا قائمة لكل الجامعة) */
  list: (q?: string) => api<User[]>(`/users/${qs({ q })}`),
  get: (id: number) => api<User>(`/users/${id}/`),
  /** البحث عن حساب بمعرّف كامل: الرقم الجامعي أو البريد أو اسم المستخدم أو رقم الهاتف */
  find: (identifier: string) => api<User>(`/users/find/${qs({ q: identifier })}`),
};

// ---------------------------------------------------------------- جهات الاتصال
export const contacts = {
  list: () => api<User[]>("/contacts/"),
  /** بمعرّف (رقم جامعي، بريد، اسم مستخدم، هاتف) أو برقم شخص أعرفه أصلاً (عضو في مجموعتي) */
  add: (who: { identifier: string } | { user_id: number }) => api<User>("/contacts/", "POST", who),
  remove: (userId: number) => api(`/contacts/${userId}/`, "DELETE"),
};

// ---------------------------------------------------------------- القنوات
export const channels = {
  /** دليل قنوات الجامعة */
  list: (q?: string) => api<ChannelInfo[]>(`/channels/${qs({ q })}`),
  /** للتدريسيين والإداريين فقط */
  create: (title: string, description = "") => api<Conversation>("/channels/", "POST", { title, description }),
  subscribe: (id: number) => api<Conversation>(`/channels/${id}/subscribe/`, "POST"),
  unsubscribe: (id: number) => api(`/channels/${id}/subscribe/`, "DELETE"),
};

// ---------------------------------------------------------------- المحادثات
export type ChatFilter = "all" | "groups" | "channels" | "favorites" | "unread" | "archived";

export const conversations = {
  list: (filter: ChatFilter = "all", q?: string) => api<Conversation[]>(`/conversations/${qs({ filter, q })}`),
  get: (id: number) => api<Conversation>(`/conversations/${id}/`),
  /** محادثة ثنائية ويا شخص (موجودة أو جديدة) */
  openWith: (userId: number) => api<Conversation>("/conversations/", "POST", { user_id: userId }),
  saved: () => api<Conversation>("/conversations/saved/"),
  createGroup: (title: string, memberIds: number[], description = "") =>
    api<Conversation>("/conversations/groups/", "POST", { title, member_ids: memberIds, description }),
  /** إعداداتي: مفضلة، كتم (mute_hours = لمدة)، أرشفة، خلفية هذه المحادثة */
  setPrefs: (id: number, prefs: Partial<Pick<Conversation, "is_favorite" | "is_muted" | "is_archived" | "is_pinned" | "wallpaper">> & { mute_hours?: number }) =>
    api<Conversation>(`/conversations/${id}/`, "PATCH", prefs),
  /** الرسائل المختفية، وإعدادات المجموعة (للمشرف) */
  setSettings: (id: number, data: Partial<Pick<Conversation, "disappear_after" | "only_admins_post" | "only_admins_edit" | "slow_mode">>) =>
    api<Conversation>(`/conversations/${id}/`, "PATCH", data),
  /** رابط دعوة جديد (يلغي القديم)، أو إلغاؤه */
  createInvite: (id: number) => api<{ invite_code: string }>(`/conversations/${id}/invite/`, "POST"),
  revokeInvite: (id: number) => api<{ invite_code: null }>(`/conversations/${id}/invite/`, "DELETE"),
  /** المشرف بس: اسم ووصف المجموعة */
  updateGroup: (id: number, data: { title?: string; description?: string }) =>
    api<Conversation>(`/conversations/${id}/`, "PATCH", data),
  setGroupAvatar: (id: number, file: File | null) => {
    if (!file) return api<Conversation>(`/conversations/${id}/`, "PATCH", { avatar: null });
    const form = new FormData();
    form.append("avatar", file);
    return api<Conversation>(`/conversations/${id}/`, "PATCH", form);
  },
  /** بالمجموعة = مغادرة. بالثنائية = أرشفة */
  leave: (id: number) => api(`/conversations/${id}/`, "DELETE"),
  members: (id: number) => api<Member[]>(`/conversations/${id}/members/`),
  addMembers: (id: number, userIds: number[]) => api<Member[]>(`/conversations/${id}/members/`, "POST", { user_ids: userIds }),
  removeMember: (id: number, userId: number) => api(`/conversations/${id}/members/${userId}/`, "DELETE"),
  setRole: (id: number, userId: number, role: "admin" | "member") =>
    api<Member>(`/conversations/${id}/members/${userId}/`, "PATCH", { role }),
  /** حذف المحادثة عندي بس (الطرف الثاني ما يتأثر) */
  clear: (id: number) => api(`/conversations/${id}/clear/`, "POST"),
  markRead: (id: number) => api<{ updated: number }>(`/conversations/${id}/read/`, "PATCH"),
  /** الوسائط المشتركة + عددها لكل نوع */
  media: (id: number, type: "media" | "image" | "video" | "voice" | "file" | "link" | "location" = "media", before?: number) =>
    api<{ counts: Record<string, number>; results: Message[] }>(`/conversations/${id}/media/${qs({ type, before })}`),
};

// ---------------------------------------------------------------- الرسائل
export type SendFileOpts = {
  kind?: MessageKind; caption?: string; duration?: number; replyTo?: number; name?: string;
  width?: number; height?: number;
  /** نسبة الرفع 0..1 (تجعل الطلب XMLHttpRequest) */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};

export const messages = {
  /** آخر 50 رسالة. للأقدم مرر before = id أقدم رسالة عندك */
  list: (conversationId: number, before?: number) =>
    api<Message[]>(`/conversations/${conversationId}/messages/${qs({ before })}`),
  sendText: (conversationId: number, content: string, replyTo?: number, silent?: boolean) =>
    api<Message>(`/conversations/${conversationId}/messages/`, "POST", { content, reply_to: replyTo, silent }),
  /** الرسائل المجدولة (رسائلي في هذه المحادثة) */
  scheduled: (conversationId: number) => api<ScheduledMessage[]>(`/conversations/${conversationId}/scheduled/`),
  schedule: (conversationId: number, content: string, sendAt: Date, opts: { silent?: boolean; replyTo?: number } = {}) =>
    api<ScheduledMessage>(`/conversations/${conversationId}/scheduled/`, "POST", {
      content, send_at: sendAt.toISOString(), silent: opts.silent, reply_to: opts.replyTo,
    }),
  cancelScheduled: (id: number) => api(`/scheduled/${id}/`, "DELETE"),
  /** صورة/فيديو/صوت/ملف. للصوت مرر duration بالثواني */
  sendFile: (conversationId: number, file: File | Blob, opts: SendFileOpts = {}) => {
    const form = new FormData();
    form.append("file", file, opts.name ?? (file instanceof File ? file.name : "voice.webm"));
    if (opts.kind) form.append("kind", opts.kind);
    if (opts.caption) form.append("content", opts.caption);
    if (opts.duration) form.append("duration", String(opts.duration));
    if (opts.replyTo) form.append("reply_to", String(opts.replyTo));
    // أبعاد الفيديو يقرؤها المتصفح (الخادم يقرأ أبعاد الصورة بنفسه)
    if (opts.width && opts.height) { form.append("width", String(opts.width)); form.append("height", String(opts.height)); }
    const path = `/conversations/${conversationId}/messages/`;
    return opts.onProgress ? upload<Message>(path, form, opts.onProgress, opts.signal) : api<Message>(path, "POST", form);
  },
  /** liveMinutes: 15 أو 60 أو 480 للموقع المباشر */
  sendLocation: (conversationId: number, latitude: number, longitude: number, liveMinutes?: number, caption?: string) =>
    api<Message>(`/conversations/${conversationId}/messages/`, "POST", {
      kind: "location", latitude, longitude, live_minutes: liveMinutes, content: caption,
    }),
  updateLiveLocation: (messageId: number, latitude: number, longitude: number) =>
    api<Message>(`/messages/${messageId}/location/`, "PATCH", { latitude, longitude }),
  stopLiveLocation: (messageId: number) => api<Message>(`/messages/${messageId}/location/`, "PATCH", { stop: true }),
  edit: (messageId: number, content: string) => api<Message>(`/messages/${messageId}/`, "PATCH", { content }),
  remove: (messageId: number) => api(`/messages/${messageId}/`, "DELETE"),
  /** تفاعل ❤️: نفس الإيموجي مرة ثانية يشيله */
  react: (messageId: number, emoji: string) => api<Message>(`/messages/${messageId}/react/`, "POST", { emoji }),
  star: (messageId: number) => api<{ starred: boolean }>(`/messages/${messageId}/star/`, "POST"),
  unstar: (messageId: number) => api<{ starred: boolean }>(`/messages/${messageId}/star/`, "DELETE"),
  /** الرسائل المميزة ⭐ (كلها، أو لمحادثة وحدة) */
  starred: (conversationId?: number) => api<Message[]>(`/starred/${qs({ conversation: conversationId })}`),
};

// ---------------------------------------------------------------- رابط الدعوة
export const invites = {
  preview: (code: string) => api<InvitePreview>(`/invite/${encodeURIComponent(code)}/`),
  join: (code: string) => api<Conversation>(`/invite/${encodeURIComponent(code)}/`, "POST"),
};

// ---------------------------------------------------------------- الحالات
export const stories = {
  feed: (kind?: "image" | "video" | "text") => api<StoryGroup[]>(`/stories/${qs({ kind })}`),
  postMedia: (file: File, text = "") => {
    const form = new FormData();
    form.append("file", file);
    if (text) form.append("text", text);
    return api<StoryItem>("/stories/", "POST", form);
  },
  postText: (text: string, background = "#5b5cf0") => api<StoryItem>("/stories/", "POST", { text, background }),
  remove: (id: number) => api(`/stories/${id}/`, "DELETE"),
  markViewed: (id: number) => api(`/stories/${id}/view/`, "POST"),
  viewers: (id: number) => api<{ user: User; viewed_at: string }[]>(`/stories/${id}/viewers/`),
};

// ---------------------------------------------------------------- المكالمات
export const calls = {
  log: (filter?: "missed") => api<Call[]>(`/calls/${qs({ filter })}`),
  start: (conversationId: number, kind: CallKind) => api<Call>("/calls/", "POST", { conversation_id: conversationId, kind }),
  answer: (id: number) => api<Call>(`/calls/${id}/answer/`, "POST"),
  decline: (id: number) => api(`/calls/${id}/decline/`, "POST"),
  end: (id: number) => api<Call>(`/calls/${id}/end/`, "POST"),
  /** مغادرة المكالمة الجماعية (تبقى لمن بقي) */
  leave: (id: number) => api<Call>(`/calls/${id}/leave/`, "POST"),
  /** المكالمة الجارية في محادثة (لزر «انضمام») */
  active: async (conversationId: number) => (await api<{ call: Call | null }>(`/calls/active/${qs({ conversation: conversationId })}`)).call,
  iceServers: () => api<{ ice_servers: RTCIceServer[] }>("/calls/ice/"),
  /** المكالمة التي ترنّ لي الآن (عند فتح التطبيق من إشعار مكالمة) */
  ringing: async () => (await api<{ call: Call | null }>("/calls/ringing/")).call,
  /** حوّلتُ المكالمة إلى فيديو: يُبلَّغ الطرف الآخر ويُحدَّث السجل */
  video: (id: number) => api(`/calls/${id}/video/`, "POST"),
};
