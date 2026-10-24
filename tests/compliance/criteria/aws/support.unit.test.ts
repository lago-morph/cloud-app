/**
 * Offline checks of the AWS criteria's support (G-T2). Untagged: these are not evidence for
 * AWS-AC-*. No network: fetch, clocks and observers are fakes.
 */
import { describe, expect, it } from "vitest";
import { directClient, missingAwsMembers, otherStageArn, pauseBoundMs, resumeResponseProblems, simulationCases, waitForPause, type ClusterObservation } from "./support.js";

describe("AWS criteria support: directClient", () => {
  const PUBLIC = "https://d111111abcdef8.cloudfront.net";
  const FN = "https://abc123.lambda-url.us-east-1.on.aws/";

  function recording(): { calls: { url: string; headers: Headers }[]; fetch: typeof fetch } {
    const calls: { url: string; headers: Headers }[] = [];
    const fake: typeof fetch = (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    };
    return { calls, fetch: fake };
  }

  it("sends requests to the Function URL with the path and query, and the public origin as default Origin", async () => {
    const rec = recording();
    const c = directClient(`${PUBLIC}/some/path`, FN, { fetch: rec.fetch });
    expect(c.baseUrl).toBe(PUBLIC);
    await c.get("/api/levels/user?x=1");
    await c.post("/api/levels/user", {});
    expect(rec.calls.map((k) => k.url)).toEqual(["https://abc123.lambda-url.us-east-1.on.aws/api/levels/user?x=1", "https://abc123.lambda-url.us-east-1.on.aws/api/levels/user"]);
    expect(rec.calls[0]?.headers.get("origin")).toBeNull();
    expect(rec.calls[1]?.headers.get("origin")).toBe(PUBLIC);
  });

  it("sends an explicit Origin unchanged, and omits it when asked", async () => {
    const rec = recording();
    const c = directClient(PUBLIC, FN, { fetch: rec.fetch });
    await c.post("/api/levels/user", {}, { origin: "https://abc123.lambda-url.us-east-1.on.aws" });
    await c.post("/api/levels/user", {}, { origin: false });
    expect(rec.calls[0]?.headers.get("origin")).toBe("https://abc123.lambda-url.us-east-1.on.aws");
    expect(rec.calls[1]?.headers.has("origin")).toBe(false);
  });

  it("refuses a Function URL that is not https", () => {
    expect(() => directClient(PUBLIC, "http://abc.lambda-url.us-east-1.on.aws/")).toThrow(/not https/);
  });
});

describe("AWS criteria support: hook members", () => {
  it("names the AWS members a hooks object lacks", () => {
    const fn = (): Promise<never> => Promise.reject(new Error("unused"));
    expect(missingAwsMembers({ functionUrl: fn, observeCluster: fn })).toEqual(["stageResources", "stageNatGateways", "stageFunctions", "simulatePrincipalPolicy"]);
    expect(missingAwsMembers({ stageResources: fn, stageNatGateways: fn, stageFunctions: fn, simulatePrincipalPolicy: fn, functionUrl: fn, observeCluster: fn })).toEqual([]);
  });
});

