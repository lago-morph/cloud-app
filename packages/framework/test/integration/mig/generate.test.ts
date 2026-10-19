/**
 * MIG-AC-001: generating from a changed schema produces one new migration per dialect;
 * editing a generated migration makes the checker fail.
 *
 * Runs the package binary in a scratch app (cli.md §2 layout): `generate-migration`
 * (MIG §2 "Generation": `migrations/sqlite/`, `migrations/postgres/`,
 * `migrations/checksums.json`), then `verify`, whose step 3 is the migration checker
 * (CLI-REQ-002, CHECK-REQ-004). The checker has no other contracted entry point, so the
 * edit is judged through `verify`, with an unedited control run first so the failure can
 * only come from the edit (DEC-0223).
 */
import { readFileSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createAppDir, migrationFiles, removeAppDir, runCli, writeApp } from "../sql/support/app-dir.js";
import { APP_TEST, APP_V1, APP_V2 } from "./apps.js";

const read = (dir: string, files: string[]): string[] => files.map((f) => readFileSync(join(dir, f), "utf8"));

describe("MIG generation and checksums (local)", () => {
  let dir: string;
  let v1Sqlite: string[] = [];
  let v1Postgres: string[] = [];

  beforeAll(() => {
    dir = createAppDir({ "src/app.ts": APP_V1, "tests/app.test.ts": APP_TEST });
  });
  afterAll(() => removeAppDir(dir));

  it(tag("MIG-AC-001", "generating from a new schema writes one migration per dialect and records their checksums"), async () => {
    const result = await runCli(dir, ["generate-migration"]);
    expect(result.status, result.output).toBe(0);
    v1Sqlite = migrationFiles(dir, "sqlite");
    v1Postgres = migrationFiles(dir, "postgres");
    expect(v1Sqlite).toHaveLength(1);
    expect(v1Postgres).toHaveLength(1);
    const checksums = readFileSync(join(dir, "migrations/checksums.json"), "utf8");
    expect(() => JSON.parse(checksums)).not.toThrow();
    for (const f of [...v1Sqlite, ...v1Postgres]) expect(checksums).toContain(basename(f, ".sql"));
  }, 300_000);

  it(tag("MIG-AC-001", "generating from a changed schema produces exactly one new migration per dialect and leaves earlier ones unchanged"), async () => {
    const before = { sqlite: read(dir, v1Sqlite), postgres: read(dir, v1Postgres) };
    writeApp(dir, { "src/app.ts": APP_V2 });
    const result = await runCli(dir, ["generate-migration"]);
    expect(result.status, result.output).toBe(0);
    const sqlite = migrationFiles(dir, "sqlite");
    const postgres = migrationFiles(dir, "postgres");
    expect(sqlite).toHaveLength(2);
    expect(postgres).toHaveLength(2);
    expect(sqlite.slice(0, 1)).toEqual(v1Sqlite);
    expect(postgres.slice(0, 1)).toEqual(v1Postgres);
    expect(read(dir, v1Sqlite)).toEqual(before.sqlite);
    expect(read(dir, v1Postgres)).toEqual(before.postgres);
    const added = [sqlite[1] ?? "", postgres[1] ?? ""];
    for (const f of added) expect(readFileSync(join(dir, f), "utf8").trim().length).toBeGreaterThan(0);
    const checksums = readFileSync(join(dir, "migrations/checksums.json"), "utf8");
    for (const f of [...sqlite, ...postgres]) expect(checksums).toContain(basename(f, ".sql"));
  }, 300_000);

  it(tag("MIG-AC-001", "editing a generated migration makes the checker fail (verify passes before the edit, fails after it)"), async () => {
    const control = await runCli(dir, ["verify"], 900_000);
    expect(control.status, `verify must pass before the edit:\n${control.output}`).toBe(0);

    const edited = migrationFiles(dir, "sqlite")[0] ?? "";
    appendFileSync(join(dir, edited), "\n-- edited by hand\n");
    const result = await runCli(dir, ["verify"], 900_000);
    expect(result.status, result.output).not.toBe(0);
    expect(result.status).not.toBeNull();
    // The failure names the edited migration (CHECK diagnostics name the construct).
    expect(result.output).toContain(basename(edited));
  }, 1_800_000);
});
