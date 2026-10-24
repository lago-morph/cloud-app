/**
 * The AWS API as the AWS cloud test hooks use it (plan-aws.md G-T1; the AWS counterpart of
 * `_cloud/api.ts`).
 *
 * - Clients are the framework's pinned SDK v3 clients (PAR-111), each created once per process
 *   with the framework's proxy-aware request handler (`targets/aws/sdk.ts`, DEC-PENDING-g-03-4),
 *   so they reach AWS through `HTTPS_PROXY` in the sandbox and directly elsewhere. Credentials
 *   come from the SDK's default chain (environment, profile, …) and are never read or printed
 *   here.
 * - The region is the account region recorded by `setup-account` (DEC-0075); the hooks take it
 *   from `AWS_REGION` (or `AWS_DEFAULT_REGION`), which the driver sets for an AWS run. Without one
 *   a hook reports a missing prerequisite. The account ID comes from STS `GetCallerIdentity`,
 *   once per process.
 * - Usage is countable and capped (plan §1 "Cloud usage limits"): every `send` goes through
 *   `awsCall`, which counts it, refuses calls beyond `maxAwsCalls()` (default 500 per process,
 *   `COMPLIANCE_AWS_MAX_CALLS` overrides) and prints `[g-t1] aws api calls in this process: <n>`
 *   once on exit. The count is of `send` calls; the SDK's own retries (at most `MAX_ATTEMPTS`
 *   per call) are not counted separately. Listings are bounded by their callers (`MAX_PAGES`).
 */
import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { RDSClient } from "@aws-sdk/client-rds";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { proxyAwareHandler } from "../../../../../packages/framework/src/targets/aws/sdk.js";
import { prerequisiteMissing } from "../../../harness/index.js";

export const DEFAULT_MAX_AWS_CALLS = 500;
export const MAX_AWS_CALLS_ENV = "COMPLIANCE_AWS_MAX_CALLS";
/** SDK attempts per call (its default); kept explicit so a hook's worst-case cost is known. */
export const MAX_ATTEMPTS = 3;
/** Pages any one listing reads at most; more is an error, never a silent cut. */
export const MAX_PAGES = 20;

type Env = Readonly<Record<string, string | undefined>>;

let calls = 0;
let reporting = false;

/** AWS API calls made by this process so far. */
export function awsCallCount(): number {
  return calls;
}

/** The per-process cap on AWS API calls. */
export function maxAwsCalls(env: Env = process.env): number {
  const raw = env[MAX_AWS_CALLS_ENV];
  if (raw === undefined || raw === "") return DEFAULT_MAX_AWS_CALLS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${MAX_AWS_CALLS_ENV}=${raw} is not a positive integer`);
  return n;
}

/**
 * One counted AWS API call: `what` names it for the cap message. The call's own error is
 * rethrown unchanged, so callers can match its `name`.
 */
export async function awsCall<T>(what: string, send: () => Promise<T>): Promise<T> {
  const cap = maxAwsCalls();
  if (calls >= cap) throw new Error(`${what}: refused, this process already made ${String(calls)} AWS API calls (cap ${String(cap)}, ${MAX_AWS_CALLS_ENV})`);
  calls += 1;
  if (!reporting) {
    reporting = true;
    process.once("exit", () => process.stderr.write(`[g-t1] aws api calls in this process: ${String(calls)}\n`));
  }
  return send();
}

/** The SDK error's name (`ParameterNotFound`, `NotFound`, …), or undefined for a non-error. */
export function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name : undefined;
}

/** The HTTP status the SDK recorded for a failed call, if any. */
export function errorStatus(error: unknown): number | undefined {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * A failed call, described by the error's name and HTTP status only: SDK messages can carry
 * request details, so they are left out (no credential is ever in them, but the hooks keep
 * their output short and stable).
 */
export function awsFailure(what: string, error: unknown): Error {
  const name = errorName(error) ?? "unknown error";
  const status = errorStatus(error);
  return new Error(`${what} failed: ${name}${status === undefined ? "" : ` (HTTP ${String(status)})`}`);
}

/** The account region (DEC-0075) from `AWS_REGION` or `AWS_DEFAULT_REGION`; a missing prerequisite without one. */
export function awsRegion(env: Env = process.env): string {
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
  if (region === undefined || region === "") return prerequisiteMissing("AWS_REGION is not set: the AWS cloud test hooks need the account region recorded by setup-account");
  if (!/^[a-z]{2}(-[a-z]+)+-\d+$/.test(region)) throw new Error(`AWS_REGION=${region} is not an AWS region name`);
  return region;
}

export interface AwsClients {
  readonly ssm: SSMClient;
  readonly s3: S3Client;
  readonly lambda: LambdaClient;
  readonly rds: RDSClient;
  readonly iam: IAMClient;
  readonly sts: STSClient;
  readonly secrets: SecretsManagerClient;
  /** The tagging API in the account region. */
  readonly tagging: ResourceGroupsTaggingAPIClient;
  /** The tagging API in us-east-1, where global resources (CloudFront distributions) are listed. */
  readonly taggingGlobal: ResourceGroupsTaggingAPIClient;
}

let clients: AwsClients | undefined;
let account: Promise<string> | undefined;

/** The process's clients, created on first use. */
export function awsClients(): AwsClients {
  if (clients !== undefined) return clients;
  const region = awsRegion();
  const base = { region, maxAttempts: MAX_ATTEMPTS, requestHandler: proxyAwareHandler(process.env) };
  clients = {
    ssm: new SSMClient(base),
    s3: new S3Client(base),
    lambda: new LambdaClient(base),
    rds: new RDSClient(base),
    iam: new IAMClient(base),
    sts: new STSClient(base),
    secrets: new SecretsManagerClient(base),
    tagging: new ResourceGroupsTaggingAPIClient(base),
    taggingGlobal: new ResourceGroupsTaggingAPIClient({ ...base, region: "us-east-1" }),
  };
  return clients;
}

/** The account ID of the credentials in use (STS `GetCallerIdentity`, once per process). */
export function awsAccountId(): Promise<string> {
  account ??= readAccountId().catch((error: unknown) => {
    account = undefined;
    throw error;
  });
  return account;
}

async function readAccountId(): Promise<string> {
  const what = "reading the caller identity (STS GetCallerIdentity)";
  let id: string | undefined;
  try {
    id = (await awsCall(what, () => awsClients().sts.send(new GetCallerIdentityCommand({})))).Account;
  } catch (error) {
    throw awsFailure(what, error);
  }
  if (id === undefined || !/^\d{12}$/.test(id)) throw new Error("STS GetCallerIdentity returned no 12-digit account ID");
  return id;
}

/** Test support: forget the clients, the account ID and the call count. */
export function resetAwsHooksState(): void {
  clients = undefined;
  account = undefined;
  calls = 0;
}
