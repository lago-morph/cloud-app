/**
 * What each failing portability fixture in `check/fail/` must produce (CHECK-REQ-001,
 * CHECK-REQ-002, SQL-REQ-002). The fixture app is `apps/base` + `check/fail`; the passing
 * app is `apps/base` + `check/pass`.
 *
 * - `rule`: the check.md §1 rule whose diagnostic must name the file; null when the
 *   criterion names no rule (any diagnostic about the file counts).
 * - `construct`: patterns, one of which must appear in that rule's diagnostic once the rule
 *   name and skill reference are removed (CHECK-AC-003).
 * - `sqlFeature`: the fixture uses a query feature that sql.md §2.3 excludes (SQL-AC-002).
 * - `typeError`: the fixture must (also) fail type checking (the app lib set: CHECK §2).
 */
export type RuleName =
  | "allowed-imports"
  | "no-env-access"
  | "browser-api-only"
  | "no-raw-sql"
  | "no-dialect-features"
  | "framework-order"
  | "no-transactions"
  | "no-relational-queries"
  | "framework-ids"
  | "app-error-codes";

export const RULES: readonly RuleName[] = [
  "allowed-imports",
  "no-env-access",
  "browser-api-only",
  "no-raw-sql",
  "no-dialect-features",
  "framework-order",
  "no-transactions",
  "no-relational-queries",
  "framework-ids",
  "app-error-codes",
];

export interface FailingFixture {
  /** App-relative path; its base name is unique within the fixture app. */
  readonly file: string;
  readonly rule: RuleName | null;
  readonly what: string;
  readonly construct?: readonly RegExp[];
  readonly sqlFeature?: boolean;
  readonly typeError?: boolean;
  /** One fixture per rule is the representative checked by CHECK-AC-003. */
  readonly representative?: boolean;
}

const s = (name: string): string => `src/server/fail/${name}.ts`;
const c = (name: string): string => `src/client/fail/${name}.ts`;

