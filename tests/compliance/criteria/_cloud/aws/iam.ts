/**
 * IAM hooks on the stage's Lambda role (AWS-AC-003, SEC-AC-003 IAM part, LOG-AC-001 AWS case).
 *
 * - **Role.** The role is the one the stage's Function runs as (Lambda
 *   `GetFunctionConfiguration` → `Role`), so the hooks never guess its generated name. 1 call.
 * - **Simulation.** `simulatePrincipal` is `iam:SimulatePrincipalPolicy` against that role for
 *   the given actions and resource ARNs; one result per (action, resource) pair, with the
 *   decision `allowed`, `explicitDeny` or `implicitDeny`. One call per 100 results, bounded. The
 *   simulation evaluates the role's identity policies only (no resource policies, no context
 *   keys), which is what "the Lambda role cannot read …" asks.
 * - **Log deny (LOG-AC-001).** `addLogDeny` puts one inline policy on the role, named
 *   `compliance-log-deny-<stage>`, denying `s3:PutObject` on
 *   `arn:aws:s3:::prototype-logs-<account>/<app>/<stage>/*` only: the deny is scoped to the stage's
 *   own prefix and the shared bucket itself (its policy, its objects) is never altered. It then
 *   waits (bounded, `LOG_DENY_VISIBLE_MS`) until the simulation reports `explicitDeny` for a key
 *   under that prefix, and a further `IAM_PROPAGATION_MS` for the change to reach S3's
 *   authorisation (IAM is eventually consistent; unverified live). `removeLogDeny` deletes the
 *   policy; an already absent one is fine. `withLogDeny` always removes it, also when the body
 *   throws. Only `test-` stages are changed. 2 calls plus the simulation polls.
 */
import { DeleteRolePolicyCommand, PutRolePolicyCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { waitFor } from "../../../harness/index.js";
import { awsAccountId, awsCall, awsClients, awsFailure, errorName, MAX_PAGES } from "./api.js";
import { type AwsStage, checkTestStage, functionName, logBucketName, stageLogPrefix } from "./names.js";

export const LOG_DENY_POLICY_PREFIX = "compliance-log-deny-";
/** Bound for the simulation to show the new deny. */
export const LOG_DENY_VISIBLE_MS = 60_000;
/** Extra wait after the simulation shows the deny, for the change to reach S3 (unverified live). */
export const IAM_PROPAGATION_MS = 10_000;

export type EvalDecision = "allowed" | "explicitDeny" | "implicitDeny";

export interface SimulationResult {
  readonly action: string;
  readonly resource: string;
  readonly decision: EvalDecision;
}

/** The ARN of the role the stage's Function runs as. */
export async function stageRoleArn(s: AwsStage): Promise<string> {
  const name = functionName(s);
  const what = `reading the role of Lambda function ${name}`;
  let role: string | undefined;
  try {
    role = (await awsCall(what, () => awsClients().lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name })))).Role;
  } catch (error) {
    throw awsFailure(what, error);
  }
  if (role === undefined || !/^arn:aws[a-z-]*:iam::\d{12}:role\/.+/.test(role)) throw new Error(`${what}: no role ARN in the function configuration`);
  return role;
}

/** The role name of a role ARN (the last path segment). */
export function roleNameFromArn(arn: string): string {
  const name = arn.split("/").pop();
  if (name === undefined || name === "" || !arn.includes(":role/")) throw new Error(`not a role ARN: ${arn}`);
  return name;
}

function decisionOf(value: string | undefined): EvalDecision {
  if (value === "allowed" || value === "explicitDeny" || value === "implicitDeny") return value;
  throw new Error(`unexpected IAM simulation decision ${String(value)}`);
}

