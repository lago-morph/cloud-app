/**
 * The AWS-only members of `AwsCloudHooks` (criteria/aws/support.ts, G-T2), built on G-T1's
 * hooks (plan-aws.md G-T4 "reconcile the hooks"). Each one is a thin adapter: the IAM simulation,
 * the Function URL and the cluster observer are G-T1's; the stage resources, the NAT gateways and
 * the stage's functions are read here with the same counted, capped calls (`api.ts`).
 *
 * - `stageResources`: account and region (`api.ts`), the role from the Function's configuration
 *   (`iam.ts`), the files bucket by its fixed name, the cluster ARN (RDS `DescribeDBClusters`) and
 *   the credentials secret's ARN (Secrets Manager `DescribeSecret`). 4 calls (plus STS once).
 * - `stageFunctions`: every Lambda function whose name is the stage's (`<app>-<stage>-…`, names.ts),
 *   with `VpcConfig`, from Lambda `ListFunctions`. One call per 50 functions, bounded.
 * - `stageNatGateways`: every NAT gateway, in any state but `deleted`, in the account's shared VPC
 *   (EC2 `DescribeVpcs` by the tag `prototype-framework=shared-network`, DEC-0475), in a VPC
 *   one of the stage's functions names, or tagged `sst:app`/`sst:stage` with the stage. 1 + 2 calls
 *   per 1,000 gateways, bounded.
 * - `simulatePrincipalPolicy`, `functionUrl`, `observeCluster`: G-T1's `simulatePrincipal`,
 *   `functionUrlOrigin` and `observeClusterPause`.
 */
import { DescribeNatGatewaysCommand, DescribeVpcsCommand, type Filter, type NatGateway } from "@aws-sdk/client-ec2";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import type { AwsCloudHooks, AwsNatGateway, AwsStageFunction, AwsStageResources, ClusterObservation } from "../../aws/support.js";
import type { CloudHooks } from "../../core/support/stores.js";
import { awsAccountId, awsCall, awsClients, awsFailure, awsRegion, MAX_PAGES } from "./api.js";
import { observeClusterPause } from "./cluster.js";
import { functionUrlOrigin } from "./function-url.js";
import { simulatePrincipal, stageRoleArn } from "./iam.js";
import { type AwsStage, checkStage, clusterIdentifier, credentialsSecretName, filesBucketName, functionName, generatedNameOfStage, STAGE_TAG_KEYS } from "./names.js";

/** The tag `setup-account` puts on the shared network (DEC-0475). */
export const SHARED_NETWORK_TAG = { key: "prototype-framework", value: "shared-network" } as const;

type Members = Omit<AwsCloudHooks, keyof CloudHooks>;

async function clusterArn(s: AwsStage): Promise<string> {
  const id = clusterIdentifier(s);
  const what = `reading Aurora cluster ${id}`;
  let arn: string | undefined;
  try {
    arn = (await awsCall(what, () => awsClients().rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: id })))).DBClusters?.[0]?.DBClusterArn;
  } catch (error) {
    throw awsFailure(what, error);
  }
  if (arn === undefined || !arn.startsWith("arn:")) throw new Error(`${what}: no cluster ARN returned`);
  return arn;
}

async function credentialsSecretArn(s: AwsStage): Promise<string> {
  const name = credentialsSecretName(s);
  const what = `reading secret ${name}`;
  let arn: string | undefined;
  try {
    arn = (await awsCall(what, () => awsClients().secrets.send(new DescribeSecretCommand({ SecretId: name })))).ARN;
  } catch (error) {
    throw awsFailure(what, error);
  }
  if (arn === undefined || !arn.startsWith("arn:")) throw new Error(`${what}: no secret ARN returned`);
  return arn;
}

/** The stage's own resource identifiers (AWS-REQ-003). */
export async function stageResources(s: AwsStage): Promise<AwsStageResources> {
  checkStage(s);
  const accountId = await awsAccountId();
  return {
    accountId,
    region: awsRegion(),
    roleArn: await stageRoleArn(s),
    bucketName: filesBucketName(s, accountId),
    clusterArn: await clusterArn(s),
    credentialsSecretArn: await credentialsSecretArn(s),
  };
}

