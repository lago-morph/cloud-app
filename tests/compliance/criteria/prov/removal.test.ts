/**
 * PROV-AC-003 (provisioning.md §4; milestone): removing one of two stages leaves the other
 * stage and the shared resources intact, and leaves no resource, secret, or parameter of the
 * removed stage except its log entries.
 *
 * Two further `test-<random>` stages of apps/reference, A and B, are deployed; A gets a file in
 * its bucket (so `remove` must empty it), a KV row and a log entry, B a KV row and a log entry.
 * Then `remove` of A exits 0 and:
 * - A: the independent stage-resource probe (`_cloud/stage-resources.ts`) finds nothing left —
 *   no database, Worker (so no Worker secret or variable: Cloudflare has no other parameter
 *   store), R2 bucket, legacy R2 API token or state-home object (the stage record included);
 *   A's origin no longer serves the app. A's log entries may remain (not asserted either way).
 *   A is a test stage, so it is removed without a backup (PROV-REQ-003 as amended, DEC-0543):
 *   `prototype-backups` holds nothing under `reference/<A>/`;
 * - B: its resources (probe), secret locations, secret value (digest), KV value, log entry and
 *   health are as before;
 * - shared: the log bucket and the state home exist, the backup bucket `prototype-backups` exists
 *   with its lifecycle rule (PAR-311, DEC-0543), and these, the mail sink, the account's R2
 *   signing credential (its record by digest and its token, DEC-0550) and the account's
 *   workers.dev subdomain (by digest, never printed) are unchanged.
 * B is removed afterwards.
 *
 * Production removal (PROV-REQ-003 as amended, DEC-0543), a second test: one production stage
 * P of apps/reference (`p003<random>`, prodcheck's values copied as its committed values file,
 * like PROV-AC-004's production stage), with one object written straight into its bucket.
 * - A failed backup deletes nothing: `remove --confirm-production P` with a token that has the
 *   everyday set but "Workers R2 Storage Read" instead of "Write" (DEC-0551; the driver creates
 *   it, `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_STORAGE_WRITE`) cannot write the backup: it exits
 *   1, says "nothing was deleted; the stage is unchanged", and P's resources (probe), its object
 *   and its app are as before; no backup manifest was written.
 * - Backed up first: `remove --confirm-production P` with the run's token exits 0, and
 *   `prototype-backups/reference/P/<yyyymmddThhmmssZ>/` holds `database/<name>.sql` (D1's export,
 *   with the schema's tables) for P's database, `files/<key>` for every object P's bucket held,
 *   with its bytes and content type, and `manifest.json` (app, stage, databases, number of
 *   files), written last. The object could only be copied before the bucket was emptied. Then
 *   nothing of P remains and the shared resources are unchanged. The test deletes the backup.
 * P carries a reserved prefix and a marker (DEC-0560): a process killed mid-test can leave it, and
 * a cloud run starting or ending more than PAR-286 later removes it (`--confirm-production`).
 *
 * Passes (DEC-0318): two D1 databases at once, so this runs in a milestone pass with no run
 * stage (the database cap is checked first).
 *
 * Cloud usage (estimate, D-T.md): 3 deploys (4 with P's secret) and 4 removes; D1 ≈ 150 rows
 * written by migrations and records, 2 KV rows, ≈ 10 rows read, one D1 export; R2 a handful of
 * small objects; ≈ 80 Cloudflare API requests by the probes and hooks (sharedResources ×4 ≈ 36,
 * probes ×6 ≈ 30, scoped R2 tokens ×4 ≈ 16). Needs D1 (blocked while DEC-0317 holds).
 */
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLOUD_WAITS, prerequisiteMissing, tag, target, waitFor, type ComplianceClient } from "../../harness/index.js";
import { NO_R2_STORAGE_WRITE_ENV } from "../../harness/test-tokens.js";
import { backupLifecycle, retentionRuleProblems } from "../_cloud/account.js";
import { cloudHooks as hooksFor } from "../_cloud/index.js";
import { BACKUP_BUCKET, listKeys, withR2Access } from "../_cloud/r2.js";
import { listStageResources, sharedResources, stageBucketName, stageResourceDetails } from "../_cloud/stage-resources.js";
import { isLocal, parameterNumber, REFERENCE_DIR, uniqueValue, utcDay } from "../core/support/repo.js";
import { logDayPrefix } from "../core/support/stores.js";
import { healthStatus, holdStages, newProductionStage, tail, withCloudStage, type CloudStage } from "./support/stage.js";

const sha256 = (v: string): string => createHash("sha256").update(v, "utf8").digest("hex");

async function logKey(s: CloudStage, requestId: string): Promise<string> {
  const hooks = hooksFor(s.target);
  return waitFor(
    async () => (await hooks.listLogKeys(logDayPrefix(s.app, s.stage, utcDay(new Date())))).find((k) => k.endsWith(`-${requestId}.json`)),
    { what: `the log entry of request ${requestId} of ${s.stage}`, timeoutMs: CLOUD_WAITS.requestMs, intervalMs: 2_000 },
  );
}

