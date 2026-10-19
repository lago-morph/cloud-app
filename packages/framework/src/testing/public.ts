/**
 * Test helpers owned by the testing component (contract: docs/contracts/ts/testing.d.ts:
 * `createTestApp`, `connectTestStage` and their types). `mockUsers` is AUTH's (auth/testing.ts).
 * Stub written by B-01; implemented by B-16 (`createTestApp`) and C-04 (`connectTestStage`).
 */
import type { DefinedApp } from "../core/public.js";
import type { ConfigDeclaration } from "../config/public.js";
import type { CurrentUser } from "../auth/public.js";
import type { Severity } from "../log/public.js";

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

/** Options for `createTestApp`. The SQL dialect is fixed per test process, not an option. */
export interface TestAppOptions {
  /** Identity for every request; default anonymous. */
  readonly user?: CurrentUser;
  /** Config values overriding the app's defaults. */
  readonly config?: Record<string, unknown>;
  /** Secret values for the test. */
  readonly secrets?: Record<string, string>;
  /** Capabilities that fail as unavailable. */
  readonly unavailable?: readonly ("sql" | "kv" | "files" | "secrets")[];
  /** Use the test-only stub login provider instead of the authentication mock. Default false. */
  readonly stubLoginProvider?: boolean;
}

export interface TestApp {
  /** Sends a request to the app's API and returns the response. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Returns a test app that sends subsequent requests as `user`. */
  as(user: CurrentUser): TestApp;
  /** Entries written so far by this test app, in order. */
  logs(): readonly LogEntry[];
  /** With `stubLoginProvider`: completes a login through the stub provider as `subject`. */
  loginWithStub(subject: string, options?: { readonly displayName?: string; readonly stubFailure?: "refused" | "replayed" }): Promise<void>;
  /** Discards all state created by this test app. */
  dispose(): Promise<void>;
}

/** In-process app with fresh local storage, migrations applied, and the authentication mock. */
export function createTestApp<C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  options?: TestAppOptions,
): Promise<TestApp> {
  throw new Error("not implemented: createTestApp");
}

/** Connects to the deployed test stage that `smoke` targets, or to the local `dev` server. */
export function connectTestStage(): Promise<TestApp> {
  throw new Error("not implemented: connectTestStage");
}
