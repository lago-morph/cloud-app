/**
 * MIG-AC-002 and MIG-AC-003, local interpretation (DEC-0144).
 *
 * Locally, a "deployment" is starting `dev` on the app directory: it applies pending
 * migrations in place to the persistent local D1 database (migrations.md §2 "Local",
 * local.md §2), and a failing migration leaves that database unchanged because D1's batch
 * call is atomic. So:
 * - "initial deployment" = first `dev` start; "second deployment with no changes" = a
 *   second `dev` start with the same sources; "the app answers" = the health check
 *   (`/api/__framework/health`, 204) and the app's own routes;
 * - "the deploy exits with failure status" = `dev` exits non-zero instead of serving;
 * - "the old app answers again" = `dev` with the previous version's sources (app and its
 *   committed migrations) serves the unchanged data;
 * - "no new database behind" = still exactly one local D1 database file.
 * The database is inspected from Miniflare's SQLite file after `dev` stops (mig/local-d1.ts).
 * The cloud parts (stopping the Worker, copying the database) are D-04's (B-T2 row: local).
 */
import { cpSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createAppDir, migrationFiles, removeAppDir, runCli, startDev, writeApp, type DevServer } from "../sql/support/app-dir.js";
import { APP_V1, APP_V2, APP_V3, dataV1, dataV2, seedIds, type SeedIds } from "./apps.js";
import { d1DatabaseFiles, onlyD1Database, snapshotD1, type D1Snapshot } from "./local-d1.js";

let running: DevServer | undefined;

async function serve(dir: string): Promise<DevServer> {
  const started = await startDev(dir);
  if ("exited" in started) {
    throw new Error(`dev exited (status ${String(started.exited.status)}) instead of serving:\n${started.exited.output}`);
  }
  running = started.server;
  return started.server;
}

async function stop(): Promise<void> {
  await running?.stop();
  running = undefined;
}

