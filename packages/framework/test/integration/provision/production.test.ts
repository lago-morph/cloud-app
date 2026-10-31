/**
 * PROV on a production stage and F's v0.2.0 deploy changes, locally (S4 §1.1 item 1): the AUTH
 * service binding and the auth app's registry (DEC-0725, DEC-0726), the R2 signing credential
 * bound from Secrets Store or, as the fallback, copied into Worker secrets (DEC-0727, DEC-0729,
 * plan-v0.2.0 §10), and `remove` of one of two stages with the production backup first
 * (PROV-REQ-003 and its DEC-0543 amendment; PROV-AC-003's local equivalent).
 *
 * Stage databases and the registry are real local D1; the rest is the fake Cloudflare API
 * (support.ts). Fake-API runs: no criterion tag (plan-v0.2.0 §7a.1.4).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRegistered, type D1Like } from "../../../src/auth-app/store.js";
import type { Histories } from "../../../src/mig/apply.js";
import { createAccountSigningCredential } from "../../../src/provision/cloudflare/r2-token.js";
import { runDeploy } from "../../../src/provision/core/deploy.js";
import type { Stage } from "../../../src/provision/core/operations.js";
import { runRemove } from "../../../src/provision/core/remove.js";
import { ACCOUNT, AUTH_APP_WORKER, cleanTempDirs, histories, io, openWorld, rows, stageDatabases, withAuthApp, withLegacyEmailDomain, workerOf, type World } from "./support.js";

const PROD: Stage = { app: "reference", stage: "prod" };
const TEST: Stage = { app: "reference", stage: "test-keep" };
/** PAR-455's Secrets Store names and the framework secrets they stand in for (DEC-0729), written out. */
const SIGNING = [
  { binding: "SECRET_FRAMEWORK_R2_ACCESS_KEY_ID", secretName: "PROTOTYPE_R2_ACCESS_KEY_ID" },
  { binding: "SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY", secretName: "PROTOTYPE_R2_SECRET_ACCESS_KEY" },
];
const SHARED_BUCKETS = ["prototype-logs", "sst-state", "prototype-backups"];

let world: World;
let v1: Histories;
beforeEach(async () => {
  v1 ??= (await histories()).v1;
  world = await openWorld();
}, 60_000);
afterEach(async () => {
  await world?.d1.close();
});
afterAll(cleanTempDirs);

const deploy = async (stage: Stage) => {
  const out = io();
  const result = await runDeploy(world.target, { stage, migrations: v1, requiredSecrets: [] }, out);
  expect(result.status, out.err).toBe(0);
  return out;
};
const record = () => world.cloud.objectBodies.get("sst-state/framework/r2-signing.json") as { accessKeyId: string; secretsStore?: { storeId: string } };
const storeBindings = (stage: Stage) => (world.cloud.workers.get(workerOf(stage))?.bindings ?? []).filter((b) => b.type === "secrets_store_secret");