export const RULE_FIXTURES: readonly FailingFixture[] = [
  // allowed-imports
  { file: s("ai-node-fs"), rule: "allowed-imports", what: "a node:fs import", construct: [/node:fs/], representative: true },
  { file: s("ai-bare-fs"), rule: "allowed-imports", what: "a bare fs import", construct: [/\bfs\b/] },
  { file: s("ai-bare-crypto"), rule: "allowed-imports", what: "a bare crypto import (Node built-in)", construct: [/\bcrypto\b/] },
  { file: s("ai-dynamic-node"), rule: "allowed-imports", what: "a dynamic import of node:os", construct: [/node:os/] },
  { file: s("ai-reexport-node"), rule: "allowed-imports", what: "a re-export of node:fs/promises", construct: [/node:fs\/promises/] },
  { file: s("ai-import-via-reexport"), rule: "allowed-imports", what: "an import of a Node built-in through a local re-export", construct: [/readFile|node:fs/] },
  { file: s("ai-drizzle-d1"), rule: "allowed-imports", what: "a Drizzle dialect module (drizzle-orm/d1)", construct: [/drizzle-orm\/d1/] },
  { file: s("ai-drizzle-pg-core"), rule: "allowed-imports", what: "a Drizzle dialect module (drizzle-orm/pg-core)", construct: [/drizzle-orm\/pg-core/] },
  { file: s("ai-pg-view"), rule: "allowed-imports", what: "a view (pgView from a Drizzle dialect module)", construct: [/drizzle-orm\/pg-core|pgView/], sqlFeature: true },
  { file: s("ai-pglite"), rule: "allowed-imports", what: "a database driver (PGlite)", construct: [/pglite/i] },
  { file: s("ai-cloudflare-workers"), rule: "allowed-imports", what: "a platform SDK (cloudflare:workers)", construct: [/cloudflare:workers/] },
  { file: s("ai-workers-types"), rule: "allowed-imports", what: "a platform SDK (@cloudflare/workers-types)", construct: [/workers-types/] },
  { file: s("ai-targets-local"), rule: "allowed-imports", what: "the ./targets/local subpath from app code", construct: [/targets\/local/] },
  { file: s("ai-provision"), rule: "allowed-imports", what: "the ./provision subpath from app code", construct: [/provision/] },
  { file: s("ai-check"), rule: "allowed-imports", what: "the ./check subpath from app code", construct: [/\/check/] },
  { file: s("ai-testing-in-server"), rule: "allowed-imports", what: "the ./testing subpath from server code", construct: [/testing/] },

  // no-env-access
  { file: s("ne-process-env"), rule: "no-env-access", what: "process.env", construct: [/process/] },
  { file: s("ne-import-meta-env"), rule: "no-env-access", what: "import.meta.env", construct: [/import\.meta/] },
  { file: s("ne-c-env"), rule: "no-env-access", what: "Hono c.env", construct: [/\benv\b/] },
  { file: s("ne-c-env-destructured"), rule: "no-env-access", what: "c.env through destructuring", construct: [/\benv\b/] },
  { file: s("ne-context-alias"), rule: "no-env-access", what: "c.env through an aliased context", construct: [/\benv\b/] },
  { file: s("ne-execution-ctx"), rule: "no-env-access", what: "c.executionCtx", construct: [/executionCtx/], representative: true },
  { file: s("ne-on-error"), rule: "no-env-access", what: "replacing the error handler", construct: [/onError/] },
  { file: s("ne-not-found"), rule: "no-env-access", what: "replacing the not-found handler", construct: [/notFound/] },

  // browser-api-only
  { file: c("ba-framework-root"), rule: "browser-api-only", what: "the framework root from browser code", construct: [/prototype-framework/] },
  { file: c("ba-testing"), rule: "browser-api-only", what: "./testing from browser code", construct: [/testing/] },
  { file: c("ba-fetch"), rule: "browser-api-only", what: "direct fetch", construct: [/fetch/], representative: true },
  { file: c("ba-fetch-alias"), rule: "browser-api-only", what: "fetch through an alias (globalThis.fetch)", construct: [/fetch/] },
  { file: c("ba-window-fetch"), rule: "browser-api-only", what: "window.fetch", construct: [/fetch/] },
  { file: c("ba-xhr"), rule: "browser-api-only", what: "XMLHttpRequest", construct: [/XMLHttpRequest/] },
  { file: c("ba-websocket"), rule: "browser-api-only", what: "WebSocket", construct: [/WebSocket/] },
  { file: c("ba-eventsource"), rule: "browser-api-only", what: "EventSource", construct: [/EventSource/] },

  // no-raw-sql
  { file: s("rs-sql-template"), rule: "no-raw-sql", what: "the sql template tag", construct: [/\bsql\b/], sqlFeature: true },
  { file: s("rs-sql-raw"), rule: "no-raw-sql", what: "sql.raw", construct: [/sql\.raw|\braw\b|\bsql\b/], sqlFeature: true, representative: true },
  { file: s("rs-sql-alias"), rule: "no-raw-sql", what: "the sql tag imported under an alias", construct: [/\bq\b|\bsql\b/], sqlFeature: true },
  { file: s("rs-sql-reexported-user"), rule: "no-raw-sql", what: "the sql tag through a local re-export", construct: [/sqlFragment|\bsql\b/], sqlFeature: true },
  { file: s("rs-window-function"), rule: "no-raw-sql", what: "a window function (only reachable through raw SQL)", construct: [/\bsql\b/], sqlFeature: true },
  { file: s("rs-json-operator"), rule: "no-raw-sql", what: "a JSON operator (only reachable through raw SQL)", construct: [/\bsql\b/], sqlFeature: true },
  { file: s("rs-full-text"), rule: "no-raw-sql", what: "full-text search (only reachable through raw SQL)", construct: [/\bsql\b/], sqlFeature: true },

  // no-dialect-features
  { file: s("nd-like"), rule: "no-dialect-features", what: "like", construct: [/\blike\b/], sqlFeature: true },
  { file: s("nd-not-like"), rule: "no-dialect-features", what: "notLike", construct: [/notLike/], sqlFeature: true },
  { file: s("nd-ilike-alias"), rule: "no-dialect-features", what: "ilike under an alias", construct: [/ilike|fuzzy/], sqlFeature: true },
  { file: s("nd-like-reexported-user"), rule: "no-dialect-features", what: "like through a local re-export", construct: [/matches|\blike\b/], sqlFeature: true },
  { file: s("nd-exists"), rule: "no-dialect-features", what: "an expression not exported by sql.d.ts (exists)", construct: [/exists/], sqlFeature: true },
  { file: s("nd-right-join"), rule: "no-dialect-features", what: "a right outer join", construct: [/rightJoin|right/i], sqlFeature: true, representative: true },
  { file: s("nd-full-join"), rule: "no-dialect-features", what: "a full outer join", construct: [/fullJoin|full/i], sqlFeature: true },
  { file: s("nd-subquery-right-join"), rule: "no-dialect-features", what: "a right join inside a subquery", construct: [/rightJoin|right/i], sqlFeature: true },
  { file: s("nd-max-boolean"), rule: "no-dialect-features", what: "max(boolean)", construct: [/\bmax\b/], sqlFeature: true },
  { file: s("nd-min-boolean"), rule: "no-dialect-features", what: "min(boolean)", construct: [/\bmin\b/], sqlFeature: true },
  { file: s("nd-sum-text"), rule: "no-dialect-features", what: "sum(text)", construct: [/\bsum\b/], sqlFeature: true },
  { file: s("nd-avg-text"), rule: "no-dialect-features", what: "avg(text)", construct: [/\bavg\b/], sqlFeature: true },
  { file: s("nd-cte-max-boolean"), rule: "no-dialect-features", what: "max(boolean) inside a common table expression", construct: [/\bmax\b/], sqlFeature: true },
  { file: s("nd-data-modifying-cte"), rule: "no-dialect-features", what: "a data-modifying common table expression", construct: [/\$with|insert|\bwith\b/], sqlFeature: true },
  { file: s("nd-for-update"), rule: "no-dialect-features", what: "row locking (for update)", construct: [/\bfor\b/], sqlFeature: true },

  // framework-order
  { file: s("fo-drizzle-asc"), rule: "framework-order", what: "Drizzle's asc", construct: [/\basc\b/], sqlFeature: true, representative: true },
  { file: s("fo-drizzle-desc-alias"), rule: "framework-order", what: "Drizzle's desc under an alias", construct: [/\bdesc\b|newest/], sqlFeature: true },
  { file: s("fo-plain-column"), rule: "framework-order", what: "ordering by a bare column", construct: [/orderBy|title/], sqlFeature: true },
  { file: s("fo-reexported-user"), rule: "framework-order", what: "Drizzle's asc through a local re-export", construct: [/ascending|\basc\b/], sqlFeature: true },

  // no-transactions
  { file: s("nt-transaction"), rule: "no-transactions", what: ".transaction()", construct: [/transaction/], sqlFeature: true, typeError: true, representative: true },
  { file: s("nt-batch"), rule: "no-transactions", what: ".batch()", construct: [/batch/], sqlFeature: true, typeError: true },
  { file: s("nt-destructured"), rule: "no-transactions", what: "transaction taken by destructuring", construct: [/transaction/], sqlFeature: true, typeError: true },

  // no-relational-queries
  { file: s("nr-query"), rule: "no-relational-queries", what: "db.query", construct: [/query/], sqlFeature: true, typeError: true, representative: true },
  { file: s("nr-query-alias"), rule: "no-relational-queries", what: "db.query through an alias", construct: [/query/], sqlFeature: true, typeError: true },

  // framework-ids
  { file: s("fi-literal-id"), rule: "framework-ids", what: "a literal ID value", construct: [/fixed-note-id|\bid\b|newId/], representative: true },
  { file: s("fi-random-uuid"), rule: "framework-ids", what: "crypto.randomUUID() as an ID", construct: [/randomUUID|\bid\b|newId/] },
  { file: s("fi-update-id"), rule: "framework-ids", what: "an update of an id() column", construct: [/\bid\b/] },
  { file: s("fi-helper-id"), rule: "framework-ids", what: "an ID from an app helper", construct: [/makeId|\bid\b|newId/] },

  // app-error-codes
  { file: s("ae-sql-conflict"), rule: "app-error-codes", what: "FrameworkError with SQL.CONFLICT", construct: [/SQL\.CONFLICT/], representative: true },
  { file: s("ae-kv-invalid-key"), rule: "app-error-codes", what: "FrameworkError with KV.INVALID_KEY", construct: [/KV\.INVALID_KEY/] },
  { file: s("ae-core-internal"), rule: "app-error-codes", what: "FrameworkError with CORE.INTERNAL", construct: [/CORE\.INTERNAL/] },
  { file: s("ae-cfg-undeclared"), rule: "app-error-codes", what: "FrameworkError with CFG.UNDECLARED_KEY", construct: [/CFG\.UNDECLARED_KEY/] },
  { file: s("ae-const-alias"), rule: "app-error-codes", what: "a capability code held in a const", construct: [/SEC\.MISSING|code/] },
  { file: s("ae-reexported-class-user"), rule: "app-error-codes", what: "FrameworkError through a local re-export", construct: [/FILES\.NOT_FOUND/] },
];

