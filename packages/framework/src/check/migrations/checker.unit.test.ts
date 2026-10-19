/**
 * The migration checker end to end on real local D1 and PGlite (CHECK-REQ-004): histories made
 * by the MIG generator, then changed the way an agent might change them by hand.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { appSchema, generateMigrations } from "../../mig/generate.js";
import { checksumOf } from "../../mig/history.js";
import { boolean, id, integer, ref, text } from "../../sql/columns.js";
import { defineTable } from "../../sql/table.js";
import type { AnyTable, ColumnBuilders } from "../../sql/types.js";
import { runMigrationChecker } from "./checker.js";

const T = 120_000;
const ADD_COPY_DROP = /add[\s,-]+copy[\s,-]+(?:and[\s-]+)?drop/i;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An app directory whose migrations are generated from each version of the tables in turn. */
async function generatedApp(...versions: Record<string, AnyTable>[]): Promise<string> {
  const appDir = mkdtempSync(join(tmpdir(), "mig-checker-"));
  dirs.push(appDir);
  for (const tables of versions) await generateMigrations({ root: join(appDir, "migrations"), schema: appSchema(tables) });
  return appDir;
}

/** Adds a hand-written pair `<nnnn>_<slug>.sql` registered in checksums.json (as an agent editing files would). */
function handWritten(appDir: string, base: string, sqlite: string, postgres: string): void {
  const sumsPath = join(appDir, "migrations", "checksums.json");
  const sums = JSON.parse(readFileSync(sumsPath, "utf8")) as Record<string, string>;
  for (const [dialect, text] of [["sqlite", sqlite], ["postgres", postgres]] as const) {
    writeFileSync(join(appDir, "migrations", dialect, `${base}.sql`), text);
    sums[`${dialect}/${base}.sql`] = checksumOf(text);
  }
  writeFileSync(sumsPath, JSON.stringify(sums, null, 2) + "\n");
}

const parents = defineTable("parents", { id: id(), name: text() });
const records = (extra: ColumnBuilders = {}, options: { indexes?: readonly (readonly ["label"])[] } = {}) =>
  defineTable("records", { id: id(), label: text(), amount: integer().default(0), ...extra }, options);
const tags = (options: { uniques?: readonly (readonly ["name"])[] } = {}) => defineTable("tags", { id: id(), name: text() }, options);

