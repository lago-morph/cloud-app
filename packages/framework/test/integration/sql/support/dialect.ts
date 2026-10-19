/**
 * Per-process SQL dialect selection for the framework's own integration suites (B-T2).
 *
 * core.md §2 / local.md §2: the dialect is fixed per test-runner process and is not a
 * `createTestApp` option; spike A-10 recommends "an env var selecting the dialect (B-16)".
 * The variable's name is not contracted yet, so it is fixed here in one place
 * (DEC-PENDING-B-T2-1). Each `*.sqlite.test.ts` / `*.postgres.test.ts` entry file sets it
 * before it imports anything that loads the framework (dialect-specific tables are built
 * at import), then imports its suite dynamically. Vitest's `forks` pool gives each test
 * file its own process, so the two dialects never share a process.
 *
 * This module must not import the framework.
 */

export const DIALECT_ENV = "PROTOTYPE_FRAMEWORK_DIALECT";

export type Dialect = "sqlite" | "postgres";

/** Human label used in test titles: the local database the dialect runs on. */
export const DIALECT_LABEL: Record<Dialect, string> = {
  sqlite: "local D1",
  postgres: "PGlite",
};

export function selectDialect(dialect: Dialect): void {
  process.env[DIALECT_ENV] = dialect;
}
