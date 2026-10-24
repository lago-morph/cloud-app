/**
 * AWS stage-resource probe (DEC-0279 `listStageResources`; PROV-AC-003, COMPL-AC-004, E2E-012):
 * every resource of PROV's removal list still present for one stage, read independently of the
 * framework's own `listStageResources`.
 *
 * What is probed (aws.md "Deploy mechanics", AWS-REQ-003, PROV §2 "Removal"; names in
 * `names.ts`):
 * - the Function `<app>-<stage>-http` (Lambda `GetFunctionConfiguration`), 1 call;
 * - the Aurora cluster `<app>-<stage>` (RDS `DescribeDBClusters`), 1 call;
 * - the files bucket `<app>-<stage>-files-<account>` (S3 `HeadBucket`, expected owner), 1 call;
 * - the credentials secret `<app>-<stage>-database-credentials` (Secrets Manager
 *   `DescribeSecret`; a secret scheduled for deletion counts as present), 1 call;
 * - every SSM parameter under `/<app>/<stage>/` (one call per 10 parameters);
 * - every resource tagged `sst:app=<app>` and `sst:stage=<stage>` (tagging API `GetResources`) in
 *   the account region and in us-east-1, where CloudFront distributions are listed; this finds
 *   the generated names (site bucket, distribution, router function, KV store, instance,
 *   subnet and parameter groups), one call per 100 resources and region;
 * - the IAM roles whose generated name starts with `<app>-<stage>-` (IAM `ListRoles`, one call
 *   per 1,000 roles): IAM roles are global and not listed by the tagging API.
 * Log entries are not stage resources: they stay after removal by design (PROV-AC-003). The
 * tagging API can list a resource for a short time after it was deleted; such an entry is a
 * leftover until it disappears, so callers that check removal wait for the list to empty.
 */
import { GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { ListRolesCommand } from "@aws-sdk/client-iam";
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { GetResourcesCommand, type ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { awsAccountId, awsCall, awsClients, awsFailure, awsRegion, errorName, MAX_PAGES } from "./api.js";
import { ownedBucketExists } from "./logs.js";
import { type AwsStage, checkStage, clusterIdentifier, credentialsSecretName, filesBucketName, functionName, generatedNameOfStage, STAGE_TAG_KEYS } from "./names.js";
import { stageParameters } from "./secrets.js";

export interface AwsStageResourceDetails {
  readonly functions: readonly string[];
  readonly clusters: readonly string[];
  readonly buckets: readonly string[];
  readonly secrets: readonly string[];
  readonly parameters: readonly string[];
  readonly roles: readonly string[];
  /** ARNs of tagged resources not already reported by name above. */
  readonly tagged: readonly string[];
}

async function present(what: string, notFound: readonly string[], send: () => Promise<unknown>): Promise<boolean> {
  try {
    await awsCall(what, send);
    return true;
  } catch (error) {
    if (notFound.includes(errorName(error) ?? "")) return false;
    throw awsFailure(what, error);
  }
}

/** Whether the stage's Function exists. */
export function functionExists(s: AwsStage): Promise<boolean> {
  const name = functionName(s);
  return present(`reading Lambda function ${name}`, ["ResourceNotFoundException"], () => awsClients().lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name })));
}

/** Whether the stage's Aurora cluster exists (any status, deleting included). */
export function clusterExists(s: AwsStage): Promise<boolean> {
  const id = clusterIdentifier(s);
  return present(`reading Aurora cluster ${id}`, ["DBClusterNotFoundFault"], () => awsClients().rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: id })));
}

/** Whether the stage's credentials secret exists (scheduled for deletion included). */
export function credentialsSecretExists(s: AwsStage): Promise<boolean> {
  const name = credentialsSecretName(s);
  return present(`reading secret ${name}`, ["ResourceNotFoundException"], () => awsClients().secrets.send(new DescribeSecretCommand({ SecretId: name })));
}

