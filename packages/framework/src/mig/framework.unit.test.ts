import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { frameworkSchema, frameworkTables } from "./framework.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "./migrations-dir.js";
import { generateMigrations } from "./generate.js";
import { checksumOf, readHistory } from "./history.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("framework tables and their shipped histories", () => {
  it("define __framework_kv(key, value) and __framework_migrations(id, dialect, checksum, applied_at) in both dialects", () => {
    for (const dialect of ["sqlite", "postgres"] as const) {
      const t = frameworkTables(dialect);
      expect(Object.keys(t.kv)).toEqual(expect.arrayContaining(["key", "value"]));
      expect(Object.keys(t.migrations)).toEqual(expect.arrayContaining(["id", "dialect", "checksum", "appliedAt"]));
    }
  });

  it("the package ships a framework history per dialect, with checksums", () => {
    const sums = JSON.parse(readFileSync(join(FRAMEWORK_MIGRATIONS_DIR, "checksums.json"), "utf8")) as Record<string, string>;
    for (const dialect of ["sqlite", "postgres"] as const) {
      const history = readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework");
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]?.text).toContain("__framework_kv");
      expect(history[0]?.text).toContain("__framework_migrations");
      for (const m of history) expect(sums[`${dialect}/${m.name}.sql`]).toBe(checksumOf(m.text));
    }
  });

  it(tag("MIG-AC-001", "the shipped framework histories are exactly what the generator produces from the framework tables (nothing pending, nothing edited)"), async () => {
    const copy = mkdtempSync(join(tmpdir(), "mig-framework-"));
    dirs.push(copy);
    cpSync(FRAMEWORK_MIGRATIONS_DIR, copy, { recursive: true });
    expect(await generateMigrations({ root: copy, schema: frameworkSchema, name: "framework_tables" })).toEqual({ status: "unchanged" });
  });
});
