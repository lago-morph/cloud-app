import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { id, integer, ref, text } from "../sql/columns.js";
import { defineTable } from "../sql/table.js";
import type { AnyTable } from "../sql/types.js";
import { appSchema, generateMigrations, MigrationGenerationError } from "./generate.js";
import { checksumOf, migrationFileNames } from "./history.js";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "mig-generate-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const parentsV1 = defineTable("parents", { id: id(), name: text(), note: text().nullable() });
const childrenV1 = defineTable("children", { id: id(), parentId: ref(() => parentsV1.id), label: text() });
const V1 = { parents: parentsV1, children: childrenV1 };

const parentsV2 = defineTable("parents", { id: id(), name: text() });
const childrenV2 = defineTable("children", { id: id(), parentId: ref(() => parentsV2.id), label: text(), rank: integer().default(0) }, { indexes: [["label"]] });
const V2 = { parents: parentsV2, children: childrenV2 };

const read = (root: string, rel: string): string => readFileSync(join(root, rel), "utf8");
const checksums = (root: string): Record<string, string> => JSON.parse(read(root, "checksums.json")) as Record<string, string>;
const generate = (root: string, tables: Record<string, AnyTable>, name?: string) =>
  generateMigrations({ root, schema: appSchema(tables), ...(name === undefined ? {} : { name }) });