/** CHECK-AC-001's named fixtures whose rule the criterion leaves open. */
export const OTHER_CHECK_FIXTURES: readonly FailingFixture[] = [
  { file: s("buffer-use"), rule: null, what: "a server-side Buffer use (fails type checking)", construct: [/Buffer/], typeError: true },
  { file: c("html-inner"), rule: null, what: "a raw-HTML insertion (innerHTML) in browser code", construct: [/innerHTML/] },
  { file: c("html-insert-adjacent"), rule: null, what: "a raw-HTML insertion (insertAdjacentHTML) in browser code", construct: [/insertAdjacentHTML/] },
  { file: c("shared-value-import"), rule: null, what: "a value import from src/shared/ in browser code", construct: [/shared|noteInput/] },
];

/** CHECK-AC-002: type escapes (no rule name is specified by check.md). */
export const TYPE_ESCAPE_FIXTURES: readonly FailingFixture[] = [
  { file: s("te-any-param"), rule: null, what: "an any-typed parameter" },
  { file: s("te-any-generic"), rule: null, what: "any as a type argument" },
  { file: s("te-as-unknown-as"), rule: null, what: "an `as unknown as` cast to an unrelated type" },
  { file: s("te-as-unrelated"), rule: null, what: "an `as` cast to an unrelated type", typeError: true },
  { file: s("te-ts-ignore"), rule: null, what: "a @ts-ignore comment" },
  { file: s("te-ts-expect-error"), rule: null, what: "a @ts-expect-error comment" },
  { file: s("te-ts-nocheck"), rule: null, what: "a @ts-nocheck comment" },
  { file: s("te-eslint-disable"), rule: null, what: "an eslint-disable block comment" },
  { file: s("te-eslint-disable-next-line"), rule: null, what: "an eslint-disable-next-line comment" },
];

