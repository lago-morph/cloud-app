// S3 scenario, shared by the workerd/D1 run and the Node/PGlite run.
// `send(path, {method, body, headers, host})` -> {status, json}. Each call is one request = one BA instance.
const ORIGIN = "http://localhost:8787";
const IP = "203.0.113.7";

export async function scenario(send, log) {
  const results = [];
  const check = (name, ok, evidence) => {
    results.push({ name, ok: !!ok });
    log(`${ok ? "PASS" : "FAIL"} ${name}${evidence === undefined ? "" : "\n      " + JSON.stringify(evidence)}`);
  };
  const post = (path, body, extra = {}) =>
    send(path, { method: "POST", body, headers: { origin: ORIGIN, "cf-connecting-ip": extra.ip ?? IP, ...(extra.headers ?? {}) }, host: extra.host });
  const mails = async (to) => (await send(`/spike/mail?to=${encodeURIComponent(to)}`, { method: "GET" })).json;
  const shape = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" ? shape(v) : typeof v])) : typeof o);

  const alice = "alice@example.test";
  const pw = "a-long-passphrase-1";

  // 1. sign-up: new vs existing email
  const s1 = await post("/api/auth/password/sign-up", { name: "Alice", email: alice, password: pw });
  const s2 = await post("/api/auth/password/sign-up", { name: "Alice", email: alice, password: "another-passphrase-2" }, { ip: "203.0.113.8" });
  check("sign-up new email -> 200, token null, no Set-Cookie", s1.json.ba.status === 200 && s1.json.ba.body.token === null && s1.json.ba.setCookieNames.length === 0, { status: s1.json.ba.status, body: s1.json.ba.body, setCookie: s1.json.ba.setCookieNames, builtMs: s1.json.builtMs });
  check("sign-up existing email -> same status and same body shape", s2.json.ba.status === s1.json.ba.status && JSON.stringify(shape(s2.json.ba.body)) === JSON.stringify(shape(s1.json.ba.body)) && s2.json.ba.setCookieNames.length === 0, { status: s2.json.ba.status, body: s2.json.ba.body });
  check("existing-email sign-up got a different (synthetic) user.id", s1.json.ba.body.user.id !== s2.json.ba.body.user.id, { real: s1.json.ba.body.user.id, synthetic: s2.json.ba.body.user.id });

  let m = await mails(alice);
  check("outbox: one 'verify' mail (sign-up) + one 'existing' mail (onExistingUserSignUp)", m.filter((x) => x.kind === "verify").length === 1 && m.filter((x) => x.kind === "existing").length === 1, m.map((x) => x.kind));
  const verifyMail = m.find((x) => x.kind === "verify");
  check("verify mail URL is built from baseURL", verifyMail.url.startsWith(`${ORIGIN}/api/auth/password/verify-email?token=`), verifyMail.url.replace(/token=[^&]+/, "token=<jwt>"));

  // 2. sign-in before verification
  const pre = await post("/api/auth/password/sign-in", { email: alice, password: pw });
  check("sign-in before verification -> 403 EMAIL_NOT_VERIFIED", pre.json.ba.status === 403 && pre.json.ba.body.code === "EMAIL_NOT_VERIFIED", { status: pre.json.ba.status, body: pre.json.ba.body });
  m = await mails(alice);
  check("sendOnSignIn re-sent a verify mail", m.filter((x) => x.kind === "verify").length === 2, m.map((x) => x.kind));

  // 3. verify through a framework POST that the bridge turns into BA's GET /verify-email
  const bogus = await post("/api/auth/password/verify", { token: "not-a-token" });
  check("bogus verify token -> 401 INVALID_TOKEN, no Set-Cookie", bogus.json.ba.status === 401 && bogus.json.ba.setCookieNames.length === 0, { status: bogus.json.ba.status, body: bogus.json.ba.body });
  const v = await post("/api/auth/password/verify", { token: verifyMail.token });
  check("verify with mailed token -> 200 {status:true}, no session cookie (autoSignInAfterVerification:false)", v.json.ba.status === 200 && v.json.ba.body.status === true && v.json.ba.setCookieNames.length === 0, { status: v.json.ba.status, body: v.json.ba.body, setCookie: v.json.ba.setCookieNames });
  const v2 = await post("/api/auth/password/verify", { token: verifyMail.token });
  check("replaying the verify token -> still 200 (stateless JWT, not single-use)", v2.json.ba.status === 200, { status: v2.json.ba.status, body: v2.json.ba.body });
  let counts = (await send("/spike/counts", { method: "GET" })).json;
  check("no BA session rows after verify", counts.__framework_auth_session === 0, counts);

  // 4. sign-in after verification
  const ok = await post("/api/auth/password/sign-in", { email: alice, password: pw });
  check("sign-in after verification -> 200 with user.id and a session token", ok.json.ba.status === 200 && typeof ok.json.ba.body.token === "string" && ok.json.ba.body.user.id === s1.json.ba.body.user.id, { status: ok.json.ba.status, body: { ...ok.json.ba.body, token: ok.json.ba.body.token && `<${ok.json.ba.body.token.length} chars>` } });
  check("BA set a cookie that the bridge stripped; BA session row deleted (1 -> 0)", ok.json.ba.setCookieNames.length > 0 && ok.json.bridge.baSessionRowsBefore === 1 && ok.json.bridge.baSessionRowsAfter === 0, { baSetCookie: ok.json.ba.setCookieNames, bridge: ok.json.bridge });
  counts = (await send("/spike/counts", { method: "GET" })).json;
  check("table counts after sign-in", counts.__framework_auth_session === 0 && counts.__framework_auth_user === 1 && counts.__framework_auth_account === 1, counts);

  const wrong = await post("/api/auth/password/sign-in", { email: alice, password: "wrong-password-xx" }, { ip: "198.51.100.1" });
  const nouser = await post("/api/auth/password/sign-in", { email: "nobody@example.test", password: "wrong-password-xx" }, { ip: "198.51.100.1" });
  check("wrong password and unknown email give the same 401 body", wrong.json.ba.status === 401 && JSON.stringify(wrong.json.ba.body) === JSON.stringify(nouser.json.ba.body), { wrong: wrong.json.ba.body, unknown: nouser.json.ba.body });

  // 5. reset flow
  const f1 = await post("/api/auth/password/forgot", { email: alice }, { ip: "198.51.100.2" });
  const f2 = await post("/api/auth/password/forgot", { email: "nobody@example.test" }, { ip: "198.51.100.2" });
  check("forgot: same 200 body for existing and unknown email", f1.json.ba.status === 200 && JSON.stringify(f1.json.ba.body) === JSON.stringify(f2.json.ba.body), { existing: f1.json.ba.body, unknown: f2.json.ba.body });
  m = await mails(alice);
  const resetMail = m.find((x) => x.kind === "reset");
  check("reset mail captured; URL built from baseURL", resetMail && resetMail.url.startsWith(`${ORIGIN}/api/auth/password/reset-password/`), resetMail && resetMail.url.replace(/reset-password\/[^?]+/, "reset-password/<token>"));
  const newPw = "a-brand-new-passphrase-3";
  const r1 = await post("/api/auth/password/reset", { token: resetMail.token, password: newPw }, { ip: "198.51.100.3" });
  check("reset with mailed token -> 200 {status:true}", r1.json.ba.status === 200 && r1.json.ba.body.status === true, { status: r1.json.ba.status, body: r1.json.ba.body, setCookie: r1.json.ba.setCookieNames });
  const r2 = await post("/api/auth/password/reset", { token: resetMail.token, password: "yet-another-passphrase" }, { ip: "198.51.100.3" });
  check("reset token is single-use -> 400 INVALID_TOKEN", r2.json.ba.status === 400, { status: r2.json.ba.status, body: r2.json.ba.body });
  const oldPw = await post("/api/auth/password/sign-in", { email: alice, password: pw }, { ip: "198.51.100.4" });
  const newOk = await post("/api/auth/password/sign-in", { email: alice, password: newPw }, { ip: "198.51.100.4" });
  check("after reset: old password 401, new password 200", oldPw.json.ba.status === 401 && newOk.json.ba.status === 200, { old: oldPw.json.ba.status, new: newOk.json.ba.status });
  const short = await post("/api/auth/password/sign-up", { name: "Bob", email: "bob@example.test", password: "short" }, { ip: "198.51.100.5" });
  check("password shorter than 12 -> 400 PASSWORD_TOO_SHORT", short.json.ba.status === 400 && short.json.ba.body.code === "PASSWORD_TOO_SHORT", short.json.ba.body);

  // 6. rate limiter (database storage) through auth.handler(): sign-in rule 5 per 60 s per IP
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const r = await post("/api/auth/password/sign-in", { email: alice, password: "wrong-password-xx" }, { ip: "192.0.2.99" });
    statuses.push(r.json.ba.status);
  }
  check("sign-in burst from one IP: 5x 401 then 429", statuses.slice(0, 5).every((s) => s === 401) && statuses.slice(5).every((s) => s === 429), statuses);
  const other = await post("/api/auth/password/sign-in", { email: alice, password: "wrong-password-xx" }, { ip: "192.0.2.100" });
  check("another IP is not limited", other.json.ba.status === 401, other.json.ba.status);
  const rl = (await send("/spike/rate-limit-rows", { method: "GET" })).json;
  check("rate-limit rows live in __framework_auth_rate_limit", rl.some((r) => r.key.includes("192.0.2.99") && r.count === 5), rl.filter((r) => r.key.includes("192.0.2.99")));

  // 7. origin checks
  const evil = "https://evil.example";
  const fo1 = await post("/api/auth/password/sign-in", { email: alice, password: newPw }, { ip: "192.0.2.1", headers: { origin: evil } });
  check("forged Origin on sign-in (rebuilt request) -> 403 INVALID_ORIGIN", fo1.json.ba.status === 403 && fo1.json.ba.body.code === "INVALID_ORIGIN", fo1.json.ba.body);
  const fo2 = await post("/api/auth/password/sign-up", { name: "Eve", email: "eve@example.test", password: "a-long-passphrase-9" }, { ip: "192.0.2.2", headers: { origin: evil } });
  check("forged Origin on sign-up -> 403 INVALID_ORIGIN", fo2.json.ba.status === 403 && fo2.json.ba.body.code === "INVALID_ORIGIN", fo2.json.ba.body);
  const fo3 = await post("/api/auth/password/forgot", { email: alice }, { ip: "192.0.2.3", headers: { origin: evil } });
  check("forged Origin on forgot (no cookie) -> BA does NOT reject (originCheck only runs with a Cookie header) [expected gap]", fo3.json.ba.status === 200, { status: fo3.json.ba.status, body: fo3.json.ba.body });
  const fo4 = await send("/raw/request-password-reset", { method: "POST", body: { email: alice }, headers: { origin: evil, cookie: "x=1", "cf-connecting-ip": "192.0.2.4" } });
  check("raw (unbridged) forgot with forged Origin AND a Cookie header -> 403 (BA's check needs a Cookie; the bridge never forwards Cookie)", fo4.json.status === 403, fo4.json.body);
  const raw = await send("/raw/sign-in/email",{ method: "POST", body: { email: alice, password: newPw }, headers: { origin: evil, "cf-connecting-ip": "192.0.2.5" }, host: "evil.example" });
  check("raw passthrough with forged Host + Origin -> 403 INVALID_ORIGIN (trustedOrigins from baseURL, not Host)", raw.status === 200 && raw.json.status === 403, raw.json);
  const fh = await post("/api/auth/password/forgot", { email: alice }, { ip: "192.0.2.6", host: "evil.example", headers: { "x-forwarded-host": "evil.example" } });
  m = await mails(alice);
  const last = m.filter((x) => x.kind === "reset").at(-1);
  check("forged Host/X-Forwarded-Host: reset link still on baseURL", fh.json.ba.status === 200 && last.url.startsWith(ORIGIN), last.url.replace(/reset-password\/[^?]+/, "reset-password/<token>"));

  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length === 0;
}
