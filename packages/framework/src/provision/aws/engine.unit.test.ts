import { DescribeDBEngineVersionsCommand, DescribeOrderableDBInstanceOptionsCommand, RDSClient, RDSServiceException } from "@aws-sdk/client-rds";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "./aws-network-guard.test-support.js";
import { checkEngine, compareVersions } from "./engine.js";

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const rds = mockClient(RDSClient);
afterEach(() => rds.reset());
afterAll(() => rds.restore());
const client = () => new RDSClient({ region: "us-east-1" });

const version = (v: string, min: number | undefined, status = "available") => ({
  Engine: "aurora-postgresql",
  EngineVersion: v,
  Status: status,
  ...(min === undefined ? {} : { ServerlessV2FeaturesSupport: { MinCapacity: min, MaxCapacity: 256 } }),
});
const dataApi = (supported: readonly string[]) => {
  rds.on(DescribeOrderableDBInstanceOptionsCommand).callsFake((input: { EngineVersion?: string }) => ({
    OrderableDBInstanceOptions: [{ EngineVersion: input.EngineVersion, DBInstanceClass: "db.serverless", SupportsHttpEndpoint: supported.includes(input.EngineVersion ?? "") }],
  }));
};

describe("Aurora engine check (PAR-110 17.x, Data API, PAR-212 0 ACU)", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("17.10", "17.9")).toBeGreaterThan(0);
    expect(compareVersions("17.4", "17.4")).toBe(0);
    expect(compareVersions("16.9", "17.1")).toBeLessThan(0);
  });

  it("passes with the highest 17.x minor that has a 0 ACU minimum and the Data API", async () => {
    rds.on(DescribeDBEngineVersionsCommand).resolves({ DBEngineVersions: [version("16.8", 0), version("17.4", 0), version("17.5", 0), version("17.6", 0.5)] });
    dataApi(["17.4", "17.5"]);
    expect(await checkEngine(client(), "us-east-1")).toEqual({ ok: true, version: "17.5" });
    const first = rds.commandCalls(DescribeDBEngineVersionsCommand)[0];
    expect(first?.args[0].input).toEqual({ Engine: "aurora-postgresql" });
    expect(rds.commandCalls(DescribeOrderableDBInstanceOptionsCommand).map((c) => c.args[0].input)).toEqual([
      { Engine: "aurora-postgresql", EngineVersion: "17.5", DBInstanceClass: "db.serverless" },
    ]);
  });

  it("follows the pagination markers of both calls", async () => {
    rds.on(DescribeDBEngineVersionsCommand, { Engine: "aurora-postgresql" }).resolvesOnce({ DBEngineVersions: [version("17.4", 0)], Marker: "m1" }).resolves({ DBEngineVersions: [version("17.7", 0)] });
    rds
      .on(DescribeOrderableDBInstanceOptionsCommand)
      .resolvesOnce({ OrderableDBInstanceOptions: [{ SupportsHttpEndpoint: false }], Marker: "o1" })
      .resolves({ OrderableDBInstanceOptions: [{ SupportsHttpEndpoint: true }] });
    expect(await checkEngine(client(), "us-east-1")).toEqual({ ok: true, version: "17.7" });
    expect(rds.commandCalls(DescribeDBEngineVersionsCommand)[1]?.args[0].input).toEqual({ Engine: "aurora-postgresql", Marker: "m1" });
  });

  it("wrong engine: a region without any 17.x fails, naming the region and the requirement", async () => {
    rds.on(DescribeDBEngineVersionsCommand).resolves({ DBEngineVersions: [version("15.6", 0), version("16.8", 0), version("17.1", 0, "deprecated")] });
    const r = await checkEngine(client(), "ap-south-2");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toMatch(/region ap-south-2 does not offer Aurora PostgreSQL 17\.x \(PAR-110\) with the Data API and a 0 ACU minimum capacity \(PAR-212\): no 17\.x/);
  });

  it("wrong engine: 17.x without a 0 ACU minimum or without the Data API fails, listing why per version", async () => {
    rds.on(DescribeDBEngineVersionsCommand).resolves({ DBEngineVersions: [version("17.4", 0.5), version("17.5", undefined), version("17.6", 0)] });
    dataApi([]);
    const r = await checkEngine(client(), "eu-south-2");
    expect(r).toEqual({
      ok: false,
      problem:
        "region eu-south-2 does not offer Aurora PostgreSQL 17.x (PAR-110) with the Data API and a 0 ACU minimum capacity (PAR-212); versions offered: 17.6 (no Data API on db.serverless), 17.5 (minimum unknown), 17.4 (minimum 0.5 ACU)",
    });
  });

  it("an RDS error is a failed check naming the error, never a pass", async () => {
    rds.on(DescribeDBEngineVersionsCommand).rejects(new RDSServiceException({ name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 }, message: "no" }));
    expect(await checkEngine(client(), "us-east-1")).toEqual({
      ok: false,
      problem: "checking Aurora PostgreSQL 17.x (PAR-110) with the Data API and a 0 ACU minimum capacity (PAR-212) in region us-east-1 failed: AccessDenied (HTTP 403)",
    });
  });
});
