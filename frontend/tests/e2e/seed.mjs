// حسابات جاهزة لاختبارات en وfit وperms: «مصطفى محمد» ومعه جهة اتصال «Zahraa» ومحادثة فيها رسائل.
// يكتب seed/accounts.json في مجلد التشغيل (tests/e2e/.out).
import { mkdirSync, writeFileSync } from "node:fs";
const B = process.env.API_URL || "http://localhost:8000/api";
const n = Date.now() % 1000000;
const req = (method, path, body, token) => fetch(B + path, {
  method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Token " + token } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());
const reg = (u, name) => req("POST", "/auth/register/", { username: `${u}${n}`, password: "secret123", display_name: name });
const me = await reg("mustafa", "مصطفى محمد");
const zahraa = await reg("zahraa", "Zahraa");
await req("POST", "/contacts/", { identifier: zahraa.user.username }, me.token);
await req("POST", "/contacts/", { identifier: me.user.username }, zahraa.token);
const chat = await req("POST", "/conversations/", { user_id: zahraa.user.id }, me.token);
for (const [who, text] of [[me, "مرحباً زهراء، هل وصلتك المحاضرات؟"], [zahraa, "نعم، شكراً لك!"], [me, "ممتاز، نلتقي في المكتبة"]]) {
  await req("POST", `/conversations/${chat.id}/messages/`, { content: text }, who.token);
}
mkdirSync("seed", { recursive: true });
writeFileSync("seed/accounts.json", JSON.stringify({ me, zahraa }, null, 1));
console.log("seed accounts ready");
