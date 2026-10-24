/**
 * AWS-AC-002 (aws.md §4; AWS-REQ-002): "The stage contains no NAT gateway and no VPC-attached
 * Lambda."
 *
 * Runs against the run's stage. Reading: "no NAT gateway" = the stage's network (the account's
 * shared VPC, DEC-0074) and the stage's tagged resources hold no NAT gateway in any state but
 * `deleted`; "no VPC-attached Lambda" = every Lambda function of the stage (at least the HTTP
 * Lambda) has no VPC subnets and no VPC ID. Both are read through the AWS cloud hooks
 * (`awsHooks`): `DescribeNatGateways` and `GetFunctionConfiguration` (plan-aws.md §2).
 *
 * Cloud usage: a few read-only AWS API requests (EC2, Lambda, tagging); no HTTP requests to the
 * stage; no database rows.
 */
import { describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import { runDeployment } from "../core/support/repo.js";
import { awsHooks } from "./support.js";

if (target().target === "aws") {
  describe("AWS-AC-002 no NAT, no VPC-attached Lambda (aws)", () => {
    it(tag("AWS-AC-002", "the stage contains no NAT gateway and none of its Lambda functions is attached to a VPC"), async () => {
      const hooks = await awsHooks("AWS-AC-002");
      const run = runDeployment();
      const stage = { app: run.app, stage: run.stage };

      const nats = (await hooks.stageNatGateways(stage)).filter((n) => n.state !== "deleted");
      expect(nats.map((n) => `${n.id} (${n.vpcId}, ${n.state})`), "NAT gateways in the stage's network").toEqual([]);

      const functions = await hooks.stageFunctions(stage);
      expect(functions.length, "the stage has at least its HTTP Lambda").toBeGreaterThan(0);
      const attached = functions.filter((f) => f.vpcSubnetIds.length > 0 || (f.vpcId !== undefined && f.vpcId !== ""));
      expect(attached.map((f) => `${f.name} (VPC ${f.vpcId ?? "?"}, subnets ${f.vpcSubnetIds.join(",")})`), "VPC-attached Lambda functions").toEqual([]);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on other targets.
  describe("AWS-AC-002 (aws only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
