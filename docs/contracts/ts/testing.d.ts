/**
 * Test helpers (`<package>/testing`). Importable only from app test files.
 * Owners: CORE (test app), AUTH (mock identities). Behavior: docs/components/core.md,
 * docs/components/auth.md.
 */
import type { DefinedApp } from "./core";
import type { ConfigDeclaration } from "./config";
import type { CurrentUser } from "./auth";

export interface TestAppOptions {
  /** Identity for every request; default anonymous. */
  readonly user?: CurrentUser;
  /** Config values overriding the app's defaults. */
  readonly config?: Record<string, unknown>;
  /** Secret values for the test. */
  readonly secrets?: Record<string, string>;
  /** SQL dialect to run against: SQLite (default) or Postgres. */
  readonly dialect?: "sqlite" | "postgres";
}

export interface TestApp {
  /** Sends a request to the app's API and returns the response. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Changes the identity for subsequent requests. */
  as(user: CurrentUser): TestApp;
  /** Discards all state created by this test app. */
  dispose(): Promise<void>;
}

/** In-process app with fresh local storage, migrations applied, and the authentication mock. */
export declare function createTestApp<C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  options?: TestAppOptions,
): Promise<TestApp>;

export declare const mockUsers: {
  readonly anonymous: CurrentUser;
  readonly user: (id?: string) => CurrentUser;
  readonly admin: (id?: string) => CurrentUser;
};
