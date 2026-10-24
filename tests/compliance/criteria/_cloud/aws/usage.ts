/**
 * The AWS cluster cap (plan-aws.md G-T4; `harness/aws-usage.ts`): at most `MAX_AWS_CLUSTERS` (3)
 * Aurora clusters at once. `testStageClusters` lists the account's test-stage clusters
 * (`<app>-test-…`, by the fixed cluster identifier `<app>-<stage>`, DEC-0438, DEC-0480) with RDS
 * `DescribeDBClusters`, one counted call per 100 clusters, bounded. The driver checks it before it
 * deploys its run stage; a test that creates a further stage calls `requireClusterRoom` first, which
 * reports a missing prerequisite (recorded `blocked`) when the cap would be passed.
 */
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { assertClusterRoom, TEST_STAGE_CLUSTER } from "../../../harness/aws-usage.js";
import { prerequisiteMissing } from "../../../harness/index.js";
import { awsCall, awsClients, awsFailure, MAX_PAGES } from "./api.js";

/**
 * Identifiers of the account's test-stage Aurora clusters (any status, deleting included), sorted.
 * `env` gives the region when the process's clients are not created yet (the driver's own process
 * passes the account's region; G-EV F4).
 */
export async function testStageClusters(env: Readonly<Record<string, string | undefined>> = process.env): Promise<string[]> {
  const ids: string[] = [];
  let marker: string | undefined;
  const what = "listing Aurora clusters";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () => awsClients(env).rds.send(new DescribeDBClustersCommand({ MaxRecords: 100, ...(marker === undefined ? {} : { Marker: marker }) })));
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const c of r.DBClusters ?? []) if (c.DBClusterIdentifier !== undefined && TEST_STAGE_CLUSTER.test(c.DBClusterIdentifier)) ids.push(c.DBClusterIdentifier);
    marker = r.Marker;
    if (marker === undefined || marker === "") return ids.sort();
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
}

/** Reports a missing prerequisite when creating `more` stages (one cluster each) would pass the cap. */
export async function requireClusterRoom(more: number, what: string): Promise<void> {
  const existing = await testStageClusters();
  try {
    assertClusterRoom(existing, more, what);
  } catch (error) {
    prerequisiteMissing(error instanceof Error ? error.message : String(error));
  }
}
