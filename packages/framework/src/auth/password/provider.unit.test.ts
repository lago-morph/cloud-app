/**
 * The password `CredentialProvider` (password.md §2; PWD-REQ-001…007), over the framework
 * tables on both local databases: local D1 through Wrangler's getPlatformProxy (miniflare,
 * DEC-0105) and PGlite (DEC-0106). Every operation and its paths: enumeration-safe outcomes,
 * unverified sign-in refused without mail, single-use and expiring tokens, 429 over a limit, a
 * forged Origin refused, BA's session row removed, and AUTH issuing the framework session from
 * `deriveUserId("password", subject)`. Vitest runs with `NODE_ENV=test`, under which BA would
 * turn its origin check off by default (RESULT.md P1): every check here holds anyway.
 */
import type { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../../tests/support/tags.js";
import { assembleApp } from "../../core/assemble.js";
import { FrameworkError } from "../../core/errors.js";
import { createDeployment } from "../../core/identity.js";
import { defineApp, type Services } from "../../core/public.js";
import { createHttpParts } from "../../http/runtime.js";
import type { LogService, Severity } from "../../log/public.js";
import { applyMigrations, d1MigrationDatabase, pgliteMigrationDatabase, type D1Like, type MigrationDatabase } from "../../mig/apply.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { readHistory } from "../../mig/history.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import type { Dialect } from "../../sql/dialect.js";
import { openPostgres } from "../../sql/postgres.js";
import { LOCAL_COOKIES } from "../local-cookies.js";
import type { CredentialContext, CredentialProvider } from "../login-provider.js";
import { createAuthParts } from "../runtime.js";
import { deriveUserId } from "../user-id.js";
import { bridgeRequest, forward } from "./bridge.js";
import type { MailInput, MailSender } from "./mail.js";
import { BA_PATHS, createPasswordAuth, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, RATE_LIMITS, RESET_LINK_SECONDS, VERIFICATION_LINK_SECONDS, type PasswordDatabase } from "./options.js";
import { createPasswordProvider, PASSWORD_PROVIDER_ID } from "./provider.js";
import { AUTH_MODEL_NAMES } from "./tables.js";

const ORIGIN = "http://localhost:8787";
// Generated dummy secrets for tests only.
const AUTH_SECRET = "pwd-unit-test-secret-9f2c4e1a7b3d5f6091a2b3c4d5e6f708";
const SESSION_KEY = "pwd-unit-test-session-key-0123456789abcdef";
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "another horse battery";

interface Entry {
  readonly component: string;
  readonly severity: Severity;
  readonly message: string;
}

interface Harness {
  readonly dialect: Dialect;
  readonly migrations: MigrationDatabase;
  readonly database: PasswordDatabase;
  rows(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname, persist: false });
  const binding = proxy.env.DB;
  return {
    dialect: "sqlite",
    migrations: d1MigrationDatabase(binding),
    database: { dialect: "sqlite", db: drizzleD1(binding as never) },
    rows: async (sql, ...params) => (await binding.prepare(sql).bind(...params).all<Record<string, unknown>>()).results,
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg: PGlite = await openPostgres();
  return {
    dialect: "postgres",
    migrations: pgliteMigrationDatabase(pg),
    database: { dialect: "postgres", db: drizzlePglite(pg) },
    rows: async (sql, ...params) => {
      let n = 0;
      return (await pg.query<Record<string, unknown>>(sql.replace(/\?/g, () => `$${++n}`), params)).rows;
    },
    close: () => pg.close(),
  };
}

/** A recording outbox whose sender can be switched to failing or never-completing. */
function outbox() {
  const sent: MailInput[] = [];
  let mode: "ok" | "failing" | "never" = "ok";
  const sender: MailSender = {
    send(message) {
      if (mode === "failing") return Promise.reject(Object.assign(new Error(`cannot send to ${message.to}`), { code: "E_SENDER_NOT_VERIFIED" }));
      if (mode === "never") return new Promise<void>(() => undefined);
      sent.push(message);
      return Promise.resolve();
    },
  };
  return {
    sender,
    sent,
    setMode: (m: typeof mode) => void (mode = m),
    to: (address: string) => sent.filter((m) => m.to === address),
    last: (address: string) => sent.filter((m) => m.to === address).at(-1),
  };
}

const TOKEN_IN = /\/api\/auth\/(verify|reset)\?token=([^\s"&<]+)/;

function tokenOf(message: MailInput | undefined): string {
  const match = message === undefined ? null : TOKEN_IN.exec(message.text);
  if (match?.[2] === undefined) throw new Error("no token link in the message");
  return decodeURIComponent(match[2]);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (thrown) {
    if (thrown instanceof FrameworkError) return thrown.code;
    throw thrown;
  }
  return "resolved";
}

let ipCounter = 0;
/** A fresh client IP per test, so rate limits never couple tests (RESULT.md P7). */
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

describe.each([
  ["sqlite (local D1, miniflare)", openD1],
  ["postgres (PGlite)", openPg],
] as const)("the password provider on %s", (_name, open) => {
  let h: Harness;
  let mail: ReturnType<typeof outbox>;
  let entries: Entry[];
  let pending: Promise<unknown>[];
  let provider: CredentialProvider;
  let ip: string;
  let counter = 0;

  const log: LogService = { write: (component, severity, message) => void entries.push({ component, severity, message }) };

  function ctx(overrides: Partial<CredentialContext> = {}): CredentialContext {
    return {
      publicOrigin: ORIGIN,
      origin: ORIGIN,
      clientIp: ip,
      userAgent: "unit-test",
      waitUntil: (work) => void pending.push(work),
      getSecret: async (name) => {
        if (name === FRAMEWORK_SECRETS.authSecret) return AUTH_SECRET;
        throw new Error(`unexpected secret ${name}`);
      },
      getConfig: () => undefined,
      ...overrides,
    };
  }

  const settle = async () => {
    await Promise.all(pending.splice(0));
  };
  const count = async (table: string) => Number((await h.rows(`SELECT count(*) AS n FROM "${table}"`))[0]?.["n"]);
  const address = () => `person${++counter}.${h.dialect}@example.test`;

  /** Signs up and verifies `email`, from its own client IP. */
  async function verifiedAccount(email: string, displayName = "Alice Example"): Promise<void> {
    const c = ctx({ clientIp: freshIp() });
    await provider.signUp(c, { email, password: PASSWORD, displayName });
    await settle();
    await provider.verify(c, { token: tokenOf(mail.last(email)) });
  }

  beforeAll(async () => {
    h = await open();
    const applied = await applyMigrations(h.migrations, { framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, h.dialect, "framework"), app: [] });
    expect(applied.applied).toContain("framework/0001_auth_tables");
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(() => {
    mail = outbox();
    entries = [];
    pending = [];
    ip = freshIp();
    provider = createPasswordProvider({ database: h.database, log, mail: mail.sender });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has the id 'password'", () => {
    expect(provider.id).toBe("password");
    expect(PASSWORD_PROVIDER_ID).toBe("password");
  });

  describe("sign-up and verification", () => {
    it(tag("PWD-AC-001", "sign-up creates an unverified account and mails a verification link on the public origin, with the entered display name"), async () => {
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "  Alice Example " });
      await settle();
      const users = await h.rows(`SELECT * FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, email);
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ name: "Alice Example" });
      expect([false, 0]).toContain(users[0]?.["email_verified"]);
      const messages = mail.to(email);
      expect(messages).toHaveLength(1);
      const message = messages[0];
      expect(message?.subject).toBe("Confirm your email address");
      expect(message?.text).toContain("Hello Alice Example,");
      expect(message?.text).toMatch(new RegExp(`${ORIGIN}/api/auth/verify\\?token=`));
      expect(message?.html).toContain(`href="${ORIGIN}/api/auth/verify?token=`);
      // MAIL-REQ-004: no password, secret or user ID.
      for (const part of [message?.text, message?.html, message?.subject]) {
        expect(part).not.toContain(PASSWORD);
        expect(part).not.toContain(AUTH_SECRET);
        expect(part).not.toContain(String(users[0]?.["id"]));
      }
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });

    it("the link is built from the public origin, not the request's Origin or any header", async () => {
      const email = address();
      await provider.signUp(ctx({ publicOrigin: "https://app.example.test/" , origin: "https://app.example.test" }), { email, password: PASSWORD, displayName: "A" });
      await settle();
      expect(mail.last(email)?.text).toContain("https://app.example.test/api/auth/verify?token=");
    });

    it(tag("PWD-AC-005", "sign-up for an existing address resolves the same and mails the 'someone tried to register' notice"), async () => {
      const email = address();
      expect(await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "First" })).toBeUndefined();
      expect(await provider.signUp(ctx({ clientIp: freshIp() }), { email: email.toUpperCase(), password: NEW_PASSWORD, displayName: "Second" })).toBeUndefined();
      await settle();
      expect(mail.to(email).map((m) => m.subject)).toEqual(["Confirm your email address", "Someone tried to register with your email address"]);
      expect(mail.last(email)?.text).toContain(`${ORIGIN}/api/auth/forgot`);
      expect(mail.last(email)?.text).toContain("Hello First,");
      expect(await h.rows(`SELECT "name" FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, email)).toEqual([{ name: "First" }]);
    });

    it(tag("PWD-AC-002", "sign-up refuses a password outside PAR-254…PAR-255 or a missing display name with HTTP.INVALID_INPUT, and accepts both bounds"), async () => {
      expect(await failure(provider.signUp(ctx(), { email: address(), password: "x".repeat(PASSWORD_MIN_LENGTH - 1), displayName: "A" }))).toBe("HTTP.INVALID_INPUT");
      expect(await failure(provider.signUp(ctx(), { email: address(), password: "x".repeat(PASSWORD_MAX_LENGTH + 1), displayName: "A" }))).toBe("HTTP.INVALID_INPUT");
      expect(await failure(provider.signUp(ctx(), { email: address(), password: PASSWORD, displayName: "   " }))).toBe("HTTP.INVALID_INPUT");
      expect(await failure(provider.signUp(ctx(), { email: "not an address", password: PASSWORD, displayName: "A" }))).toBe("HTTP.INVALID_INPUT");
      expect(await failure(provider.signUp(ctx({ clientIp: freshIp() }), { email: address(), password: "y".repeat(PASSWORD_MIN_LENGTH), displayName: "A" }))).toBe("resolved");
      const longest = address();
      expect(await failure(provider.signUp(ctx({ clientIp: freshIp() }), { email: longest, password: "z".repeat(PASSWORD_MAX_LENGTH), displayName: "A" }))).toBe("resolved");
      // PAR-244: the stored credential is an scrypt hash, never the password.
      const stored = await h.rows(
        `SELECT a."password" AS p FROM "${AUTH_MODEL_NAMES.account}" a JOIN "${AUTH_MODEL_NAMES.user}" u ON u."id" = a."user_id" WHERE u."email" = ?`,
        longest,
      );
      expect(String(stored[0]?.["p"])).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    });

    it(tag("PWD-AC-001", "sign-in before verification is AUTH.NOT_VERIFIED and mails nothing; resend mails one new link; verify creates no session"), async () => {
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "Alice" });
      await settle();
      expect(mail.to(email)).toHaveLength(1);
      expect(await failure(provider.signIn(ctx(), { email, password: PASSWORD }))).toBe("AUTH.NOT_VERIFIED");
      await settle();
      expect(mail.to(email)).toHaveLength(1); // sendOnSignIn is off (DEC-0516)
      expect(entries).toContainEqual({ component: "AUTH", severity: "warn", message: "login failed: not verified" });

      await provider.sendVerification(ctx(), { email });
      await settle();
      expect(mail.to(email)).toHaveLength(2);
      await provider.verify(ctx(), { token: tokenOf(mail.last(email)) });
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
      const identity = await provider.signIn(ctx(), { email, password: PASSWORD });
      expect(identity.displayName).toBe("Alice");
    });

    it(tag("PWD-AC-005", "resend resolves the same for an unverified, a verified and an unknown address, and mails only the unverified one"), async () => {
      const unverified = address();
      const verified = address();
      const unknown = address();
      await provider.signUp(ctx({ clientIp: freshIp() }), { email: unverified, password: PASSWORD, displayName: "U" });
      await verifiedAccount(verified);
      await settle();
      const before = mail.sent.length;
      for (const email of [unverified, verified, unknown]) expect(await provider.sendVerification(ctx({ clientIp: freshIp() }), { email })).toBeUndefined();
      await settle();
      expect(mail.sent.slice(before).map((m) => m.to)).toEqual([unverified]);
    });

    it(tag("AUTH-AC-011", "a bogus, empty or tampered verification token is AUTH.LOGIN_FAILED and verifies nothing"), async () => {
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" });
      await settle();
      const token = tokenOf(mail.last(email));
      for (const bad of ["bogus", "", `${token.slice(0, -2)}xx`]) expect(await failure(provider.verify(ctx(), { token: bad }))).toBe("AUTH.LOGIN_FAILED");
      expect(entries.filter((e) => e.message === "login failed: invalid token")).toHaveLength(3);
      expect(await failure(provider.signIn(ctx(), { email, password: PASSWORD }))).toBe("AUTH.NOT_VERIFIED");
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });

    it("a verification token replayed within PAR-256 changes nothing and creates no session (DEC-0516)", async () => {
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" });
      await settle();
      const token = tokenOf(mail.last(email));
      await provider.verify(ctx(), { token });
      await provider.verify(ctx(), { token });
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });

    it(tag("PWD-AC-004", "past PAR-256 a verification token is refused"), async () => {
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" });
      await settle();
      const token = tokenOf(mail.last(email));
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + (VERIFICATION_LINK_SECONDS + 60) * 1000 });
      expect(await failure(provider.verify(ctx({ clientIp: freshIp() }), { token }))).toBe("AUTH.LOGIN_FAILED");
    });
  });

  describe("sign-in", () => {
    it(tag("PWD-AC-003", "a verified sign-in returns the BA user ID and the entered display name, and removes BA's session row"), async () => {
      const email = address();
      await verifiedAccount(email, "Bob Builder");
      const identity = await provider.signIn(ctx(), { email: ` ${email.toUpperCase()} `, password: PASSWORD });
      const users = await h.rows(`SELECT "id" FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, email);
      expect(identity).toEqual({ subject: users[0]?.["id"], displayName: "Bob Builder" });
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
      // A second sign-in yields the same subject.
      expect((await provider.signIn(ctx(), { email, password: PASSWORD })).subject).toBe(identity.subject);
    });

    it("BA did create a session row and set its cookies; the bridge returns neither", async () => {
      const email = address();
      await verifiedAccount(email);
      const auth = createPasswordAuth({ database: h.database, publicOrigin: ORIGIN, secret: AUTH_SECRET, waitUntil: () => undefined, log, mail: { verification: () => undefined, reset: () => undefined, existing: () => undefined } });
      const raw = await auth.handler(bridgeRequest(ctx(), { method: "POST", path: BA_PATHS.signIn, body: { email, password: PASSWORD } }));
      expect(raw.status).toBe(200);
      expect(raw.headers.getSetCookie().join(";")).toContain("better-auth.session_token");
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(1);
      await h.rows(`DELETE FROM "${AUTH_MODEL_NAMES.session}"`);
      const answer = await forward(auth, ctx(), { method: "POST", path: BA_PATHS.signIn, body: { email, password: PASSWORD } });
      expect(Object.keys(answer).sort()).toEqual(["code", "signIn", "status"]);
      expect(answer.signIn?.token).toBeTypeOf("string");
      await h.rows(`DELETE FROM "${AUTH_MODEL_NAMES.session}"`);
    });

    it(tag("PWD-AC-005", "an unknown address and a wrong password give the same AUTH.LOGIN_FAILED and log one fixed reason without the address"), async () => {
      const email = address();
      await verifiedAccount(email);
      const errors: unknown[] = [];
      for (const input of [{ email, password: "wrong password!!" }, { email: address(), password: PASSWORD }]) {
        try {
          await provider.signIn(ctx(), input);
        } catch (thrown) {
          errors.push(thrown);
        }
      }
      expect(errors).toHaveLength(2);
      const [a, b] = errors as FrameworkError[];
      expect(a?.code).toBe("AUTH.LOGIN_FAILED");
      expect({ code: b?.code, message: b?.message }).toEqual({ code: a?.code, message: a?.message });
      expect(entries.filter((e) => e.component === "AUTH")).toEqual([
        { component: "AUTH", severity: "warn", message: "login failed: wrong credentials" },
        { component: "AUTH", severity: "warn", message: "login failed: wrong credentials" },
      ]);
      expect(JSON.stringify(entries)).not.toContain("@example.test");
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });
  });

  describe("the account's role list (PWD-REQ-008, DEC-0521)", () => {
    const roleOf = async (email: string) => (await h.rows(`SELECT "role" FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, email))[0]?.["role"] ?? null;
    const subjectOf = async (email: string) => String((await h.rows(`SELECT "id" FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, email))[0]?.["id"]);

    it(tag("PWD-AC-010", "a new account has no role (NULL), before and after verification and sign-in; a role in the sign-up body is not taken"), async () => {
      const email = address();
      const c = ctx({ clientIp: freshIp() });
      await provider.signUp(c, { email, password: PASSWORD, displayName: "New", ...({ role: "admin" } as object) } as { email: string; password: string; displayName: string });
      await settle();
      expect(await roleOf(email)).toBeNull();
      const subject = await subjectOf(email);
      expect(await provider.accountStatus(subject)).toEqual({ verified: false, roles: [] });
      await provider.verify(c, { token: tokenOf(mail.last(email)) });
      await provider.signIn(ctx(), { email, password: PASSWORD });
      expect(await roleOf(email)).toBeNull();
      expect(await provider.accountStatus(subject)).toEqual({ verified: true, roles: [] });
    });

    it("accountStatus is null for an unknown subject and parses the stored list", async () => {
      expect(await provider.accountStatus("no-such-subject")).toBeNull();
      const email = address();
      await verifiedAccount(email);
      const subject = await subjectOf(email);
      await h.rows(`UPDATE "${AUTH_MODEL_NAMES.user}" SET "role" = ? WHERE "id" = ?`, " admin, ,editor", subject);
      expect(await provider.accountStatus(subject)).toEqual({ verified: true, roles: ["admin", "editor"] });
    });

    it(tag("PWD-AC-010", "grant adds admin once; revoke removes it and leaves NULL, never user; an unknown subject changes nothing"), async () => {
      const { changeAccountRole, subjectOfUserId } = await import("./account.js");
      const email = address();
      await verifiedAccount(email);
      const subject = await subjectOf(email);
      expect(await subjectOfUserId(h.database, PASSWORD_PROVIDER_ID, await deriveUserId(PASSWORD_PROVIDER_ID, subject))).toBe(subject);
      expect(await subjectOfUserId(h.database, PASSWORD_PROVIDER_ID, "u_NOBODY")).toBeUndefined();
      expect(await changeAccountRole(h.database, subject, "admin", "grant")).toBe(true);
      expect(await roleOf(email)).toBe("admin");
      expect(await changeAccountRole(h.database, subject, "admin", "grant")).toBe(true);
      expect(await roleOf(email)).toBe("admin");
      expect(await changeAccountRole(h.database, subject, "admin", "revoke")).toBe(true);
      expect(await roleOf(email)).toBeNull();
      expect(await changeAccountRole(h.database, subject, "admin", "revoke")).toBe(true);
      expect(await roleOf(email)).toBeNull();
      await h.rows(`UPDATE "${AUTH_MODEL_NAMES.user}" SET "role" = ? WHERE "id" = ?`, "editor", subject);
      await changeAccountRole(h.database, subject, "admin", "grant");
      expect(await roleOf(email)).toBe("editor,admin");
      await changeAccountRole(h.database, subject, "admin", "revoke");
      expect(await roleOf(email)).toBe("editor");
      expect(await changeAccountRole(h.database, "no-such-subject", "admin", "grant")).toBe(false);
    });
  });

  describe("password reset", () => {
    it(tag("PWD-AC-004", "forgot mails a single-use reset link; after the reset the old password fails and the new one works"), async () => {
      const email = address();
      await verifiedAccount(email);
      await provider.requestReset(ctx(), { email });
      await settle();
      const message = mail.last(email);
      expect(message?.subject).toBe("Reset your password");
      expect(message?.text).toContain(`${ORIGIN}/api/auth/reset?token=`);
      const token = tokenOf(message);
      expect(await failure(provider.reset(ctx(), { token, newPassword: "short" }))).toBe("HTTP.INVALID_INPUT");
      await provider.reset(ctx(), { token, newPassword: NEW_PASSWORD });
      expect(await failure(provider.reset(ctx(), { token, newPassword: NEW_PASSWORD }))).toBe("AUTH.LOGIN_FAILED");
      expect(await failure(provider.signIn(ctx(), { email, password: PASSWORD }))).toBe("AUTH.LOGIN_FAILED");
      expect((await provider.signIn(ctx(), { email, password: NEW_PASSWORD })).displayName).toBe("Alice Example");
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });

    it(tag("PWD-AC-005", "forgot resolves the same for an unknown address and mails nothing"), async () => {
      const unknown = address();
      expect(await provider.requestReset(ctx(), { email: unknown })).toBeUndefined();
      expect(await provider.requestReset(ctx(), { email: "not an address" })).toBeUndefined();
      await settle();
      expect(mail.sent).toEqual([]);
    });

    it("a bogus or empty reset token is AUTH.LOGIN_FAILED", async () => {
      expect(await failure(provider.reset(ctx(), { token: "bogus", newPassword: NEW_PASSWORD }))).toBe("AUTH.LOGIN_FAILED");
      expect(await failure(provider.reset(ctx(), { token: "", newPassword: NEW_PASSWORD }))).toBe("AUTH.LOGIN_FAILED");
    });

    it(tag("PWD-AC-004", "past PAR-257 a reset token is refused"), async () => {
      const email = address();
      await verifiedAccount(email);
      await provider.requestReset(ctx(), { email });
      await settle();
      const token = tokenOf(mail.last(email));
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + (RESET_LINK_SECONDS + 60) * 1000 });
      expect(await failure(provider.reset(ctx({ clientIp: freshIp() }), { token, newPassword: NEW_PASSWORD }))).toBe("AUTH.LOGIN_FAILED");
      vi.useRealTimers();
      expect((await provider.signIn(ctx({ clientIp: freshIp() }), { email, password: PASSWORD })).displayName).toBe("Alice Example");
    });
  });

  describe("rate limits (NODE_ENV=test)", () => {
    it(tag("PWD-AC-006", "sign-in beyond PAR-258 from one IP is AUTH.RATE_LIMITED; another IP is unaffected"), async () => {
      expect(process.env["NODE_ENV"]).toBe("test");
      const email = address();
      await verifiedAccount(email);
      const outcomes: string[] = [];
      for (let i = 0; i <= RATE_LIMITS.signIn.max; i++) outcomes.push(await failure(provider.signIn(ctx(), { email, password: "wrong password!!" })));
      expect(outcomes).toEqual([...Array<string>(RATE_LIMITS.signIn.max).fill("AUTH.LOGIN_FAILED"), "AUTH.RATE_LIMITED"]);
      // Even the right password is refused from that IP within the window (the limiter counts every request, P6).
      expect(await failure(provider.signIn(ctx(), { email, password: PASSWORD }))).toBe("AUTH.RATE_LIMITED");
      expect(entries).toContainEqual({ component: "AUTH", severity: "warn", message: "login failed: rate limited" });
      expect(await failure(provider.signIn(ctx({ clientIp: freshIp() }), { email, password: PASSWORD }))).toBe("resolved");
    });

    it(tag("PWD-AC-006", "sign-up, forgot and resend beyond PAR-259 from one IP are AUTH.RATE_LIMITED"), async () => {
      for (const op of ["signUp", "requestReset", "sendVerification"] as const) {
        ip = freshIp();
        const outcomes: string[] = [];
        for (let i = 0; i <= RATE_LIMITS.mailing.max; i++) {
          const email = address();
          const run = op === "signUp" ? provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" }) : provider[op](ctx(), { email });
          outcomes.push(await failure(run));
        }
        expect(outcomes, op).toEqual([...Array<string>(RATE_LIMITS.mailing.max).fill("resolved"), "AUTH.RATE_LIMITED"]);
      }
    });

    it(tag("PWD-AC-006", "verify and reset submissions beyond PAR-242 from one IP are AUTH.RATE_LIMITED"), async () => {
      const outcomes: string[] = [];
      for (let i = 0; i <= RATE_LIMITS.tokenSubmit.max; i++) outcomes.push(await failure(provider.verify(ctx(), { token: "bogus" })));
      expect(outcomes.at(-1)).toBe("AUTH.RATE_LIMITED");
      expect(new Set(outcomes.slice(0, -1))).toEqual(new Set(["AUTH.LOGIN_FAILED"]));
      ip = freshIp();
      const resets: string[] = [];
      for (let i = 0; i <= RATE_LIMITS.tokenSubmit.max; i++) resets.push(await failure(provider.reset(ctx(), { token: "bogus", newPassword: NEW_PASSWORD })));
      expect(resets.at(-1)).toBe("AUTH.RATE_LIMITED");
    });

    it("the counters live in __framework_auth_rate_limit, keyed by IP and BA path", async () => {
      await failure(provider.signIn(ctx(), { email: address(), password: PASSWORD }));
      const rows = await h.rows(`SELECT "key", "count" FROM "${AUTH_MODEL_NAMES.rateLimit}" WHERE "key" = ?`, `${ip}|${BA_PATHS.signIn}`);
      expect(rows.map((r) => Number(r["count"]))).toEqual([1]);
    });
  });

  describe("forged Origin (NODE_ENV=test)", () => {
    const forged = ["https://evil.example", "", "http://localhost:8788", "null"];

    it(tag("PWD-AC-007", "every operation with a forged or missing Origin is AUTH.REQUEST_FORGERY and has no effect"), async () => {
      const email = address();
      await verifiedAccount(email);
      const fresh = address();
      for (const origin of forged) {
        const c = ctx({ origin });
        expect(await failure(provider.signUp(c, { email: fresh, password: PASSWORD, displayName: "A" })), origin).toBe("AUTH.REQUEST_FORGERY");
        expect(await failure(provider.signIn(c, { email, password: PASSWORD })), origin).toBe("AUTH.REQUEST_FORGERY");
        expect(await failure(provider.sendVerification(c, { email: fresh })), origin).toBe("AUTH.REQUEST_FORGERY");
        expect(await failure(provider.verify(c, { token: "bogus" })), origin).toBe("AUTH.REQUEST_FORGERY");
        expect(await failure(provider.requestReset(c, { email })), origin).toBe("AUTH.REQUEST_FORGERY");
        expect(await failure(provider.reset(c, { token: "bogus", newPassword: NEW_PASSWORD })), origin).toBe("AUTH.REQUEST_FORGERY");
      }
      await settle();
      expect(mail.to(fresh)).toEqual([]);
      expect(mail.to(email)).toHaveLength(1); // the verification of verifiedAccount only
      expect(await h.rows(`SELECT "id" FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, fresh)).toEqual([]);
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });

    it("BA's own origin check is on too: a forged Origin reaching BA's sign-in and sign-up is refused", async () => {
      const email = address();
      await verifiedAccount(email);
      const auth = createPasswordAuth({ database: h.database, publicOrigin: ORIGIN, secret: AUTH_SECRET, waitUntil: () => undefined, log, mail: { verification: () => undefined, reset: () => undefined, existing: () => undefined } });
      const signIn = await forward(auth, ctx({ origin: "https://evil.example" }), { method: "POST", path: BA_PATHS.signIn, body: { email, password: PASSWORD } });
      expect({ status: signIn.status, signIn: signIn.signIn }).toEqual({ status: 403, signIn: undefined });
      expect(signIn.code).toMatch(/ORIGIN/);
      const signUp = await forward(auth, ctx({ origin: "https://evil.example" }), { method: "POST", path: BA_PATHS.signUp, body: { email: address(), password: PASSWORD, name: "A" } });
      expect(signUp.status).toBe(403);
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);
    });
  });

  describe("mail", () => {
    it(tag("PWD-AC-005", "with a sender that never completes, every operation still resolves"), async () => {
      mail.setMode("never");
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" });
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" });
      await provider.sendVerification(ctx({ clientIp: freshIp() }), { email });
      await provider.requestReset(ctx({ clientIp: freshIp() }), { email });
      expect(pending.length).toBeGreaterThanOrEqual(4); // the four sends, plus BA's own background tasks
      pending.splice(0);
    });

    it(tag("MAIL-AC-002", "a failed send changes no outcome and is one MAIL entry naming the code, never the address"), async () => {
      mail.setMode("failing");
      const email = address();
      await provider.signUp(ctx(), { email, password: PASSWORD, displayName: "A" });
      await provider.requestReset(ctx({ clientIp: freshIp() }), { email });
      await settle();
      expect(entries.filter((e) => e.component === "MAIL")).toEqual([
        { component: "MAIL", severity: "error", message: "mail send failed: E_SENDER_NOT_VERIFIED" },
        { component: "MAIL", severity: "error", message: "mail send failed: E_SENDER_NOT_VERIFIED" },
      ]);
      expect(JSON.stringify(entries)).not.toContain(email);
    });
  });

  describe("AUTH issues the framework session", () => {
    function authApp() {
      const deployment = createDeployment({ app: "pwdunit", stage: "dev", target: "local" });
      const auth = createAuthParts({
        deployment,
        publicOrigin: ORIGIN,
       
        secret: async (_c, name) => (name === FRAMEWORK_SECRETS.sessionKey ? SESSION_KEY : name === FRAMEWORK_SECRETS.authSecret ? AUTH_SECRET : Promise.reject(new Error(name))),
        cookies: LOCAL_COOKIES,
        credentialProvider: (c) => createPasswordProvider({ database: h.database, log: c.var.log, mail: mail.sender }),
      });
      const http = createHttpParts();
      const defined = defineApp({ name: "pwdunit", config: {}, secrets: [], tables: {}, routes: (api) => void api.get("/whoami", (c) => c.json(c.var.user)) });
      const hono = assembleApp(defined, {
        deployment,
        createLog: () => log,
        createServices: () => ({}) as unknown as Omit<Services, "log">,
        currentUser: auth.currentUser,
        forgeryCheck: auth.forgeryCheck,
        ...http.parts,
        frameworkRoutes: (api) => {
          http.parts.frameworkRoutes?.(api);
          auth.routes(api);
          // What I-C's route does, reduced: validate, call AUTH, answer with a fixed body.
          api.post("/test/sign-in", async (c) => {
            const body = await c.req.json<{ email: string; password: string }>();
            await auth.credentials?.signIn(c, body);
            return c.json({ result: "signed-in" });
          });
        },
      });
      http.attach(hono);
      return { auth, request: (path: string, init?: RequestInit) => hono.request(path, init, { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => undefined, props: {} }) };
    }

    it(tag("AUTH-AC-013", "a sign-in sets only the framework session cookie, with the user ID derived from 'password' and the subject"), async () => {
      const email = address();
      await verifiedAccount(email, "Carol");
      const { auth, request } = authApp();
      expect(auth.credentials).toBeDefined();
      const res = await request("/api/test/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": freshIp() },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: "signed-in" });
      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(/^session_local=/);
      expect(cookies.join(";")).not.toMatch(/better-auth/);
      expect(await count(AUTH_MODEL_NAMES.session)).toBe(0);

      const users = await h.rows(`SELECT "id" FROM "${AUTH_MODEL_NAMES.user}" WHERE "email" = ?`, email);
      const id = await deriveUserId("password", String(users[0]?.["id"]));
      const who = await request("/api/whoami", { headers: { cookie: cookies[0]?.split(";")[0] ?? "" } });
      expect(await who.json()).toEqual({ level: "user", id, displayName: "Carol" });
    });

    it("a refused sign-in sets no cookie and answers the catalogue error", async () => {
      const { request } = authApp();
      const res = await request("/api/test/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": freshIp() },
        body: JSON.stringify({ email: address(), password: PASSWORD }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH.LOGIN_FAILED");
      expect(res.headers.getSetCookie()).toEqual([]);
    });

    it("the context AUTH builds: public origin, the request's Origin, CF-Connecting-IP or 127.0.0.1, User-Agent", async () => {
      const { auth } = authApp();
      const seen: CredentialContext[] = [];
      const deployment = createDeployment({ app: "pwdunit", stage: "dev", target: "local" });
      const parts = createAuthParts({ deployment, publicOrigin: `${ORIGIN}/ignored-path`, secret: async () => SESSION_KEY, cookies: LOCAL_COOKIES, credentialProvider: () => ({ ...createPasswordProvider({ database: h.database, log, mail: mail.sender }), sendVerification: async (c) => void seen.push(c) }) });
      const defined = defineApp({ name: "pwdunit", config: {}, secrets: [], tables: {}, routes: () => undefined });
      const hono = assembleApp(defined, {
        deployment,
        createLog: () => log,
        createServices: () => ({}) as unknown as Omit<Services, "log">,
        currentUser: parts.currentUser,
        forgeryCheck: parts.forgeryCheck,
        frameworkRoutes: (api) => void api.post("/resend", async (c) => c.json(await parts.credentials?.sendVerification(c, { email: "x@example.test" }) ?? null)),
      });
      await hono.request("/api/resend", { method: "POST", headers: { origin: "https://evil.example", "user-agent": "ua/1", host: "evil.example" } });
      await hono.request("/api/resend", { method: "POST", headers: { origin: ORIGIN, "cf-connecting-ip": "203.0.113.7" } });
      expect(seen.map((c) => [c.publicOrigin, c.origin, c.clientIp, c.userAgent])).toEqual([
        [ORIGIN, "https://evil.example", "127.0.0.1", "ua/1"],
        [ORIGIN, ORIGIN, "203.0.113.7", null],
      ]);
      expect(auth.credentials?.context).toBeTypeOf("function");
    });
  });
});

describe("the bridge's request", () => {
  it(tag("PWD-AC-003", "is built on the public origin and copies only Origin, CF-Connecting-IP and User-Agent"), async () => {
    const request = bridgeRequest(
      { publicOrigin: `${ORIGIN}/`, origin: ORIGIN, clientIp: "192.0.2.1", userAgent: "ua", waitUntil: () => undefined, getSecret: async () => "", getConfig: () => undefined },
      { method: "POST", path: BA_PATHS.signIn, body: { email: "a@example.test", password: PASSWORD } },
    );
    expect(request.url).toBe(`${ORIGIN}/api/auth/password/sign-in/email`);
    expect([...request.headers.keys()].sort()).toEqual(["accept", "cf-connecting-ip", "content-type", "origin", "user-agent"]);
    expect(await request.json()).toEqual({ email: "a@example.test", password: PASSWORD });
    const get = bridgeRequest(
      { publicOrigin: ORIGIN, origin: "", clientIp: "192.0.2.1", userAgent: null, waitUntil: () => undefined, getSecret: async () => "", getConfig: () => undefined },
      { method: "GET", path: BA_PATHS.verify, query: { token: "a b" } },
    );
    expect(get.method).toBe("GET");
    expect(get.url).toBe(`${ORIGIN}/api/auth/password/verify-email?token=a+b`);
    expect([...get.headers.keys()].sort()).toEqual(["accept", "cf-connecting-ip"]);
  });
});