/** Whether the stage's origin still serves the app: anything but a 200 from the app's own route counts as gone. */
async function servesApp(c: ComplianceClient): Promise<boolean> {
  try {
    return (await c.get("/api/ref/deployment")).status === 200;
  } catch {
    return false;
  }
}

if (!isLocal()) {
  describe("PROV-AC-003 removal of one of two stages (cloud, milestone)", () => {
    it(
      tag("PROV-AC-003", "removing one of two stages leaves the other and the shared resources intact and nothing of the removed stage except its log entries"),
      async () => {
        const t = target().target;
        const valueA = uniqueValue("dt1prov003a");
        const valueB = uniqueValue("dt1prov003b");
        await holdStages(2, "PROV-AC-003 (two stages)", () =>
          withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: valueA }, databases: 1, held: true }, (a) =>
            withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: valueB }, databases: 1, held: true }, async (b) => {
              await a.deployReady();
              await b.deployReady();
              const hooks = hooksFor(t);
              const key = `dt1:prov003:${randomBytes(6).toString("hex")}`;

              const userA = await a.client().as("user");
              userA.expectStatus(await userA.request("PUT", "/api/files/content", { json: { name: "dt1/prov003.txt", contentType: "text/plain", base64: Buffer.from("A").toString("base64") } }), 204);
              userA.expectStatus(await userA.request("PUT", "/api/kv/value", { json: { key, value: "A" } }), 204);
              const anonA = a.client();
              anonA.expectStatus(await anonA.post("/api/ref/log", { severity: "info", message: "d-t1 PROV-AC-003 stage A" }), 200);

              const userB = await b.client().as("user");
              userB.expectStatus(await userB.request("PUT", "/api/kv/value", { json: { key, value: "B" } }), 204);
              const anonB = b.client();
              const idB = anonB.expectStatus(await anonB.post("/api/ref/log", { severity: "info", message: "d-t1 PROV-AC-003 stage B" }), 200).json<{ requestId: string }>().requestId;
              const keyB = await logKey(b, idB);

              const beforeB = await stageResourceDetails(b);
              const secretsB = await hooks.secretLocations(b);
              const shared = await sharedResources();
              expect(beforeB.workers.length, "B has a Worker before").toBe(1);
              expect(shared.logBucket && shared.stateHome, "shared resources exist before").toBe(true);
              expect(shared.backupBucket, "the backup bucket prototype-backups exists before (DEC-0543)").toBe(true);
              expect(retentionRuleProblems(await backupLifecycle(), parameterNumber("PAR-311")), "the backup bucket's lifecycle rule (PAR-311)").toEqual([]);

              const removed = await a.remove();
              expect(removed.status, `remove of A:\n${removed.output.slice(-2000)}`).toBe(0);

              // Nothing of A remains (its log entries may).
              expect(await listStageResources({ target: t, app: a.app, stage: a.stage }), "resources of the removed stage").toEqual([]);
              await waitFor(async () => ((await servesApp(anonA)) ? undefined : true), { what: "the removed stage's origin to stop serving the app", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 2_000 });
              // A test stage is removed without a backup (DEC-0543).
              expect(await listKeys(BACKUP_BUCKET, `${a.app}/${a.stage}/`), "backup objects of the removed test stage").toEqual([]);

              // B is intact.
              expect(await stageResourceDetails(b), "B's resources").toEqual(beforeB);
              expect(await hooks.secretLocations(b), "B's secret locations").toEqual(secretsB);
              expect(anonB.expectStatus(await anonB.get("/api/ref/secret"), 200).json(), "B's secret value").toEqual({ sha256: sha256(valueB) });
              expect(userB.expectStatus(await userB.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json(), "B's data").toEqual({ value: "B" });
              expect(await healthStatus(anonB), "B's health").toBe(204);
              expect(await hooks.listLogKeys(keyB.slice(0, keyB.lastIndexOf("/") + 1)), "B's log entry").toContain(keyB);

              // The shared resources are intact.
              expect(await sharedResources(), "shared log bucket, state home, mail sink, backup bucket and its rule, signing credential and workers.dev subdomain").toEqual(shared);
            }),
          ),
        );
      },
      60 * 60_000,
    );

    it(
      tag("PROV-AC-003", "a production stage's remove backs it up to prototype-backups before deleting anything; a failed backup deletes nothing"),
      async () => {
        const t = target().target;
        const token = process.env[NO_R2_STORAGE_WRITE_ENV];
        if (token === undefined || token === "") prerequisiteMissing(`needs a Cloudflare API token with the everyday set but without "Workers R2 Storage Write" in ${NO_R2_STORAGE_WRITE_ENV} (the compliance driver creates one for a run that selects PROV-AC-003)`);
        const stage = newProductionStage("p003");
        await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: uniqueValue("dt1prov003p") }, databases: 1, productionStage: stage }, async (p) => {
          await p.deployReady();
          const ref = { app: p.app, stage: p.stage };
          const bucket = stageBucketName(ref);
          const key = `dt1/prov003-${randomBytes(6).toString("hex")}.bin`;
          const bytes = randomBytes(256);
          const contentType = "application/x-dt1-prov003";
          await withR2Access([bucket], "write", (r2) => r2.put(bucket, key, bytes, contentType));
          const stageObjects = (await withR2Access([bucket], "read", (r2) => r2.list(bucket, ""))).map((o) => o.key);
          expect(stageObjects, "the production stage's bucket holds the test object").toContain(key);
          const before = await stageResourceDetails(ref);
          expect(before.databases.length, "the production stage has one database").toBe(1);
          const shared = await sharedResources();
          const prefix = `${p.app}/${p.stage}/`;

          // 1. A failed backup (it cannot be written) deletes nothing.
          const failed = await p.remove({ env: { CLOUDFLARE_API_TOKEN: token } });
          expect(failed.status, `remove whose backup cannot be written must exit 1:\n${tail(failed.output)}`).toBe(1);
          expect(failed.output, "the output says nothing was deleted").toContain("nothing was deleted; the stage is unchanged");
          expect(failed.output.includes(token), "the output does not print the token").toBe(false);
          expect(await stageResourceDetails(ref), "the stage's resources after the failed backup").toEqual(before);
          const kept = await withR2Access([bucket], "read", (r2) => r2.get(bucket, key));
          expect(kept?.bytes.equals(bytes), "the stage's object after the failed backup").toBe(true);
          expect(await healthStatus(p.client()), "the stage still answers after the failed backup").toBe(204);
          expect((await listKeys(BACKUP_BUCKET, prefix)).filter((k) => k.endsWith("/manifest.json")), "backup manifests after the failed backup").toEqual([]);

          // 2. The backup is written first, then the stage is removed.
          const startedAt = Date.now();
          const removed = await p.remove();
          expect(removed.status, `remove --confirm-production of the production stage:\n${tail(removed.output)}`).toBe(0);
          const checked = await withR2Access([BACKUP_BUCKET], "write", async (r2) => {
            const objects = await r2.list(BACKUP_BUCKET, prefix);
            try {
              const folders = [...new Set(objects.map((o) => /^[^/]+\/[^/]+\/(\d{8}T\d{6}Z)\//.exec(o.key)?.[1] ?? "(not a backup folder)"))];
              expect(folders, `backup folders under ${BACKUP_BUCKET}/${prefix}`).toHaveLength(1);
              const folder = folders[0] ?? "";
              const at = Date.parse(`${folder.slice(0, 4)}-${folder.slice(4, 6)}-${folder.slice(6, 8)}T${folder.slice(9, 11)}:${folder.slice(11, 13)}:${folder.slice(13, 15)}Z`);
              expect(Math.abs(at - startedAt), "the backup folder's time is the removal's (UTC)").toBeLessThan(15 * 60_000);
              const base = `${prefix}${folder}/`;
              const names = objects.map((o) => o.key.slice(base.length)).sort();
              const expected = [...before.databases.map((d) => `database/${d.name}.sql`), ...stageObjects.map((k) => `files/${k}`), "manifest.json"].sort();
              expect(names, "the backup's objects: each database's export, each stored file, and the manifest").toEqual(expected);
              const manifestTime = Date.parse(objects.find((o) => o.key === `${base}manifest.json`)?.lastModified ?? "");
              for (const o of objects) expect(Date.parse(o.lastModified), `${o.key} was written no later than manifest.json`).toBeLessThanOrEqual(manifestTime);

              const copied = await r2.get(BACKUP_BUCKET, `${base}files/${key}`);
              expect(copied?.bytes.equals(bytes), "the backed-up file's bytes").toBe(true);
              expect(copied?.contentType, "the backed-up file's content type").toBe(contentType);
              for (const d of before.databases) {
                const dump = (await r2.get(BACKUP_BUCKET, `${base}database/${d.name}.sql`))?.bytes.toString("utf8") ?? "";
                expect(dump, `the export of ${d.name} holds the schema's tables`).toMatch(/CREATE TABLE/i);
              }
              const manifest = JSON.parse((await r2.get(BACKUP_BUCKET, `${base}manifest.json`))?.bytes.toString("utf8") ?? "{}") as Record<string, unknown>;
              expect(manifest, "the manifest names the app and the stage").toMatchObject({ app: p.app, stage: p.stage });
              for (const d of before.databases) expect(JSON.stringify(manifest), `the manifest names the database ${d.name}`).toContain(d.name);
              expect(Object.values(manifest), "the manifest gives the number of files").toContain(stageObjects.length);
              return names.length;
            } finally {
              // The test's own backup: delete it (an owner's backups are deleted by PAR-311's rule).
              for (const o of objects) await r2.remove(BACKUP_BUCKET, o.key);
            }
          });
          expect(checked, "backup objects checked").toBeGreaterThan(2);
          expect(await listStageResources({ target: t, app: p.app, stage: p.stage, production: true }), "resources of the removed production stage").toEqual([]);
          expect(await sharedResources(), "the shared resources after the production removal").toEqual(shared);
        });
      },
      60 * 60_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PROV-AC-003 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
