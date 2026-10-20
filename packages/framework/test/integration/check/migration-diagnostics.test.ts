/**
 * CHECK-AC-003 for the migration checker's diagnostics (E-T2, evaluation E flag F4): "Every
 * rule's diagnostic names its construct, rule, and an existing skill reference." check.md §2
 * gives the migration checker five rule IDs (`prototype-framework/migration-checksums`,
 * `-history`, `-apply`, `-supported-changes`, `-dialects`, DEC-0187) and the portability rules'
 * one-line layout: `<file>:<line>:<col>  error  <message naming the construct>  <rule ID>  (read
 * skill/reference/<file>.md)`. For each rule a real `npx <package> verify` run on a fixture app
 * (`apps/base` + `mig/base`, migrations made by `generate-migration`) is broken the way that rule
 * catches, and one diagnostic line must carry that rule, a message naming the offending
 * construct, and a `skill/reference/*.md` that exists on disk.
 *
 * Three apps, so that one break cannot hide another (a failed apply stops that dialect's later
 * judgements, and the dialect comparison needs both histories applied):
 * - files: an edited generated migration (checksums) and a pair numbered with a gap (history);
 * - changes: a column added to one dialect only, checksum kept (dialects), then a hand-written
 *   column rename in both dialects, recorded in checksums (supported-changes);
 * - apply: a hand-written pair, recorded in checksums, that alters a table that does not exist.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { FixtureApp, REPO_ROOT, addHandWrittenMigration, editMigrationKeepingChecksum, migrationFiles, stripAnsi, type RunResult } from "../../fixtures/support/app.js";

const SETUP_TIMEOUT = 900_000;
const PKG = "@lago-morph/prototype-framework";
const RULE_PREFIX = "prototype-framework/";

/** One diagnostic in check.md §2's layout. */
interface Diagnostic {
  readonly line: string;
  readonly file: string;
  readonly message: string;
  readonly rule: string;
  readonly reference: string;
}

const LAYOUT = /^\s*(\S+):(\d+):(\d+)\s+error\s+(.+?)\s+(prototype-framework\/[a-z-]+)\s+\(read (\S+)\)\s*$/;

function diagnostics(output: string): Diagnostic[] {
  return stripAnsi(output)
    .split(/\r?\n/)
    .flatMap((line) => {
      const m = LAYOUT.exec(line);
      return m === null ? [] : [{ line, file: m[1] ?? "", message: m[4] ?? "", rule: m[5] ?? "", reference: m[6] ?? "" }];
    });
}

function show(result: RunResult): string {
  return `verify exit ${String(result.code)}; output:\n${result.output.slice(-20_000)}`;
}

/**
 * Asserts one diagnostic of `rule` whose message (the text between `error` and the rule ID, so
 * not the location) matches every pattern in `construct`, and whose reference exists.
 */
function expectActionable(result: RunResult, check: string, construct: readonly RegExp[]): void {
  const rule = `${RULE_PREFIX}${check}`;
  expect(result.code, show(result)).not.toBe(0);
  const all = diagnostics(result.output);
  const ofRule = all.filter((d) => d.rule === rule);
  expect(ofRule.length, `no ${rule} diagnostic in the check.md §2 layout\n${show(result)}`).toBeGreaterThan(0);
  const good = ofRule.filter((d) => construct.every((re) => re.test(d.message)) && /^skill\/reference\/[A-Za-z0-9._-]+\.md$/.test(d.reference) && existsSync(join(REPO_ROOT, d.reference)));
  expect(good.length, `no ${rule} diagnostic names ${construct.map(String).join(" and ")} in its message and an existing skill/reference/*.md:\n${ofRule.map((d) => d.line).join("\n")}`).toBeGreaterThan(0);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Writes `migrations/<dialect>/<base>.sql` and records its SHA-256 in `checksums.json`, as generate-migration would. */
async function addRecorded(app: FixtureApp, dialect: "sqlite" | "postgres", base: string, sql: string): Promise<void> {
  await app.write(`migrations/${dialect}/${base}.sql`, sql);
  const sums = JSON.parse(await app.read("migrations/checksums.json")) as Record<string, string>;
  sums[`${dialect}/${base}.sql`] = sha256(sql);
  await app.write("migrations/checksums.json", `${JSON.stringify(sums, null, 2)}\n`);
}

function baseOf(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1, -".sql".length);
}

const apps: FixtureApp[] = [];
async function migApp(): Promise<FixtureApp> {
  const app = await FixtureApp.create({ layers: ["apps/base", "mig/base"] });
  apps.push(app);
  return app;
}

