/**
 * PROV-AC-006 (provisioning.md §4; milestone), Cloudflare part (plan §11 Q2): stages deploy
 * "from a clean machine with no local CLI state". The region part is AWS (DEC-0075) and is
 * recorded not-run by the driver ("AWS phase not started").
 *
 * A "machine" here is a fresh scratch copy of apps/reference (committed files only: no
 * `.framework/`, `.wrangler/` or other generated state) run with a fresh, empty HOME and XDG
 * directories (no wrangler, SST or Pulumi state or configuration). Sequence:
 * 1. machine 1 deploys a new `test-<random>` stage; a user writes one KV value;
 * 2. machine 2, which never saw the stage, deploys the same stage again: it succeeds, the stage
 *    still has exactly one database (the same one), and the KV value written through machine 1
 *    is still there, so all deploy state came from the cloud;
 * 3. machine 3 removes the stage: `remove` exits 0 and nothing of the stage is left.
 *
 * Cloud usage (estimate, D-T.md): 2 deploys (the second applies no migration) and 1 remove;
 * D1 ≈ 50 rows written by the first deploy's migrations and records, 1 KV row, ≈ 5 rows read;
 * ≈ 10 Cloudflare API requests by the probes. Needs D1 (blocked while DEC-0317 holds). Holds 1
 * D1 database.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import { listStageResources, stageDatabases } from "../_cloud/stage-resources.js";
import { scratchCopy } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR, uniqueValue } from "../core/support/repo.js";
import { freshHome, healthStatus, runCli, tail, withCloudStage } from "./support/stage.js";

if (!isLocal()) {
  describe("PROV-AC-006 deploy from a clean machine (cloud, milestone)", () => {
    it(
      tag("PROV-AC-006", "Cloudflare part: a stage deploys again and is removed from clean machines with no local CLI state"),
      async () => {
        const t = target().target;
        const home1 = freshHome("m1");
        const home2 = freshHome("m2");
        const home3 = freshHome("m3");
        try {
          await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: uniqueValue("dt1prov006") }, databases: 1, env: home1.env }, async (stage) => {
            await stage.deployReady();
            const ref = { app: stage.app, stage: stage.stage };
            const dbs = await stageDatabases(ref);
            expect(dbs.length, "databases after the first deploy").toBe(1);
            const key = `dt1:prov006:${randomBytes(6).toString("hex")}`;
            const user = await stage.client().as("user");
            user.expectStatus(await user.request("PUT", "/api/kv/value", { json: { key, value: "from machine 1" } }), 204);

            const machine2 = await scratchCopy(REFERENCE_DIR, "d-t1-prov006-m2");
            try {
              const again = await runCli(["deploy", "--target", t, "--stage", stage.stage], { cwd: machine2.dir, env: home2.env });
              expect(again.status, `deploy from a clean machine:\n${tail(again.output)}`).toBe(0);
            } finally {
              await machine2.remove();
            }
            expect(await stageDatabases(ref), "the same single database after the deploy from the clean machine").toEqual(dbs);
            expect(await healthStatus(stage.client()), "health after the deploy from the clean machine").toBe(204);
            const user2 = await stage.client().as("user");
            expect(user2.expectStatus(await user2.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json(), "data written before the deploy from the clean machine").toEqual({ value: "from machine 1" });

            const machine3 = await scratchCopy(REFERENCE_DIR, "d-t1-prov006-m3");
            try {
              const removed = await runCli(["remove", "--target", t, "--stage", stage.stage], { cwd: machine3.dir, env: home3.env });
              expect(removed.status, `remove from a clean machine:\n${tail(removed.output)}`).toBe(0);
            } finally {
              await machine3.remove();
            }
            expect(await listStageResources({ target: t, ...ref }), "resources left after the remove from a clean machine").toEqual([]);
          });
        } finally {
          home1.remove();
          home2.remove();
          home3.remove();
        }
      },
      60 * 60_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PROV-AC-006 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
