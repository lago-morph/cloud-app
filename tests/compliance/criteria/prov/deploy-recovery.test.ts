/**
 * COMPL-AC-008 (compliance.md §4; milestone): on each cloud, a deploy stopped at the abort point
 * after the database copy, and one stopped after the code deploy, are each followed by a
 * successful re-run that leaves the stage with one database and the app answering.
 *
 * For each abort point, one further `test-<random>` stage of apps/reference (one stage at a
 * time) is deployed at version 1, then deployed at version 2 (the `v2` overlay, ROUTES.md: a
 * schema change, so the deploy copies the database, MIG-REQ-006) with the runner-only abort
 * point set (compliance.md "Deploy recovery"; DEC-0269 `abortAt`). That deploy must exit
 * non-zero. Its re-run without the abort point must exit 0 and leave exactly one database of the
 * stage (PROV-REQ-002's exact pattern) and the app answering: health 204 and `schema-version`
 * v2.
 *
 * The CLI form of the abort point is D-05's (DEC-0269 wires it "only for the compliance
 * runner"). Assumption (D-T.md): the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT` with
 * value `after-copy` or `after-code`. A deploy that ignores it and succeeds fails this test with
 * a message saying so.
 *
 * Passes (DEC-0318): a schema-changing deploy holds two D1 databases, so this runs in a
 * milestone pass with no run stage (the cap is checked first).
 *
 * Cloud usage (estimate, D-T.md): 2 stages × (3 deploys + 1 remove); D1 ≈ 300 rows written in
 * all (first deploys' migrations and records ≈ 50 each, database copies and v2 migrations
 * ≈ 25 each, up to 4 copies), ≈ 100 rows read; ≈ 10 Cloudflare API requests by the probes. No
 * data fixture is loaded. Needs D1 (blocked while DEC-0317 holds).
 */
import { describe, expect, it } from "vitest";
import { CLOUD_WAITS, tag, waitFor } from "../../harness/index.js";
import { stageDatabases } from "../_cloud/stage-resources.js";
import { isLocal, REFERENCE_DIR, uniqueValue } from "../core/support/repo.js";
import { healthStatus, tail, withCloudStage } from "./support/stage.js";

/** Assumed CLI form of the runner-only abort point (D-05). */
const ABORT_ENV = "PROTOTYPE_FRAMEWORK_ABORT_AT";

type AbortPoint = "after-copy" | "after-code";
const POINTS: readonly AbortPoint[] = ["after-copy", "after-code"];

if (!isLocal()) {
  describe("COMPL-AC-008 deploy recovery (cloud, milestone)", () => {
    for (const point of POINTS) {
      it(
        tag("COMPL-AC-008", `a deploy stopped at the abort point ${point} is followed by a successful re-run that leaves one database and the app answering`),
        async () => {
          await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: uniqueValue("dt1compl008") }, databases: 2 }, async (stage) => {
            await stage.deployReady();
            const ref = { app: stage.app, stage: stage.stage };
            expect((await stageDatabases(ref)).length, "databases after the version 1 deploy").toBe(1);

            stage.applyOverlay("v2");
            const aborted = await stage.deploy({ env: { [ABORT_ENV]: point } });
            expect(aborted.status, `the deploy with abort point ${point} (${ABORT_ENV}=${point}) must stop with failure status; if it succeeded, the runner-only abort point is not wired this way:\n${tail(aborted.output)}`).not.toBe(0);

            const rerun = await stage.deploy();
            expect(rerun.status, `the re-run after the ${point} abort:\n${tail(rerun.output)}`).toBe(0);
            expect((await stageDatabases(ref)).map((d) => d.name).length, "the stage's databases after the re-run").toBe(1);
            const c = stage.client();
            await waitFor(async () => ((await healthStatus(c)) === 204 ? true : undefined), { what: "the app answering after the re-run", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1_000 });
            expect(c.expectStatus(await c.get("/api/ref/schema-version"), 200).json(), "the app answers at version 2").toEqual({ version: "v2" });
          });
        },
        60 * 60_000,
      );
    }
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("COMPL-AC-008 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