afterAll(async () => {
  for (const app of apps) await app.dispose();
});

describe("migration-checker diagnostics: file checks", () => {
  let result: RunResult;
  let edited = "";
  let gap = "";

  beforeAll(async () => {
    const app = await migApp();
    const lite = await migrationFiles(app, "sqlite");
    const first = lite[0];
    if (first === undefined) throw new Error("fixture has no generated sqlite migration");
    edited = `sqlite/${baseOf(first)}.sql`;
    // A comment only: the schema is unchanged, so only the checksum check fires for it.
    await app.write(first, `${await app.read(first)}\n-- edited by hand after it was generated\n`);
    // A pair numbered two past the last one, recorded in checksums: only the numbering is wrong.
    const n = Number.parseInt(baseOf(lite[lite.length - 1] ?? "0000_x").slice(0, 4), 10) + 2;
    gap = `${String(n).padStart(4, "0")}_add_gap`;
    await addRecorded(app, "sqlite", gap, "CREATE TABLE `gap` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n");
    await addRecorded(app, "postgres", gap, 'CREATE TABLE "gap" (\n\t"id" text PRIMARY KEY NOT NULL\n);\n');
    result = await app.cli(["verify"]);
  }, SETUP_TIMEOUT);

  it(tag("CHECK-AC-003", "the prototype-framework/migration-checksums diagnostic names the edited migration, the rule and an existing skill reference"), () => {
    expectActionable(result, "migration-checksums", [new RegExp(edited.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))]);
  });

  it(tag("CHECK-AC-003", "the prototype-framework/migration-history diagnostic names the misnumbered migration, the rule and an existing skill reference"), () => {
    expectActionable(result, "migration-history", [new RegExp(`\\b${gap}\\.sql\\b`)]);
  });
});

describe("migration-checker diagnostics: schema changes", () => {
  let result: RunResult;
  const slug = "rename_label";

  beforeAll(async () => {
    const app = await migApp();
    const pg = await migrationFiles(app, "postgres");
    const last = pg[pg.length - 1];
    if (last === undefined) throw new Error("fixture has no generated postgres migration");
    await editMigrationKeepingChecksum(app, last, (sql) => `${sql.trimEnd()}\n--> statement-breakpoint\nALTER TABLE "records" ADD COLUMN "extra" text;\n`);
    await app.write(
      "src/server/schema.ts",
      `import { defineTable, id, integer, text, timestamp } from "${PKG}";\n\nexport const items = defineTable("items", {\n  id: id(),\n  title: text(),\n  createdAt: timestamp(),\n});\n\nexport const records = defineTable("records", {\n  id: id(),\n  title: text(),\n  amount: integer().default(0),\n});\n`,
    );
    await addHandWrittenMigration(app, "sqlite", slug, "ALTER TABLE `records` RENAME COLUMN `label` TO `title`;\n");
    await addHandWrittenMigration(app, "postgres", slug, 'ALTER TABLE "records" RENAME COLUMN "label" TO "title";\n');
    result = await app.cli(["verify"]);
  }, SETUP_TIMEOUT);

  it(tag("CHECK-AC-003", "the prototype-framework/migration-dialects diagnostic names the diverging column, the rule and an existing skill reference"), () => {
    expectActionable(result, "migration-dialects", [/\bextra\b/]);
  });

  it(tag("CHECK-AC-003", "the prototype-framework/migration-supported-changes diagnostic names the renamed column, the rule and an existing skill reference"), () => {
    expectActionable(result, "migration-supported-changes", [new RegExp(`\\d{4}_${slug}\\.sql\\b`), /\blabel\b/, /\btitle\b/]);
  });
});

describe("migration-checker diagnostics: a migration that fails to apply", () => {
  let result: RunResult;
  const slug = "alter_missing";

  beforeAll(async () => {
    const app = await migApp();
    await addHandWrittenMigration(app, "sqlite", slug, "ALTER TABLE `missing_table` ADD `note` text;\n");
    await addHandWrittenMigration(app, "postgres", slug, 'ALTER TABLE "missing_table" ADD COLUMN "note" text;\n');
    result = await app.cli(["verify"]);
  }, SETUP_TIMEOUT);

  it(tag("CHECK-AC-003", "the prototype-framework/migration-apply diagnostic names the failing migration and its database error, the rule and an existing skill reference"), () => {
    expectActionable(result, "migration-apply", [new RegExp(`\\d{4}_${slug}\\.sql\\b`), /missing_table/]);
  });
});
