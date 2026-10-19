/**
 * Test helpers (`<package>/testing`). Importable only from app test files.
 * Owners: CORE (test app), AUTH (mock identities). Behavior: docs/components/core.md,
 * docs/components/auth.md.
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

/**
 * Options for `createTestApp`. The SQL dialect is not an option: it is fixed per test
 * process, and `verify` runs the suite once per supported dialect (docs/components/core.md).
 */
export interface TestAppOptions {
  /** Identity for every request; default anonymous. */
  readonly user?: CurrentUser;
  /** Config values overriding the app's defaults. A key the app did not declare makes `createTestApp` throw. */
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
}

export interface TestApp {
  /**
   * Sends a request to the app's API and returns the response. State-changing requests
   * (any method other than GET, HEAD, and OPTIONS) carry the deployment's origin in
   * `Origin` unless `init` sets one, so they pass the request forgery check.
   */
  request(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Returns a test app that sends subsequent requests as `user`. It shares storage with
   * the original. On a connected stage it logs in as `user` through mock-login.
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
  /** Discards all state created by this test app. On a connected stage it only logs out; stage data is kept. */
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
 * sets `Origin` on state-changing requests. It rejects a stage that is not a test stage.
 * If connecting or logging in gets an unexpected response, it rejects with a message
 * naming the method, path, status, error code, and requestId.
 */
export declare function connectTestStage(): Promise<TestApp>;

export declare const mockUsers: {
  readonly anonymous: CurrentUser;
  readonly user: (id?: string) => CurrentUser;
  readonly admin: (id?: string) => CurrentUser;
};
