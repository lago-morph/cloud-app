/**
 * Levels from the account, in-process on one dialect (docs/components/auth.md AUTH-REQ-003 as
 * amended, §2 "Levels", "How the level is evaluated"; password.md PWD-REQ-008; DEC-0521…0525).
 * Each dialect entry file (`roles.d1.test.ts`, `roles.pglite.test.ts`) selects its dialect and
 * then defines this suite, so every criterion here runs "on both dialects".
 *
 * - AUTH-AC-003: with `passwordLoginProvider` (and with `stubLoginProvider` and `loginWithStub`),
 *   `grantRole` makes the very next request with the same session `admin`, `revokeRole` makes
 *   it `user` again, with no new login and no rebuild; the `role` column is NULL afterwards.
 * - AUTH-AC-012: an unverified, deleted or unreadable account is anonymous.
 * - AUTH-AC-013 (derivation part): the user ID equals the derivation from `password` and the
 *   provider's subject, which this suite reads from `__framework_auth_user.id`.
 * - AUTH-AC-015: the reads of `__framework_auth_user` per request, with the statements sent to
 *   the database recorded (`./database.ts`).
 * - PWD-AC-010: the `role` column of new, verified, signed-in and granted-then-revoked accounts,
 *   and sign-ups that try to set it.
 *
 * Written from the criteria and the contracts (testing.d.ts `grantRole`, `revokeRole`,
 * `TestApp.mail`, `loginWithStub`; framework.openapi.yaml `/api/auth/me`;
 * internal/auth-password.openapi.yaml), never from the implementation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry, TestApp as ContractTestApp, TestAppOptions as ContractTestAppOptions } from "../../../../docs/contracts/ts/testing.js";
import { tag } from "../../harness/index.js";
import { referenceTestApp, type TestAppOptions } from "../core/support/in-process.js";
import {
  createVerifiedAccount,
  deriveUserId,
  expectAnswer,
  expectResult,
  forgot,
  hasLink,
  IN_PROCESS_SECRET,
  inProcessBrowser,
  linkToken,
  me,
  newAccount,
  resend,
  reset,
  ROUTES,
  signIn,
  signUp,
  testIp,
  testPassword,
  USER_ID,
  verify,
  waitForMail,
  type Account,
  type AuthBrowser,
} from "../pwd/support.js";
import { accountRow, AUTH_USER, deleteAccount, roleOf, subjectOf, withDatabase, type TestDatabase } from "./database.js";
import { SESSION_LIFETIME_S, sessionCookieName, tamper } from "./support.js";

type App = ContractTestApp;

const opened: App[] = [];

async function openApp(options: ContractTestAppOptions): Promise<{ readonly app: App; readonly db: TestDatabase }> {
  const requested = { ...options, secrets: { apiKey: IN_PROCESS_SECRET, ...(options.secrets ?? {}) } };
  const opened1 = await withDatabase(async () => (await referenceTestApp(requested as unknown as TestAppOptions)) as unknown as App);
  opened.push(opened1.app);
  return opened1;
}

/** The contract's role helpers (testing.d.ts, DEC-0525), or a failure naming them. */
function roles(app: App): Pick<App, "grantRole" | "revokeRole"> {
  const a = app as Partial<App>;
  if (typeof a.grantRole !== "function" || typeof a.revokeRole !== "function") {
    throw new Error("the test app has no grantRole/revokeRole (TestApp.grantRole, TestApp.revokeRole: docs/contracts/ts/testing.d.ts, DEC-0525)");
  }
  return { grantRole: (id, role) => a.grantRole?.(id, role) ?? Promise.resolve(), revokeRole: (id, role) => a.revokeRole?.(id, role) ?? Promise.resolve() };
}

interface SignedIn {
  readonly b: AuthBrowser;
  readonly a: Account;
  readonly id: string;
}

/** Sign-up, verification through `app.mail`, sign-in: a browser holding the account's session. */
async function signedIn(app: App, label: string): Promise<SignedIn> {
  const b = inProcessBrowser(app);
  const a = newAccount(label);
  await createVerifiedAccount(b, a, testIp());
  expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
  const who = await me(b);
  expect(who.level, "a verified, signed-in account with no role is level user").toBe("user");
  expect(who.id ?? "", "the user ID's form (auth.md §2)").toMatch(USER_ID);
  return { b, a, id: who.id ?? "" };
}

