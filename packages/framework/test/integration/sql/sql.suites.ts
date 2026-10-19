/**
 * All per-dialect SQL suites of B-T2, registered by `sql.sqlite.test.ts` and
 * `sql.postgres.test.ts` after each has selected its dialect. Imports the framework.
 */
import { afterAll, beforeAll, describe } from "vitest";
import { inArray } from "../../../src/index.js";
import { defineAtomicAndFailureSuite } from "./atomic-failures.suite.js";
import { defineQuerySuite } from "./queries.suite.js";
import { defineSchemaRuleSuite } from "./schema-rules.suite.js";
import type { Dialect } from "./support/dialect.js";
import { probe } from "./support/probe.js";
import { cleanupSuiteDir, newTestApp, prepareSuiteDir, tables, uuid } from "./support/suite-app.js";
import { defineValueSuite } from "./values.suite.js";

export function defineSqlSuites(dialect: Dialect): void {
  // Definition-time rules need no database.
  defineSchemaRuleSuite(dialect);

  describe("against the database", () => {
    beforeAll(async () => {
      await prepareSuiteDir();
      await assertDialect(dialect);
    }, 600_000);
    afterAll(() => cleanupSuiteDir());

    defineQuerySuite(dialect);
    defineValueSuite(dialect);
    defineAtomicAndFailureSuite(dialect);
  });
}

/**
 * Harness check, not a criterion: proves this process really runs on the selected dialect.
 * Local D1 refuses more than PAR-216 (100) bound parameters in one statement; PGlite does
 * not (DEC-0102). If the dialect selection were ignored, both entry files would silently
 * test the same database.
 */
export async function assertDialect(dialect: Dialect): Promise<void> {
  const app = await newTestApp();
  try {
    const ids = Array.from({ length: 101 }, (_, i) => uuid(5000 + i));
    const outcome = await probe(app, async ({ sql }) =>
      sql.select({ id: tables.posts.id }).from(tables.posts).where(inArray(tables.posts.id, ids)));
    const onD1 = !outcome.ok;
    if (onD1 !== (dialect === "sqlite")) {
      throw new Error(`dialect selection not honoured: expected ${dialect}, but a 101-parameter query ${outcome.ok ? "succeeded" : "failed"}`);
    }
  } finally {
    await app.dispose();
  }
}