/** ARNs of the resources carrying both stage tags, in one tagging-API region; bounded. */
export async function taggedResourceArns(s: AwsStage, client: ResourceGroupsTaggingAPIClient, region: string): Promise<string[]> {
  checkStage(s);
  const arns: string[] = [];
  let token: string | undefined;
  const what = `listing resources tagged ${STAGE_TAG_KEYS.app}=${s.app}, ${STAGE_TAG_KEYS.stage}=${s.stage} in ${region}`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () =>
        client.send(
          new GetResourcesCommand({
            TagFilters: [
              { Key: STAGE_TAG_KEYS.app, Values: [s.app] },
              { Key: STAGE_TAG_KEYS.stage, Values: [s.stage] },
            ],
            ResourcesPerPage: 100,
            ...(token === undefined ? {} : { PaginationToken: token }),
          }),
        ),
      );
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const m of r.ResourceTagMappingList ?? []) if (m.ResourceARN !== undefined) arns.push(m.ResourceARN);
    token = r.PaginationToken;
    if (token === undefined || token === "") return arns;
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
}

/** IAM roles of the stage by generated name (`<app>-<stage>-…`); bounded. */
export async function stageRoles(s: AwsStage): Promise<string[]> {
  checkStage(s);
  const names: string[] = [];
  let marker: string | undefined;
  const what = "listing IAM roles";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () => awsClients().iam.send(new ListRolesCommand({ MaxItems: 1000, ...(marker === undefined ? {} : { Marker: marker }) })));
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const role of r.Roles ?? []) if (role.RoleName !== undefined && generatedNameOfStage(role.RoleName, s)) names.push(role.RoleName);
    marker = r.Marker;
    if (r.IsTruncated !== true || marker === undefined || marker === "") return names.sort();
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not list further`);
}

/** The resource name an ARN's own part names (`arn:aws:s3:::b` → `b`, `…:function:f` → `f`, `…:role/r` → `r`). */
function arnResourceName(arn: string): string {
  const resource = arn.split(":").slice(5).join(":");
  return resource.split(/[:/]/).filter((p) => p !== "").pop() ?? resource;
}

/** Everything of the stage still present, structured. */
export async function awsStageResourceDetails(s: AwsStage): Promise<AwsStageResourceDetails> {
  checkStage(s);
  const account = await awsAccountId();
  const region = awsRegion();
  const fn = functionName(s);
  const cluster = clusterIdentifier(s);
  const bucket = filesBucketName(s, account);
  const secret = credentialsSecretName(s);
  const functions = (await functionExists(s)) ? [fn] : [];
  const clusters = (await clusterExists(s)) ? [cluster] : [];
  const buckets = (await ownedBucketExists(bucket)) ? [bucket] : [];
  const secrets = (await credentialsSecretExists(s)) ? [secret] : [];
  const parameters = await stageParameters(s);
  const roles = await stageRoles(s);
  const tagged = [...(await taggedResourceArns(s, awsClients().tagging, region)), ...(region === "us-east-1" ? [] : await taggedResourceArns(s, awsClients().taggingGlobal, "us-east-1"))];
  const named = new Set([...functions, ...clusters, ...buckets, ...roles]);
  const secretArn = (arn: string): boolean => arn.includes(":secretsmanager:") && arnResourceName(arn).startsWith(`${secret}-`);
  return {
    functions,
    clusters,
    buckets,
    secrets,
    parameters,
    roles,
    tagged: [...new Set(tagged)].filter((arn) => !named.has(arnResourceName(arn)) && !(secrets.length > 0 && secretArn(arn))).sort(),
  };
}

/** The leftover strings, in the form the driver and `remove` print them (`<kind> <identifier>`). */
export function awsLeftoverStrings(d: AwsStageResourceDetails): string[] {
  return [
    ...d.functions.map((x) => `Lambda function ${x}`),
    ...d.clusters.map((x) => `Aurora cluster ${x}`),
    ...d.buckets.map((x) => `S3 bucket ${x}`),
    ...d.secrets.map((x) => `secret ${x}`),
    ...d.parameters.map((x) => `SSM parameter ${x}`),
    ...d.roles.map((x) => `IAM role ${x}`),
    ...d.tagged.map((x) => `tagged resource ${x}`),
  ];
}

/** DEC-0279 hook on AWS: every resource of PROV's removal list still present for a test stage. */
export async function listAwsStageResources(input: AwsStage): Promise<string[]> {
  if (!input.stage.startsWith("test-")) throw new Error(`the stage-resource probe handles test stages only, not ${input.stage}`);
  return awsLeftoverStrings(await awsStageResourceDetails(input));
}
