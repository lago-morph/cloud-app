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
 */
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
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

test(tag("E2E-018", "a return URL not in the registry is refused with no redirect: trailing slash, case, port, percent-encoding, another origin, and another app's ID"), async () => {
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
  ];
  for (const [app, ret] of cases) {
    const r = await new Browser(stack).go(`${stack.authOrigin}/start?${new URLSearchParams({ app, return: ret, state: "s" }).toString()}`);
    expect(r.status, `${app} ${ret}`).toBe(400);
    expect(r.location, `${app} ${ret}`).toBeNull();
  }
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
  expect(`${back.origin}${back.pathname}`).toBe(otherReturn);
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

test(tag("E2E-018", "consent denied, and someone outside the account, sign no one in; an ID token with no email signs in through the /user fallback"), async () => {
  const denied = new Browser(stack);
  const { start } = await denied.start();
  const state = new URL(start.location!).searchParams.get("state")!;
  // What Cloudflare's consent screen sends back when the person declines.
  const refused = await denied.go(`${stack.authOrigin}/callback?${new URLSearchParams({ error: "access_denied", state }).toString()}`);
  const app = await denied.go(refused.location!);
  expect(app.location).toMatch(/authError=login_failed/);
  expect(await denied.me()).toEqual({ level: "anonymous" });

  stack.members.set("e2e018-outsider", { memberships: [{ account: { id: "another-account" }, status: "accepted", roles: ADMIN }] });
  const outsider = new Browser(stack);
  expect((await outsider.signIn("e2e018-outsider")).appCallback.location).toMatch(/authError=login_failed/);
  expect(await outsider.me()).toEqual({ level: "anonymous" });

  member("e2e018-noemail", USER, "from-user-api@example.com");
  const noEmail = new Browser(stack);
  await noEmail.signIn("e2e018-noemail", {});
  expect(await noEmail.me()).toMatchObject({ level: "user" });
});

// The role-refresh window, shared by E2E-007 and E2E-018: sessions made, the account changed, then one real
// wait past PAR-425 (workerd's clock cannot be moved, DEC-0765). The outcomes are separate tests, so each
// scenario's result is its own; E2E-007's comes last, as it is red until its root cause is fixed.
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

// Red until the auth app's role(sub) reflects the account's current membership (root cause
// 2026-10-31-T2-E2E-007-role-refresh-reads-stored-role): today it answers the role stored at the person's last sign-in.
test(tag("E2E-007", "at the role refresh: the promoted member is admin, the demoted one user, and the removed one's session ends"), async () => {
  expect(people.promoted, "the refresh-window test ran first").toBeDefined();
  expect.soft(await people.promoted.me(), "promoted").toMatchObject({ level: "admin" });
  expect.soft((await people.promoted.api("/api/levels/admin")).status, "promoted: admin route").toBe(200);
  expect.soft(await people.demoted.me(), "demoted").toMatchObject({ level: "user" });
  expect.soft((await people.demoted.api("/api/levels/admin")).status, "demoted: admin route").toBe(403);
  expect.soft((await people.removed.api("/api/levels/user")).status, "removed: user route").toBe(401);
  expect.soft(await people.removed.me(), "removed").toEqual({ level: "anonymous" });
});