/** Every Lambda function of the stage (its fixed HTTP Function and any generated `<app>-<stage>-…` one), with its VPC settings. */
export async function stageFunctions(s: AwsStage): Promise<AwsStageFunction[]> {
  checkStage(s);
  const http = functionName(s);
  const out: AwsStageFunction[] = [];
  let marker: string | undefined;
  const what = "listing Lambda functions";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () => awsClients().lambda.send(new ListFunctionsCommand({ MaxItems: 50, ...(marker === undefined ? {} : { Marker: marker }) })));
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const f of r.Functions ?? []) {
      const name = f.FunctionName;
      if (name === undefined || (name !== http && !generatedNameOfStage(name, s))) continue;
      const vpcId = f.VpcConfig?.VpcId;
      out.push({ name, vpcSubnetIds: [...(f.VpcConfig?.SubnetIds ?? [])], ...(vpcId === undefined || vpcId === "" ? {} : { vpcId }) });
    }
    marker = r.NextMarker;
    if (marker === undefined || marker === "") return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
}

/** The account's shared VPC IDs (normally one), found by the shared-network tag. */
export async function sharedVpcIds(): Promise<string[]> {
  const what = `listing VPCs tagged ${SHARED_NETWORK_TAG.key}=${SHARED_NETWORK_TAG.value}`;
  try {
    const r = await awsCall(what, () => awsClients().ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: `tag:${SHARED_NETWORK_TAG.key}`, Values: [SHARED_NETWORK_TAG.value] }] })));
    return (r.Vpcs ?? []).map((v) => v.VpcId).filter((id): id is string => id !== undefined && id !== "").sort();
  } catch (error) {
    throw awsFailure(what, error);
  }
}

async function natGateways(what: string, filters: Filter[]): Promise<NatGateway[]> {
  const out: NatGateway[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () => awsClients().ec2.send(new DescribeNatGatewaysCommand({ Filter: filters, MaxResults: 1000, ...(token === undefined ? {} : { NextToken: token }) })));
    } catch (error) {
      throw awsFailure(what, error);
    }
    out.push(...(r.NatGateways ?? []));
    token = r.NextToken;
    if (token === undefined || token === "") return out;
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
}

/** NAT gateways (not `deleted`) in the stage's network: the shared VPC, any VPC a stage function names, or tagged with the stage. */
export async function stageNatGateways(s: AwsStage, functions?: readonly AwsStageFunction[]): Promise<AwsNatGateway[]> {
  checkStage(s);
  const fns = functions ?? (await stageFunctions(s));
  const vpcs = [...new Set([...(await sharedVpcIds()), ...fns.map((f) => f.vpcId).filter((v): v is string => v !== undefined)])].sort();
  const found = new Map<string, AwsNatGateway>();
  const add = (list: readonly NatGateway[]): void => {
    for (const n of list) {
      if (n.NatGatewayId === undefined || n.State === "deleted") continue;
      found.set(n.NatGatewayId, { id: n.NatGatewayId, vpcId: n.VpcId ?? "", state: n.State ?? "unknown" });
    }
  };
  if (vpcs.length > 0) add(await natGateways(`listing NAT gateways in VPC(s) ${vpcs.join(", ")}`, [{ Name: "vpc-id", Values: vpcs }]));
  add(
    await natGateways(`listing NAT gateways tagged ${STAGE_TAG_KEYS.app}=${s.app}, ${STAGE_TAG_KEYS.stage}=${s.stage}`, [
      { Name: `tag:${STAGE_TAG_KEYS.app}`, Values: [s.app] },
      { Name: `tag:${STAGE_TAG_KEYS.stage}`, Values: [s.stage] },
    ]),
  );
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One look at the stage cluster, in the criteria's shape: paused only when observably paused. */
export async function observeCluster(s: AwsStage): Promise<ClusterObservation> {
  const o = await observeClusterPause(s);
  return { paused: o.state === "paused", detail: o.state === "never-pauses" ? `never pauses: ${o.detail}` : o.detail };
}

/** The AWS-only hook members (G-T2's `AwsCloudHooks` minus C-T1's `CloudHooks`). */
export function awsCriteriaHooks(): Members {
  return {
    stageResources: (stage) => stageResources(stage),
    stageNatGateways: (stage) => stageNatGateways(stage),
    stageFunctions: (stage) => stageFunctions(stage),
    simulatePrincipalPolicy: (principalArn, actions, resources) => simulatePrincipal(principalArn, actions, resources),
    functionUrl: async (stage) => `${await functionUrlOrigin(stage)}/`,
    observeCluster: (stage) => observeCluster(stage),
  };
}
