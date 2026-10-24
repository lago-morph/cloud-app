// AWS cloud test hooks (G-T1): the CloudHooks for AWS — SSM secrets (SEC-AC-003/005 hooks) and
// the shared log bucket through S3 (LOG-AC-002/004/005, SEC-AC-002). No network: aws-sdk-client-mock.
import { GetObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DeleteParameterCommand, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it } from "vitest";
import { cloudHooks } from "../index.js";
import { listLogEntries } from "../logs.js";
import { ACCOUNT, expectNoAwsTraffic, sdkError, STAGE, useAwsMocks } from "./hooks.test-support.js";
import { awsCloudHooks } from "./index.js";
import { listAwsLogEntries } from "./logs.js";
import { secretParameterName, stageParameterPath } from "./names.js";
import { stageParameters } from "./secrets.js";

const t = useAwsMocks();
const LOG_BUCKET = `prototype-logs-${ACCOUNT}`;
const body = (text: string) => ({ transformToString: () => Promise.resolve(text) }) as never;

describe("AWS CloudHooks: cloudHooks('aws') is the AWS implementation", () => {
  it("returns the AWS hooks for target aws", () => {
    // C-T1's CloudHooks plus G-T2's AwsCloudHooks members (G-T4).
    expect(Object.keys(cloudHooks("aws")).sort()).toEqual([
      "deleteSecret",
      "functionUrl",
      "listLogKeys",
      "logBucketExists",
      "observeCluster",
      "readLogObject",
      "secretLocations",
      "simulatePrincipalPolicy",
      "stageFunctions",
      "stageNatGateways",
      "stageResources",
    ]);
  });
});

describe("AWS CloudHooks: secrets (SSM /<app>/<stage>/secrets/<name>)", () => {
  it("names the SEC-REQ-003 location and refuses names that could widen the path", () => {
    expect(secretParameterName(STAGE, "apiKey")).toBe("/reference/test-abc123def456ghi/secrets/apiKey");
    expect(() => secretParameterName(STAGE, "../x")).toThrow(/invalid logical secret name/);
    expect(() => secretParameterName({ app: "ref-app", stage: "test-a" }, "apiKey")).toThrow(/invalid app name/);
    expect(() => stageParameterPath({ app: "reference", stage: "test/a" })).toThrow(/invalid stage name/);
  });

  it("deleteSecret deletes exactly the stage's parameter in SSM", async () => {
    t.mocks().ssm.on(DeleteParameterCommand).resolves({});
    await awsCloudHooks().deleteSecret(STAGE, "apiKey");
    expect(t.mocks().ssm.commandCalls(DeleteParameterCommand).map((c) => c.args[0].input)).toEqual([{ Name: "/reference/test-abc123def456ghi/secrets/apiKey" }]);
    expectNoAwsTraffic(t.guard());
  });

  it("deleteSecret of an absent parameter is an error naming it; other failures name the error", async () => {
    t.mocks().ssm.on(DeleteParameterCommand).rejectsOnce(sdkError("ParameterNotFound")).rejectsOnce(sdkError("AccessDeniedException", 403));
    await expect(awsCloudHooks().deleteSecret(STAGE, "apiKey")).rejects.toThrow("deleting SSM parameter /reference/test-abc123def456ghi/secrets/apiKey failed: the parameter does not exist");
    await expect(awsCloudHooks().deleteSecret(STAGE, "apiKey")).rejects.toThrow(/failed: AccessDeniedException \(HTTP 403\)/);
  });

  it("secretLocations lists names only (no decryption), across pages, sorted", async () => {
    const path = "/reference/test-abc123def456ghi/secrets/";
    t.mocks()
      .ssm.on(GetParametersByPathCommand)
      .resolvesOnce({ Parameters: [{ Name: `${path}zeta` }], NextToken: "n1" })
      .resolvesOnce({ Parameters: [{ Name: `${path}apiKey` }] });
    expect(await awsCloudHooks().secretLocations(STAGE)).toEqual([`${path}apiKey`, `${path}zeta`]);
    const inputs = t.mocks().ssm.commandCalls(GetParametersByPathCommand).map((c) => c.args[0].input);
    expect(inputs).toEqual([
      { Path: path, Recursive: false, WithDecryption: false, MaxResults: 10 },
      { Path: path, Recursive: false, WithDecryption: false, MaxResults: 10, NextToken: "n1" },
    ]);
    expectNoAwsTraffic(t.guard());
  });

  it("the stage's parameters are listed recursively under /<app>/<stage>/; an endless listing is bounded", async () => {
    t.mocks().ssm.on(GetParametersByPathCommand).resolves({ Parameters: [{ Name: "/reference/test-abc123def456ghi/x" }], NextToken: "again" });
    await expect(stageParameters(STAGE)).rejects.toThrow(/more than 20 pages/);
    expect(t.mocks().ssm.commandCalls(GetParametersByPathCommand)[0]?.args[0].input).toMatchObject({ Path: "/reference/test-abc123def456ghi/", Recursive: true });
    expect(t.mocks().ssm.commandCalls(GetParametersByPathCommand)).toHaveLength(20);
  });
});

