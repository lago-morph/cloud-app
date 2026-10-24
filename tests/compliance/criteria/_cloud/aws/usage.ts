/**
 * The AWS cluster cap (plan-aws.md G-T4; `harness/aws-usage.ts`): at most `MAX_AWS_CLUSTERS` (3)
 * Aurora clusters at once. `testStageClusters` lists the account's test-stage clusters
 * (`<app>-test-…`, by the fixed cluster identifier `<app>-<stage>`, DEC-0438, DEC-0480) with RDS
 * `DescribeDBClusters`, one counted call per 100 clusters, bounded. The driver checks it before it
 * deploys its run stage; a test that creates a further stage calls `requireClusterRoom` first, which
 * reports a missing prerequisite (recorded `blocked`) when the cap would be passed.
 *
 * The Lambda function cap (PAR-284, DEC-0506) works the same way: `accountLambdaFunctions` lists
 * every function in us-east-1 and us-west-2 with Lambda `ListFunctions`, one counted call per 50
 * functions per region, bounded; `requireAwsStageRoom` checks both caps for a further stage.
 */
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { assertClusterRoom, assertLambdaRoom, LAMBDA_COUNT_REGIONS, TEST_STAGE_CLUSTER } from "../../../harness/aws-usage.js";
import { prerequisiteMissing } from "../../../harness/index.js";
import { awsCall, awsClients, awsFailure, awsLambdaIn, MAX_PAGES } from "./api.js";

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

/** Every Lambda function in us-east-1 and us-west-2, as `<region>/<name>`, sorted (PAR-284 counts them all). */
export async function accountLambdaFunctions(): Promise<string[]> {
  const names: string[] = [];
  for (const region of LAMBDA_COUNT_REGIONS) {
    const what = `listing Lambda functions in ${region}`;
    let marker: string | undefined;
    let done = false;
    for (let page = 0; page < MAX_PAGES && !done; page += 1) {
      let r;
      try {
        r = await awsCall(what, () => awsLambdaIn(region).send(new ListFunctionsCommand({ MaxItems: 50, ...(marker === undefined ? {} : { Marker: marker }) })));
      } catch (error) {
        throw awsFailure(what, error);
      }
      for (const f of r.Functions ?? []) if (f.FunctionName !== undefined) names.push(`${region}/${f.FunctionName}`);
      marker = r.NextMarker;
      done = marker === undefined || marker === "";
    }
    if (!done) throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
  }
  return names.sort();
}

/** Reports a missing prerequisite when creating `more` stages would pass the Lambda function cap. */
export async function requireLambdaRoom(more: number, what: string): Promise<void> {
  const existing = await accountLambdaFunctions();
  try {
    assertLambdaRoom(existing, more, what);
  } catch (error) {
    prerequisiteMissing(error instanceof Error ? error.message : String(error));
  }
}

/** Both AWS caps for `more` further stages: the cluster cap (PAR-283), then the Lambda function cap (PAR-284). */
export async function requireAwsStageRoom(more: number, what: string): Promise<void> {
  await requireClusterRoom(more, what);
  await requireLambdaRoom(more, what);
}
