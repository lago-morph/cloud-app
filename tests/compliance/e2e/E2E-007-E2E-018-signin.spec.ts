/**
 * E2E-018 — Sign-in through the auth app, and E2E-007 — Role from membership, local parts (plan-v0.2.0
 * §4.1, §7.1 "Add" item 2 and the E2E-007 rewrite). API-driven over HTTP (support/signin-client.ts)
 * against the local real-sign-in stack (support/signin-stack.ts): the reference app's production
 * bundle, the auth app, mock-oauth2-server and the fake memberships API. E2E-018's one UI test is in
 * E2E-005.spec.ts, which also checks what the pages expose.
 *
 * Edge cases listed before writing (resources/edge-cases.md): return URLs one character off (trailing
 * slash, case, port, percent-encoding), another app's ID; a code reused, issued for another app, and
 * redeemed concurrently; consent denied; no email in the ID token; anonymous, user, admin and someone
 * outside the account; the auth app unavailable between refreshes, at a refresh and at sign-in.
 * A code past its 60 s lifetime is not here: workerd's clock cannot be moved, and waiting is not
 * worth it for a rule the auth app's unit tests show with a fake clock (DEC-0765).
 *
 * E2E-007 (DEC-0703, DEC-0791): a promote, a demote and a removal leave each existing session's level as
 * it was, also after a role refresh; a new sign-in shows the new level, and a removed member's is
 * refused; an existing session follows a new sign-in at its next refresh; a session ends just after
 * PAR-250 (12 hours) and not before. The 12-hour part runs in-process (`createTestApp` with the
 * auth-app provider over the fake binding and its clock), because workerd's clock cannot be moved.
 */
import type { TestApp } from "@lago-morph/prototype-framework/testing";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { referenceTestApp } from "./support/in-process.js";
import { Browser } from "./support/signin-client.js";
import { APP_ID, startSignInStack, type SignInStack } from "./support/signin-stack.js";
import { ACCOUNT_ID } from "../../../packages/framework/test/integration/auth-app/support.js";

/** PAR-425 (role-refresh interval, 5 min) plus a margin: a role change shows on the first request after it. */
const REFRESH_WAIT_MS = 5 * 60_000 + 15_000;
const ADMIN = ["Super Administrator - All Privileges"];
const USER = ["HTTP Applications Read"];

let stack: SignInStack;
let callback = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(600_000);
  stack = await startSignInStack();
  callback = `${stack.appOrigin}/api/auth/callback`;
  // As `deploy` does for a production stage once its Worker exists (DEC-0725).
  await stack.registry.register(APP_ID, callback);
});

test.afterAll(async () => {
  await stack?.close();
});

const member = (sub: string, roles: string[], email?: string) =>
  stack.members.set(sub, { ...(email === undefined ? {} : { email }), memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles }] });

test(tag("E2E-018", "deploy registers the app's return URL and remove clears it: /start refuses an unregistered app, accepts it once registered, refuses it again after remove"), async () => {
  await stack.registry.unregister(APP_ID);
  const before = await new Browser(stack).start();
  expect(before.start.status).toBe(400);
  expect(before.start.location).toBeNull();
  expect(await stack.registry.problems()).toEqual([]);
  await stack.registry.register(APP_ID, callback);
  await stack.registry.register(APP_ID, callback);
  expect((await new Browser(stack).start()).start.status, "registered (twice: idempotent)").toBe(302);
  await stack.registry.unregister(APP_ID);
  expect((await new Browser(stack).start()).start.status, "after remove").toBe(400);
  await stack.registry.register(APP_ID, callback);
});