/** `iam:SimulatePrincipalPolicy` for `principalArn`: one result per (action, resource) pair. */
export async function simulatePrincipal(principalArn: string, actions: readonly string[], resources: readonly string[]): Promise<SimulationResult[]> {
  if (actions.length === 0 || resources.length === 0) throw new Error("the IAM simulation needs at least one action and one resource");
  for (const a of actions) if (!/^[a-z0-9-]+:[A-Za-z0-9]+$/.test(a)) throw new Error(`not an exact IAM action: ${a}`);
  const results: SimulationResult[] = [];
  let marker: string | undefined;
  const what = `simulating ${String(actions.length)} action(s) on ${String(resources.length)} resource(s) for ${principalArn}`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () =>
        awsClients().iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: principalArn, ActionNames: [...actions], ResourceArns: [...resources], MaxItems: 100, ...(marker === undefined ? {} : { Marker: marker }) })),
      );
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const e of r.EvaluationResults ?? []) {
      const action = e.EvalActionName ?? "";
      const per = e.ResourceSpecificResults ?? [];
      if (per.length > 0) for (const p of per) results.push({ action, resource: p.EvalResourceName ?? "", decision: decisionOf(p.EvalResourceDecision) });
      else results.push({ action, resource: e.EvalResourceName ?? "", decision: decisionOf(e.EvalDecision) });
    }
    marker = r.Marker;
    if (r.IsTruncated !== true || marker === undefined || marker === "") return results;
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not read further`);
}

/** The simulation against the stage's Lambda role. */
export async function simulateStageRole(s: AwsStage, actions: readonly string[], resources: readonly string[]): Promise<SimulationResult[]> {
  return simulatePrincipal(await stageRoleArn(s), actions, resources);
}

/** The (action, resource) pairs the simulation allows. */
export function allowedPairs(results: readonly SimulationResult[]): SimulationResult[] {
  return results.filter((r) => r.decision === "allowed");
}

export function logDenyPolicyName(s: AwsStage): string {
  checkTestStage(s);
  return `${LOG_DENY_POLICY_PREFIX}${s.stage}`;
}

/** The inline deny: `s3:PutObject` on the stage's own log prefix only. */
export function logDenyPolicyDocument(s: AwsStage, account: string): { Version: string; Statement: { Sid: string; Effect: "Deny"; Action: string; Resource: string }[] } {
  checkTestStage(s);
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "ComplianceLogDeny", Effect: "Deny", Action: "s3:PutObject", Resource: `arn:aws:s3:::${logBucketName(account)}/${stageLogPrefix(s)}*` }],
  };
}

export interface LogDeny {
  readonly roleName: string;
  readonly policyName: string;
  remove(): Promise<void>;
}

export interface LogDenyOptions {
  readonly visibleMs?: number;
  readonly propagationMs?: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

async function deleteInlinePolicy(roleName: string, policyName: string): Promise<void> {
  const what = `deleting inline policy ${policyName} of role ${roleName}`;
  try {
    await awsCall(what, () => awsClients().iam.send(new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: policyName })));
  } catch (error) {
    if (errorName(error) === "NoSuchEntityException") return;
    throw awsFailure(what, error);
  }
}

/** Removes the stage's log deny; nothing to remove is fine. */
export async function removeLogDeny(s: AwsStage): Promise<void> {
  await deleteInlinePolicy(roleNameFromArn(await stageRoleArn(s)), logDenyPolicyName(s));
}

/** Adds the stage-scoped inline deny on the Lambda role and waits until IAM reports it. */
export async function addLogDeny(s: AwsStage, options: LogDenyOptions = {}): Promise<LogDeny> {
  checkTestStage(s);
  const account = await awsAccountId();
  const roleArn = await stageRoleArn(s);
  const roleName = roleNameFromArn(roleArn);
  const policyName = logDenyPolicyName(s);
  const what = `adding inline policy ${policyName} to role ${roleName}`;
  try {
    await awsCall(what, () => awsClients().iam.send(new PutRolePolicyCommand({ RoleName: roleName, PolicyName: policyName, PolicyDocument: JSON.stringify(logDenyPolicyDocument(s, account)) })));
  } catch (error) {
    throw awsFailure(what, error);
  }
  const handle: LogDeny = { roleName, policyName, remove: () => deleteInlinePolicy(roleName, policyName) };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    const probe = `arn:aws:s3:::${logBucketName(account)}/${stageLogPrefix(s)}compliance-log-deny-probe.json`;
    await waitFor(
      async () => {
        const [r] = await simulatePrincipal(roleArn, ["s3:PutObject"], [probe]);
        return r?.decision === "explicitDeny" ? true : undefined;
      },
      { what: `IAM to report the log deny on role ${roleName}`, timeoutMs: options.visibleMs ?? LOG_DENY_VISIBLE_MS, intervalMs: options.intervalMs ?? 5_000, sleep, ...(options.now === undefined ? {} : { now: options.now }) },
    );
    await sleep(options.propagationMs ?? IAM_PROPAGATION_MS);
  } catch (error) {
    await handle.remove();
    throw error;
  }
  return handle;
}

/** Runs `body` with the stage's log deny in place, and always removes the deny afterwards. */
export async function withLogDeny<T>(s: AwsStage, body: () => Promise<T>, options: LogDenyOptions = {}): Promise<T> {
  const deny = await addLogDeny(s, options);
  try {
    return await body();
  } finally {
    await deny.remove();
  }
}