/**
 * CHECK-AC-003 covers every rule's diagnostic (check.md §2 "Shipped configuration"): besides the
 * ten CHECK-REQ-001 rules in RULES, the framework's `no-raw-html` and `no-suppression-comments`,
 * and the type-escape bans taken from typescript-eslint (`no-explicit-any`,
 * `consistent-type-assertions`, `no-non-null-assertion`). Rule names are matched as whole
 * tokens, so `@typescript-eslint/no-explicit-any` names `no-explicit-any`.
 */
export type OtherRuleName =
  | "no-raw-html"
  | "no-suppression-comments"
  | "no-explicit-any"
  | "consistent-type-assertions"
  | "no-non-null-assertion";

export type AnyRuleName = RuleName | OtherRuleName;

/** Every rule whose diagnostic CHECK-AC-003 judges (12 framework rules + 3 type-escape bans). */
export const ALL_RULES: readonly AnyRuleName[] = [
  ...RULES,
  "no-raw-html",
  "no-suppression-comments",
  "no-explicit-any",
  "consistent-type-assertions",
  "no-non-null-assertion",
];

/** A representative fixture per rule outside RULES, with the construct its diagnostic must name. */
export interface ReferenceFixture {
  readonly file: string;
  readonly rule: OtherRuleName;
  readonly what: string;
  readonly construct: readonly RegExp[];
}

export const OTHER_RULE_REPRESENTATIVES: readonly ReferenceFixture[] = [
  { file: c("html-inner"), rule: "no-raw-html", what: "an innerHTML write in browser code", construct: [/innerHTML/] },
  { file: s("te-ts-ignore"), rule: "no-suppression-comments", what: "a @ts-ignore comment", construct: [/@ts-ignore/] },
  { file: s("te-any-param"), rule: "no-explicit-any", what: "an any-typed parameter", construct: [/\bany\b/] },
  { file: s("te-as-unknown-as"), rule: "consistent-type-assertions", what: "an `as unknown as` cast", construct: [/\bas\b|type assertion/i] },
  { file: s("te-non-null"), rule: "no-non-null-assertion", what: "a non-null assertion (`!`)", construct: [/non-null/i] },
];

export function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}