describe("PROV production stage and F's bindings on the Cloudflare target with local D1", { timeout: 120_000 }, () => {
  it("a production deploy binds AUTH to the auth app, registers its callback URL, and binds the signing credential from Secrets Store instead of copying it", async () => {
    const registryId = await withAuthApp(world);
    withLegacyEmailDomain(world.cloud);
    expect((await createAccountSigningCredential(world.cloud.api, ACCOUNT, { secretsStore: true })).where).toBe("secrets-store");
    const storeId = record().secretsStore?.storeId;
    expect(storeId, "the record says where the credential is").toBeDefined();

    const out = await deploy(PROD);
    const origin = /public origin: (https:\/\/\S+)/.exec(out.out)?.[1];
    expect(origin).toBeDefined();
    const worker = world.cloud.workers.get(workerOf(PROD))!;
    expect(worker.bindings).toContainEqual({ type: "service", name: "AUTH", service: AUTH_APP_WORKER, entrypoint: "AuthApp" });
    const registry = world.d1.database(registryId) as unknown as D1Like;
    expect(await isRegistered(registry, workerOf(PROD), `${origin!}/api/auth/callback`)).toBe(true);
    expect(storeBindings(PROD)).toEqual(SIGNING.map((s) => ({ type: "secrets_store_secret", name: s.binding, storeId, secretName: s.secretName })));
    for (const s of SIGNING) expect(worker.secrets.has(s.binding), `${s.binding} is not also a Worker secret`).toBe(false);
  });

  it("removing the production stage of two backs it up first, clears its registry entry, and leaves the other stage and the shared resources intact", async () => {
    const registryId = await withAuthApp(world);
    withLegacyEmailDomain(world.cloud);
    await deploy(TEST);
    const origin = /public origin: (https:\/\/\S+)/.exec((await deploy(PROD)).out)?.[1];
    const registry = world.d1.database(registryId) as unknown as D1Like;
    expect(await isRegistered(registry, workerOf(PROD), `${origin!}/api/auth/callback`)).toBe(true);
    const [prodDb] = await stageDatabases(world, PROD);
    await world.d1.database(prodDb!.id).prepare(`INSERT INTO "notes" ("id", "title") VALUES ('n1', 'kept in the backup')`).run();
    world.cloud.putBytes(`${workerOf(PROD)}-files`, "photos/a.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    const testDbs = await stageDatabases(world, TEST);
    const testWorker = world.cloud.workers.get(workerOf(TEST))!;

    const mark = world.events.length;
    const out = io();
    const result = await runRemove(world.target, PROD, out);
    expect(result.status, out.err).toBe(0);
    expect(result.leftovers).toEqual([]);

    // The backup is complete, and written before anything was deleted (DEC-0543).
    const events = world.events.slice(mark);
    const firstDelete = events.findIndex((e) => (/^(api|d1|bytes) DELETE /.test(e) && !e.includes("/prototype-backups/")) || e.startsWith("sst remove"));
    // DEC-0725 also puts the registry clear before anything is deleted: that order fails on this
    // base and is the red test of its own fix PR (root cause 2026-10-31-T3-remove-registry-order).
    const registryClear = events.findIndex((e) => e.startsWith(`d1 POST /accounts/${ACCOUNT}/d1/database/${registryId}/query`));
    expect(registryClear, "the registry entry is cleared").toBeGreaterThan(-1);
    const lastBackupWrite = events.map((e) => e.startsWith("bytes PUT /accounts/") && e.includes("/prototype-backups/")).lastIndexOf(true);
    expect(lastBackupWrite, "the backup was written").toBeGreaterThan(-1);
    expect(firstDelete, "nothing is deleted before the backup is complete").toBeGreaterThan(lastBackupWrite);
    const backup = [...(world.cloud.buckets.get("prototype-backups") ?? [])].filter((k) => k.startsWith("reference/prod/"));
    const dump = backup.find((k) => k.endsWith(`/database/${prodDb!.name}.sql`));
    expect(dump, backup.join("\n")).toBeDefined();
    expect(new TextDecoder().decode(world.cloud.objectBytes.get(`prototype-backups/${dump}`)?.bytes)).toContain("kept in the backup");
    expect(backup.some((k) => /\/files\/000001$/.test(k)), "the stored file is copied").toBe(true);
    expect(backup.some((k) => k.endsWith("/manifest.json"))).toBe(true);

    // The production stage is gone, and nobody new can sign in to it.
    expect(await stageDatabases(world, PROD)).toEqual([]);
    expect(world.cloud.workers.has(workerOf(PROD))).toBe(false);
    expect(world.cloud.buckets.has(`${workerOf(PROD)}-files`)).toBe(false);
    expect((await world.target.listStageResources(PROD)).resources, "no resource of the removed stage is left").toEqual([]);
    expect([...(world.cloud.buckets.get("sst-state") ?? [])].filter((k) => k.includes(`/${PROD.app}/${PROD.stage}`)), "no state object or stage record of it is left").toEqual([]);
    expect(await isRegistered(registry, workerOf(PROD), `${origin!}/api/auth/callback`)).toBe(false);

    // The other stage and the account's shared resources are untouched.
    expect(await stageDatabases(world, TEST)).toEqual(testDbs);
    expect(await rows(world, testDbs[0]!.id, `SELECT count(*) AS n FROM "__framework_migrations"`)).toEqual([{ n: v1.framework.length + v1.app.length }]);
    expect(world.cloud.workers.get(workerOf(TEST))).toBe(testWorker);
    expect(testWorker.enabled).toBe(true);
    expect(world.cloud.buckets.has(`${workerOf(TEST)}-files`)).toBe(true);
    for (const b of SHARED_BUCKETS) expect(world.cloud.buckets.has(b), b).toBe(true);
    expect(world.cloud.lifecycles.get("prototype-backups")).toHaveLength(1);
    expect(world.cloud.objectBodies.has("sst-state/framework/r2-signing.json"), "the account's signing credential stays").toBe(true);
    expect(world.cloud.workers.has(AUTH_APP_WORKER), "the auth app stays").toBe(true);

    // A test stage is removed without a backup.
    expect((await runRemove(world.target, TEST, io())).status).toBe(0);
    expect([...(world.cloud.buckets.get("prototype-backups") ?? [])].filter((k) => k.startsWith(`reference/${TEST.stage}/`))).toEqual([]);
    expect(await stageDatabases(world, TEST)).toEqual([]);
  });

  it("when Secrets Store is unavailable the signing credential stays in its record and deploy copies it into Worker secrets; switching forms moves it both ways", async () => {
    const STORES = `GET /accounts/${ACCOUNT}/secrets_store/stores?per_page=50`;
    world.cloud.override.set(STORES, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null } });
    expect((await createAccountSigningCredential(world.cloud.api, ACCOUNT, { secretsStore: true })).where).toBe("record");
    world.cloud.override.delete(STORES);
    await deploy(TEST);
    const worker = () => world.cloud.workers.get(workerOf(TEST))!;
    expect(storeBindings(TEST), "the fallback binds nothing from Secrets Store").toEqual([]);
    expect(worker().secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID") === record().accessKeyId, "the record's credential is copied").toBe(true);
    expect(worker().secrets.has("SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY")).toBe(true);

    // To the store form: the Worker-secret copies are deleted and both names are bound instead.
    expect((await createAccountSigningCredential(world.cloud.api, ACCOUNT, { secretsStore: true })).where).toBe("secrets-store");
    await deploy(TEST);
    expect(storeBindings(TEST).map((b) => b.name).sort()).toEqual(SIGNING.map((s) => s.binding).sort());
    for (const s of SIGNING) expect(worker().secrets.has(s.binding), s.binding).toBe(false);

    // Back to the record form (setup-account without the option): the bindings go, the copies return.
    await createAccountSigningCredential(world.cloud.api, ACCOUNT);
    await deploy(TEST);
    expect(storeBindings(TEST)).toEqual([]);
    expect(worker().secrets.get("SECRET_FRAMEWORK_R2_ACCESS_KEY_ID") === record().accessKeyId).toBe(true);
  });
});
