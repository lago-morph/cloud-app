// AWS cloud test hooks (G-T1): IAM simulation on the stage role (AWS-AC-003, SEC-AC-003) and the
// stage-scoped log deny (LOG-AC-001 AWS case). No network: aws-sdk-client-mock.
import { DeleteRolePolicyCommand, PutRolePolicyCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { describe, expect, it } from "vitest";
import { ACCOUNT, expectNoAwsTraffic, sdkError, STAGE, useAwsMocks } from "./hooks.test-support.js";
import { addLogDeny, allowedPairs, logDenyPolicyDocument, removeLogDeny, roleNameFromArn, simulatePrincipal, simulateStageRole, stageRoleArn, withLogDeny } from "./iam.js";

const t = useAwsMocks();
const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/reference-test-abc123def456ghi-HttpRole-1a2b3c4d`;
const ROLE = "reference-test-abc123def456ghi-HttpRole-1a2b3c4d";
const LOG_PREFIX_ARN = `arn:aws:s3:::prototype-logs-${ACCOUNT}/reference/test-abc123def456ghi/`;
const noWait = { sleep: () => Promise.resolve(), intervalMs: 1, propagationMs: 0 };

function withRole(): void {
  t.mocks().lambda.on(GetFunctionConfigurationCommand, { FunctionName: "reference-test-abc123def456ghi-http" }).resolves({ Role: ROLE_ARN });
}

describe("AWS IAM hooks: the stage role", () => {
  it("is the role the stage's Function runs as", async () => {
    withRole();
    expect(await stageRoleArn(STAGE)).toBe(ROLE_ARN);
    expect(roleNameFromArn(ROLE_ARN)).toBe(ROLE);
    expect(roleNameFromArn(`arn:aws:iam::${ACCOUNT}:role/service-role/x`)).toBe("x");
    expect(() => roleNameFromArn("arn:aws:s3:::b")).toThrow(/not a role ARN/);
  });

  it("refuses a configuration without a role ARN", async () => {
    t.mocks().lambda.on(GetFunctionConfigurationCommand).resolves({});
    await expect(stageRoleArn(STAGE)).rejects.toThrow(/no role ARN/);
  });
});

describe("AWS IAM hooks: SimulatePrincipalPolicy", () => {
  it("simulates the given actions and resources against the stage role and flattens the results", async () => {
    withRole();
    const other = `arn:aws:s3:::reference-test-zzz999yyy888xxx-files-${ACCOUNT}/*`;
    t.mocks()
      .iam.on(SimulatePrincipalPolicyCommand)
      .resolvesOnce({
        EvaluationResults: [{ EvalActionName: "s3:GetObject", EvalResourceName: other, EvalDecision: "implicitDeny" }],
        IsTruncated: true,
        Marker: "p2",
      })
      .resolvesOnce({
        EvaluationResults: [
          {
            EvalActionName: "ssm:GetParameter",
            EvalDecision: "allowed",
            ResourceSpecificResults: [
              { EvalResourceName: "arn:a", EvalResourceDecision: "allowed" },
              { EvalResourceName: "arn:b", EvalResourceDecision: "explicitDeny" },
            ],
          },
        ],
      });
    const results = await simulateStageRole(STAGE, ["s3:GetObject", "ssm:GetParameter"], [other, "arn:a", "arn:b"]);
    expect(results).toEqual([
      { action: "s3:GetObject", resource: other, decision: "implicitDeny" },
      { action: "ssm:GetParameter", resource: "arn:a", decision: "allowed" },
      { action: "ssm:GetParameter", resource: "arn:b", decision: "explicitDeny" },
    ]);
    expect(allowedPairs(results)).toEqual([{ action: "ssm:GetParameter", resource: "arn:a", decision: "allowed" }]);
    const inputs = t.mocks().iam.commandCalls(SimulatePrincipalPolicyCommand).map((c) => c.args[0].input);
    expect(inputs[0]).toEqual({ PolicySourceArn: ROLE_ARN, ActionNames: ["s3:GetObject", "ssm:GetParameter"], ResourceArns: [other, "arn:a", "arn:b"], MaxItems: 100 });
    expect(inputs[1]?.Marker).toBe("p2");
    expectNoAwsTraffic(t.guard());
  });

  it("refuses wildcard or empty inputs and unknown decisions", async () => {
    await expect(simulatePrincipal(ROLE_ARN, ["s3:*"], ["arn:x"])).rejects.toThrow(/not an exact IAM action/);
    await expect(simulatePrincipal(ROLE_ARN, [], ["arn:x"])).rejects.toThrow(/at least one action/);
    t.mocks().iam.on(SimulatePrincipalPolicyCommand).resolves({ EvaluationResults: [{ EvalActionName: "s3:GetObject", EvalDecision: "maybe" as never }] });
    await expect(simulatePrincipal(ROLE_ARN, ["s3:GetObject"], ["arn:x"])).rejects.toThrow(/unexpected IAM simulation decision maybe/);
  });
});

describe("AWS IAM hooks: the log deny (LOG-AC-001)", () => {
  it("denies s3:PutObject on the stage's own log prefix only", () => {
    expect(logDenyPolicyDocument(STAGE, ACCOUNT)).toEqual({
      Version: "2012-10-17",
      Statement: [{ Sid: "ComplianceLogDeny", Effect: "Deny", Action: "s3:PutObject", Resource: `${LOG_PREFIX_ARN}*` }],
    });
    expect(() => logDenyPolicyDocument({ app: "reference", stage: "prod" }, ACCOUNT)).toThrow(/test stages only/);
  });

  it("adds the inline policy, waits until the simulation shows the deny, then removes it", async () => {
    withRole();
    t.mocks().iam.on(PutRolePolicyCommand).resolves({});
    t.mocks().iam.on(DeleteRolePolicyCommand).resolves({});
    t.mocks()
      .iam.on(SimulatePrincipalPolicyCommand)
      .resolvesOnce({ EvaluationResults: [{ EvalActionName: "s3:PutObject", EvalDecision: "allowed" }] })
      .resolvesOnce({ EvaluationResults: [{ EvalActionName: "s3:PutObject", EvalDecision: "explicitDeny" }] });
    const seen: string[] = [];
    const out = await withLogDeny(
      STAGE,
      () => {
        seen.push(`during: ${String(t.mocks().iam.commandCalls(DeleteRolePolicyCommand).length)} deletes`);
        return Promise.resolve("ok");
      },
      noWait,
    );
    expect(out).toBe("ok");
    expect(seen).toEqual(["during: 0 deletes"]);
    const put = t.mocks().iam.commandCalls(PutRolePolicyCommand).map((c) => c.args[0].input);
    expect(put).toHaveLength(1);
    expect(put[0]?.RoleName).toBe(ROLE);
    expect(put[0]?.PolicyName).toBe("compliance-log-deny-test-abc123def456ghi");
    expect(JSON.parse(put[0]?.PolicyDocument ?? "{}")).toEqual(logDenyPolicyDocument(STAGE, ACCOUNT));
    const probes = t.mocks().iam.commandCalls(SimulatePrincipalPolicyCommand).map((c) => c.args[0].input);
    expect(probes).toHaveLength(2);
    expect(probes[0]?.ResourceArns?.[0]?.startsWith(LOG_PREFIX_ARN)).toBe(true);
    expect(t.mocks().iam.commandCalls(DeleteRolePolicyCommand).map((c) => c.args[0].input)).toEqual([{ RoleName: ROLE, PolicyName: "compliance-log-deny-test-abc123def456ghi" }]);
    expectNoAwsTraffic(t.guard());
  });

  it("removes the deny when the body throws", async () => {
    withRole();
    t.mocks().iam.on(PutRolePolicyCommand).resolves({});
    t.mocks().iam.on(DeleteRolePolicyCommand).resolves({});
    t.mocks().iam.on(SimulatePrincipalPolicyCommand).resolves({ EvaluationResults: [{ EvalActionName: "s3:PutObject", EvalDecision: "explicitDeny" }] });
    await expect(withLogDeny(STAGE, () => Promise.reject(new Error("request failed")), noWait)).rejects.toThrow("request failed");
    expect(t.mocks().iam.commandCalls(DeleteRolePolicyCommand)).toHaveLength(1);
  });

  it("removes the deny and fails when IAM never reports it within the bound", async () => {
    withRole();
    t.mocks().iam.on(PutRolePolicyCommand).resolves({});
    t.mocks().iam.on(DeleteRolePolicyCommand).resolves({});
    t.mocks().iam.on(SimulatePrincipalPolicyCommand).resolves({ EvaluationResults: [{ EvalActionName: "s3:PutObject", EvalDecision: "allowed" }] });
    let clock = 0;
    const opts = { now: () => clock, sleep: (ms: number) => Promise.resolve(void (clock += ms)), intervalMs: 5_000, visibleMs: 20_000, propagationMs: 0 };
    await expect(addLogDeny(STAGE, opts)).rejects.toThrow(/timed out after 20 s waiting for IAM to report the log deny/);
    expect(t.mocks().iam.commandCalls(DeleteRolePolicyCommand)).toHaveLength(1);
  });

  it("removeLogDeny accepts an already absent policy and reports other failures", async () => {
    withRole();
    t.mocks().iam.on(DeleteRolePolicyCommand).rejectsOnce(sdkError("NoSuchEntityException", 404)).rejectsOnce(sdkError("AccessDenied", 403));
    await removeLogDeny(STAGE);
    await expect(removeLogDeny(STAGE)).rejects.toThrow(/deleting inline policy compliance-log-deny-test-abc123def456ghi of role .* failed: AccessDenied/);
  });

  it("never changes a non-test stage", async () => {
    await expect(addLogDeny({ app: "reference", stage: "prod" }, noWait)).rejects.toThrow(/test stages only/);
    expect(t.mocks().iam.commandCalls(PutRolePolicyCommand)).toHaveLength(0);
  });
});