/** Background work of earlier requests (mail sends) has finished, so it is not counted. */
function settle(ms = 500): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function expectLevel(b: AuthBrowser, level: "anonymous" | "user" | "admin", id: string, what: string): Promise<void> {
  const who = await me(b);
  if (level === "anonymous") expect(who, `${what}: /api/auth/me is exactly { level: "anonymous" } (no unlistedId)`).toStrictEqual({ level: "anonymous" });
  else expect(who, `${what}: /api/auth/me`).toMatchObject({ level, id });
  const user = await b.get("/api/levels/user");
  if (level === "anonymous") expectAnswer(user, 401, "AUTH.UNAUTHENTICATED");
  else expect(expectAnswer(user, 200).json(), `${what}: requireUser() route`).toStrictEqual({ level, id });
  const admin = await b.get("/api/levels/admin");
  if (level === "admin") expect(expectAnswer(admin, 200).json(), `${what}: requireAdmin() route`).toStrictEqual({ level, id });
  else if (level === "user") expectAnswer(admin, 403, "AUTH.FORBIDDEN");
  else expectAnswer(admin, 401, "AUTH.UNAUTHENTICATED");
}

async function setVerified(db: TestDatabase, subject: string, verified: boolean): Promise<void> {
  await db.run(`UPDATE ${AUTH_USER} SET email_verified = ${db.bool(verified)} WHERE id = ?`, [subject]);
}

/** A Cookie header holding no session cookie (the reference app's own cookie, ROUTES.md). */
const NO_SESSION = "refOne=1";

const ROLE_LOOKUP_FAILED = /^role lookup failed \([^()\s]+\)$/;

