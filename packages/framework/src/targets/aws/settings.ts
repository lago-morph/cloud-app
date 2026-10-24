/**
 * The HTTP Lambda's settings (config.md §2 "Delivery", "AWS"; aws.md §2): provisioning-derived
 * identifiers reach the runtime as Lambda environment variables, and the role's session
 * credentials and region are the variables Lambda itself sets. This is the AWS counterpart of
 * the Cloudflare Worker's `bindings.ts` (reader) and `settings.ts` (the variables provisioning
 * declares, `awsLambdaEnvironment`, which G-08 maps onto the SST Function).
 *
 * Secrets are never environment variables on AWS: they are SSM SecureString parameters, read
 * per request (SEC-REQ-003, `secrets/aws.ts`). So the reader never reads a `SECRET_*` variable,
 * and `awsLambdaEnvironment` refuses to declare one (a Lambda's environment is readable by
 * anyone with `lambda:GetFunctionConfiguration`, SEC-REQ-002).
 *
 * Missing framework variables are `CORE.MISCONFIGURED`, raised on first use, as on Cloudflare.
 * The log bucket is the exception: without it entries fall back to marked output lines and
 * requests are unaffected (LOG-REQ-001; DEC-0457).
 */
import { FrameworkError } from "../../core/errors.js";
import type { Environment } from "./sdk.js";
import { LAMBDA_RUNTIME_VARIABLES, LAMBDA_VARIABLES } from "./variables.js";

/** The variable names, shared with the stage program (`variables.ts`; DEC-0469). */
export { LAMBDA_RUNTIME_VARIABLES, LAMBDA_VARIABLES };

/** The prefix no Lambda variable may carry on AWS (Worker secrets' naming on the other targets). */
export const SECRET_PREFIX = "SECRET_";

/** The execution role's temporary credentials. */
export interface AwsSessionCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Always set in Lambda (role credentials are temporary). */
  readonly sessionToken?: string;
}

/** Where and as whom log entries are stored. */
export interface LogBucketSettings {
  readonly bucket: string;
  /** Sent as `x-amz-expected-bucket-owner`. */
  readonly accountId: string;
  readonly region: string;
  readonly credentials: AwsSessionCredentials;
}

export interface AwsDatabaseSettings {
  readonly clusterArn: string;
  readonly secretArn: string;
  readonly name: string;
}

/** The settings the runtime reads; each required one raises `CORE.MISCONFIGURED` when read unset. */
export interface AwsLambdaSettings {
  readonly region: string;
  readonly accountId: string;
  readonly publicOrigin: string;
  readonly filesBucket: string;
  readonly database: AwsDatabaseSettings;
  readonly credentials: AwsSessionCredentials;
  /** Undefined when any part is missing: logging never fails a request (LOG-REQ-001). */
  readonly logBucket: LogBucketSettings | undefined;
}

function optional(env: Environment, name: string): string | undefined {
  if (name.startsWith(SECRET_PREFIX)) return undefined; // never read, whatever the caller asks
  const value = env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function required(env: Environment, name: string, what: string): string {
  const value = optional(env, name);
  if (value === undefined) throw new FrameworkError("CORE.MISCONFIGURED", `the Lambda variable ${name} (${what}) is not set`);
  return value;
}

function credentialsOf(env: Environment): AwsSessionCredentials | undefined {
  const accessKeyId = optional(env, LAMBDA_RUNTIME_VARIABLES.accessKeyId);
  const secretAccessKey = optional(env, LAMBDA_RUNTIME_VARIABLES.secretAccessKey);
  if (accessKeyId === undefined || secretAccessKey === undefined) return undefined;
  const sessionToken = optional(env, LAMBDA_RUNTIME_VARIABLES.sessionToken);
  return sessionToken === undefined ? { accessKeyId, secretAccessKey } : { accessKeyId, secretAccessKey, sessionToken };
}

/** The Lambda's settings over `env` (the function's `process.env`). Values are read when used. */
export function awsLambdaSettings(env: Environment): AwsLambdaSettings {
  const V = LAMBDA_VARIABLES;
  return Object.freeze({
    get region() {
      return required(env, LAMBDA_RUNTIME_VARIABLES.region, "the function's region");
    },
    get accountId() {
      return required(env, V.accountId, "the account ID");
    },
    get publicOrigin() {
      return required(env, V.publicOrigin, "the stage's public origin");
    },
    get filesBucket() {
      return required(env, V.filesBucket, "the stage's bucket");
    },
    get database() {
      return {
        clusterArn: required(env, V.databaseClusterArn, "the stage's Aurora cluster"),
        secretArn: required(env, V.databaseSecretArn, "the database credentials secret"),
        name: required(env, V.databaseName, "the stage's current database"),
      };
    },
    get credentials() {
      const credentials = credentialsOf(env);
      if (credentials === undefined) {
        throw new FrameworkError(
          "CORE.MISCONFIGURED",
          `the Lambda variables ${LAMBDA_RUNTIME_VARIABLES.accessKeyId} and ${LAMBDA_RUNTIME_VARIABLES.secretAccessKey} (the role's credentials) are not set`,
        );
      }
      return credentials;
    },
    get logBucket() {
      const bucket = optional(env, V.logBucket);
      const accountId = optional(env, V.accountId);
      const region = optional(env, LAMBDA_RUNTIME_VARIABLES.region);
      const credentials = credentialsOf(env);
      if (bucket === undefined || accountId === undefined || region === undefined || credentials === undefined) return undefined;
      return { bucket, accountId, region, credentials };
    },
  });
}

/** What provisioning knows about one stage when it deploys its HTTP Lambda. */
export interface StageLambdaInput {
  readonly publicOrigin: string;
  readonly accountId: string;
  readonly logBucket: string;
  readonly filesBucket: string;
  readonly database: AwsDatabaseSettings;
}

const HTTPS_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/;

/** Refuses variables named `SECRET_*` or reserved by the Lambda runtime (`CORE.MISCONFIGURED`). */
export function checkLambdaEnvironment(variables: Readonly<Record<string, string>>): void {
  const reserved = new Set<string>(Object.values(LAMBDA_RUNTIME_VARIABLES));
  const secrets = Object.keys(variables).filter((name) => name.startsWith(SECRET_PREFIX));
  if (secrets.length > 0) {
    throw new FrameworkError(
      "CORE.MISCONFIGURED",
      `the Lambda environment declares ${secrets.join(", ")}; on AWS secrets are SSM parameters, never environment variables`,
    );
  }
  const runtime = Object.keys(variables).filter((name) => reserved.has(name));
  if (runtime.length > 0) throw new FrameworkError("CORE.MISCONFIGURED", `the Lambda environment declares ${runtime.join(", ")}, which the Lambda runtime sets`);
}

/** The HTTP Lambda's framework variables for one stage (target data for G-08's SST program). */
export function awsLambdaEnvironment(input: StageLambdaInput): Readonly<Record<string, string>> {
  if (!HTTPS_ORIGIN.test(input.publicOrigin)) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the stage's public origin must be an https origin without a path, got ${JSON.stringify(input.publicOrigin)}`);
  }
  const V = LAMBDA_VARIABLES;
  const variables = {
    [V.publicOrigin]: input.publicOrigin,
    [V.accountId]: input.accountId,
    [V.logBucket]: input.logBucket,
    [V.filesBucket]: input.filesBucket,
    [V.databaseClusterArn]: input.database.clusterArn,
    [V.databaseSecretArn]: input.database.secretArn,
    [V.databaseName]: input.database.name,
  };
  checkLambdaEnvironment(variables);
  return Object.freeze(variables);
}
