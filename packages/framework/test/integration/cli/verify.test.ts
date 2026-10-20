/**
 * `verify` (CLI-REQ-002, LOCAL-REQ-003) and the verify parts of CORE-REQ-005 / CORE-REQ-007,
 * run as `npx <package> verify` in fixture apps and in a copy of the template.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  FW_DIR,
  FixtureApp,
  REPO_ROOT,
  diagnosticsFor,
  editMigrationKeepingChecksum,
  isTypeScriptError,
  migrationFiles,
  namesRule,
  type RunResult,
} from "../../fixtures/support/app.js";

const TIMEOUT = 900_000;
const PKG = "@lago-morph/prototype-framework";

const apps: FixtureApp[] = [];
async function fixture(layers: readonly string[], files?: Record<string, string | null>): Promise<FixtureApp> {
  const app = await FixtureApp.create(files === undefined ? { layers } : { layers, files });
  apps.push(app);
  return app;
}

afterAll(async () => {
  for (const app of apps) await app.dispose();
});

function show(result: RunResult): string {
  return `verify exit ${String(result.code)}:\n${result.output.slice(-20_000)}`;
}

/**
 * Removes what legitimately differs between two runs of the same command: durations,
 * clock times and temp paths. Everything else (steps, counts, diagnostics) must match.
 */
function normalise(output: string, dir: string): string {
  return output
    .split(dir)
    .join("<app>")
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<time>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, "<timestamp>")
    .replace(/\d+(?:\.\d+)?\s?(?:ms|s|m)\b/g, "<duration>")
    .replace(/\(\d+(?:\.\d+)?\s?(?:ms|s)\)/g, "(<duration>)")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

