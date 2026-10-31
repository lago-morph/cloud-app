/**
 * Test helpers (`<package>/testing`). Importable only from app test files.
 * Owners: CORE (test app), AUTH (mock identities, role helpers), MAIL (outbox).
 * Behavior: docs/components/core.md, docs/components/auth.md,
 * docs/components/mail.md.
 */
import type { DefinedApp } from "./core";
import type { ConfigDeclaration } from "./config";
import type { CurrentUser } from "./auth";
import type { Severity } from "./log";

/** One log entry, shaped as contracts/schemas/log-entry.schema.json. */
export interface LogEntry {
  readonly time: string;
  readonly app: string;
  readonly stage: string;
  /** One of the log entry schema's target values. */
  readonly target: string;
  readonly component: string;
  readonly severity: Severity;
  readonly message: string;
  /** Present when written during an HTTP request. */
  readonly requestId?: string;
}

/** One email the framework sent (verification, reset, or "someone tried to register"). */
export interface MailMessage {
  readonly to: string;
  /** `"<sender name> <no-reply@...>"`. */
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** ISO 8601 time the message was handed to the sender. */
  readonly sentAt: string;
}

/** The framework's outgoing email as a test sees it. Nothing is ever delivered. */
export interface TestMail {
  /** The latest message sent to `address`, or undefined when there is none. */
  lastTo(address: string): Promise<MailMessage | undefined>;
  /** Every message sent so far, in order. On a connected stage this throws: read one address at a time. */
  all(): Promise<readonly MailMessage[]>;
}

/**
 * Options for `createTestApp`. The SQL dialect is not an option: it is fixed per test
 * process, and `verify` runs the suite once per supported dialect (docs/components/core.md).
 */
export interface TestAppOptions {
  /** Identity for every request; default anonymous. */
  readonly user?: CurrentUser;
  /**
   * Config values overriding the app's defaults. A key the app did not declare makes `createTestApp` throw.
   * The reserved key `framework` holds the stage configuration's `framework` section
   * (`{ email? }`, stage-config.schema.json); each `createTestApp` call is one build. It takes no
   * `admins` or `users`: with either, `createTestApp` throws, as the build does (DEC-0521, DEC-0522).
   * Grant roles with `TestApp.grantRole` instead.
   */
  readonly config?: Record<string, unknown>;
  /** Secret values for the test. */
  readonly secrets?: Record<string, string>;
  /**
   * Capabilities that fail as unavailable from creation: every operation of each one named throws
   * its `*.UNAVAILABLE` code (`sql` also makes `kv` unavailable). `TestApp.setUnavailable` changes the set later.
   */
  readonly unavailable?: readonly TestCapability[];
  /**
   * Use the test-only stub login provider instead of the authentication mock. Logins then
   * go through the real login, callback, user-ID derivation, and level code paths
   * (docs/components/auth.md). Each subject logged in gets an in-memory account, verified and
   * with no roles. Default false.
   */
  readonly stubLoginProvider?: boolean;
  /**
   * Use the auth-app provider (sign-in with Cloudflare; provider id `cf-account`) over the
   * in-memory fake auth-app binding (internal/auth-app.d.ts, `TestApp.authApp`), instead of the
   * authentication mock. Logins then go through `/api/auth/login`, the fake auth app's `/start`,
   * the callback's code redemption, the user-ID derivation and the role refresh
   * (docs/components/auth.md; plan-v0.2.0 §4.1). Mutually exclusive with `stubLoginProvider` and
   * with `user`. Default false.
   */
  readonly authAppLoginProvider?: boolean;
  /**
   * For the framework's own MAIL tests: an outgoing-mail sender whose every send fails, or
   * whose sends never complete. Default: the in-memory outbox.
   */
  readonly mailSender?: "failing" | "never-completing";
  /**
   * For the framework's own LOG tests (LOG-AC-001): a log writer whose every write fails, or
   * whose writes never complete. `logs()` then returns no entries. Default: the in-memory log.
   */
  readonly logWriter?: "failing" | "never-completing";
}

/** A capability that `unavailable` and `TestApp.setUnavailable` can make fail. */
export type TestCapability = "sql" | "kv" | "files" | "secrets";

/** The fake auth app as a test sees it (`TestApp.authApp`; internal/auth-app.d.ts, the in-memory fake). */
export interface TestAuthApp {
  issueCode(identity: { readonly sub: string; readonly email: string; readonly role: "admin" | "user" }, options: { readonly app: string; readonly returnUrl?: string }): string;
  setRole(sub: string, role: "admin" | "user" | null): void;
  unregisterApp(app: string): void;
  failNext(n: number): void;
  setUnavailable(unavailable: boolean): void;
  readonly calls: { readonly redeem: number; readonly role: number };
}

/** A test app's clock (`TestApp.clock`). */
export interface TestClock {
  /** The current time, in ms since the epoch. */
  now(): number;
  /** Moves the clock forward by `ms`. */
  advance(ms: number): void;
}

