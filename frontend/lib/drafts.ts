// المسودات: ما كتبته ولم ترسله يبقى في خانة الكتابة لكل محادثة (في هذا المتصفح فقط)،
// ويظهر في قائمة المحادثات «مسودة: ...» كما في واتساب.
const key = (convId: number) => `wasl-draft:${convId}`;

export function readDraft(convId: number) {
  try {
    return localStorage.getItem(key(convId)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(convId: number, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key(convId), text);
    else localStorage.removeItem(key(convId));
  } catch {
    /* التخزين غير متاح (تصفح خاص): لا مسودات */
  }
  window.dispatchEvent(new Event("wasl:draft"));
}