describe("generate-migration engine", () => {
  it(tag("MIG-AC-001", "the first generation writes one migration per dialect, creating every table, and records both checksums"), async () => {
    const root = scratch();
    const result = await generate(root, V1);
    expect(result).toEqual({ status: "created", files: ["sqlite/0000_schema.sql", "postgres/0000_schema.sql"] });
    expect(read(root, "sqlite/0000_schema.sql")).toMatch(/CREATE TABLE `parents`[\s\S]*CREATE TABLE `children`/);
    expect(read(root, "postgres/0000_schema.sql")).toMatch(/CREATE TABLE "parents"[\s\S]*CREATE TABLE "children"/);
    expect(read(root, "sqlite/0000_schema.sql")).toContain("--> statement-breakpoint");
    expect(checksums(root)).toEqual({
      "postgres/0000_schema.sql": checksumOf(read(root, "postgres/0000_schema.sql")),
      "sqlite/0000_schema.sql": checksumOf(read(root, "sqlite/0000_schema.sql")),
    });
  });

  it(tag("MIG-AC-001", "a changed schema produces exactly one new migration per dialect, with only the change, and leaves earlier files unchanged"), async () => {
    const root = scratch();
    await generate(root, V1);
    const before = { sqlite: read(root, "sqlite/0000_schema.sql"), postgres: read(root, "postgres/0000_schema.sql") };
    const result = await generate(root, V2, "drop_note_add_rank");
    expect(result).toEqual({ status: "created", files: ["sqlite/0001_drop_note_add_rank.sql", "postgres/0001_drop_note_add_rank.sql"] });
    expect(migrationFileNames(root, "sqlite")).toEqual(["0000_schema.sql", "0001_drop_note_add_rank.sql"]);
    expect(migrationFileNames(root, "postgres")).toEqual(["0000_schema.sql", "0001_drop_note_add_rank.sql"]);
    expect(read(root, "sqlite/0000_schema.sql")).toBe(before.sqlite);
    expect(read(root, "postgres/0000_schema.sql")).toBe(before.postgres);
    const lite = read(root, "sqlite/0001_drop_note_add_rank.sql");
    expect(lite).not.toContain("CREATE TABLE");
    expect(lite).toContain("DROP COLUMN `note`");
    expect(lite).toContain("ADD `rank`");
    expect(lite).toContain("CREATE INDEX `children_label_idx`");
    expect(Object.keys(checksums(root)).sort()).toEqual([
      "postgres/0000_schema.sql", "postgres/0001_drop_note_add_rank.sql", "sqlite/0000_schema.sql", "sqlite/0001_drop_note_add_rank.sql",
    ]);
  });

  it(tag("MIG-AC-001", "an unchanged schema writes nothing"), async () => {
    const root = scratch();
    await generate(root, V1);
    const sums = read(root, "checksums.json");
    expect(await generate(root, V1)).toEqual({ status: "unchanged" });
    expect(migrationFileNames(root, "sqlite")).toHaveLength(1);
    expect(read(root, "checksums.json")).toBe(sums);
  });

  it("a diff that both removes and adds columns of one table is refused, naming the table and telling to generate the drop and the add separately", async () => {
    const root = scratch();
    await generate(root, V1);
    const renamed = defineTable("parents", { id: id(), title: text(), note: text().nullable() });
    const err = await generate(root, { parents: renamed, children: defineTable("children", { id: id(), parentId: ref(() => renamed.id), label: text() }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationGenerationError);
    expect(String((err as Error).message)).toMatch(/parents/);
    expect(String((err as Error).message)).toMatch(/separate/);
    expect(migrationFileNames(root, "sqlite")).toHaveLength(1);
    expect(migrationFileNames(root, "postgres")).toHaveLength(1);
  });

  it("a diff that both removes and adds tables is refused", async () => {
    const root = scratch();
    await generate(root, { parents: parentsV1 });
    const err = await generate(root, { others: defineTable("others", { id: id() }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationGenerationError);
    expect(String((err as Error).message)).toMatch(/parents[\s\S]*others|others[\s\S]*parents/);
    expect(migrationFileNames(root, "sqlite")).toHaveLength(1);
  });

  it.each([
    ["a column type change", defineTable("parents", { id: id(), name: integer(), note: text().nullable() })],
    ["a nullability change", defineTable("parents", { id: id(), name: text(), note: text() })],
    ["a default change", defineTable("parents", { id: id(), name: text().default("x"), note: text().nullable() })],
    ["a NOT NULL column without a static default added to an existing table", defineTable("parents", { id: id(), name: text(), note: text().nullable(), score: integer() })],
  ])("refuses %s, naming the add-copy-drop pattern, and writes nothing", async (_what, changed) => {
    const root = scratch();
    await generate(root, { parents: parentsV1 });
    const err = await generate(root, { parents: changed }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationGenerationError);
    expect(String((err as Error).message)).toMatch(/add-copy-drop/);
    expect(migrationFileNames(root, "sqlite")).toHaveLength(1);
    expect(migrationFileNames(root, "postgres")).toHaveLength(1);
  });

  it("allows adding a NOT NULL column with a static default, and a nullable column, to an existing table", async () => {
    const root = scratch();
    await generate(root, { parents: parentsV1 });
    const added = defineTable("parents", { id: id(), name: text(), note: text().nullable(), score: integer().default(0), extra: text().nullable() });
    expect(await generate(root, { parents: added })).toMatchObject({ status: "created" });
  });

  it("numbers the next migration after the highest existing one and keeps a schema snapshot per file", async () => {
    const root = scratch();
    await generate(root, V1);
    await generate(root, V2);
    expect(existsSync(join(root, "sqlite/meta/0001_schema.json"))).toBe(true);
    expect(existsSync(join(root, "postgres/meta/0001_schema.json"))).toBe(true);
  });

  it("deleting an unapplied last migration and generating again reproduces it", async () => {
    const root = scratch();
    await generate(root, V1);
    await generate(root, V2);
    const second = read(root, "sqlite/0001_schema.sql");
    for (const d of ["sqlite", "postgres"]) {
      rmSync(join(root, d, "0001_schema.sql"));
      rmSync(join(root, d, "meta", "0001_schema.json"));
    }
    expect(await generate(root, V2)).toEqual({ status: "created", files: ["sqlite/0001_schema.sql", "postgres/0001_schema.sql"] });
    expect(read(root, "sqlite/0001_schema.sql")).toBe(second);
  });

  it("refuses a slug that is not lowercase snake_case", async () => {
    await expect(generate(scratch(), V1, "Bad Name")).rejects.toBeInstanceOf(MigrationGenerationError);
  });
});
