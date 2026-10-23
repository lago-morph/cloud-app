/**
 * COMPL-AC-004 (compliance.md §4): every test stage a cloud run creates is named `test-`
 * followed by a random run ID of the specified length and alphabet, and two runs' IDs differ.
 * After a cloud run that is interrupted mid-way, the next cleanup removes the stages, or the
 * evidence lists them as leftovers. A stage whose R2 API token is deliberately left behind is
 * reported with that token as a leftover. Cleanup never removes `prodcheck`.
 *
 * Clauses (readings in D-T.md):
 * 1. Naming (no cloud call, no D1): the specified form is `test-` + (PAR-291 − 5) characters of
 *    lowercase letters and digits (compliance.md "Test stages"; read from parameters.md, not from
 *    the code). Checked for this run's stage, for the driver's own generator
 *    (`testStageName(newRunId())`, which the driver calls for its stage) and the further-stage
 *    generator (`newTestStage()`), each called twice (all distinct), and for the stages of every
 *    committed Cloudflare evidence record (all distinct across runs).
 * 2. Interrupted run, then the token left behind (D1: deploys one stage). A further stage S is
 *    deployed and listed in a pending-stage list, as a run interrupted after its deploy leaves
 *    it. The driver (`runCompliance`, real Cloudflare stage operations through the CLI and its
 *    real leftover check; the test runners themselves are stubbed, so no tests run inside the
 *    test) then runs once: afterwards S has nothing left (independent probe), or every resource
 *    still present is named in the record's leftovers. Then S's R2 API token is put back under
 *    its exact name and policies (a token left behind by its stage), and a second driver cleanup
 *    whose removal leaves the token deliberately in place must list that token's ID among the
 *    record's leftovers. The token is deleted afterwards.
 * 3. `prodcheck` (no cloud call): with `prodcheck` in the pending list, the driver's cleanup
 *    never calls `remove` (nor the leftover check) for it.
 *
 * Cloud usage (estimate, D-T.md): clause 2 deploys and removes one stage (≈ 50 D1 rows written,
 * a few read) and makes ≈ 15 Cloudflare API requests (probes ×3, token get/create/delete).
 * Clauses 1 and 3 make no cloud request.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newRunId, testStageName, type EvidencePaths, type WriteEvidenceInput } from "../../../../packages/framework/src/evidence/public.js";
import { newTestStage, tag, target } from "../../harness/index.js";
import { parseArgs } from "../../harness/args.js";
import { runCompliance, type CloudStageOps, type DriverDeps } from "../../harness/driver.js";
import { nodeDeps, pendingStageStore } from "../../harness/node-deps.js";
import { accountId, cfApi, cfOk } from "../_cloud/api.js";
import { listStageResources, stageResourceDetails } from "../_cloud/stage-resources.js";
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
  const real = nodeDeps(REPO_ROOT);
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
  await runCompliance(parseArgs(argv), argv, deps);
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
      const stages = files
        .map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { stage?: string; command?: string }))
        .filter((r) => !(r.command ?? "").includes("--base-url"))
        .map((r) => r.stage)
        .filter((s): s is string => s !== undefined);
      for (const s of stages) expect(s, "a recorded run's stage").toMatch(form);
      expect(new Set(stages).size, "recorded runs' stages are distinct").toBe(stages.length);
    });

    it(
      tag("COMPL-AC-004", "after an interrupted run the next cleanup removes its stage or lists it as leftovers; a stage whose R2 API token is left behind is reported with that token"),
      async () => {
        const t = target().target;
        if (t !== "cloudflare") throw new Error(`no cleanup check for target ${t}`);
        const scratch = mkdtempSync(join(tmpdir(), "d-t1-compl004-"));
        let putBack: string | undefined;
        try {
          await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: uniqueValue("dt1compl004") }, databases: 1 }, async (stage) => {
            await stage.deployReady();
            const ref = { app: stage.app, stage: stage.stage };
            const before = await stageResourceDetails(ref);
            expect(before.tokens.length, "the deployed stage has one R2 API token").toBe(1);
            const token = before.tokens[0] ?? { id: "", name: "" };
            const detail = await cfOk<{ name: string; policies: readonly { effect: string; permission_groups: readonly { id: string }[]; resources: Record<string, string> }[] }>(
              "reading the stage's R2 API token",
              "GET",
              `/accounts/${accountId()}/tokens/${token.id}`,
            );

            // 1. The run that deployed the stage was interrupted: the stage is still pending.
            const pending = join(scratch, "pending-interrupted.json");
            pendingStageStore(pending).add(t, stage.stage);
            const first = await driverCleanup(t, pending, nodeDeps(REPO_ROOT).cloud(t));
            const remaining = await listStageResources({ target: t, ...ref });
            // When the cleanup left nothing, the stage is gone: withCloudStage's finally need not remove it again.
            stage.removedElsewhere({ command: "the driver's cleanup (COMPL-AC-004)", status: 0, output: first.log.join("\n") }, remaining);
            const unreported = remaining.filter((r) => !first.leftovers.some((l) => l.includes(r.slice(r.lastIndexOf(" ") + 1))));
            expect(unreported, `resources still present but not in the record's leftovers (${first.leftovers.join("; ") || "none"})`).toEqual([]);

            // 2. The stage's R2 API token is left behind: put it back under its exact name and policies.
            const created = await cfOk<{ id: string }>("putting back the stage's R2 API token", "POST", `/accounts/${accountId()}/tokens`, {
              name: detail.name,
              policies: detail.policies.map((p) => ({ effect: p.effect, permission_groups: p.permission_groups.map((g) => ({ id: g.id })), resources: p.resources })),
            });
            putBack = created.id;
            const real = nodeDeps(REPO_ROOT).cloud(t);
            const keepToken: CloudStageOps = {
              deploy: () => Promise.reject(new Error("no deploy in a cleanup check")),
              remove: () => Promise.resolve("removal skipped by COMPL-AC-004: the stage's R2 API token is deliberately left behind\n"),
              listStageResources: (s) => real.listStageResources(s),
            };
            const pendingToken = join(scratch, "pending-token.json");
            pendingStageStore(pendingToken).add(t, stage.stage);
            const second = await driverCleanup(t, pendingToken, keepToken);
            expect(second.leftovers.filter((l) => l.includes(created.id)), `the record's leftovers (${second.leftovers.join("; ") || "none"}) name the left-behind token`).not.toEqual([]);
          });
        } finally {
          // The stage's removal may already have deleted it (it carries the stage's token name): 404 is fine.
          if (putBack !== undefined) {
            const r = await cfApi("DELETE", `/accounts/${accountId()}/tokens/${putBack}`);
            if (r.status !== 200 && r.status !== 404) process.stderr.write(`[d-t1] deleting the put-back R2 API token ${putBack} failed with HTTP ${String(r.status)}; delete it by hand\n`);
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