describe("verify on the template", () => {
  it(
    tag("CLI-AC-002", "verify passes on the template"),
    async () => {
      const app = await FixtureApp.copyOf(join(REPO_ROOT, "apps", "template"));
      apps.push(app);
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    tag("CLI-AC-002", "two consecutive verify runs with networking disabled give identical results"),
    async () => {
      const app = await FixtureApp.copyOf(join(REPO_ROOT, "apps", "template"));
      apps.push(app);
      const first = await app.cli(["verify"], { offline: true });
      const second = await app.cli(["verify"], { offline: true });
      expect(first.code, show(first)).toBe(0);
      expect(second.code, show(second)).toBe(first.code);
      expect(normalise(second.output, app.dir)).toBe(normalise(first.output, app.dir));
    },
    TIMEOUT,
  );
});

describe("verify fails on each kind of defect", () => {
  it(
    tag("CLI-AC-002", "verify fails on a type error"),
    async () => {
      const app = await fixture(["apps/base"], { "src/server/broken-types.ts": 'export const count: number = "not a number";\n' });
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(diagnosticsFor(result.output, "broken-types.ts").some(isTypeScriptError), show(result)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    tag("CLI-AC-002", "verify fails on a portability violation"),
    async () => {
      const app = await fixture(["apps/base"], {
        "src/server/env-read.ts": `import { defineApp } from "${PKG}";\n\nexport const other = defineApp({\n  name: "other",\n  config: {},\n  secrets: [],\n  tables: {},\n  routes: (api) => {\n    api.get("/env", (c) => c.json({ names: Object.keys(c.env) }));\n  },\n});\n`,
      });
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(diagnosticsFor(result.output, "env-read.ts").some((l) => namesRule(l, "no-env-access")), show(result)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    tag("CLI-AC-002", "verify fails on a mismatched migration (dialect histories disagree)"),
    async () => {
      const app = await fixture(["apps/base"]);
      const pg = await migrationFiles(app, "postgres");
      const last = pg[pg.length - 1];
      expect(last, "generate-migration wrote no postgres migration").toBeDefined();
      if (last === undefined) return;
      await editMigrationKeepingChecksum(app, last, (sql) => `${sql.trimEnd()}\n--> statement-breakpoint\nALTER TABLE "items" ADD COLUMN "extra" text;\n`);
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(result.output, show(result)).toMatch(/\bextra\b/);
    },
    TIMEOUT,
  );

  it(
    tag("CLI-AC-002", "verify fails on a failing test"),
    async () => {
      const app = await fixture(["apps/base"], {
        "tests/failing.test.ts": 'import { expect, it } from "vitest";\n\nit("deliberately failing check", () => {\n  expect(1 + 1).toBe(3);\n});\n',
      });
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(result.output, show(result)).toContain("deliberately failing check");
    },
    TIMEOUT,
  );

  it(
    tag("CLI-AC-002", "verify fails on a Postgres-only failure (negative OFFSET)"),
    async () => {
      // `.limit(10).offset(-1)`: Drizzle sends `limit ? offset ?` with -1; local D1 returns every
      // row, PGlite raises "OFFSET must not be negative" (DEC-PENDING-B-T4-7; root-cause record
      // 2026-10-19-B-17-negative-limit-not-pg-only.md).
      const app = await fixture(["apps/base", "cli/pg-only", "cli/pg-only-offset"]);
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      // Only a supported, type-correct construct: every static step passes.
      for (const step of ["type checking", "portability rules", "migration checker", "zod version"]) {
        expect(result.output, show(result)).toMatch(new RegExp(`^verify: ${step}: passed\\b`, "m"));
      }
      // Postgres-only: the sqlite test process passes, the postgres one fails on the fixture test.
      expect(result.output, show(result)).toMatch(/^verify: tests \(sqlite\): passed \(\d+ passed, 0 failed, 0 skipped\)$/m);
      expect(result.output, show(result)).toMatch(/^verify: tests \(postgres\): 1 failed \(\d+ passed, 1 failed, 0 skipped\)$/m);
      const pgStart = result.output.indexOf("verify: tests (postgres)\n");
      const pgEnd = result.output.indexOf("verify: tests (postgres): ");
      expect(pgStart, show(result)).toBeGreaterThanOrEqual(0);
      expect(result.output.slice(pgStart, pgEnd), show(result)).toContain("FAIL  tests/negative-offset.test.ts > negative offset returns every item");
      expect(result.output, show(result)).toMatch(/^verify failed: tests \(postgres\)$/m);
    },
    TIMEOUT,
  );

  it(
    tag("CLI-AC-002", "verify fails on a project with zero tests"),
    async () => {
      const app = await fixture(["apps/base"], { "tests/hello.test.ts": null });
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(result.output, show(result)).toMatch(/no tests|zero tests|0 tests|no test files/i);
    },
    TIMEOUT,
  );
});

describe("LOCAL-REQ-003 Postgres-dialect check", () => {
  it(
    tag("LOCAL-AC-003", "a query that works on SQLite but not on Postgres (SELECT DISTINCT ordered by an unselected column) makes verify fail"),
    async () => {
      const app = await fixture(["apps/base", "cli/pg-only", "cli/pg-only-distinct"]);
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(result.output, show(result)).toContain("distinct titles ordered by creation time");
    },
    TIMEOUT,
  );
});

describe("CORE-REQ-005 export list", () => {
  it(tag("CORE-AC-005", "the package's exports map equals the subpath table (without ./targets/aws this phase: DEC-0110)"), async () => {
    const pkg: unknown = JSON.parse(await readFile(join(FW_DIR, "package.json"), "utf8"));
    const exportsMap: unknown = pkg !== null && typeof pkg === "object" ? Reflect.get(pkg, "exports") : undefined;
    expect(exportsMap).toBeTypeOf("object");
    const keys = Object.keys(exportsMap !== null && typeof exportsMap === "object" ? exportsMap : {}).sort();
    expect(keys).toEqual([".", "./check", "./client", "./provision", "./targets/cloudflare", "./targets/local", "./testing"]);
  });

  it(
    tag("CORE-AC-005", "a fixture importing ./targets/aws from app code fails verify"),
    async () => {
      const app = await fixture(["apps/base"], {
        "src/server/aws-runtime.ts": `import * as aws from "${PKG}/targets/aws";\n\nexport const runtime = aws;\n`,
      });
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      // B-T5 (flag F8): the failure must be the portability rule that enforces CORE-REQ-005's
      // "Importable by" column (check.md: allowed-imports rejects framework subpaths outside the
      // importer's row), naming the subpath, not just any diagnostic (an unresolved-module type
      // error alone would otherwise satisfy it while no ./targets/aws export exists).
      const lines = diagnosticsFor(result.output, "aws-runtime.ts");
      expect(
        lines.some((l) => namesRule(l, "allowed-imports") && /targets\/aws/.test(l)),
        `no allowed-imports diagnostic naming targets/aws for aws-runtime.ts\n${lines.join("\n")}\n${show(result)}`,
      ).toBe(true);
    },
    TIMEOUT,
  );
});

describe("CORE-REQ-007 app-reported failure codes", () => {
  it(
    tag("CORE-AC-008", "verify part: an app throwing a capability-owned code (SQL.CONFLICT) from its own code fails verify"),
    async () => {
      const app = await fixture(["apps/base"], {
        "src/server/duplicate.ts": `import { FrameworkError } from "${PKG}";\n\nexport function rejectDuplicate(title: string): never {\n  throw new FrameworkError("SQL.CONFLICT", \`duplicate title \${title}\`);\n}\n`,
      });
      const result = await app.cli(["verify"]);
      expect(result.code, show(result)).not.toBe(0);
      expect(diagnosticsFor(result.output, "duplicate.ts").some((l) => namesRule(l, "app-error-codes")), show(result)).toBe(true);
    },
    TIMEOUT,
  );
});