test(tag(["E2E-018", "AUTH-AC-006"], "a member signs in as user and an administrator as admin; the transaction cookie is HttpOnly, Secure, SameSite=Lax, Path=/ and __Host-; sign-out ends the session"), async () => {
  member("e2e018-user", USER);
  member("e2e018-admin", ADMIN);
  const user = new Browser(stack);
  const flow = await user.signIn("e2e018-user");
  const tx = flow.login.setCookies.find((c) => c.startsWith("__Host-login="))!;
  expect(tx, "the transaction cookie").toBeDefined();
  for (const attribute of [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\/(;|$)/i]) expect(tx).toMatch(attribute);
  expect(tx).not.toMatch(/;\s*Domain=/i);
  const start = new URL(flow.login.location!);
  expect(`${start.origin}${start.pathname}`).toBe(`${stack.authOrigin}/start`);
  expect(start.searchParams.get("app")).toBe(APP_ID);
  expect(start.searchParams.get("return")).toBe(callback);
  expect(flow.appCallback.status).toBe(302);
  expect(flow.appCallback.setCookies.some((c) => /^__Host-login=;/.test(c) || (c.startsWith("__Host-login=") && /Max-Age=0/i.test(c))), "the callback clears the transaction cookie").toBe(true);
  expect(await user.me()).toMatchObject({ level: "user" });
  expect((await user.api("/api/levels/user")).status).toBe(200);
  expect((await user.api("/api/levels/admin")).status).toBe(403);

  const admin = new Browser(stack);
  await admin.signIn("e2e018-admin");
  expect(await admin.me()).toMatchObject({ level: "admin" });
  expect((await admin.api("/api/levels/admin")).status).toBe(200);

  expect((await user.api("/api/auth/logout", "POST")).status).toBe(204);
  expect(await user.me()).toEqual({ level: "anonymous" });
  expect((await user.api("/api/levels/user")).status).toBe(401);
});

test(tag("E2E-018", "a return URL not in the registry is refused with no redirect: trailing slash, case, port, percent-encoding, another origin, a query; and an app ID with another app's registered return URL"), async () => {
  // Two registered apps, so the mismatch cases pair a registered app with the other's registered return URL.
  const otherReturn = `${stack.appOrigin}/api/auth/other-app-callback`;
  await stack.registry.register("reference-other", otherReturn);
  const u = new URL(callback);
  const otherPort = `${u.protocol}//${u.hostname}:${String(Number(u.port) + 1)}${u.pathname}`;
  const cases: [string, string][] = [
    [APP_ID, `${callback}/`],
    [APP_ID, callback.replace("localhost", "LOCALHOST")],
    [APP_ID, callback.replace("/api/auth/callback", "/api/Auth/callback")],
    [APP_ID, otherPort],
    [APP_ID, callback.replace("/callback", "/%63allback")],
    [APP_ID, `${callback}?next=https://evil.example`],
    [APP_ID, "https://evil.example/api/auth/callback"],
    ["reference-other", callback],
    [APP_ID, otherReturn],
  ];
  for (const [app, ret] of cases) {
    const r = await new Browser(stack).go(`${stack.authOrigin}/start?${new URLSearchParams({ app, return: ret, state: "s" }).toString()}`);
    expect(r.status, `${app} ${ret}`).toBe(400);
    expect(r.location, `${app} ${ret}`).toBeNull();
  }
  // Positive control: each registered pair is accepted.
  for (const [app, ret] of [[APP_ID, callback], ["reference-other", otherReturn]]) {
    const ok = await new Browser(stack).go(`${stack.authOrigin}/start?${new URLSearchParams({ app: app!, return: ret!, state: "s" }).toString()}`);
    expect(ok.status, `${app!} ${ret!}`).toBe(302);
  }
  await stack.registry.unregister("reference-other");
});