describe("AWS CloudHooks: the shared log bucket prototype-logs-<account>", () => {
  it("logBucketExists: HeadBucket with the expected owner; 404 → false; 403 (another account's) → error", async () => {
    t.mocks().s3.on(HeadBucketCommand).resolvesOnce({}).rejectsOnce(sdkError("NotFound", 404)).rejectsOnce(sdkError("Forbidden", 403));
    expect(await awsCloudHooks().logBucketExists()).toBe(true);
    expect(await awsCloudHooks().logBucketExists()).toBe(false);
    await expect(awsCloudHooks().logBucketExists()).rejects.toThrow(`reading S3 bucket ${LOG_BUCKET} (HeadBucket, expected owner ${ACCOUNT}) failed: HTTP 403`);
    for (const c of t.mocks().s3.commandCalls(HeadBucketCommand)) expect(c.args[0].input).toEqual({ Bucket: LOG_BUCKET, ExpectedBucketOwner: ACCOUNT });
    expectNoAwsTraffic(t.guard());
  });

  it("listLogKeys pages through ListObjectsV2 with the expected owner and returns sorted keys", async () => {
    const prefix = "reference/test-abc123def456ghi/2026/10/24/";
    t.mocks()
      .s3.on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: `${prefix}b.json` }], IsTruncated: true, NextContinuationToken: "c1" })
      .resolvesOnce({ Contents: [{ Key: `${prefix}a.json` }], IsTruncated: false });
    expect(await awsCloudHooks().listLogKeys(prefix)).toEqual([`${prefix}a.json`, `${prefix}b.json`]);
    expect(t.mocks().s3.commandCalls(ListObjectsV2Command).map((c) => c.args[0].input)).toEqual([
      { Bucket: LOG_BUCKET, Prefix: prefix, MaxKeys: 1000, ExpectedBucketOwner: ACCOUNT },
      { Bucket: LOG_BUCKET, Prefix: prefix, MaxKeys: 1000, ExpectedBucketOwner: ACCOUNT, ContinuationToken: "c1" },
    ]);
  });

  it("listLogKeys refuses a truncated page without a token and an unbounded listing", async () => {
    t.mocks().s3.on(ListObjectsV2Command).resolvesOnce({ Contents: [], IsTruncated: true });
    await expect(awsCloudHooks().listLogKeys("p/")).rejects.toThrow(/truncated listing without a continuation token/);
    t.mocks().s3.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: true, NextContinuationToken: "x" });
    await expect(awsCloudHooks().listLogKeys("p/")).rejects.toThrow(/more than 20000 keys/);
  });

  it("readLogObject reads one object as UTF-8 with the expected owner; a failure names the key", async () => {
    t.mocks().s3.on(GetObjectCommand).resolvesOnce({ Body: body('{"level":"error"}') }).rejectsOnce(sdkError("NoSuchKey", 404));
    expect(await awsCloudHooks().readLogObject("reference/test-x/2026/10/24/k.json")).toBe('{"level":"error"}');
    expect(t.mocks().s3.commandCalls(GetObjectCommand)[0]?.args[0].input).toEqual({ Bucket: LOG_BUCKET, Key: "reference/test-x/2026/10/24/k.json", ExpectedBucketOwner: ACCOUNT });
    await expect(awsCloudHooks().readLogObject("k")).rejects.toThrow(`reading S3 object ${LOG_BUCKET}/k failed: NoSuchKey (HTTP 404)`);
  });

  it("listLogEntries (DEC-0279) on aws lists one stage day and reads each entry", async () => {
    const prefix = "reference/test-abc123def456ghi/2026/10/24/";
    t.mocks().s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: `${prefix}e1.json` }] });
    t.mocks().s3.on(GetObjectCommand).resolves({ Body: body("{}") });
    expect(await listLogEntries({ target: "aws", ...STAGE, day: "2026/10/24" })).toEqual([{ key: `${prefix}e1.json`, body: "{}" }]);
    expect(t.mocks().s3.commandCalls(ListObjectsV2Command)[0]?.args[0].input.Prefix).toBe(prefix);
    await expect(listAwsLogEntries({ ...STAGE, day: "2026-10-24" })).rejects.toThrow(/day must be yyyy\/mm\/dd/);
    expectNoAwsTraffic(t.guard());
  });
});