describe("migration checker", () => {
  it(
    tag("CHECK-AC-004", "each supported change of MIG §2, generated one per migration, passes (incl. a SQLite rebuild for dropping a reference column)"),
    async () => {
      const note = { note: text().nullable() };
      const active = { active: boolean().default(true) };
      const pid = { pid: ref(() => parents.id).nullable() };
      const appDir = await generatedApp(
        { parents, records: records() },
        { parents, records: records(), tags: tags() },
        { parents, records: records(note), tags: tags() },
        { parents, records: records({ ...note, ...active }), tags: tags() },
        { parents, records: records({ ...note, ...active }, { indexes: [["label"]] }), tags: tags() },
        { parents, records: records({ ...note, ...active }, { indexes: [["label"]] }), tags: tags({ uniques: [["name"]] }) },
        { parents, records: records({ ...note, ...active }), tags: tags({ uniques: [["name"]] }) },
        { parents, records: records({ ...note, ...active }), tags: tags() },
        { parents, records: records(active), tags: tags() },
        { parents, records: records(active) },
        { parents, records: records({ ...active, ...pid }) },
        { parents, records: records(active) },
      );
      expect(await runMigrationChecker(appDir)).toEqual([]);
    },
    T,
  );

  it(
    tag("CHECK-AC-004", "mismatched dialect histories fail, naming the differing column (checksums kept valid)"),
    async () => {
      const appDir = await generatedApp({ records: records() }, { records: records({ note: text().nullable() }) });
      const file = join(appDir, "migrations", "postgres", "0001_schema.sql");
      const edited = `${readFileSync(file, "utf8")}--> statement-breakpoint\nALTER TABLE "records" ADD COLUMN "extra" text;\n`;
      writeFileSync(file, edited);
      const sumsPath = join(appDir, "migrations", "checksums.json");
      const sums = JSON.parse(readFileSync(sumsPath, "utf8")) as Record<string, string>;
      writeFileSync(sumsPath, JSON.stringify({ ...sums, "postgres/0001_schema.sql": checksumOf(edited) }));
      const diags = await runMigrationChecker(appDir);
      expect(diags.map((d) => [d.file, d.rule])).toEqual([["migrations/sqlite/0001_schema.sql", "prototype-framework/migration-dialects"]]);
      expect(diags[0]?.message).toMatch(/records\.extra exists in postgres but not in sqlite/);
      expect(diags[0]?.message).toContain("postgres/0001_schema.sql");
    },
    T,
  );

  it(
    tag("CHECK-AC-004", "an edited applied migration fails on its checksum"),
    async () => {
      const appDir = await generatedApp({ records: records() });
      const file = join(appDir, "migrations", "sqlite", "0000_schema.sql");
      // An edit that keeps the file appliable, so only the checksum can catch it.
      writeFileSync(file, readFileSync(file, "utf8").replace("NOT NULL", "NOT  NULL"));
      const diags = await runMigrationChecker(appDir);
      expect(diags.map((d) => [d.file, d.rule]), JSON.stringify(diags)).toEqual([["migrations/sqlite/0000_schema.sql", "prototype-framework/migration-checksums"]]);
    },
    T,
  );

  const unsupported = [
    {
      change: "a NOT NULL column without a static default added to an existing table",
      sqlite: "ALTER TABLE `records` ADD `score` integer NOT NULL;\n",
      postgres: 'ALTER TABLE "records" ADD COLUMN "score" integer NOT NULL;\n',
    },
    {
      change: "a column type change (SQLite as drizzle-kit's table rebuild)",
      sqlite: [
        "CREATE TABLE `__new_records` (`id` text PRIMARY KEY NOT NULL, `label` text NOT NULL, `amount` real DEFAULT 0 NOT NULL);",
        "--> statement-breakpoint",
        'INSERT INTO `__new_records`("id", "label", "amount") SELECT "id", "label", "amount" FROM `records`;',
        "--> statement-breakpoint",
        "DROP TABLE `records`;",
        "--> statement-breakpoint",
        "ALTER TABLE `__new_records` RENAME TO `records`;",
        "",
      ].join("\n"),
      postgres: 'ALTER TABLE "records" ALTER COLUMN "amount" SET DATA TYPE double precision;\n',
    },
    {
      change: "a column rename",
      sqlite: "ALTER TABLE `records` RENAME COLUMN `label` TO `title`;\n",
      postgres: 'ALTER TABLE "records" RENAME COLUMN "label" TO "title";\n',
    },
  ];
  for (const u of unsupported) {
    it(
      tag("CHECK-AC-004", `${u.change}, hand-written with valid checksums, fails in both dialects naming the add-copy-drop pattern`),
      async () => {
        const appDir = await generatedApp({ records: records() });
        handWritten(appDir, "0001_change", u.sqlite, u.postgres);
        const diags = await runMigrationChecker(appDir);
        for (const dialect of ["sqlite", "postgres"]) {
          const mine = diags.filter((d) => d.file === `migrations/${dialect}/0001_change.sql`);
          expect(mine.length, `${dialect}: ${JSON.stringify(diags)}`).toBeGreaterThan(0);
        }
        const named = diags.filter((d) => d.rule === "prototype-framework/migration-supported-changes" && ADD_COPY_DROP.test(d.message));
        expect(named.length, JSON.stringify(diags)).toBeGreaterThan(0);
      },
      T,
    );
  }

  it(
    tag("CHECK-AC-004", "a migration that cannot be applied fails with the database error, and later migrations of that dialect are not judged"),
    async () => {
      const appDir = await generatedApp({ records: records() });
      handWritten(appDir, "0001_change", "ALTER TABLE `missing` ADD `x` text;\n", 'ALTER TABLE "missing" ADD COLUMN "x" text;\n');
      const diags = await runMigrationChecker(appDir);
      expect(diags.map((d) => [d.file, d.rule])).toEqual([
        ["migrations/sqlite/0001_change.sql", "prototype-framework/migration-apply"],
        ["migrations/postgres/0001_change.sql", "prototype-framework/migration-apply"],
      ]);
      expect(diags[0]?.message).toMatch(/missing/);
    },
    T,
  );

  it(
    tag("CHECK-AC-004", "a migration that changes data fails"),
    async () => {
      const appDir = await generatedApp({ records: records() });
      handWritten(appDir, "0001_change", "UPDATE `records` SET `amount` = 1;\n", 'UPDATE "records" SET "amount" = 1;\n');
      const diags = await runMigrationChecker(appDir);
      expect(diags.map((d) => [d.file, d.rule])).toEqual([
        ["migrations/sqlite/0001_change.sql", "prototype-framework/migration-supported-changes"],
        ["migrations/postgres/0001_change.sql", "prototype-framework/migration-supported-changes"],
      ]);
    },
    T,
  );

  it("an app without migrations passes", async () => {
    const appDir = mkdtempSync(join(tmpdir(), "mig-checker-"));
    dirs.push(appDir);
    expect(await runMigrationChecker(appDir)).toEqual([]);
  }, T);
});
