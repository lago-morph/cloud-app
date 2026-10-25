/**
 * Test helpers (`<package>/testing`). Importable only from app test files.
 * Owners: CORE (test app), AUTH (mock identities), PWD (password login provider), MAIL (outbox).
 * Behavior: docs/components/core.md, docs/components/auth.md, docs/components/password.md,
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
   * (`{ admins?, users? }`, stage-config.schema.json); each `createTestApp` call is one build.
   */
  readonly config?: Record<string, unknown>;
  /** Secret values for the test. */
  readonly secrets?: Record<string, string>;
  /** Capabilities that fail as unavailable: every operation of each one named throws its `*.UNAVAILABLE` code. */
  readonly unavailable?: readonly ("sql" | "kv" | "files" | "secrets")[];
  /**
   * Use the test-only stub login provider instead of the authentication mock. Logins then
   * go through the real login, callback, user-ID derivation, and admin-list code paths
   * (docs/components/auth.md). Default false.
   */
  readonly stubLoginProvider?: boolean;
  /**
   * Use the real email-and-password login provider (docs/components/password.md) with an
   * in-memory outbox (`TestApp.mail`), instead of the authentication mock. Sign-up, verification,
   * sign-in and reset then go through the provider's routes, with its rate limits and request
   * forgery check on. Mutually exclusive with `stubLoginProvider`. Default false.
   */
  readonly passwordLoginProvider?: boolean;
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
   * Discards all state created by this test app. In-process, the original and every test
   * app made from it with `as` share one app: disposing any of them disposes all, and later
   * requests through any of them reject. On a connected stage it only logs that test app
   * out; stage data is kept.
   */
  dispose(): Promise<void>;
}

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
