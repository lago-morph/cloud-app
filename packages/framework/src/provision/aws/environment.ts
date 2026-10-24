/**
 * AWS credentials, SDK clients and the SST tool environment (PROV §2 "Credentials"; aws.md
 * "Deploy mechanics"; G-S1 §5, G-S2 Q4).
 *
 * Credentials come from the variables the AWS SDK and SST normally use and are checked by name
 * only (CLI-REQ-004: no value is ever printed). Either a named profile (`AWS_PROFILE`), a
 * web-identity or container credential source, or the static pair `AWS_ACCESS_KEY_ID` +
 * `AWS_SECRET_ACCESS_KEY` (with `AWS_SESSION_TOKEN` when temporary) counts as present. The
 * preflight then proves them usable with STS `GetCallerIdentity`, which also yields the
 * account ID every shared-resource name and expected-owner check uses.
 *
 * Proxy (G-S1 §5, DEC-PENDING-g-s1-5): `NODE_USE_ENV_PROXY=1` does not reach SDK v3's own
 * `https.Agent`, so every client the CLI builds gets a `NodeHttpHandler` whose agent is
 * `new https.Agent({ keepAlive: true, proxyEnv })`. It honours `HTTPS_PROXY`/`NO_PROXY` and
 * connects directly when none is set. The handler is given as its options object, which the
 * SDK turns into `NodeHttpHandler.create(options)` itself; this needs no direct dependency on
 * `@smithy/node-http-handler`.
 */
import type https from "node:https";
import { EC2Client } from "@aws-sdk/client-ec2";
import { RDSClient } from "@aws-sdk/client-rds";
import { S3Client } from "@aws-sdk/client-s3";
import { SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { proxyAwareHandler, type Environment } from "../../targets/aws/sdk.js";

export type { Environment };
/** The proxy-aware request handler options every CLI-side SDK client gets (shared with the Lambda runtime). */
export { proxyAwareHandler };

/** The default AWS region `setup-account` uses when none is chosen and none is recorded (PAR-060). */
export const DEFAULT_REGION = "us-east-1";

/** The static credential pair, named when neither it nor another credential source is present. */
export const CREDENTIAL_NAMES = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;

/** Variables that each name a complete credential source of the SDK's default chain on their own. */
const OTHER_SOURCES = ["AWS_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"] as const;

const set = (env: Environment, name: string): boolean => (env[name] ?? "") !== "";

/** Names of the credential variables that are missing (empty when some credential source is present). */
export function missingCredentials(env: Environment): string[] {
  if (OTHER_SOURCES.some((name) => set(env, name))) return [];
  return CREDENTIAL_NAMES.filter((name) => !set(env, name));
}

/** Client configuration for one region: the region and the proxy-aware handler. */
export function clientConfig(env: Environment, region: string): { region: string; requestHandler: { readonly httpsAgent: https.Agent } } {
  return { region, requestHandler: proxyAwareHandler(env) };
}

/** The SDK clients account setup uses, all in one region. */
export interface AwsClients {
  readonly region: string;
  readonly sts: STSClient;
  readonly s3: S3Client;
  readonly ec2: EC2Client;
  readonly rds: RDSClient;
  readonly ssm: SSMClient;
}

/** Builds the account-setup clients for `region` with the proxy-aware handler. */
export function createAwsClients(env: Environment, region: string): AwsClients {
  const config = clientConfig(env, region);
  return {
    region,
    sts: new STSClient(config),
    // A bucket may live in another region than the client's; follow S3's redirect to it.
    s3: new S3Client({ ...config, followRegionRedirects: true }),
    ec2: new EC2Client(config),
    rds: new RDSClient(config),
    ssm: new SSMClient(config),
  };
}

/** An SDK error's name and HTTP status, never its message (which may echo request details). */
export function describeAwsError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const name = typeof e.name === "string" ? e.name : "Error";
  const status = typeof e.$metadata?.httpStatusCode === "number" ? ` (HTTP ${e.$metadata.httpStatusCode})` : "";
  return `${name}${status}`;
}

/** The HTTP status of an SDK error, if it carries one. */
export function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

/** The SDK error's name, if it has one. */
export function errorNameOf(error: unknown): string | undefined {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : undefined;
}

export type CredentialCheck = { readonly ok: true; readonly accountId: string } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Deploy and setup-account step 1, credential part: names any missing variable, then calls STS
 * `GetCallerIdentity`. Sends nothing when a variable is missing.
 */
export async function checkCredentials(env: Environment, sts: STSClient): Promise<CredentialCheck> {
  const missing = missingCredentials(env);
  if (missing.length > 0) return { ok: false, problems: missing };
  try {
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    if (!identity.Account) return { ok: false, problems: ["AWS credentials are not usable: STS GetCallerIdentity returned no account"] };
    return { ok: true, accountId: identity.Account };
  } catch (error) {
    return { ok: false, problems: [`AWS credentials are not usable: STS GetCallerIdentity failed with ${describeAwsError(error)}`] };
  }
}

/**
 * The environment SST runs with: the caller's, plus the account region and the settings the
 * Cloudflare target also uses (DEC-0107). `NODE_USE_ENV_PROXY=1` serves SST's Node side; the
 * Go side's CA handling (`SSL_CERT_FILE`) is wired by the CLI (G-11).
 */
export function sstEnvironment(env: Environment, region: string): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
  return { ...kept, AWS_REGION: region, NODE_USE_ENV_PROXY: "1", SST_TELEMETRY_DISABLED: "1", CI: "1" };
}
