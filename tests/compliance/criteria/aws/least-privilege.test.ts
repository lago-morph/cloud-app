/**
 * AWS-AC-003 (aws.md §4; AWS-REQ-003): "IAM policy simulation against the stage role shows that
 * the Lambda role cannot read another stage's bucket, secrets, or database, and cannot read the
 * log bucket."
 *
 * Runs against the run's stage; deploys no further stage. Reading: "the stage role" = the HTTP
 * Lambda's execution role, simulated with `iam:SimulatePrincipalPolicy` through the AWS cloud
 * hooks. "Another stage" = the identifiers of the same resources for a fresh `test-<random>`
 * stage of the app (`otherStageArn`): IAM evaluates the role's policy against resource ARNs, so
 * a role scoped to its own stage's exact ARNs denies them, and a wildcard such as
 * `reference-test-*` would allow them and fail this test. Every denied case must come back as a
 * deny (implicit or explicit). As a positive control, the role's access to its own bucket,
 * secret, database, credentials and its log `PutObject` must come back allowed, so a simulation
 * that denies everything (wrong principal, missing permission) cannot pass.
 *
 * Cloud usage: one stage-resource probe and about 4 SimulatePrincipalPolicy requests; no HTTP
 * requests to the stage; no database rows.
 */
import { describe, expect, it } from "vitest";
import { newTestStage, tag, target } from "../../harness/index.js";
import { runDeployment } from "../core/support/repo.js";
import { awsHooks, simulationCases, type AwsCloudHooks, type SimulationCase, type SimulationResult } from "./support.js";

async function simulate(hooks: AwsCloudHooks, roleArn: string, c: SimulationCase): Promise<SimulationResult[]> {
  const results = [...(await hooks.simulatePrincipalPolicy(roleArn, c.actions, c.resources))];
  for (const action of c.actions) {
    for (const resource of c.resources) {
      expect(results.some((r) => r.action === action && r.resource === resource), `${c.what}: the simulation evaluated ${action} on ${resource}`).toBe(true);
    }
  }
  return results;
}

const show = (r: SimulationResult): string => `${r.action} on ${r.resource}: ${r.decision}`;

if (target().target === "aws") {
  describe("AWS-AC-003 least privilege (aws)", () => {
    it(tag("AWS-AC-003", "IAM simulation: the stage role cannot read another stage's bucket, secrets or database, nor read the log bucket"), async () => {
      const hooks = await awsHooks("AWS-AC-003");
      const run = runDeployment();
      const resources = await hooks.stageResources({ app: run.app, stage: run.stage });
      const other = newTestStage();
      expect(other, "the other stage differs from the run's stage").not.toBe(run.stage);
      const cases = simulationCases(resources, run.app, run.stage, other);

      for (const c of cases.allowed) {
        const results = await simulate(hooks, resources.roleArn, c);
        expect(results.filter((r) => r.decision !== "allowed").map(show), `positive control, ${c.what}: allowed`).toEqual([]);
      }
      for (const c of cases.denied) {
        const results = await simulate(hooks, resources.roleArn, c);
        expect(results.filter((r) => r.decision === "allowed").map(show), `${c.what}: denied`).toEqual([]);
      }
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on other targets.
  describe("AWS-AC-003 (aws only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
