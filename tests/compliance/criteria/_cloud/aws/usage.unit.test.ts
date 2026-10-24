// plan-aws.md G-T4: the three-cluster cap's count, through the counted hooks. No network: aws-sdk-client-mock.
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { describe, expect, it } from "vitest";
import { PREREQUISITE_MARKER } from "../../../harness/index.js";
import { awsCallCount, awsClients } from "./api.js";
import { expectNoAwsTraffic, useAwsMocks } from "./hooks.test-support.js";
import { requireClusterRoom, testStageClusters } from "./usage.js";

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