export interface TestApp {
  /**
   * Sends a request to the app's API and returns the response. State-changing requests
   * (any method other than GET, HEAD, and OPTIONS) carry the deployment's origin in
   * `Origin` unless `init` sets one, so they pass the request forgery check.
   * `path` is a path on the app's origin, or a URL on that origin; a URL on any other origin
   * (including `//host`, `/\host`, another protocol on the app's host, and `blob:`) is refused
   * before anything is sent, on both test apps. Send requests to other hosts, such as a cloud
   * ticket's `url`, with `fetch`.
   * In-process, a request comes from the client address 127.0.0.1 unless `init` sets the
   * `CF-Connecting-IP` header, so login rate limits apply per test client.
   */
  request(path: string, init?: RequestInit): Promise<Response>;
  /**
   * The framework's outgoing email: in-process, the in-memory outbox of this test app; on a
   * connected test stage, the stage's mail capture. Messages never leave the test.
   */
  readonly mail: TestMail;
  /**
   * Returns a test app that sends subsequent requests as `user`. It shares storage with
   * the original. On a connected stage it logs in as `user` through mock-login. A test app
   * created with `stubLoginProvider` has no authentication mock, so `as` throws there.
   */
  as(user: CurrentUser): TestApp;
  /**
   * Entries written so far by this test app, in order. Framework `error` entries are also
   * echoed to stderr as they are written. A connected stage's entries are in its log
   * location, so on a connected stage this throws.
   */
  logs(): readonly LogEntry[];
  /**
   * With `stubLoginProvider`: completes a login through the stub provider as `subject`
   * (the provider's identifier for the person) and keeps the resulting session for later
   * requests. Optional `stubFailure` makes the stub's login fail in the named way.
   */
  loginWithStub(subject: string, options?: { readonly displayName?: string; readonly stubFailure?: "refused" | "replayed" }): Promise<void>;
  /**
   * With `authAppLoginProvider`: signs in as the Cloudflare user `identity` (its `sub`, `email`
   * and the role the fake auth app records for it) through `/api/auth/login`, the fake auth app
   * and the callback, and keeps the resulting session for later requests. Throws otherwise and on
   * a connected stage.
   */
  loginWithAuthApp(identity: { readonly sub: string; readonly email: string; readonly role: "admin" | "user" }): Promise<void>;
  /**
   * With `authAppLoginProvider`: the fake auth app. `setRole(sub, role | null)` changes (or, with
   * `null`, removes) the user record the next role refresh reads; `failNext(n)` and
   * `setUnavailable(b)` make binding calls fail as an outage would; `calls` counts `redeem` and
   * `role` calls, failed ones included; `issueCode` and `unregisterApp` are as in the fake.
   * Throws otherwise and on a connected stage.
   */
  readonly authApp: TestAuthApp;
  /**
   * In-process: the clock AUTH reads for session times and the role refresh (PAR-425), and the
   * fake auth app for code lifetimes. `advance(ms)` moves it forward; a role-refresh retry delay
   * (PAR-427) moves it instead of waiting. Throws on a connected stage.
   */
  readonly clock: TestClock;
  /**
   * With `stubLoginProvider` or `authAppLoginProvider`: adds `role` to the roles of the account
   * whose user ID (as `/api/auth/me` shows it) is `userId`: the stub's in-memory account, or the
   * fake auth app's record (`admin`). A session keeps the level it has until its next role refresh (PAR-425; move
   * `clock` past it), so the change shows then, with no new login (AUTH-REQ-003, DEC-0525,
   * DEC-0672). Granting a role already held changes nothing.
   * Rejects when no account has that user ID. Throws on a test app with the authentication mock
   * (choose the level with `user` or `as` instead) and on a connected stage (use the `admins`
   * command there).
   */
  grantRole(userId: string, role: TestRole): Promise<void>;
  /**
   * The reverse of `grantRole`: removes `role` from the account's roles. With no role left the
   * account has none (the `role` column is NULL), never a "user" role. Revoking a role not held
   * changes nothing. Same availability as `grantRole`.
   */
  revokeRole(userId: string, role: TestRole): Promise<void>;
  /**
   * In-process only: replaces the set of unavailable capabilities (initially the `unavailable`
   * option), from the next operation on. It applies to this test app and every test app made from
   * it with `as`, since they share one app. `[]` makes every capability available again. Stored
   * data is kept: a test can store a file, call `setUnavailable(["files"])`, and see a later
   * files operation fail with `FILES.UNAVAILABLE` (DEC-0537). Throws for an unknown capability,
   * after `dispose`, and on a connected stage.
   */
  setUnavailable(capabilities: readonly TestCapability[]): void;
  /**
   * Discards all state created by this test app. In-process, the original and every test
   * app made from it with `as` share one app: disposing any of them disposes all, and later
   * requests through any of them reject. On a connected stage it only logs that test app
   * out; stage data is kept.
   */
  dispose(): Promise<void>;
}

/**
 * The roles a test can grant. `admin` is the only role defined (DEC-0521); "user" is an access
 * level that every verified account has, not a role.
 */
export type TestRole = "admin";

/** In-process app with fresh local storage, migrations applied, and the authentication mock. */
export declare function createTestApp<C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  options?: TestAppOptions,
): Promise<TestApp>;

/**
 * Connects to the deployed stage that the running `smoke` command targets (CLI), or to
 * the local `dev` server when `smoke` runs locally. The base URL comes from the stage's
 * recorded deploy output. It logs in through mock-login, keeps the session cookie, and
 * sets `Origin` on state-changing requests. It rejects a stage that is not a test stage
 * (a stage whose name does not start with `test-`).
 * If connecting or logging in gets an unexpected response, it rejects with a message
 * naming the method, path, status, error code, and requestId.
 */
export declare function connectTestStage(): Promise<TestApp>;

export declare const mockUsers: {
  readonly anonymous: CurrentUser;
  readonly user: (id?: string) => CurrentUser;
  readonly admin: (id?: string) => CurrentUser;
};
