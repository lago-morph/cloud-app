/**
 * Offline file checks of the migration checker (CHECK-REQ-004 third bullet, MIG-REQ-001):
 * checksums against `migrations/checksums.json`, and the history layout and order.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checksumOf } from "../../mig/history.js";
import { checkMigrationFiles } from "./files.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An app directory whose `migrations/` holds `files`; checksums recorded for `recorded` (default: all, as generated). */
function app(files: Record<string, string>, recorded?: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mig-check-files-"));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, "migrations", rel)), { recursive: true });
    writeFileSync(join(root, "migrations", rel), text);
  }
  const sums = recorded ?? Object.fromEntries(Object.entries(files).map(([rel, text]) => [rel, checksumOf(text)]));
  writeFileSync(join(root, "migrations", "checksums.json"), JSON.stringify(sums, null, 2) + "\n");
  return root;
}

const A = "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);\n";
const PA = 'CREATE TABLE "a" ("id" text PRIMARY KEY NOT NULL);\n';
const B = "ALTER TABLE `a` ADD `n` text;\n";
const PB = 'ALTER TABLE "a" ADD COLUMN "n" text;\n';

describe("[CHECK-AC-004] checksums (an edited applied migration fails)", () => {
  it("a generated history whose files match checksums.json has no diagnostics", () => {
    expect(checkMigrationFiles(app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA }))).toEqual([]);
  });

  it("a file edited after generation fails, naming the file and the checksum rule", () => {
    const dir = app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA }, { "sqlite/0000_schema.sql": checksumOf(A + "-- old\n"), "postgres/0000_schema.sql": checksumOf(PA) });
    const diags = checkMigrationFiles(dir);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ file: "migrations/sqlite/0000_schema.sql", line: 1, column: 1, rule: "prototype-framework/migration-checksums", reference: "skill/reference/sql-and-migrations.md" });
    expect(diags[0]?.message).toMatch(/edited/);
  });

  it("a file with no checksums.json entry fails as not generated", () => {
    const dir = app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA }, { "postgres/0000_schema.sql": checksumOf(PA) });
    const diags = checkMigrationFiles(dir);
    expect(diags.map((d) => [d.file, d.rule])).toEqual([["migrations/sqlite/0000_schema.sql", "prototype-framework/migration-checksums"]]);
    expect(diags[0]?.message).toMatch(/not listed in migrations\/checksums\.json/);
  });

  it("an entry whose file no longer exists fails on checksums.json (an applied migration was deleted)", () => {
    const dir = app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA }, { "sqlite/0000_schema.sql": checksumOf(A), "postgres/0000_schema.sql": checksumOf(PA), "sqlite/0001_schema.sql": checksumOf(B) });
    const diags = checkMigrationFiles(dir);
    expect(diags.map((d) => [d.file, d.rule])).toEqual([["migrations/checksums.json", "prototype-framework/migration-checksums"]]);
    expect(diags[0]?.message).toContain("sqlite/0001_schema.sql");
  });

  it("migrations without checksums.json, or an unreadable one, fail on checksums.json", () => {
    const dir = app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA });
    rmSync(join(dir, "migrations", "checksums.json"));
    expect(checkMigrationFiles(dir).map((d) => [d.file, d.rule])).toEqual([["migrations/checksums.json", "prototype-framework/migration-checksums"]]);
    writeFileSync(join(dir, "migrations", "checksums.json"), "{ not json");
    expect(checkMigrationFiles(dir).map((d) => [d.file, d.rule])).toEqual([["migrations/checksums.json", "prototype-framework/migration-checksums"]]);
  });

  it("an app without migrations has nothing to check", () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-check-files-"));
    dirs.push(dir);
    expect(checkMigrationFiles(dir)).toEqual([]);
  });
});

describe("[CHECK-AC-004] history layout and order (paired, numbered in order)", () => {
  const rules = (dir: string) => checkMigrationFiles(dir).map((d) => [d.file, d.rule]);

  it("a file present in one dialect only fails, naming the missing counterpart", () => {
    const dir = app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA, "sqlite/0001_schema.sql": B });
    const diags = checkMigrationFiles(dir);
    expect(diags.map((d) => [d.file, d.rule])).toEqual([["migrations/sqlite/0001_schema.sql", "prototype-framework/migration-history"]]);
    expect(diags[0]?.message).toContain("postgres/0001_schema.sql");
  });

  it("numbers must run 0000, 0001, … without gaps or repeats, so no migration can be slipped in before applied ones", () => {
    expect(rules(app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA, "sqlite/0002_schema.sql": B, "postgres/0002_schema.sql": PB }))).toEqual([
      ["migrations/sqlite/0002_schema.sql", "prototype-framework/migration-history"],
      ["migrations/postgres/0002_schema.sql", "prototype-framework/migration-history"],
    ]);
    expect(rules(app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA, "sqlite/0000_more.sql": B, "postgres/0000_more.sql": PB }))).toEqual([
      ["migrations/sqlite/0000_schema.sql", "prototype-framework/migration-history"],
      ["migrations/postgres/0000_schema.sql", "prototype-framework/migration-history"],
    ]);
  });

  it("a file name not of the form <nnnn>_<slug>.sql fails", () => {
    expect(rules(app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA, "sqlite/0001-Extra.sql": B, "postgres/0001-Extra.sql": PB }))).toEqual([
      ["migrations/sqlite/0001-Extra.sql", "prototype-framework/migration-history"],
      ["migrations/postgres/0001-Extra.sql", "prototype-framework/migration-history"],
    ]);
  });

  it("a generated multi-step history passes", () => {
    expect(rules(app({ "sqlite/0000_schema.sql": A, "postgres/0000_schema.sql": PA, "sqlite/0001_add_n.sql": B, "postgres/0001_add_n.sql": PB }))).toEqual([]);
  });
});
