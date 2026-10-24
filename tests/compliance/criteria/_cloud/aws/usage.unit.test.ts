// plan-aws.md G-T4: the three-cluster cap's count, through the counted hooks. No network: aws-sdk-client-mock.
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { describe, expect, it } from "vitest";
import { PREREQUISITE_MARKER } from "../../../harness/index.js";
import { awsCallCount, awsClients } from "./api.js";
import { expectNoAwsTraffic, useAwsMocks } from "./hooks.test-support.js";
import { accountLambdaFunctions, requireAwsStageRoom, requireClusterRoom, requireLambdaRoom, testStageClusters } from "./usage.js";

const t = useAwsMocks();

describe("AWS cluster cap", () => {
  it("lists the test-stage clusters (paged), counting each call", async () => {
    t.mocks()
      .rds.on(DescribeDBClustersCommand, { MaxRecords: 100 })
      .resolves({ DBClusters: [{ DBClusterIdentifier: "reference-test-b0000000000001" }, { DBClusterIdentifier: "reference-prodcheck" }], Marker: "m" })
      .on(DescribeDBClustersCommand, { MaxRecords: 100, Marker: "m" })
      .resolves({ DBClusters: [{ DBClusterIdentifier: "notes-test-a0000000000001" }, { DBClusterIdentifier: "manual" }] });
    expect(await testStageClusters()).toEqual(["notes-test-a0000000000001", "reference-test-b0000000000001"]);
    expect(awsCallCount()).toBe(2);
    expectNoAwsTraffic(t.guard());
  });

  // G-EV F4: in the driver's own process the region comes from the driver (the account's region), not the environment.
  it("lists in the region it is given when the process environment has none", async () => {
    delete process.env.AWS_REGION;
    t.mocks().rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    expect(await testStageClusters({ AWS_REGION: "ap-southeast-2" })).toEqual([]);
    expect(await awsClients().rds.config.region()).toBe("ap-southeast-2");
    expectNoAwsTraffic(t.guard());
  });

  it("requireClusterRoom reports a missing prerequisite when a further stage would be the fourth cluster", async () => {
    t.mocks().rds.on(DescribeDBClustersCommand).resolves({ DBClusters: ["a", "b", "c"].map((x) => ({ DBClusterIdentifier: `reference-test-${x}000000000001` })) });
    await expect(requireClusterRoom(1, "PROV-AC-003 (a further stage)")).rejects.toThrow(PREREQUISITE_MARKER);
    t.mocks().rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ DBClusterIdentifier: "reference-test-a000000000001" }] });
    await expect(requireClusterRoom(1, "PROV-AC-003 (a further stage)")).resolves.toBeUndefined();
  });
});

// PAR-284 (DEC-0506): the account's Lambda functions in us-east-1 and us-west-2, through the counted hooks.
describe("AWS Lambda function cap", () => {
  it("lists every function in us-east-1 and in us-west-2 (paged), whatever the account region, counting each call", async () => {
    const seen: string[] = [];
    t.mocks().lambda.on(ListFunctionsCommand).callsFake(async (input: { Marker?: string }, getClient: () => { config: { region: () => Promise<string> } }) => {
      const region = await getClient().config.region();
      seen.push(`${region}${input.Marker === undefined ? "" : ` ${input.Marker}`}`);
      if (region === "us-east-1" && input.Marker === undefined) return { Functions: [{ FunctionName: "reference-test-a-http" }, { FunctionName: "manual" }], NextMarker: "m" };
      if (region === "us-east-1") return { Functions: [{ FunctionName: "other" }] };
      return { Functions: [{ FunctionName: "reference-test-b-http" }] };
    });
    expect(await accountLambdaFunctions()).toEqual(["us-east-1/manual", "us-east-1/other", "us-east-1/reference-test-a-http", "us-west-2/reference-test-b-http"]);
    expect(seen).toEqual(["us-east-1", "us-east-1 m", "us-west-2"]);
    expect(awsCallCount()).toBe(3);
    expectNoAwsTraffic(t.guard());
  });

  it("requireLambdaRoom reports a missing prerequisite when a further stage would make a ninth function", async () => {
    t.mocks().lambda.on(ListFunctionsCommand).resolves({ Functions: ["a", "b", "c", "d"].map((x) => ({ FunctionName: x })) });
    await expect(requireLambdaRoom(1, "PROV-AC-003 (a further stage)")).rejects.toThrow(PREREQUISITE_MARKER);
    await expect(requireLambdaRoom(1, "PROV-AC-003 (a further stage)")).rejects.toThrow(/9 Lambda functions/);
    t.mocks().lambda.on(ListFunctionsCommand).resolves({ Functions: [{ FunctionName: "a" }] });
    await expect(requireLambdaRoom(1, "PROV-AC-003 (a further stage)")).resolves.toBeUndefined();
  });

  it("requireAwsStageRoom checks the cluster cap and the function cap", async () => {
    t.mocks().rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    t.mocks().lambda.on(ListFunctionsCommand).resolves({ Functions: Array.from({ length: 4 }, (_, i) => ({ FunctionName: `f${String(i)}` })) });
    await expect(requireAwsStageRoom(1, "a further stage")).rejects.toThrow(/9 Lambda functions/);
    t.mocks().lambda.on(ListFunctionsCommand).resolves({ Functions: [] });
    t.mocks().rds.on(DescribeDBClustersCommand).resolves({ DBClusters: ["a", "b", "c"].map((x) => ({ DBClusterIdentifier: `reference-test-${x}000000000001` })) });
    await expect(requireAwsStageRoom(1, "a further stage")).rejects.toThrow(/4 Aurora clusters/);
    t.mocks().rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    await expect(requireAwsStageRoom(1, "a further stage")).resolves.toBeUndefined();
  });
});