test(tag("E2E-018", "a code is single use, bound to its app, and of concurrent redemptions exactly one signs in"), async () => {
  member("e2e018-code", USER);
  // Reused: the same callback URL again, with a fresh transaction, signs no one in.
  const first = new Browser(stack);
  const flow = await first.signIn("e2e018-code");
  expect(await first.me()).toMatchObject({ level: "user" });
  const again = new Browser(stack);
  const { login } = await again.start();
  const replayed = new URL(flow.authCallback.location!);
  replayed.searchParams.set("state", new URL(login.location!).searchParams.get("state")!);
  const reuse = await again.go(replayed.toString());
  expect(reuse.location).toMatch(/\/\?authError=login_failed&requestId=/);
  expect(await again.me()).toEqual({ level: "anonymous" });

  // Issued for another app: registered with its own return URL; its code brought to this app is refused.
  const otherReturn = `${stack.appOrigin}/api/auth/other-app-callback`;
  await stack.registry.register("reference-other", otherReturn);
  const thief = new Browser(stack);
  const { login: mine } = await thief.start();
  const foreign = await thief.go(`${stack.authOrigin}/start?${new URLSearchParams({ app: "reference-other", return: otherReturn, state: "o" }).toString()}`);
  const back = new URL((await thief.go(await thief.atIssuer(foreign.location!, "e2e018-code", { email: "c@example.com", email_verified: true }))).location!);
  // A real code, issued for the other app (its own return URL and state).
  expect(`${back.origin}${back.pathname}`).toBe(otherReturn);
  expect(back.searchParams.get("state")).toBe("o");
  expect(back.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const stolen = await thief.go(`${callback}?${new URLSearchParams({ code: back.searchParams.get("code")!, state: new URL(mine.location!).searchParams.get("state")! }).toString()}`);
  expect(stolen.location).toMatch(/authError=login_failed/);
  expect(await thief.me()).toEqual({ level: "anonymous" });
  await stack.registry.unregister("reference-other");

  // Concurrent: one transaction, one code, six callbacks at once.
  const racer = new Browser(stack);
  const { start } = await racer.start();
  const code = (await racer.go(await racer.atIssuer(start.location!, "e2e018-code", { email: "c@example.com", email_verified: true }))).location!;
  const results = await Promise.all(Array.from({ length: 6 }, () => racer.go(code)));
  const sessions = results.filter((r) => r.setCookies.some((c) => c.startsWith("__Host-session=") && !/Max-Age=0/i.test(c)));
  expect(sessions).toHaveLength(1);
  expect(results.filter((r) => r.location?.includes("authError=login_failed"))).toHaveLength(5);
});

test(tag("E2E-018", "consent denied, someone outside the account and a pending member sign no one in; an ID token with no email signs in through the /user fallback, and with no email anywhere is refused"), async () => {
  const denied = new Browser(stack);
  const { start } = await denied.start();
  const state = new URL(start.location!).searchParams.get("state")!;
  // What Cloudflare's consent screen sends back when the person declines.
  const refused = await denied.go(`${stack.authOrigin}/callback?${new URLSearchParams({ error: "access_denied", state }).toString()}`);
  const app = await denied.go(refused.location!);
  expect(app.location).toMatch(/authError=login_failed/);
  expect(await denied.me()).toEqual({ level: "anonymous" });

  // Outside the account: a membership of another account, and a membership of this one still pending.
  stack.members.set("e2e018-outsider", { memberships: [{ account: { id: "another-account" }, status: "accepted", roles: ADMIN }] });
  stack.members.set("e2e018-pending", { memberships: [{ account: { id: ACCOUNT_ID }, status: "pending", roles: ADMIN }] });
  for (const sub of ["e2e018-outsider", "e2e018-pending"]) {
    const outsider = new Browser(stack);
    expect((await outsider.signIn(sub)).appCallback.location, sub).toMatch(/authError=login_failed/);
    expect(await outsider.me(), sub).toEqual({ level: "anonymous" });
  }

  // No email in the ID token: the auth app reads it from /user, and stores that one.
  member("e2e018-noemail", USER, "from-user-api@example.com");
  const noEmail = new Browser(stack);
  await noEmail.signIn("e2e018-noemail", {});
  expect(await noEmail.me()).toMatchObject({ level: "user" });
  const db = await stack.authDb();
  expect(await db.prepare("SELECT email FROM users WHERE sub = ?1").bind("e2e018-noemail").first()).toEqual({ email: "from-user-api@example.com" });
  // No email from the token or /user: refused.
  member("e2e018-noemail-anywhere", USER);
  const none = new Browser(stack);
  expect((await none.signIn("e2e018-noemail-anywhere", {})).appCallback.location).toMatch(/authError=login_failed/);
  expect(await none.me()).toEqual({ level: "anonymous" });
});

// The role-refresh window, shared by E2E-007 and E2E-018: sessions made, the account changed, then one real
// wait past PAR-425 (workerd's clock cannot be moved, DEC-0765). The outcomes are separate tests, so each
// scenario's result is its own; E2E-007's comes last.
const people = {} as Record<"promoted" | "demoted" | "removed" | "outage", Browser>;

test(tag(["E2E-007", "E2E-018"], "until the role refresh: a promote, a demote and a removal change no session's level; with the auth app down, sessions keep working and a sign-in in flight fails with the app's message; then the interval passes"), async () => {
  test.setTimeout(REFRESH_WAIT_MS + 180_000);
  member("e2e007-promoted", USER);
  member("e2e007-demoted", ADMIN);
  member("e2e007-removed", USER);
  member("e2e018-outage", USER);
  for (const [key, sub] of [["promoted", "e2e007-promoted"], ["demoted", "e2e007-demoted"], ["removed", "e2e007-removed"], ["outage", "e2e018-outage"]] as const) {
    people[key] = new Browser(stack);
    await people[key].signIn(sub);
  }
  expect(await people.promoted.me()).toMatchObject({ level: "user" });
  expect(await people.demoted.me()).toMatchObject({ level: "admin" });

  // E2E-007 step 3: the changes, made in the account.
  member("e2e007-promoted", ADMIN);
  member("e2e007-demoted", USER);
  stack.members.delete("e2e007-removed");
  // E2E-018: the auth app down between refreshes changes nothing; nor do the account's changes before the refresh.
  await stack.setAuthAppDown(true);
  expect(await people.promoted.me()).toMatchObject({ level: "user" });
  expect(await people.demoted.me()).toMatchObject({ level: "admin" });
  expect(await people.removed.me()).toMatchObject({ level: "user" });
  expect(await people.outage.me()).toMatchObject({ level: "user" });
  // A sign-in in flight when the auth app goes down fails with the app's message, and no session.
  await stack.setAuthAppDown(false);
  member("e2e018-late", USER);
  const late = new Browser(stack);
  const { start } = await late.start();
  const toApp = (await late.go(await late.atIssuer(start.location!, "e2e018-late", { email: "l@example.com", email_verified: true }))).location!;
  await stack.setAuthAppDown(true);
  const failed = await late.go(toApp);
  expect(failed.location).toMatch(/\/\?authError=login_failed&requestId=/);
  expect(await late.me()).toEqual({ level: "anonymous" });
  await stack.setAuthAppDown(false);

  await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
});

test(tag("E2E-018", "at the role refresh with the auth app down, the request is anonymous and the session ends; once it is back, signing in works again"), async () => {
  expect(people.outage, "the refresh-window test ran first").toBeDefined();
  await stack.setAuthAppDown(true);
  const out = await people.outage.api("/api/levels/user");
  expect(out.status).toBe(401);
  expect(out.setCookies.some((c) => c.startsWith("__Host-session=") && /Max-Age=0/i.test(c)), "the session cookie is cleared").toBe(true);
  expect(await people.outage.me()).toEqual({ level: "anonymous" });
  await stack.setAuthAppDown(false);
  const back = new Browser(stack);
  await back.signIn("e2e018-late");
  expect(await back.me()).toMatchObject({ level: "user" });
});

// E2E-007 step 3 (DEC-0703, DEC-0791): a role change or removal shows at the person's next sign-in. The auth
// app records the role only at sign-in, so a role refresh re-reads the recorded role and changes no level.
test(tag("E2E-007", "after the role refresh, each existing session keeps its level; a new sign-in shows the new level, and the removed member is refused"), async () => {
  expect(people.promoted, "the refresh-window test ran first").toBeDefined();
  // Past PAR-425: the refresh has run, and every existing session keeps the level it signed in with.
  expect(await people.promoted.me(), "promoted, existing session").toMatchObject({ level: "user" });
  expect((await people.promoted.api("/api/levels/admin")).status, "promoted, existing session: admin route").toBe(403);
  expect(await people.demoted.me(), "demoted, existing session").toMatchObject({ level: "admin" });
  expect((await people.demoted.api("/api/levels/admin")).status, "demoted, existing session: admin route").toBe(200);
  expect((await people.removed.api("/api/levels/user")).status, "removed, existing session: user route").toBe(200);
  expect(await people.removed.me(), "removed, existing session").toMatchObject({ level: "user" });

  // A new sign-in shows the new level; the removed member can no longer sign in.
  const promoted = new Browser(stack);
  await promoted.signIn("e2e007-promoted");
  expect(await promoted.me(), "promoted, new sign-in").toMatchObject({ level: "admin" });
  expect((await promoted.api("/api/levels/admin")).status, "promoted, new sign-in: admin route").toBe(200);
  const demoted = new Browser(stack);
  await demoted.signIn("e2e007-demoted");
  expect(await demoted.me(), "demoted, new sign-in").toMatchObject({ level: "user" });
  expect((await demoted.api("/api/levels/admin")).status, "demoted, new sign-in: admin route").toBe(403);
  const removed = new Browser(stack);
  expect((await removed.signIn("e2e007-removed")).appCallback.location, "removed, new sign-in").toMatch(/authError=login_failed/);
  expect(await removed.me(), "removed, new sign-in").toEqual({ level: "anonymous" });
});

/** In-process: signs in through `/api/auth/login`, the fake auth app and the callback, and returns the session cookie pair. */
async function signInInProcess(app: TestApp, identity: { readonly sub: string; readonly role: "admin" | "user" }): Promise<string> {
  const begin = await app.request("/api/auth/login");
  expect(begin.status, "login redirects").toBe(302);
  const start = new URL(begin.headers.get("location") ?? "", "https://app.test");
  const pairs = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "");
  const transaction = pairs(begin).filter((pair) => !pair.endsWith("=")).join("; ");
  const code = app.authApp.issueCode(identity, { app: start.searchParams.get("app") ?? "", returnUrl: start.searchParams.get("return") ?? "" });
  const query = new URLSearchParams({ code, state: start.searchParams.get("state") ?? "" });
  const done = await app.request(`/api/auth/callback?${query.toString()}`, { headers: { cookie: transaction } });
  const session = pairs(done).find((pair) => pair.startsWith("session_local=") && pair !== "session_local=");
  if (session === undefined) throw new Error(`in-process sign-in as ${identity.sub} set no session: ${done.status} ${done.headers.get("location") ?? ""}`);
  return session;
}

