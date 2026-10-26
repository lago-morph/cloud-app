/**
 * COMPL-AC-004 (compliance.md §4): every test stage a cloud run creates is named `test-`
 * followed by a random run ID of the specified length and alphabet, and two runs' IDs differ.
 * After a cloud run that is interrupted mid-way, the next cleanup removes the stages, or the
 * evidence lists them as leftovers. A stage whose R2 bucket is deliberately left behind is
 * reported with that bucket as a leftover (DEC-0550: stages no longer have their own R2 API
 * token). Cleanup never removes `prodcheck`.
 *
 * Clauses (readings in D-T.md):
 * 1. Naming (no cloud call, no D1): the specified form is `test-` + (PAR-291 − 5) characters of
 *    lowercase letters and digits (compliance.md "Test stages"; read from parameters.md, not from
 *    the code). Checked for this run's stage, for the driver's own generator
 *    (`testStageName(newRunId())`, which the driver calls for its stage) and the further-stage
 *    generator (`newTestStage()`), each called twice (all distinct), and for the stages of every
 *    committed Cloudflare evidence record (all distinct across runs).
 * 2. Interrupted run, then the bucket left behind (D1: deploys one stage). A further stage S is
 *    deployed and listed in a pending-stage list, as a run interrupted after its deploy leaves
 *    it. The driver (`runCompliance`, real Cloudflare stage operations through the CLI and its
 *    real leftover check; the test runners themselves are stubbed, so no tests run inside the
 *    test) then runs once: afterwards S has nothing left (independent probe), or every resource
 *    still present is named in the record's leftovers. Then S's R2 bucket is created again under
 *    its exact name `<app>-<stage>-files` (a bucket left behind by its stage), and a second
 *    driver cleanup whose removal leaves the bucket deliberately in place must list that bucket
 *    among the record's leftovers. The bucket is deleted afterwards.
 * 3. `prodcheck` (no cloud call): with `prodcheck` in the pending list, the driver's cleanup
 *    never calls `remove` (nor the leftover check) for it.
 *
 * Cloud usage (estimate, D-T.md): clause 2 deploys and removes one stage (≈ 50 D1 rows written,
 * a few read) and makes ≈ 15 Cloudflare API requests (probes ×3, bucket create/delete).
 * Clauses 1 and 3 make no cloud request.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newRunId, testStageName, type EvidencePaths, type WriteEvidenceInput } from "../../../../packages/framework/src/evidence/public.js";
import { newTestStage, tag, target } from "../../harness/index.js";
import { parseArgs } from "../../harness/args.js";
import { isDriverCommand, runCompliance, type CloudStageOps, type DriverDeps } from "../../harness/driver.js";
import { nodeDeps, pendingStageStore } from "../../harness/node-deps.js";
import { accountId, cfApi, cfOk } from "../_cloud/api.js";
import { listStageResources, stageBucketName } from "../_cloud/stage-resources.js";
import { isLocal, parameterNumber, REFERENCE_DIR, REPO_ROOT, uniqueValue } from "../core/support/repo.js";
import { withCloudStage } from "./support/stage.js";

function stageForm(): RegExp {
  const length = parameterNumber("PAR-291") - "test-".length;
  return new RegExp(`^test-[a-z0-9]{${String(length)}}$`);
}

interface DriverRun {
  readonly leftovers: readonly string[];
  readonly log: readonly string[];
}

/**
 * Runs the driver once on `target` with an existing base URL (so it deploys no run stage of its
 * own), the given pending list and cloud operations; the test runners are stubbed and the
 * record is captured, not written.
 */
async function driverCleanup(targetName: "cloudflare", pendingFile: string, cloud: CloudStageOps): Promise<DriverRun> {
  // Without `cloudAccount` (DriverDeps: absent means no plan read and no token created, deleted or checked).
  const { cloudAccount: _noAccount, ...real } = nodeDeps(REPO_ROOT);
  const log: string[] = [];
  let leftovers: readonly string[] = [];
  const deps: DriverDeps = {
    ...real,
    git: { commit: () => "0000000000000000000000000000000000000000", changedTrackedFiles: () => [] },
    run: () => Promise.resolve({ status: 0, output: "" }),
    readFile: (p) => (p.endsWith("vitest.json") ? '{"testResults":[]}' : p.endsWith("playwright.json") ? '{"suites":[]}' : undefined),
    startLocal: () => Promise.reject(new Error("no local session in a cloud cleanup check")),
    cloud: () => cloud,
    pendingStages: pendingStageStore(pendingFile),
    writeEvidence: (input: WriteEvidenceInput): EvidencePaths => {
      leftovers = input.record.leftovers ?? [];
      return { recordPath: "(captured by COMPL-AC-004)", rawDir: "(captured)" };
    },
    log: (line) => log.push(line),
  };
  const argv = ["--target", targetName, "--base-url", "https://cleanup-check.invalid", "--only", "CF-AC-001"];
  // The nested driver gets no cloud account: its clauses need no test token, so it can never list,
  // create or delete the account's tokens (the live run's PROV-AC-002 token among them).
  expect(deps.cloudAccount, "the nested driver's cloud account").toBeUndefined();
  await runCompliance(parseArgs(argv), argv, deps);
  expect(log.filter((l) => l.includes("test token")), "token operations of the nested driver").toEqual([]);
  return { leftovers, log };
}

