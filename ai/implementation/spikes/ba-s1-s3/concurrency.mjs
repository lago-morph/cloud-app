// Concurrent sign-ups + sign-ins in one isolate: does every response/mail/session belong to the right user?
// Run against the wrangler bundle (real node:async_hooks) and the browser-condition bundle (BA's ALS polyfill).
// Usage: node concurrency.mjs <bundle> [flags] [date]
import { start } from "./run-workerd.mjs";

const bundle = process.argv[2];
const flags = (process.argv[3] ?? "nodejs_compat").split(",").filter(Boolean);
const date = process.argv[4] ?? "2026-10-01";
const { mf, send } = await start({ bundle, flags, date });
const N = 12;
const users = Array.from({ length: N }, (_, i) => ({ email: `u${i}@example.test`, name: `User ${i}`, pw: `passphrase-number-${i}` }));
const hdr = (i) => ({ origin: "http://localhost:8787", "cf-connecting-ip": `10.0.0.${i + 1}` });
const up = await Promise.all(users.map((u, i) => send("/api/auth/password/sign-up", { method: "POST", body: { name: u.name, email: u.email, password: u.pw }, headers: hdr(i) })));
let bad = up.filter((r, i) => r.json.ba?.status !== 200 || r.json.ba.body.user.email !== users[i].email).length;
for (const [i, u] of users.entries()) {
  const m = (await send(`/spike/mail?to=${encodeURIComponent(u.email)}`)).json;
  if (m.length !== 1) bad++;
  else await send("/api/auth/password/verify", { method: "POST", body: { token: m[0].token }, headers: hdr(i) });
}
const ins = await Promise.all(users.map((u, i) => send("/api/auth/password/sign-in", { method: "POST", body: { email: u.email, password: u.pw }, headers: hdr(i) })));
const ids = new Map(up.map((r, i) => [users[i].email, r.json.ba?.body?.user?.id]));
const wrong = ins.filter((r, i) => r.json.ba?.status !== 200 || r.json.bridge?.subject !== ids.get(users[i].email) || r.json.bridge?.baSessionRowsAfter !== 0);
console.log(`bundle=${bundle} date=${date} flags=${JSON.stringify(flags)}: ${N} concurrent sign-ups (bad ${bad}), ${N} concurrent sign-ins (wrong/failed ${wrong.length})`);
if (wrong.length) console.log(JSON.stringify(wrong.slice(0, 2).map((r) => r.json)));
await mf.dispose();
