/**
 * PROV `deploy` end to end on the Cloudflare target, locally (S4 §1.1 item 1): the stage
 * databases on real local D1, the rest of the account in the fake Cloudflare API (support.ts).
 * Expectations come from PROV-REQ-002 (steps 1–7, the failure output, DEC-0544/0545), the
 * Databases paragraph of PROV §2, MIG-REQ-003/006 and compliance.md's deploy-recovery abort
 * points (COMPL-AC-008's local equivalent), not from the implementation.
 *
 * Fake-API runs: no criterion tag (plan-v0.2.0 §7a.1.4).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Histories } from "../../../src/mig/apply.js";
import { runDeploy, type DeployRequest } from "../../../src/provision/core/deploy.js";
import { runStop } from "../../../src/provision/core/stop-start.js";
import { cleanTempDirs, histories, io, openWorld, rows, stageDatabases, workerOf, type World } from "./support.js";

const STAGE = { app: "reference", stage: "test-int" };
const request = (migrations: Histories, extra: Partial<DeployRequest> = {}): DeployRequest => ({ stage: STAGE, migrations, requiredSecrets: [], ...extra });

let world: World;
let h: Awaited<ReturnType<typeof histories>>;
beforeEach(async () => {
  h ??= await histories();
  world = await openWorld();
}, 60_000);
afterEach(async () => {
  await world?.d1.close();
});
afterAll(cleanTempDirs);

const first = (pattern: RegExp, from = 0): number => world.events.findIndex((e, i) => i >= from && pattern.test(e));

describe("PROV deploy on the Cloudflare target with local D1", { timeout: 120_000 }, () => {
  it("a first deploy runs PROV-REQ-002's steps in order, reading only until the preflight passed, and leaves one migrated database bound to the started Worker", async () => {
    const out = io();
    const result = await runDeploy(world.target, request(h.v1), out);
    expect(result.status, out.err).toBe(0);

    const w = workerOf(STAGE);
    const firstChange = world.events.findIndex((e) => /^(api|d1|bytes) (?!GET)/.test(e) || e.startsWith("sst deploy"));
    expect(firstChange, "something changed").toBeGreaterThan(0);
    expect(world.events.slice(0, firstChange).filter((e) => !/^(api|d1|bytes) GET |^sst install/.test(e)), "before the first change only reads").toEqual([]);
    // A first deploy has no Worker yet: step 3 is SST's first run, step 5 its next one.
    const infra = first(/^sst deploy /);
    const created = first(/^d1 POST \/accounts\/[^/]+\/d1\/database$/);
    const migrated = first(/^d1 POST .*\/query$/, created);
    const code = first(/^sst deploy /, migrated);
    const started = first(new RegExp(`^api POST .*/workers/scripts/${w}/subdomain$`), code);
    const health = first(new RegExp(`^health ${w}$`));
    expect([infra, created, migrated, code, started, health].every((i) => i >= 0), world.events.join("\n")).toBe(true);
    expect(infra, "step 3 infrastructure before step 4 migrate").toBeLessThan(migrated);
    expect(created, "the first database exists before it is migrated").toBeLessThan(migrated);
    expect(migrated, "step 4 before step 5 code").toBeLessThan(code);
    expect(code, "step 5 before step 6 start").toBeLessThan(started);
    expect(started, "step 6 before step 7 health").toBeLessThan(health);

    const dbs = await stageDatabases(world, STAGE);
    expect(dbs.map((d) => d.name)).toEqual([`${w}-db-1`]);
    const recorded = (await rows(world, dbs[0]!.id, `SELECT "id" FROM "__framework_migrations" ORDER BY "id"`)).map((r) => r.id);
    expect(recorded).toEqual([...h.v1.framework, ...h.v1.app].map((m) => m.id).sort());
    expect(world.cloud.workers.get(w)?.enabled, "the route is on").toBe(true);
    expect(world.cloud.workers.get(w)?.bindings).toContainEqual(expect.objectContaining({ type: "d1", name: "DB", id: dbs[0]!.id }));
    expect(world.cloud.workers.get(w)?.bindings.map((b) => b.name), "a test stage binds no AUTH (DEC-0725)").not.toContain("AUTH");
    expect(out.out).toMatch(/public origin: https:\/\/reference-test-int\.[a-z0-9-]+\.workers\.dev/);
  });

  it("a failing migration deletes the new database, restarts the previous version against the unchanged one, and names step, file, state and next action (MIG-REQ-003)", async () => {
    expect((await runDeploy(world.target, request(h.v1), io())).status).toBe(0);
    const [db1] = await stageDatabases(world, STAGE);
    await world.d1.database(db1!.id).prepare(`INSERT INTO "notes" ("id", "title") VALUES ('a', 'same'), ('b', 'same')`).run();
    const before = await rows(world, db1!.id, `SELECT * FROM "notes" ORDER BY "id"`);

    const out = io();
    const result = await runDeploy(world.target, request(h.v2), out);
    expect(result.status).toBe(1);
    expect(out.err).toMatch(/deploy failed at step 4/);
    expect(out.err).toContain(h.failing);
    expect(out.err).toMatch(/UNIQUE/);
    expect(out.err).toMatch(/stage state: .*previous version restarted/);
    expect(out.err).toMatch(/next action: .*run deploy again/);
    expect((await stageDatabases(world, STAGE)).map((d) => d.name), "the new database is deleted").toEqual([db1!.name]);
    expect(await rows(world, db1!.id, `SELECT * FROM "notes" ORDER BY "id"`)).toEqual(before);
    expect(world.cloud.workers.get(workerOf(STAGE))?.enabled, "the previous version answers again").toBe(true);
    expect(world.cloud.workers.get(workerOf(STAGE))?.bindings).toContainEqual(expect.objectContaining({ name: "DB", id: db1!.id }));
  });

  it("a declared secret gone from the Worker after the preflight fails the deploy at the health step, naming the error code and requestId", async () => {
    expect((await runDeploy(world.target, request(h.v1), io())).status).toBe(0);
    // The app now declares `apiKey`; with the secret set the stage is healthy.
    world.runtimeSecrets.add("apiKey");
    world.cloud.workers.get(workerOf(STAGE))!.secrets.set("SECRET_API_KEY", "a-value");
    const ok = io();
    expect((await runDeploy(world.target, request(h.v1, { requiredSecrets: ["apiKey"] }), ok)).status, ok.err).toBe(0);

    // The test hook of PROV-AC-002: the secret is removed after the preflight passed.
    const target = { ...world.target, deployCode: async (input: Parameters<World["target"]["deployCode"]>[0]) => {
      const deployed = await world.target.deployCode(input);
      world.cloud.workers.get(workerOf(STAGE))!.secrets.delete("SECRET_API_KEY");
      return deployed;
    } };
    const out = io();
    const result = await runDeploy(target, request(h.v1, { requiredSecrets: ["apiKey"] }), out);
    expect(result.status).toBe(1);
    expect(out.err).toMatch(/deploy failed at step 7/);
    expect(out.err).toContain("SEC.MISSING");
    expect(out.err).toContain("req-health-1");
    expect(out.err).toMatch(/stage state: .*health check failed/);
    expect(out.err).toMatch(/next action: .*requestId/);
    expect(out.err.includes("a-value"), "no secret value is printed").toBe(false);
  });

  it("after the runner's after-copy abort, the next deploy deletes the left-behind copy, says so, and ends on one migrated database", async () => {
    // Row-by-row copies only: the fake D1 API has four local databases and never reuses one, and its
    // own export of this schema does not import (DEC-0769), so each native attempt would use one more.
    await world.d1.close();
    world = await openWorld({ native: false });
    expect((await runDeploy(world.target, request(h.v1), io())).status).toBe(0);
    const aborted = io();
    expect((await runDeploy(world.target, request(h.v2, { abortAt: "after-copy" }), aborted)).status).toBe(1);
    expect(aborted.out + aborted.err, "which copy ran is printed although a later step stopped (DEC-0545)").toMatch(/cop(y|ied)[^\n]*(native|row by row)/i);
    const w = workerOf(STAGE);
    const dbs1 = await stageDatabases(world, STAGE);
    expect(dbs1.map((d) => d.name)).toEqual([`${w}-db-1`, `${w}-db-2`]);
    expect(aborted.err).toMatch(/stage state: .*stopped.*the next deploy deletes the copy/);
    expect(world.cloud.workers.get(w)?.bindings, "the code still uses the current database").toContainEqual(expect.objectContaining({ name: "DB", id: dbs1[0]!.id }));

    const out = io();
    expect((await runDeploy(world.target, request(h.v2), out)).status, out.err).toBe(0);
    expect(out.out + out.err, "the leftover copy is named when removed").toContain(`${w}-db-2`);
    const dbs = await stageDatabases(world, STAGE);
    expect(dbs).toHaveLength(1);
    const recorded = (await rows(world, dbs[0]!.id, `SELECT "id" FROM "__framework_migrations"`)).map((r) => r.id);
    expect(recorded).toContain(h.v2.app[1]!.id);
    expect(world.cloud.workers.get(w)?.bindings).toContainEqual(expect.objectContaining({ name: "DB", id: dbs[0]!.id }));
    expect(world.cloud.workers.get(w)?.enabled).toBe(true);
  });

  it("after the runner's after-code abort the app is not started; the next deploy finds nothing pending, starts it and passes the health check", async () => {
    await world.d1.close();
    world = await openWorld({ native: false }); // as in the after-copy case (DEC-0769)
    expect((await runDeploy(world.target, request(h.v1), io())).status).toBe(0);
    const aborted = io();
    const codeAt = world.events.length;
    expect((await runDeploy(world.target, request(h.v2, { abortAt: "after-code" }), aborted)).status).toBe(1);
    const w = workerOf(STAGE);
    expect(aborted.err).toMatch(/stage state: .*the app is not started/);
    const afterCode = world.events.slice(world.events.findIndex((e, i) => i >= codeAt && /^sst deploy (?!.*--target)/.test(e)));
    expect(afterCode.filter((e) => e.endsWith(`/workers/scripts/${w}/subdomain`) || e === `health ${w}`), "no start step and no health check after the abort").toEqual([]);
    const [current] = await stageDatabases(world, STAGE);
    expect(world.cloud.workers.get(w)?.bindings, "the code is bound to the migrated database").toContainEqual(expect.objectContaining({ name: "DB", id: current!.id }));

    const mark = world.events.length;
    const out = io();
    expect((await runDeploy(world.target, request(h.v2), out)).status, out.err).toBe(0);
    const after = world.events.slice(mark);
    expect(after.filter((e) => /^d1 POST \/accounts\/[^/]+\/d1\/database$/.test(e)), "no new database: nothing was pending").toEqual([]);
    expect(after.some((e) => e === `health ${w}`)).toBe(true);
    expect((await stageDatabases(world, STAGE)).map((d) => d.id)).toEqual([current!.id]);
    expect(world.cloud.workers.get(w)?.enabled).toBe(true);
  });

  it("a stage stopped with stop stays stopped through deploys, a failed one included, until deploy --start clears the record, starts it and checks its health (DEC-0544)", async () => {
    await world.d1.close();
    world = await openWorld({ native: false }); // as in the abort cases (DEC-0769)
    const w = workerOf(STAGE);
    const RECORD = `sst-state/framework/${STAGE.app}/${STAGE.stage}/stage.json`;
    expect((await runDeploy(world.target, request(h.v1), io())).status).toBe(0);
    expect(await runStop(world.target, STAGE, io())).toBe(0);
    expect(world.cloud.workers.get(w)?.enabled).toBe(false);
    expect(world.cloud.buckets.get("sst-state")?.has(RECORD.slice("sst-state/".length)), "stop writes the stage record").toBe(true);

    // A failure after step 5 (here the runner's after-code abort) turns a stopped stage off again,
    // since the code deploy may have turned it on, and its stage state says so.
    const aborted = io();
    expect((await runDeploy(world.target, request(h.v2, { abortAt: "after-code" }), aborted)).status).toBe(1);
    expect(world.cloud.workers.get(w)?.enabled, "turned off again after the abort").toBe(false);
    expect(aborted.err).toMatch(/stage state: .*turned off again/);

    let mark = world.events.length;
    const plain = io();
    expect((await runDeploy(world.target, request(h.v2), plain)).status, plain.err).toBe(0);
    expect(world.cloud.workers.get(w)?.enabled, "a plain deploy leaves it stopped").toBe(false);
    expect(world.events.slice(mark).filter((e) => e === `health ${w}`), "step 7 is skipped").toEqual([]);
    expect(plain.out).toMatch(/stopped/);
    expect(plain.out).toContain(`start --target cloudflare --stage ${STAGE.stage}`);

    const [current] = await stageDatabases(world, STAGE);
    await world.d1.database(current!.id).prepare(`DELETE FROM "notes"`).run();
    const failing = io();
    const v3 = { ...h.v2, app: [...h.v2.app, { ...h.v2.app[1]!, id: "app/9999_fails", name: "9999_fails", file: "9999_fails.sql", statements: ["CREATE TABLE \"notes\" (\"id\" text)"] }] };
    expect((await runDeploy(world.target, request(v3), failing)).status).toBe(1);
    expect(failing.err).toMatch(/deploy failed at step 4/);
    expect(failing.err).toContain("9999_fails.sql");
    expect(world.cloud.workers.get(w)?.enabled, "a failed migration leaves it stopped").toBe(false);

    mark = world.events.length;
    const started = io();
    expect((await runDeploy(world.target, request(h.v2, { start: true }), started)).status, started.err).toBe(0);
    expect(world.cloud.buckets.get("sst-state")?.has(RECORD.slice("sst-state/".length)), "deploy --start clears the record").toBe(false);
    expect(world.cloud.workers.get(w)?.enabled).toBe(true);
    expect(world.events.slice(mark)).toContain(`health ${w}`);
  });
});
