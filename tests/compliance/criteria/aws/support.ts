/**
 * Shared support for the AWS criteria AWS-AC-001…006 (docs/components/aws.md §4; plan-aws.md
 * item G-T2), written from the criteria and the component docs only.
 *
 * AWS-specific hooks. The C-T1 `CloudHooks` interface (`core/support/stores.ts`) covers secrets
 * and the log bucket only. These criteria also need stage-resource identifiers, the stage's
 * NAT gateways and Lambda VPC settings, an IAM policy simulation, Function URL discovery and
 * a cluster-paused observer (plan-aws.md G-T1). `AwsCloudHooks` below is the minimal optional
 * extension of `CloudHooks` these tests code against: the object `cloudHooks("aws")` returns
 * (from `_cloud/index.ts`, built by G-T1 in `_cloud/aws/`) is expected to carry these members as
 * well. While it does not, `awsHooks()` reports a missing prerequisite naming the absent members
 * (recorded `blocked`, never passed).
 *
 * No AWS request is made from this file: every AWS call goes through the hooks.
 */
import { prerequisiteMissing, type ComplianceClient, createClient } from "../../harness/index.js";
import { cloudHooks, type CloudHooks, type HookStage } from "../core/support/stores.js";

// ---------------------------------------------------------------------------------------------
// The AWS hook extension
// ---------------------------------------------------------------------------------------------

/** Identifiers of one stage's own resources (AWS-REQ-003), as the hooks read them from the account. */
export interface AwsStageResources {
  readonly accountId: string;
  readonly region: string;
  /** ARN of the HTTP Lambda's execution role (the "stage role"). */
  readonly roleArn: string;
  /** The stage's S3 bucket (FILES), by name. */
  readonly bucketName: string;
  /** ARN of the stage's Aurora cluster. */
  readonly clusterArn: string;
  /** ARN of the stage's database-credentials secret in Secrets Manager. */
  readonly credentialsSecretArn: string;
}

export interface AwsNatGateway {
  readonly id: string;
  readonly vpcId: string;
  /** EC2 state (`pending`, `available`, `deleting`, `deleted`, `failed`). */
  readonly state: string;
}

export interface AwsStageFunction {
  readonly name: string;
  /** `VpcConfig.SubnetIds` of the function; empty when it is not attached to a VPC. */
  readonly vpcSubnetIds: readonly string[];
  /** `VpcConfig.VpcId`, when set. */
  readonly vpcId?: string;
}

export type SimulationDecision = "allowed" | "implicitDeny" | "explicitDeny";

export interface SimulationResult {
  readonly action: string;
  readonly resource: string;
  readonly decision: SimulationDecision;
}

/** What one look at the stage's cluster shows (the cluster-paused observer). */
export interface ClusterObservation {
  /** True only when the cluster is observably paused (scaled to 0 ACU). */
  readonly paused: boolean;
  /** What was observed, e.g. `ServerlessDatabaseCapacity 0.5 ACU`, for the record. */
  readonly detail: string;
}

export interface AwsCloudHooks extends CloudHooks {
  /** The stage's own resource identifiers (stage-resource probe). */
  stageResources(stage: HookStage): Promise<AwsStageResources>;
  /** Every NAT gateway in the stage's network (the account's shared VPC) or tagged with the stage, in any state but `deleted`. */
  stageNatGateways(stage: HookStage): Promise<readonly AwsNatGateway[]>;
  /** Every Lambda function of the stage, with its VPC configuration. */
  stageFunctions(stage: HookStage): Promise<readonly AwsStageFunction[]>;
  /** `iam:SimulatePrincipalPolicy` for `principalArn`: one result per action and resource. */
  simulatePrincipalPolicy(principalArn: string, actions: readonly string[], resources: readonly string[]): Promise<readonly SimulationResult[]>;
  /** The HTTP Lambda's Function URL (`https://<id>.lambda-url.<region>.on.aws/`). */
  functionUrl(stage: HookStage): Promise<string>;
  /** One look at whether the stage's cluster is paused. */
  observeCluster(stage: HookStage): Promise<ClusterObservation>;
}

export const AWS_HOOK_MEMBERS = ["stageResources", "stageNatGateways", "stageFunctions", "simulatePrincipalPolicy", "functionUrl", "observeCluster"] as const;

/** The members of `AwsCloudHooks` that `hooks` lacks. */
export function missingAwsMembers(hooks: object): string[] {
  return AWS_HOOK_MEMBERS.filter((m) => typeof (hooks as Record<string, unknown>)[m] !== "function");
}