/** PAR-250 (12 hours, DEC-0791) and PAR-425 (5 minutes), in ms, as the scenario states them. */
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const REFRESH_MS = 5 * 60_000;

test(tag("E2E-007", "in-process, on the test clock: a demoted admin keeps admin in an existing session until just before 12 hours and has no session just after; a new sign-in shows the new level, and an existing session follows it at its next refresh"), async () => {
  const app = await referenceTestApp({ authAppLoginProvider: true });
  try {
    const level = async (cookie: string) => ((await (await app.request("/api/auth/me", { headers: { cookie } })).json()) as { level: string }).level;
    const status = async (cookie: string, path: string) => (await app.request(path, { headers: { cookie } })).status;
    const signedInAt = app.clock.now();
    // The auth app records each person's role at sign-in.
    const demoted = await signInInProcess(app, { sub: "e2e007-ip-demoted", role: "admin" });
    const promoted = await signInInProcess(app, { sub: "e2e007-ip-promoted", role: "user" });

    // The account demotes one and promotes the other; neither has signed in since. Past a refresh, no level changes.
    app.clock.advance(REFRESH_MS + 1000);
    expect(await level(demoted), "demoted, existing session, after a refresh").toBe("admin");
    expect(await status(demoted, "/api/levels/admin"), "demoted, existing session: admin route").toBe(200);
    expect(await level(promoted), "promoted, existing session, after a refresh").toBe("user");
    expect(await status(promoted, "/api/levels/admin"), "promoted, existing session: admin route").toBe(403);

    // The promoted member signs in again: the new session is admin, and the existing one follows at its next refresh.
    const promotedAgain = await signInInProcess(app, { sub: "e2e007-ip-promoted", role: "admin" });
    expect(await level(promotedAgain), "promoted, new sign-in").toBe("admin");
    expect(await status(promotedAgain, "/api/levels/admin"), "promoted, new sign-in: admin route").toBe(200);
    app.clock.advance(REFRESH_MS + 1000);
    expect(await level(promoted), "promoted, existing session, at its next refresh after the new sign-in").toBe("admin");

    // The demoted member's existing session keeps admin until it expires (PAR-250): still admin just before, gone just after.
    app.clock.advance(signedInAt + SESSION_LIFETIME_MS - 60_000 - app.clock.now());
    expect(await level(demoted), "demoted, existing session, just before 12 hours").toBe("admin");
    expect(await status(demoted, "/api/levels/admin"), "demoted, just before 12 hours: admin route").toBe(200);
    app.clock.advance(120_000);
    expect(await level(demoted), "demoted, existing session, just after 12 hours").toBe("anonymous");
    expect(await status(demoted, "/api/levels/user"), "demoted, just after 12 hours: user route").toBe(401);
    expect(await level(promoted), "promoted's first session, just after 12 hours").toBe("anonymous");

    // The demoted member signs in again: user.
    const demotedAgain = await signInInProcess(app, { sub: "e2e007-ip-demoted", role: "user" });
    expect(await level(demotedAgain), "demoted, new sign-in").toBe("user");
    expect(await status(demotedAgain, "/api/levels/admin"), "demoted, new sign-in: admin route").toBe(403);
  } finally {
    await app.dispose();
  }
});