if (!isLocal()) {
  describe("COMPL-AC-004 test stages and cleanup (cloud)", () => {
    it(tag("COMPL-AC-004", "test stages are test- plus a random run ID of the specified length and alphabet, and run IDs differ"), () => {
      const form = stageForm();
      const run = target().stage;
      if (run !== undefined) expect(run, "this run's stage").toMatch(form);
      const generated = [testStageName(newRunId()), testStageName(newRunId()), newTestStage(), newTestStage()];
      for (const s of generated) expect(s, "a generated test stage").toMatch(form);
      expect(new Set(generated).size, "generated stages are distinct").toBe(generated.length);

      const dir = join(REPO_ROOT, "validation", "cloudflare");
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      } catch {
        // no committed Cloudflare evidence yet
      }
      const records = files.map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as { stage?: string; command?: string }) }));
      // Only records the compliance driver wrote (`isDriverCommand`, the form driver.ts writes and its
      // unit test pins) are cloud runs that may have created a test stage, and a run given --base-url
      // created none (COMPL-AC-004). Other records, such as `check-login` on `prodcheck` (PWD-AC-009,
      // COMPL-AC-006), are not test stages: COMPL-REQ-004 exempts `prodcheck`.
      const driverRecords = records.filter((r) => isDriverCommand(r.command));
      // Not vacuous: when Cloudflare evidence is committed, the driver's records are among it.
      if (records.length > 0) expect(driverRecords.map((r) => r.file), `driver records among ${records.map((r) => `${r.file} (${r.command ?? "no command"})`).join(", ")}`).not.toEqual([]);
      const stageRuns = driverRecords.filter((r) => !(r.command ?? "").includes("--base-url"));
      for (const r of stageRuns) expect(r.stage, `${r.file}: a cloud driver run without --base-url records its run stage`).toBeDefined();
      const stages = stageRuns.map((r) => r.stage).filter((s): s is string => s !== undefined);
      for (const s of stages) expect(s, "a recorded run's stage").toMatch(form);
      expect(new Set(stages).size, "recorded runs' stages are distinct").toBe(stages.length);
    });

    it(
      tag("COMPL-AC-004", "after an interrupted run the next cleanup removes its stage or lists it as leftovers; a stage whose R2 bucket is left behind is reported with that bucket"),
      async () => {
        const t = target().target;
        if (t !== "cloudflare") throw new Error(`no cleanup check for target ${t}`);
        const scratch = mkdtempSync(join(tmpdir(), "d-t1-compl004-"));
        let putBack: string | undefined;
        try {
          await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: uniqueValue("dt1compl004") }, databases: 1 }, async (stage) => {
            await stage.deployReady();
            const ref = { app: stage.app, stage: stage.stage };
            const bucket = stageBucketName(ref);

            // 1. The run that deployed the stage was interrupted: the stage is still pending.
            const pending = join(scratch, "pending-interrupted.json");
            pendingStageStore(pending).add(t, stage.stage);
            const first = await driverCleanup(t, pending, nodeDeps(REPO_ROOT).cloud(t));
            const remaining = await listStageResources({ target: t, ...ref });
            // When the cleanup left nothing, the stage is gone: withCloudStage's finally need not remove it again.
            stage.removedElsewhere({ command: "the driver's cleanup (COMPL-AC-004)", status: 0, output: first.log.join("\n") }, remaining);
            const unreported = remaining.filter((r) => !first.leftovers.some((l) => l.includes(r.slice(r.lastIndexOf(" ") + 1))));
            expect(unreported, `resources still present but not in the record's leftovers (${first.leftovers.join("; ") || "none"})`).toEqual([]);

            // 2. The stage's R2 bucket is left behind: create it again under its exact name.
            await cfOk("putting back the stage's R2 bucket", "POST", `/accounts/${accountId()}/r2/buckets`, { name: bucket });
            putBack = bucket;
            const real = nodeDeps(REPO_ROOT).cloud(t);
            const keepBucket: CloudStageOps = {
              deploy: () => Promise.reject(new Error("no deploy in a cleanup check")),
              remove: () => Promise.resolve("removal skipped by COMPL-AC-004: the stage's R2 bucket is deliberately left behind\n"),
              listStageResources: (s) => real.listStageResources(s),
            };
            const pendingBucket = join(scratch, "pending-bucket.json");
            pendingStageStore(pendingBucket).add(t, stage.stage);
            const second = await driverCleanup(t, pendingBucket, keepBucket);
            expect(second.leftovers.filter((l) => l.includes(bucket)), `the record's leftovers (${second.leftovers.join("; ") || "none"}) name the left-behind bucket`).not.toEqual([]);
          });
        } finally {
          // The stage's removal may already have deleted it (it carries the stage's bucket name): 404 is fine.
          if (putBack !== undefined) {
            const r = await cfApi("DELETE", `/accounts/${accountId()}/r2/buckets/${encodeURIComponent(putBack)}`);
            if (r.status !== 200 && r.status !== 404) process.stderr.write(`[d-t1] deleting the put-back R2 bucket ${putBack} failed with HTTP ${String(r.status)}; delete it by hand\n`);
          }
          rmSync(scratch, { recursive: true, force: true });
        }
      },
      45 * 60_000,
    );

    it(tag("COMPL-AC-004", "cleanup never removes prodcheck"), async () => {
      const scratch = mkdtempSync(join(tmpdir(), "d-t1-compl004-"));
      try {
        const pending = join(scratch, "pending.json");
        pendingStageStore(pending).add("cloudflare", "prodcheck");
        const calls: string[] = [];
        const recording: CloudStageOps = {
          deploy: (s) => Promise.reject(new Error(`unexpected deploy of ${s}`)),
          remove: (s) => (calls.push(`remove ${s}`), Promise.resolve("")),
          listStageResources: (s) => (calls.push(`list ${s}`), Promise.resolve([])),
        };
        await driverCleanup("cloudflare", pending, recording);
        expect(calls.filter((c) => c.endsWith(" prodcheck")), "operations the cleanup ran on prodcheck").toEqual([]);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("COMPL-AC-004 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