describe("AWS criteria support: IAM simulation cases", () => {
  const r = {
    accountId: "111122223333",
    region: "us-east-1",
    roleArn: "arn:aws:iam::111122223333:role/reference-test-aaaa-HttpRole",
    bucketName: "reference-test-aaaa-files-x1",
    clusterArn: "arn:aws:rds:us-east-1:111122223333:cluster:reference-test-aaaa-database",
    credentialsSecretArn: "arn:aws:secretsmanager:us-east-1:111122223333:secret:rds!cluster-0a1b-AbCdEf",
  };

  it("derives another stage's identifiers, by substitution or by suffix", () => {
    expect(otherStageArn(r.clusterArn, "test-aaaa", "test-bbbb")).toBe("arn:aws:rds:us-east-1:111122223333:cluster:reference-test-bbbb-database");
    expect(otherStageArn(r.credentialsSecretArn, "test-aaaa", "test-bbbb")).toBe(`${r.credentialsSecretArn}-test-bbbb`);
    expect(() => otherStageArn(r.clusterArn, "test-aaaa", "test-aaaa")).toThrow();
  });

  it("denies only other stages' resources and log reads; allows own resources and the log PutObject", () => {
    const cases = simulationCases(r, "reference", "test-aaaa", "test-bbbb");
    const denied = cases.denied.flatMap((c) => c.resources);
    expect(denied.some((x) => x.includes("reference-test-aaaa-files"))).toBe(false);
    expect(denied).toContain("arn:aws:ssm:us-east-1:111122223333:parameter/reference/test-bbbb/secrets/apiKey");
    expect(denied).toContain("arn:aws:s3:::prototype-logs-111122223333");
    expect(cases.denied.find((c) => c.what === "reading the log bucket")?.actions).toEqual(["s3:GetObject"]);
    const logPut = cases.allowed.find((c) => c.what === "putting its log entries");
    expect(logPut?.actions).toEqual(["s3:PutObject"]);
    expect(logPut?.resources[0]).toMatch(/^arn:aws:s3:::prototype-logs-111122223333\/reference\/test-aaaa\//);
  });
});

describe("AWS criteria support: waiting for the pause", () => {
  function clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
    let t = 0;
    return { now: () => t, sleep: (ms) => ((t += ms), Promise.resolve()) };
  }

  it("returns paused with the elapsed time once the observer sees the pause", async () => {
    const seen: ClusterObservation[] = [{ paused: false, detail: "1 ACU" }, { paused: false, detail: "0.5 ACU" }, { paused: true, detail: "0 ACU" }];
    const c = clock();
    const w = await waitForPause(() => Promise.resolve(seen.shift() ?? { paused: false, detail: "?" }), { boundMs: 600_000, intervalMs: 30_000, ...c });
    expect(w).toEqual({ paused: true, afterMs: 60_000, detail: "0 ACU" });
  });

  it("returns not paused with the reason when the bound passes, observer errors included", async () => {
    let n = 0;
    const observe = (): Promise<ClusterObservation> => (++n % 2 === 0 ? Promise.reject(new Error("throttled")) : Promise.resolve({ paused: false, detail: "0.5 ACU" }));
    const w = await waitForPause(observe, { boundMs: 900_000, intervalMs: 30_000, ...clock() });
    expect(w.paused).toBe(false);
    if (!w.paused) expect(w.reason).toMatch(/^the cluster was not observably paused within 15 min; last observation: /);
  });

  it("bounds the wait by PAR-213 plus 10 minutes, and refuses an unbounded wait", async () => {
    expect(pauseBoundMs(5)).toBe(15 * 60_000);
    await expect(waitForPause(() => Promise.resolve({ paused: true, detail: "" }), { boundMs: Number.POSITIVE_INFINITY })).rejects.toThrow(/bound/);
  });
});

describe("AWS criteria support: the request after the pause", () => {
  const limits = { lambdaTimeoutMs: 55_000, slackMs: 3_000, unavailableStatus: 503 };

  it("accepts 2xx and SQL.UNAVAILABLE within the bound", () => {
    expect(resumeResponseProblems({ status: 200, errorCode: undefined, elapsedMs: 40_000 }, limits)).toEqual([]);
    expect(resumeResponseProblems({ status: 503, errorCode: "SQL.UNAVAILABLE", elapsedMs: 46_000 }, limits)).toEqual([]);
  });

  it("rejects a gateway timeout, another error, and an answer beyond PAR-270", () => {
    expect(resumeResponseProblems({ status: 504, errorCode: undefined, elapsedMs: 60_000 }, limits)).toHaveLength(2);
    expect(resumeResponseProblems({ status: 503, errorCode: undefined, elapsedMs: 1_000 }, limits)).toHaveLength(1);
    expect(resumeResponseProblems({ status: 502, errorCode: undefined, elapsedMs: 1_000 }, limits)).toHaveLength(1);
    expect(resumeResponseProblems({ status: 200, errorCode: undefined, elapsedMs: 58_001 }, limits)).toHaveLength(1);
  });
});
