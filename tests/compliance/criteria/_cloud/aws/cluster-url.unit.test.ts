// AWS cloud test hooks (G-T1): Function URL discovery (AWS-AC-004/006) and the cluster-paused
// observer (AWS-AC-005, PAR-281). No network: aws-sdk-client-mock.
import { GetFunctionUrlConfigCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand, DescribeEventsCommand } from "@aws-sdk/client-rds";
import { describe, expect, it } from "vitest";
import { classifyEventMessage, observeClusterPause, PAUSE_POLL_MS, PAUSE_WAIT_MS, waitForClusterPaused } from "./cluster.js";
import { functionUrlOrigin } from "./function-url.js";
import { expectNoAwsTraffic, sdkError, STAGE, useAwsMocks } from "./hooks.test-support.js";

const t = useAwsMocks();
const CLUSTER = "reference-test-abc123def456ghi";

function cluster(min: number, members: string[] = ["reference-test-abc123def456ghi-instance-1a2b"]): void {
  t.mocks()
    .rds.on(DescribeDBClustersCommand, { DBClusterIdentifier: CLUSTER })
    .resolves({ DBClusters: [{ DBClusterIdentifier: CLUSTER, Status: "available", ServerlessV2ScalingConfiguration: { MinCapacity: min, MaxCapacity: 4, SecondsUntilAutoPause: 300 }, DBClusterMembers: members.map((m) => ({ DBInstanceIdentifier: m })) }] });
}

