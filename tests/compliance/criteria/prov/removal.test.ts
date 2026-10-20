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
 *   store), R2 bucket, R2 API token or state-home object; A's origin no longer serves the app.
 *   A's log entries may remain (not asserted either way);
 * - B: its resources (probe), secret locations, secret value (digest), KV value, log entry and
 *   health are as before;
 * - shared: the log bucket and the state home exist, and the account's workers.dev subdomain is
 *   unchanged (compared by digest, never printed).
 * B is removed afterwards.
 *
 * Passes (DEC-0318): two D1 databases at once, so this runs in a milestone pass with no run
 * stage (the database cap is checked first).
 *
 * Cloud usage (estimate, D-T.md): 2 deploys and 2 removes; D1 ≈ 100 rows written by migrations
 * and records, 2 KV rows, ≈ 10 rows read; R2 one small object; ≈ 30 Cloudflare API requests by
 * the probes and hooks. Needs D1 (blocked while DEC-0317 holds).
 */
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLOUD_WAITS, tag, target, waitFor, type ComplianceClient } from "../../harness/index.js";
import { cloudHooks as hooksFor } from "../_cloud/index.js";
import { listStageResources, sharedResources, stageResourceDetails } from "../_cloud/stage-resources.js";
import { isLocal, REFERENCE_DIR, uniqueValue, utcDay } from "../core/support/repo.js";
import { logDayPrefix } from "../core/support/stores.js";
import { healthStatus, holdStages, withCloudStage, type CloudStage } from "./support/stage.js";

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

              const removed = await a.remove();
              expect(removed.status, `remove of A:\n${removed.output.slice(-2000)}`).toBe(0);

              // Nothing of A remains (its log entries may).
              expect(await listStageResources({ target: t, app: a.app, stage: a.stage }), "resources of the removed stage").toEqual([]);
              await waitFor(async () => ((await servesApp(anonA)) ? undefined : true), { what: "the removed stage's origin to stop serving the app", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 2_000 });

              // B is intact.
              expect(await stageResourceDetails(b), "B's resources").toEqual(beforeB);
              expect(await hooks.secretLocations(b), "B's secret locations").toEqual(secretsB);
              expect(anonB.expectStatus(await anonB.get("/api/ref/secret"), 200).json(), "B's secret value").toEqual({ sha256: sha256(valueB) });
              expect(userB.expectStatus(await userB.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json(), "B's data").toEqual({ value: "B" });
              expect(await healthStatus(anonB), "B's health").toBe(204);
              expect(await hooks.listLogKeys(keyB.slice(0, keyB.lastIndexOf("/") + 1)), "B's log entry").toContain(keyB);

              // The shared resources are intact.
              expect(await sharedResources(), "shared log bucket, state home and workers.dev subdomain").toEqual(shared);
            }),
          ),
        );
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