export function defineRolesSuite(dialectLabel: string): void {
  describe(`AUTH and PWD levels from the account, in-process on ${dialectLabel}`, () => {
    afterEach(async () => {
      vi.useRealTimers();
      await Promise.all(opened.splice(0).map((a) => a.dispose()));
    });

    // -------------------------------------------------------------------------------------------
    // AUTH-AC-003 (and AUTH-AC-013's "the account's role decides the level as in AUTH-AC-003")
    // -------------------------------------------------------------------------------------------

    it(
      tag(["AUTH-AC-003", "AUTH-AC-013"], `${dialectLabel}, password provider: user after sign-in; grantRole makes the very next request with the same session admin; revokeRole makes it user again and leaves the role column NULL`),
      async () => {
        const { app, db } = await openApp({ passwordLoginProvider: true });
        const { b, a, id } = await signedIn(app, "auth-ac-003");
        const sessionBefore = b.cookies()[sessionCookieName()];
        expect(expectAnswer(await b.get("/api/ref/me"), 200).json(), "c.var.user before the grant").toStrictEqual({ user: { level: "user", id, displayName: a.displayName } });
        await expectLevel(b, "user", id, "before the grant");

        await roles(app).grantRole(id, "admin");
        await expectLevel(b, "admin", id, "the first requests after grantRole, same session");
        expect(expectAnswer(await b.get("/api/ref/me"), 200).json(), "c.var.user after the grant").toStrictEqual({ user: { level: "admin", id, displayName: a.displayName } });

        await roles(app).revokeRole(id, "admin");
        await expectLevel(b, "user", id, "the first requests after revokeRole, same session");
        expect(expectAnswer(await b.get("/api/ref/me"), 200).json(), "c.var.user after the revoke").toStrictEqual({ user: { level: "user", id, displayName: a.displayName } });
        expect(b.cookies()[sessionCookieName()], "the same session throughout (no new login)").toBe(sessionBefore);
        expect(await roleOf(db, a.email), "the role column after the revoke is NULL, not \"user\"").toBeNull();
      },
    );

    it(tag("AUTH-AC-003", `${dialectLabel}, stub provider: grantRole and revokeRole change the level of the logged-in stub account on the next request`), async () => {
      const { app } = await openApp({ stubLoginProvider: true });
      const subject = `auth-ac-003-stub-${String(Date.now())}`;
      await app.loginWithStub(subject, { displayName: "AUTH 003 Stub" });
      const meOf = async (): Promise<Record<string, unknown>> => {
        const r = await app.request("/api/auth/me");
        expect(r.status).toBe(200);
        return (await r.json()) as Record<string, unknown>;
      };
      const first = await meOf();
      expect(first.level).toBe("user");
      const id = String(first.id);
      expect(id).toMatch(USER_ID);
      expect((await app.request("/api/levels/admin")).status, "requireAdmin() before the grant").toBe(403);

      await roles(app).grantRole(id, "admin");
      expect(await meOf()).toStrictEqual({ level: "admin", id, displayName: "AUTH 003 Stub" });
      const admin = await app.request("/api/levels/admin");
      expect(admin.status, "requireAdmin() after the grant").toBe(200);
      expect(await admin.json()).toStrictEqual({ level: "admin", id });
      expect(await (await app.request("/api/ref/me")).json()).toStrictEqual({ user: { level: "admin", id, displayName: "AUTH 003 Stub" } });

      await roles(app).revokeRole(id, "admin");
      expect(await meOf()).toStrictEqual({ level: "user", id, displayName: "AUTH 003 Stub" });
      const forbidden = await app.request("/api/levels/admin");
      expect(forbidden.status, "requireAdmin() after the revoke").toBe(403);
      expect(((await forbidden.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH.FORBIDDEN");
    });

    it(tag("AUTH-AC-013", `${dialectLabel}: the user ID equals u_ + base32(SHA-256("password:" + the provider's subject))[0..26], the subject being the account's __framework_auth_user id`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { a, id } = await signedIn(app, "auth-ac-013-derive");
      const subject = await subjectOf(db, a.email);
      expect(id.toUpperCase()).toBe(deriveUserId("password", subject).toUpperCase());
      expect(id, "the ID is not the subject").not.toBe(subject);
    });

    // -------------------------------------------------------------------------------------------
    // AUTH-AC-012
    // -------------------------------------------------------------------------------------------

    it(tag("AUTH-AC-012", `${dialectLabel}: sign-in before verification is refused and sets no cookie`), async () => {
      const { app } = await openApp({ passwordLoginProvider: true });
      const b = inProcessBrowser(app);
      const a = newAccount("auth-ac-012-unverified");
      expectResult(await signUp(b, a, { ip: testIp() }), "check-email");
      const r = await signIn(b, a.email, a.password, { ip: testIp() });
      expectAnswer(r, 403, "AUTH.NOT_VERIFIED");
      expect(r.setCookies, "no cookie").toEqual([]);
      expect(await me(b)).toStrictEqual({ level: "anonymous" });
    });

    it(tag("AUTH-AC-012", `${dialectLabel}: a signed-in user whose account is then marked unverified is anonymous on the next request (401 on requireUser, /api/auth/me anonymous with no unlistedId)`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { b, a, id } = await signedIn(app, "auth-ac-012-unverify");
      const subject = await subjectOf(db, a.email);
      await setVerified(db, subject, false);
      await expectLevel(b, "anonymous", id, "after the account is marked unverified");
      // Control: the session itself is still valid; the verification flag decided.
      await setVerified(db, subject, true);
      await expectLevel(b, "user", id, "after the account is marked verified again");
    });

    it(tag("AUTH-AC-012", `${dialectLabel}: an account granted admin and then marked unverified is anonymous, not admin`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { b, a, id } = await signedIn(app, "auth-ac-012-admin");
      await roles(app).grantRole(id, "admin");
      await expectLevel(b, "admin", id, "after the grant");
      await setVerified(db, await subjectOf(db, a.email), false);
      await expectLevel(b, "anonymous", id, "admin, then marked unverified");
    });

    it(tag("AUTH-AC-012", `${dialectLabel}: after the account's row is deleted, the next request with its session is anonymous`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { b, a, id } = await signedIn(app, "auth-ac-012-deleted");
      await deleteAccount(db, await subjectOf(db, a.email));
      await expectLevel(b, "anonymous", id, "after the account row is deleted");
    });

    it(tag("AUTH-AC-012", `${dialectLabel}: when the role read fails (__framework_auth_user gone while the session is valid) the request is anonymous and one warn entry "role lookup failed (<code>)" is written`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { b, a, id } = await signedIn(app, "auth-ac-012-lookup");
      const subject = await subjectOf(db, a.email);
      await roles(app).grantRole(id, "admin");
      await settle();
      await db.run(`ALTER TABLE ${AUTH_USER} RENAME TO ${AUTH_USER}_gone`);
      const before = app.logs().length;
      const who = await me(b);
      const entries = app.logs().slice(before);
      expect(who, "the request is anonymous, never admin on a guess").toStrictEqual({ level: "anonymous" });
      const failed = entries.filter((e: LogEntry) => e.message.startsWith("role lookup failed"));
      expect(failed.length, `one role-lookup entry for the request (${JSON.stringify(entries)})`).toBe(1);
      expect(failed[0]?.component).toBe("AUTH");
      expect(failed[0]?.severity).toBe("warn");
      expect(failed[0]?.message ?? "", "role lookup failed (<code>)").toMatch(ROLE_LOOKUP_FAILED);
      expect(JSON.stringify(entries), "the entry never names the subject").not.toContain(subject);
      expect(JSON.stringify(entries), "nor the address").not.toContain(a.email);
      expectAnswer(await b.get("/api/levels/user"), 401, "AUTH.UNAUTHENTICATED");
      expectAnswer(await b.get("/api/levels/admin"), 401, "AUTH.UNAUTHENTICATED");
    });

    // -------------------------------------------------------------------------------------------
    // AUTH-AC-015
    // -------------------------------------------------------------------------------------------

    it(tag("AUTH-AC-015", `${dialectLabel}: no session cookie, or a tampered one, causes no read of __framework_auth_user; a valid password session causes exactly one per request, also on a route that reads c.var.user several times`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { b, a, id } = await signedIn(app, "auth-ac-015");
      // Control for the recorder: a sign-in reads the account, and the recording sees it.
      await settle();
      db.mark();
      const again = inProcessBrowser(app);
      expectAnswer(await signIn(again, a.email, a.password, { ip: testIp() }), 200);
      expect(db.accountReads().length, "the recorder sees the sign-in's reads of __framework_auth_user").toBeGreaterThan(0);
      const name = sessionCookieName();
      const value = b.cookies()[name];
      expect(value, "the sign-in set the session cookie").toBeDefined();
      const session = value ?? "";
      await settle();

      const reads = async (what: string, path: string, cookie: string | undefined, expectLevelOf: string): Promise<number> => {
        db.mark();
        // An explicit Cookie header: without one the test app would add cookies it kept itself.
        const r = await app.request(path, { headers: { cookie: cookie ?? NO_SESSION } });
        const body = (await r.json()) as Record<string, unknown>;
        const level = path === "/api/auth/me" ? body.level : r.status === 401 ? "anonymous" : (body.level ?? (body.user as Record<string, unknown> | undefined)?.level);
        expect(level, `${what}: level`).toBe(expectLevelOf);
        return db.accountReads().length;
      };

      expect(await reads("no session cookie", "/api/auth/me", undefined, "anonymous"), "no session cookie: no read").toBe(0);
      expect(await reads("no session cookie", "/api/levels/user", undefined, "anonymous"), "no session cookie on a requireUser() route: no read").toBe(0);
      const dot = session.indexOf(".");
      for (const tampered of [tamper(session, 0), tamper(session, Math.max(1, dot - 2)), tamper(session, -1), `${session}x`, session.slice(0, -1)]) {
        expect(await reads("tampered cookie", "/api/auth/me", `${name}=${tampered}`, "anonymous"), `tampered cookie ${tampered}: no read`).toBe(0);
        expect(await reads("tampered cookie", "/api/levels/user", `${name}=${tampered}`, "anonymous"), `tampered cookie on a requireUser() route: no read`).toBe(0);
      }

      const valid = `${name}=${session}`;
      expect(await reads("valid session", "/api/auth/me", valid, "user"), "a valid password session: exactly one read").toBe(1);
      // requireUser() reads c.var.user, and the handler reads it again for { level, id }.
      expect(await reads("valid session", "/api/levels/user", valid, "user"), "a route that reads c.var.user several times: still one read").toBe(1);
      expect(await reads("valid session", "/api/ref/me", valid, "user"), "the route dumping c.var.user: one read").toBe(1);
      db.mark();
      const admin = await app.request("/api/levels/admin", { headers: { cookie: valid } });
      expect(admin.status).toBe(403);
      expect(db.accountReads().length, "requireAdmin() on a user: one read").toBe(1);
      expect(id).toMatch(USER_ID);
    });

    it(tag("AUTH-AC-015", `${dialectLabel}: an expired password-provider session cookie causes no read of __framework_auth_user`), async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = Date.parse("2026-06-01T12:00:00Z");
      vi.setSystemTime(start);
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const { b } = await signedIn(app, "auth-ac-015-expired");
      const cookie = `${sessionCookieName()}=${b.cookies()[sessionCookieName()] ?? ""}`;
      await settle();
      db.mark();
      vi.setSystemTime(start + (SESSION_LIFETIME_S - 300) * 1000);
      expect(((await (await app.request("/api/auth/me", { headers: { cookie } })).json()) as { level?: string }).level, "control: within PAR-250 the session is a user").toBe("user");
      expect(db.accountReads().length, "control: one read").toBe(1);
      vi.setSystemTime(start + (SESSION_LIFETIME_S + 300) * 1000);
      db.mark();
      expect(await (await app.request("/api/auth/me", { headers: { cookie } })).json()).toStrictEqual({ level: "anonymous" });
      expect((await app.request("/api/levels/user", { headers: { cookie } })).status).toBe(401);
      expect(db.accountReads().length, "an expired cookie: no read").toBe(0);
    });

    it(tag("AUTH-AC-015", `${dialectLabel}: a mock session (mock-login) causes no read of __framework_auth_user, at any level`), async () => {
      const { app, db } = await openApp({});
      for (const level of ["user", "admin"] as const) {
        const login = await app.request("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level, id: `auth-ac-015-mock-${level}` }) });
        expect(login.status, `mock-login as ${level}`).toBe(204);
        const set = login.headers.getSetCookie().find((c) => c.startsWith(`${sessionCookieName()}=`));
        expect(set, "mock-login set the session cookie").toBeDefined();
        const cookie = (set ?? "").split(";")[0] ?? "";
        await settle(200);
        db.mark();
        expect(await (await app.request("/api/auth/me", { headers: { cookie } })).json()).toMatchObject({ level, id: `auth-ac-015-mock-${level}` });
        expect((await app.request("/api/levels/user", { headers: { cookie } })).status).toBe(200);
        expect((await app.request("/api/levels/admin", { headers: { cookie } })).status).toBe(level === "admin" ? 200 : 403);
        expect(db.accountReads(), `a mock ${level} session: no read`).toEqual([]);
      }
    });

    // -------------------------------------------------------------------------------------------
    // PWD-AC-010
    // -------------------------------------------------------------------------------------------

    it(tag("PWD-AC-010", `${dialectLabel}: a new account's role column is NULL after sign-up, still NULL after verification and sign-in (level user); grantRole then revokeRole leave it NULL, never "user"`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      const b = inProcessBrowser(app);
      const a = newAccount("pwd-ac-010");
      expectResult(await signUp(b, a, { ip: testIp() }), "check-email");
      expect(await accountRow(db, a.email), "sign-up created the account").toBeDefined();
      expect(await roleOf(db, a.email), "after sign-up").toBeNull();
      const mail = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
      expectResult(await verify(b, linkToken(mail, "verify", b.publicOrigin), { ip: testIp() }), "verified");
      expect(await roleOf(db, a.email), "after verification").toBeNull();
      expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
      const who = await me(b);
      expect(who.level).toBe("user");
      expect(await roleOf(db, a.email), "after sign-in").toBeNull();

      const id = who.id ?? "";
      await roles(app).grantRole(id, "admin");
      expect(await roleOf(db, a.email), "after grantRole").toBe("admin");
      await roles(app).grantRole(id, "admin");
      expect(await roleOf(db, a.email), "a second grantRole changes nothing").toBe("admin");
      await roles(app).revokeRole(id, "admin");
      expect(await roleOf(db, a.email), "after revokeRole: NULL, never \"user\"").toBeNull();
      await roles(app).revokeRole(id, "admin");
      expect(await roleOf(db, a.email), "revoking a role not held changes nothing").toBeNull();
    });

    it(tag("PWD-AC-010", `${dialectLabel}: a sign-up whose JSON body carries "role": "admin" or "role": "user" is refused with 400 HTTP.INVALID_INPUT or creates an account with a NULL role that signs in as user, never admin`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      for (const role of ["admin", "user"]) {
        const b = inProcessBrowser(app);
        const a = newAccount(`pwd-ac-010-role-${role}`);
        const r = await b.post(ROUTES.signUp, { email: a.email, password: a.password, displayName: a.displayName, role }, { ip: testIp() });
        if (r.status === 400) {
          expectAnswer(r, 400, "HTTP.INVALID_INPUT");
          expect(await accountRow(db, a.email), `"role": "${role}" refused: no account`).toBeUndefined();
          continue;
        }
        expectResult(r, "check-email");
        expect(await roleOf(db, a.email), `"role": "${role}" in the body: the stored role is NULL`).toBeNull();
        const mail = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
        expectResult(await verify(b, linkToken(mail, "verify", b.publicOrigin), { ip: testIp() }), "verified");
        expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
        const who = await me(b);
        expect(who.level, `"role": "${role}" in the body: signs in as user`).toBe("user");
        expectAnswer(await b.get("/api/levels/admin"), 403, "AUTH.FORBIDDEN");
        expect(await roleOf(db, a.email)).toBeNull();
      }
    });

    it(tag("PWD-AC-010", `${dialectLabel}: no request to the provider's endpoints changes the role column (NULL stays NULL, admin stays admin)`), async () => {
      const { app, db } = await openApp({ passwordLoginProvider: true });
      for (const granted of [false, true]) {
        const { b, a, id } = await signedIn(app, `pwd-ac-010-endpoints-${String(granted)}`);
        if (granted) await roles(app).grantRole(id, "admin");
        const expected = granted ? "admin" : null;
        const check = async (what: string): Promise<void> => {
          await settle(300);
          expect(await roleOf(db, a.email), `${what}: the role column is unchanged`).toBe(expected);
        };
        await check("before");
        for (const role of ["admin", "user"]) {
          await b.post(ROUTES.signUp, { email: a.email, password: testPassword(), displayName: a.displayName, role }, { ip: testIp() });
          await check(`a sign-up for the existing address with "role": "${role}"`);
        }
        await b.post(ROUTES.signIn, { email: a.email, password: a.password, role: "admin" }, { ip: testIp() });
        await check(`a sign-in carrying "role"`);
        expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
        await check("a sign-in");
        expectResult(await resend(b, a.email, { ip: testIp() }), "check-email");
        await check("a resend");
        const sent = (await b.mail.all(a.email)).length;
        expectResult(await forgot(b, a.email, { ip: testIp() }), "check-email");
        const resetMail = await waitForMail(b.mail, a.email, "reset", { after: sent, accept: (m) => hasLink(m, "reset") });
        await check("a forgot");
        const newPassword = testPassword(24);
        expectResult(await reset(b, linkToken(resetMail, "reset", b.publicOrigin), newPassword, { ip: testIp() }), "password-reset");
        await check("a reset");
        expectAnswer(await signIn(b, a.email, newPassword, { ip: testIp() }), 200);
        await check("a sign-in with the new password");
        await b.post(ROUTES.verify, { token: "not-a-token" }, { ip: testIp() });
        await check("a verify with a bogus token");
        await b.post("/api/auth/logout", {});
        await check("a logout");
      }
    });
  });
}