describe("AWS hooks: Function URL discovery", () => {
  it("returns the stage Function's URL origin", async () => {
    t.mocks().lambda.on(GetFunctionUrlConfigCommand).resolves({ FunctionUrl: "https://abc123xyz.lambda-url.eu-west-1.on.aws/" });
    expect(await functionUrlOrigin(STAGE)).toBe("https://abc123xyz.lambda-url.eu-west-1.on.aws");
    expect(t.mocks().lambda.commandCalls(GetFunctionUrlConfigCommand)[0]?.args[0].input).toEqual({ FunctionName: "reference-test-abc123def456ghi-http" });
    expectNoAwsTraffic(t.guard());
  });

  it("fails clearly without a URL, and on anything that is not a Function URL", async () => {
    t.mocks().lambda.on(GetFunctionUrlConfigCommand).rejectsOnce(sdkError("ResourceNotFoundException", 404)).resolvesOnce({ FunctionUrl: "https://example.com/" });
    await expect(functionUrlOrigin(STAGE)).rejects.toThrow(/reference-test-abc123def456ghi-http failed: the function or its URL does not exist/);
    await expect(functionUrlOrigin(STAGE)).rejects.toThrow(/unexpected Function URL https:\/\/example.com\//);
  });
});

describe("AWS hooks: cluster-paused observer", () => {
  it("bounds the wait by PAR-281 (15 minutes), polling every 30 s", () => {
    expect(PAUSE_WAIT_MS).toBe(15 * 60_000);
    expect(PAUSE_POLL_MS).toBe(30_000);
  });

  it("classifies pause and resume event messages", () => {
    expect(classifyEventMessage("The DB instance has been paused.")).toBe("pause");
    expect(classifyEventMessage("Aurora Serverless v2 instance auto-paused")).toBe("pause");
    expect(classifyEventMessage("The DB instance is resuming.")).toBe("resume");
    expect(classifyEventMessage("Finished applying modification")).toBeUndefined();
  });

  it("is paused when every member's latest pause/resume event is a pause; reads control-plane APIs only", async () => {
    cluster(0, ["i-b", "i-a"]);
    t.mocks()
      .rds.on(DescribeEventsCommand, { SourceIdentifier: "i-a" })
      .resolves({ Events: [{ Message: "The DB instance is resuming.", Date: new Date("2026-10-24T10:00:00Z") }, { Message: "The DB instance has been paused.", Date: new Date("2026-10-24T10:10:00Z") }] });
    t.mocks()
      .rds.on(DescribeEventsCommand, { SourceIdentifier: "i-b" })
      .resolves({ Events: [{ Message: "The DB instance has been paused.", Date: new Date("2026-10-24T10:11:00Z") }, { Message: "Backup completed", Date: new Date("2026-10-24T10:12:00Z") }] });
    const o = await observeClusterPause(STAGE);
    expect(o.state).toBe("paused");
    expect(o.detail).toContain("i-a: paused (2026-10-24T10:10:00.000Z");
    const inputs = t.mocks().rds.commandCalls(DescribeEventsCommand).map((c) => c.args[0].input);
    expect(inputs).toEqual([
      { SourceIdentifier: "i-a", SourceType: "db-instance", Duration: 60, MaxRecords: 100 },
      { SourceIdentifier: "i-b", SourceType: "db-instance", Duration: 60, MaxRecords: 100 },
    ]);
    expectNoAwsTraffic(t.guard());
  });

  it("is running when a resume is newer, or no event exists yet", async () => {
    cluster(0);
    t.mocks()
      .rds.on(DescribeEventsCommand)
      .resolvesOnce({ Events: [{ Message: "The DB instance has been paused.", Date: new Date("2026-10-24T10:00:00Z") }, { Message: "The DB instance is resuming.", Date: new Date("2026-10-24T10:05:00Z") }] })
      .resolvesOnce({ Events: [] });
    expect((await observeClusterPause(STAGE)).state).toBe("running");
    const o = await observeClusterPause(STAGE);
    expect(o.state).toBe("running");
    expect(o.detail).toMatch(/no pause or resume event in the last 60 minutes/);
  });

  it("reports never-pauses at once when the minimum capacity is above 0 ACU", async () => {
    cluster(0.5);
    const r = await waitForClusterPaused(STAGE, { sleep: () => Promise.reject(new Error("must not wait")) });
    expect(r).toEqual({ paused: false, reason: `cluster ${CLUSTER} has minimum capacity 0.5 ACU, so it never pauses (PAR-212 needs 0)` });
    expect(t.mocks().rds.commandCalls(DescribeEventsCommand)).toHaveLength(0);
  });

  it("waits until paused, polling at the interval", async () => {
    cluster(0);
    t.mocks()
      .rds.on(DescribeEventsCommand)
      .resolvesOnce({ Events: [] })
      .resolves({ Events: [{ Message: "The DB instance has been paused.", Date: new Date() }] });
    let clock = 0;
    const sleeps: number[] = [];
    const r = await waitForClusterPaused(STAGE, { now: () => clock, sleep: (ms) => Promise.resolve(void (sleeps.push(ms), (clock += ms))) });
    expect(r.paused).toBe(true);
    expect(sleeps).toEqual([30_000]);
  });

  it("returns not-paused with the last observed state at the bound, never throwing", async () => {
    cluster(0);
    t.mocks().rds.on(DescribeEventsCommand).resolves({ Events: [] });
    let clock = 0;
    let polls = 0;
    const r = await waitForClusterPaused(STAGE, { now: () => clock, sleep: (ms) => Promise.resolve(void (polls++, (clock += ms))) });
    expect(r.paused).toBe(false);
    if (!r.paused) expect(r.reason).toMatch(/^the cluster did not pause within 15 minutes \(PAR-281\); last observed: cluster reference-test-abc123def456ghi status available, auto-pause after 300 s; .*no pause or resume event/);
    expect(polls).toBe(30);
    expect(t.mocks().rds.commandCalls(DescribeDBClustersCommand)).toHaveLength(31);
  });

  it("records a missing cluster and API failures as the observed state", async () => {
    t.mocks().rds.on(DescribeDBClustersCommand).rejectsOnce(sdkError("DBClusterNotFoundFault", 404)).rejects(sdkError("Throttling", 400));
    expect(await observeClusterPause(STAGE)).toEqual({ state: "unknown", detail: `cluster ${CLUSTER} does not exist` });
    let clock = 0;
    const r = await waitForClusterPaused(STAGE, { timeoutMs: 60_000, now: () => clock, sleep: (ms) => Promise.resolve(void (clock += ms)) });
    expect(r).toEqual({ paused: false, reason: `the cluster did not pause within 1 minutes (PAR-281); last observed: reading Aurora cluster ${CLUSTER} failed: Throttling (HTTP 400)` });
  });
});
