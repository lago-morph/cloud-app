// AWS cloud test hooks (G-T1): call counting and cap, region and account, error descriptions, and
// the network guard. No network: every client is an aws-sdk-client-mock mock.
import { GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { describe, expect, it } from "vitest";
import { PrerequisiteMissingError } from "../../../harness/index.js";
import { awsAccountId, awsCall, awsCallCount, awsClients, awsFailure, awsRegion, DEFAULT_MAX_AWS_CALLS, maxAwsCalls } from "./api.js";
import { ACCOUNT, expectNoAwsTraffic, REGION, sdkError, STAGE, useAwsMocks } from "./hooks.test-support.js";
import { stageSecretLocations } from "./secrets.js";

const t = useAwsMocks();

describe("AWS hooks: usage is counted and capped", () => {
  it("counts every call and refuses calls beyond the cap", async () => {
    process.env.COMPLIANCE_AWS_MAX_CALLS = "2";
    let sent = 0;
    const send = (): Promise<number> => Promise.resolve(++sent);
    await awsCall("one", send);
    await awsCall("two", send);
    await expect(awsCall("three", send)).rejects.toThrow(/three: refused, this process already made 2 AWS API calls \(cap 2, COMPLIANCE_AWS_MAX_CALLS\)/);
    expect(sent).toBe(2);
    expect(awsCallCount()).toBe(2);
    expectNoAwsTraffic(t.guard());
  });

  it("defaults the cap to 500 and rejects a malformed override", () => {
    expect(maxAwsCalls({})).toBe(DEFAULT_MAX_AWS_CALLS);
    expect(DEFAULT_MAX_AWS_CALLS).toBe(500);
    expect(() => maxAwsCalls({ COMPLIANCE_AWS_MAX_CALLS: "0" })).toThrow(/not a positive integer/);
    expect(() => maxAwsCalls({ COMPLIANCE_AWS_MAX_CALLS: "x" })).toThrow(/not a positive integer/);
  });

  it("counts a hook's SDK sends (one listing page = one call)", async () => {
    t.mocks().ssm.on(GetParametersByPathCommand).resolves({ Parameters: [] });
    await stageSecretLocations(STAGE);
    // GetCallerIdentity is not needed for SSM listings: only the one listing call is counted.
    expect(awsCallCount()).toBe(1);
  });
});

describe("AWS hooks: region and account", () => {
  it("takes the region from AWS_REGION, then AWS_DEFAULT_REGION, and reports a missing one as a prerequisite", () => {
    expect(awsRegion({ AWS_REGION: "eu-central-1" })).toBe("eu-central-1");
    expect(awsRegion({ AWS_DEFAULT_REGION: "us-west-2" })).toBe("us-west-2");
    expect(() => awsRegion({})).toThrow(PrerequisiteMissingError);
    expect(() => awsRegion({ AWS_REGION: "nowhere" })).toThrow(/not an AWS region name/);
  });

  it("creates every client in the account region (tagging also in us-east-1) with the proxy-aware handler", async () => {
    const c = awsClients();
    expect(await c.ssm.config.region()).toBe(REGION);
    expect(await c.iam.config.region()).toBe(REGION);
    expect(await c.taggingGlobal.config.region()).toBe("us-east-1");
    expect(awsClients()).toBe(c);
  });

  it("reads the account ID once per process from STS", async () => {
    expect(await awsAccountId()).toBe(ACCOUNT);
    expect(await awsAccountId()).toBe(ACCOUNT);
    expect(t.mocks().sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);
  });

  it("rejects an identity without a 12-digit account and retries after a failure", async () => {
    t.mocks().sts.on(GetCallerIdentityCommand).rejectsOnce(sdkError("ExpiredToken", 403)).resolves({ Account: "nope" });
    await expect(awsAccountId()).rejects.toThrow("reading the caller identity (STS GetCallerIdentity) failed: ExpiredToken (HTTP 403)");
    await expect(awsAccountId()).rejects.toThrow(/no 12-digit account ID/);
  });

  it("describes a failure by error name and status only, never the SDK message", () => {
    const e = awsFailure("doing x", Object.assign(sdkError("AccessDenied", 403), { message: "secret detail arn:aws:iam::123456789012:role/r" }));
    expect(e.message).toBe("doing x failed: AccessDenied (HTTP 403)");
  });
});

describe("AWS hooks: the network guard", () => {
  it("refuses an unmocked client's request to amazonaws.com", async () => {
    t.mocks().ssm.restore();
    await expect(stageSecretLocations(STAGE)).rejects.toThrow(/listing SSM parameters under \/reference\/test-abc123def456ghi\/secrets\/ failed/);
    const attempts = t.guard().attempts.splice(0);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((h) => h === `ssm.${REGION}.amazonaws.com`)).toBe(true);
    expectNoAwsTraffic(t.guard());
  });
});