/** The AWS cloud hooks, or a missing prerequisite while G-T1 has not provided the members needed. */
export async function awsHooks(what: string): Promise<AwsCloudHooks> {
  const hooks = await cloudHooks(what);
  const missing = missingAwsMembers(hooks);
  if (missing.length > 0) prerequisiteMissing(`${what} needs the AWS cloud test hooks ${missing.join(", ")} (plan-aws.md G-T1, tests/compliance/criteria/_cloud/aws/), which cloudHooks("aws") does not provide`);
  return hooks as AwsCloudHooks;
}

// ---------------------------------------------------------------------------------------------
// Direct Function URL requests (AWS-AC-004, AWS-AC-006)
// ---------------------------------------------------------------------------------------------

/**
 * A client whose requests go to the Function URL directly, bypassing CloudFront, while it
 * behaves as a browser on the public origin would: its `baseUrl` (and so the default `Origin`
 * of state-changing requests) is the stage's public origin, the CloudFront URL (aws.md §2: the
 * public origin is the CloudFront URL; DEC-0044). Only the request URL's origin is replaced.
 * An explicit `origin` option is sent unchanged, so wrong origins can still be sent.
 */
export function directClient(publicBaseUrl: string, functionUrl: string, options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {}): ComplianceClient {
  const publicOrigin = new URL(publicBaseUrl).origin;
  const direct = new URL(functionUrl);
  if (direct.protocol !== "https:") throw new Error(`the Function URL ${functionUrl} is not https`);
  const inner = options.fetch ?? fetch;
  const rewrite: typeof fetch = (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    if (url.origin !== publicOrigin) throw new Error(`directClient: unexpected request URL ${raw} (expected the public origin ${publicOrigin})`);
    const target = new URL(`${url.pathname}${url.search}`, direct.origin);
    return inner(target.toString(), init);
  };
  return createClient({ baseUrl: publicOrigin, fetch: rewrite, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
}

// ---------------------------------------------------------------------------------------------
// IAM simulation cases (AWS-AC-003)
// ---------------------------------------------------------------------------------------------

/**
 * The ARN of the same kind of resource for another stage of the app: every occurrence of
 * `stage` replaced by `otherStage`. Per-stage resources carry the stage in their names
 * (AWS-REQ-003, PROV-REQ-005). When the identifier does not contain the stage, `-<otherStage>` is
 * appended to its last segment, so the result is still another resource of the same kind.
 */
export function otherStageArn(arn: string, stage: string, otherStage: string): string {
  if (stage === "" || stage === otherStage) throw new Error("otherStageArn: the stages must differ and be non-empty");
  if (arn.includes(stage)) return arn.split(stage).join(otherStage);
  return `${arn}-${otherStage}`;
}

export interface SimulationCase {
  readonly what: string;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

/** The shared log bucket's name on AWS (log.md §2 "AWS"). */
export function logBucketName(accountId: string): string {
  return `prototype-logs-${accountId}`;
}

/** The SSM parameter ARN of a stage's secret (SEC-REQ-003: `/<app>/<stage>/secrets/<name>`). */
export function parameterArn(r: Pick<AwsStageResources, "region" | "accountId">, app: string, stage: string, name: string): string {
  return `arn:aws:ssm:${r.region}:${r.accountId}:parameter/${app}/${stage}/secrets/${name}`;
}

/**
 * AWS-AC-003's cases for the stage role. `denied`: another stage's bucket, secrets and database,
 * and reading the log bucket. `allowed`: the stage's own resources and putting objects into the
 * log bucket under the stage's prefix (AWS-REQ-003), a positive control that shows the
 * simulation evaluates the role's real policy rather than denying everything.
 */
export function simulationCases(r: AwsStageResources, app: string, stage: string, otherStage: string): { readonly denied: SimulationCase[]; readonly allowed: SimulationCase[] } {
  const otherBucket = otherStageArn(r.bucketName, stage, otherStage);
  const logBucket = logBucketName(r.accountId);
  const day = "2026/01/01";
  return {
    denied: [
      { what: "another stage's bucket", actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resources: [`arn:aws:s3:::${otherBucket}/ref/probe.txt`] },
      { what: "another stage's bucket (listing)", actions: ["s3:ListBucket"], resources: [`arn:aws:s3:::${otherBucket}`] },
      { what: "another stage's secrets", actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [parameterArn(r, app, otherStage, "apiKey")] },
      { what: "another stage's secrets (by path)", actions: ["ssm:GetParametersByPath"], resources: [`arn:aws:ssm:${r.region}:${r.accountId}:parameter/${app}/${otherStage}/secrets`] },
      { what: "another stage's database credentials", actions: ["secretsmanager:GetSecretValue"], resources: [otherStageArn(r.credentialsSecretArn, stage, otherStage)] },
      { what: "another stage's database", actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement", "rds-data:BeginTransaction"], resources: [otherStageArn(r.clusterArn, stage, otherStage)] },
      { what: "reading the log bucket", actions: ["s3:GetObject"], resources: [`arn:aws:s3:::${logBucket}/${app}/${stage}/${day}/probe.json`, `arn:aws:s3:::${logBucket}/${app}/${otherStage}/${day}/probe.json`] },
      { what: "listing the log bucket", actions: ["s3:ListBucket"], resources: [`arn:aws:s3:::${logBucket}`] },
    ],
    allowed: [
      { what: "its own bucket", actions: ["s3:GetObject", "s3:PutObject"], resources: [`arn:aws:s3:::${r.bucketName}/ref/probe.txt`] },
      { what: "its own secret", actions: ["ssm:GetParameter"], resources: [parameterArn(r, app, stage, "apiKey")] },
      { what: "its own database", actions: ["rds-data:ExecuteStatement"], resources: [r.clusterArn] },
      { what: "its own database credentials", actions: ["secretsmanager:GetSecretValue"], resources: [r.credentialsSecretArn] },
      { what: "putting its log entries", actions: ["s3:PutObject"], resources: [`arn:aws:s3:::${logBucket}/${app}/${stage}/${day}/probe.json`] },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Cluster pause (AWS-AC-005)
// ---------------------------------------------------------------------------------------------

/**
 * Bound on waiting for the cluster to pause: the auto-pause delay PAR-213 plus 10 minutes for
 * the platform to act on it and for the observer's metric to show it. No parameter names this
 * bound yet (plan-aws.md §2 "bounded by a new PAR"); proposed for G-INT.
 */
export function pauseBoundMs(autoPauseMinutes: number): number {
  return (autoPauseMinutes + 10) * 60_000;
}

export type PauseWait = { readonly paused: true; readonly afterMs: number; readonly detail: string } | { readonly paused: false; readonly reason: string };

/** Polls `observe` until the cluster is paused or `boundMs` passes. Observer errors end the wait as not paused, with the error as reason. */
export async function waitForPause(
  observe: () => Promise<ClusterObservation>,
  options: { readonly boundMs: number; readonly intervalMs?: number; readonly now?: () => number; readonly sleep?: (ms: number) => Promise<void> },
): Promise<PauseWait> {
  if (!Number.isFinite(options.boundMs) || options.boundMs <= 0) throw new Error("waitForPause: the bound must be finite and positive");
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options.intervalMs ?? 30_000;
  const start = now();
  let last = "no observation completed";
  for (;;) {
    try {
      const seen = await observe();
      if (seen.paused) return { paused: true, afterMs: now() - start, detail: seen.detail };
      last = seen.detail;
    } catch (error) {
      last = `observer error: ${error instanceof Error ? error.message : String(error)}`;
    }
    const left = start + options.boundMs - now();
    if (left <= 0) break;
    await sleep(Math.min(interval, left));
  }
  return { paused: false, reason: `the cluster was not observably paused within ${String(Math.round(options.boundMs / 60_000))} min; last observation: ${last}` };
}

/**
 * Problems with the one request sent to a paused cluster (AWS-AC-005): within PAR-270 it answers
 * 2xx or `SQL.UNAVAILABLE` (with its catalogue status), never a gateway timeout or another error.
 * `slackMs` covers the network between the test and CloudFront, outside the Lambda's own time.
 */
export function resumeResponseProblems(r: { readonly status: number; readonly errorCode: string | undefined; readonly elapsedMs: number }, limits: { readonly lambdaTimeoutMs: number; readonly slackMs: number; readonly unavailableStatus: number }): string[] {
  const problems: string[] = [];
  const ok = r.status >= 200 && r.status < 300;
  const unavailable = r.status === limits.unavailableStatus && r.errorCode === "SQL.UNAVAILABLE";
  if (r.status === 504) problems.push("a gateway timeout (504)");
  else if (!ok && !unavailable) problems.push(`status ${String(r.status)} with code ${r.errorCode ?? "none"}, neither 2xx nor ${String(limits.unavailableStatus)} SQL.UNAVAILABLE`);
  if (r.elapsedMs > limits.lambdaTimeoutMs + limits.slackMs) problems.push(`answered after ${String(r.elapsedMs)} ms, beyond PAR-270 (${String(limits.lambdaTimeoutMs)} ms) plus ${String(limits.slackMs)} ms network slack`);
  return problems;
}