async function call(server: DevServer, method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = method === "POST" ? { Origin: server.baseUrl } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${server.baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** Seeds version 1's rows; returns the IDs the app created with `newId()`. */
async function seed(server: DevServer): Promise<SeedIds> {
  const res = await call(server, "POST", "/api/seed");
  expect(res.status).toBe(200);
  return seedIds(await res.json());
}

async function data(server: DevServer): Promise<unknown> {
  const res = await call(server, "GET", "/api/data");
  expect(res.status).toBe(200);
  return res.json();
}

async function generate(dir: string): Promise<void> {
  const result = await runCli(dir, ["generate-migration"]);
  expect(result.status, result.output).toBe(0);
}

/** App migration names (file base names) in order, for the record check. */
const appMigrations = (dir: string): string[] => migrationFiles(dir, "sqlite").map((f) => basename(f, ".sql"));

/**
 * MIG-REQ-002: the record lists every migration once, framework migrations first, then app
 * migrations in order. A record row belongs to an app migration when its `id` contains the
 * migration's file base name (DEC-0224).
 */
function expectRecord(record: D1Snapshot["record"], appNames: string[]): void {
  const ids = record.map((r) => String(r["id"]));
  expect(new Set(ids).size, `record has duplicates: ${ids.join(", ")}`).toBe(ids.length);
  const appPositions = appNames.map((name) => {
    const matches = ids.flatMap((id, i) => (id.includes(name) ? [i] : []));
    expect(matches, `app migration ${name} recorded exactly once`).toHaveLength(1);
    return matches[0] ?? -1;
  });
  expect([...appPositions].sort((a, b) => a - b)).toEqual(appPositions);
  const frameworkPositions = ids.flatMap((_, i) => (appPositions.includes(i) ? [] : [i]));
  expect(frameworkPositions.length, "framework migrations (__framework_kv, __framework_migrations) are recorded").toBeGreaterThan(0);
  expect(Math.max(...frameworkPositions)).toBeLessThan(Math.min(...appPositions));
}

afterEach(async () => {
  await stop();
}, 60_000);

describe("MIG local deployment: initial and unchanged", () => {
  let dir: string;
  beforeAll(() => {
    dir = createAppDir({ "src/app.ts": APP_V1 });
  });
  afterAll(() => removeAppDir(dir));

  it(tag("MIG-AC-002", "local: the initial deployment creates the schema; a second one with no changes changes no data, applies nothing and answers; the record lists every migration once"), async () => {
    await generate(dir);

    let server = await serve(dir);
    const ids = await seed(server);
    expect(await data(server)).toEqual(dataV1(ids));
    await stop();

    const first = snapshotD1(onlyD1Database(dir));
    const tables = first.schema.filter((s) => s.type === "table").map((s) => s.name);
    expect(tables).toEqual(expect.arrayContaining(["parents", "children", "__framework_kv", "__framework_migrations"]));
    expect(first.rows["parents"]).toHaveLength(2);
    expect(first.rows["children"]).toHaveLength(3);
    expectRecord(first.record, appMigrations(dir));

    server = await serve(dir);
    expect((await call(server, "GET", "/api/__framework/health")).status).toBe(204);
    expect(await data(server)).toEqual(dataV1(ids));
    await stop();

    const second = snapshotD1(onlyD1Database(dir));
    // Same schema, same rows in every table, same record (including applied times): nothing ran.
    expect(second).toEqual(first);
  }, 900_000);
});

describe("MIG local deployment: schema change with data, failing migration, recovery", () => {
  let dir: string;
  let v2Migrations: string;
  let v3Migrations: string;
  let afterV2: D1Snapshot;
  let ids: SeedIds;

  beforeAll(() => {
    dir = createAppDir({ "src/app.ts": APP_V1 });
    // Saved copies of the committed migrations of versions 2 and 3, outside the app directory.
    v2Migrations = `${dir}-migrations-v2`;
    v3Migrations = `${dir}-migrations-v3`;
  });
  afterAll(() => {
    removeAppDir(dir);
    removeAppDir(v2Migrations);
    removeAppDir(v3Migrations);
  });

  it(tag("MIG-AC-003", "local: a supported schema change, including a column drop on a table with child rows, preserves every row and reference not explicitly dropped"), async () => {
    await generate(dir);
    let server = await serve(dir);
    ids = await seed(server);
    expect(await data(server)).toEqual(dataV1(ids));
    await stop();
    const before = snapshotD1(onlyD1Database(dir));

    writeApp(dir, { "src/app.ts": APP_V2 });
    await generate(dir);
    expect(migrationFiles(dir, "sqlite")).toHaveLength(2);

    server = await serve(dir);
    expect(await data(server)).toEqual(dataV2(ids));
    await stop();

    afterV2 = snapshotD1(onlyD1Database(dir));
    // Every parent row survives without the dropped column; every child keeps its parent.
    const strip = (rows: readonly Record<string, unknown>[] | undefined, drop: string[]) =>
      (rows ?? []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
    expect(strip(afterV2.rows["parents"], [])).toEqual(strip(before.rows["parents"], ["note"]));
    expect(strip(afterV2.rows["children"], ["rank"])).toEqual(strip(before.rows["children"], []));
    expect((afterV2.rows["children"] ?? []).every((r) => r["rank"] === 0)).toBe(true);
    expect(afterV2.rows["tags"]).toEqual([]);
    expect(afterV2.foreignKeyViolations).toEqual([]);
    expect(afterV2.rows["__framework_kv"]).toEqual(before.rows["__framework_kv"]);
    expectRecord(afterV2.record, appMigrations(dir));
    cpSync(join(dir, "migrations"), v2Migrations, { recursive: true });
  }, 900_000);

  it(tag("MIG-AC-003", "local: a data-dependent failing migration (unique over duplicates) fails the deployment, leaves the database unchanged with no new database; the old app answers again; a re-run after correcting the data succeeds"), async () => {
    expect(afterV2, "depends on the previous test's version 2 deployment").toBeDefined();
    expect(ids, "depends on the previous test's seed").toBeDefined();
    writeApp(dir, { "src/app.ts": APP_V3 });
    await generate(dir);
    expect(migrationFiles(dir, "sqlite")).toHaveLength(3);
    cpSync(join(dir, "migrations"), v3Migrations, { recursive: true });

    // The failing deployment exits with failure status instead of serving.
    const failed = await startDev(dir);
    if ("server" in failed) {
      running = failed.server;
      throw new Error("dev served although the unique-constraint migration cannot apply to duplicate rows");
    }
    expect(failed.exited.status, failed.exited.output).not.toBe(0);
    expect(failed.exited.status === null && failed.exited.signal === null).toBe(false);

    // Existing database unchanged (schema, rows, record), and no other database left behind.
    expect(d1DatabaseFiles(dir)).toHaveLength(1);
    expect(snapshotD1(onlyD1Database(dir))).toEqual(afterV2);

    // The previous version (its sources and committed migrations) answers again with the unchanged data.
    writeApp(dir, { "src/app.ts": APP_V2 });
    rmSync(join(dir, "migrations"), { recursive: true, force: true });
    cpSync(v2Migrations, join(dir, "migrations"), { recursive: true });
    let server = await serve(dir);
    expect((await call(server, "GET", "/api/__framework/health")).status).toBe(204);
    expect(await data(server)).toEqual(dataV2(ids));

    // Correct the data, then re-run the version 3 deployment.
    expect((await call(server, "POST", "/api/fix-codes", { parentId: ids.parents[1] })).status).toBe(204);
    await stop();
    writeApp(dir, { "src/app.ts": APP_V3 });
    rmSync(join(dir, "migrations"), { recursive: true, force: true });
    cpSync(v3Migrations, join(dir, "migrations"), { recursive: true });
    server = await serve(dir);
    expect(await data(server)).toEqual({
      parents: [{ id: ids.parents[0], name: "one", code: "dup" }, { id: ids.parents[1], name: "two", code: "unique-2" }],
      children: dataV2(ids).children,
    });
    await stop();

    const after = snapshotD1(onlyD1Database(dir));
    expect(d1DatabaseFiles(dir)).toHaveLength(1);
    expect(after.rows["children"]).toEqual(afterV2.rows["children"]);
    expect(after.foreignKeyViolations).toEqual([]);
    expectRecord(after.record, appMigrations(dir));
    // The constraint now exists: a unique index covers parents.code.
    const uniqueOnCode = after.schema.some((s) => s.type === "index" && s.tbl_name === "parents" && /unique/i.test(s.sql ?? "") && /code/.test(s.sql ?? ""))
      || after.schema.some((s) => s.type === "table" && s.name === "parents" && /code[^,]*unique/i.test(s.sql ?? ""));
    expect(uniqueOnCode, JSON.stringify(after.schema.filter((s) => s.tbl_name === "parents"))).toBe(true);
  }, 1_800_000);
});
