/**
 * The AWS `TargetOperations` (PROV §2 "Per-target operations"; aws.md "Deploy mechanics";
 * DEC-0267). It mirrors `provision/cloudflare/target.ts` and owns every AWS call of a stage; the
 * target-neutral core sequences them. Nothing here has run against AWS yet (phase L).
 *
 * - `preflight`, `inspectAccount`, `createSharedResources`: `account.ts` (G-07).
 * - `deployInfrastructure` (step 3) through G-08's `infrastructureDeploy`/`runSst`: with a
 *   database, the full program and `sst deploy --target Files,Database`; without one (a first
 *   deploy), an untargeted run of the program without the Function, **refused when the stage's
 *   Function exists**, since that run would delete it (root cause 2026-10-23-pass1, R1/R2).
 * - `deployCode` (step 5): the session key is generated when its parameter is absent, then a
 *   full `sst deploy` with the current database as an input, then the files bucket's CORS rule
 *   for the public origin (`router.url`, read from the run's outputs) set by API: the program
 *   declares `cors: false`, so SST never manages or overwrites it (DEC-0482).
 * - `setSecret`, `listSetSecrets`: SSM SecureString parameters `/<app>/<stage>/secrets/<name>`
 *   (SEC-REQ-003). They do not depend on the Function, so the listing is never `null`.
 * - `stopApp` / `startApp`: the Function's reserved concurrency 0 / removed (DEC-0078).
 * - Databases: G-09's Data API operations, built per stage once the cluster's credentials
 *   secret exists (its ARN is looked up by its fixed name, never read from local state).
 * - `checkHealth`: the shared health check (`cloudflare/health.ts`) with FILES' S3 preflight.
 * - `listStageResources`: the fixed-name resources (Function, files bucket, cluster, credentials
 *   secret), every parameter under `/<app>/<stage>/`, SST's passphrase parameter, the stage's
 *   SST state objects, and every other resource SST tagged `sst:app`/`sst:stage` (Resource
 *   Groups Tagging API, in the account's region and in us-east-1 for CloudFront), each by its
 *   exact identifier; plus the cluster's databases. It reads nothing local.
 * - `removeStage`, in order, every step attempted: empty the files bucket (every version and
 *   delete marker), delete the parameters under `/<app>/<stage>/`, `sst remove` (skipped when
 *   the state bucket has no `app/<app>/<stage>.json`), force-delete the credentials secret
 *   (no recovery window, DEC-0441), then delete the stage's SST state objects (every
 *   version) and its passphrase parameter, but only when `sst remove` succeeded or was skipped:
 *   otherwise they are kept so that a later remove can run SST again. Failures are collected
 *   and thrown together; the core then reports leftovers.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { DeleteFunctionConcurrencyCommand, GetFunctionCommand, LambdaClient, PutFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand, RDSClient } from "@aws-sdk/client-rds";
import type { RDSDataClient } from "@aws-sdk/client-rds-data";
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { DeleteObjectsCommand, HeadBucketCommand, HeadObjectCommand, ListObjectVersionsCommand, PutBucketCorsCommand, S3Client, type ObjectIdentifier } from "@aws-sdk/client-s3";
import { DeleteSecretCommand, DescribeSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DeleteParameterCommand, DeleteParametersCommand, GetParameterCommand, GetParametersByPathCommand, PutParameterCommand, SSMClient, type Parameter } from "@aws-sdk/client-ssm";
import { secretLocation } from "../../config/secret-locations.js";
import { bucketCorsArgs, checkStorageCors } from "../../files/aws/cors.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import { createDataApiClient } from "../../sql/data-api.js";
import { checkStageHealth } from "../cloudflare/health.js";
import type { DeployedCode, DeployInput, ListedDatabase, Stage, StageDatabase, StageResource, StageResources, TargetOperations } from "../core/operations.js";
import { awsAccount, bootstrapStateBucket, type AwsAccount } from "./account.js";
import { awsDatabaseOperations, type AwsDatabaseOperations } from "./databases.js";
import { checkEngine } from "./engine.js";
import { clientConfig, describeAwsError, errorNameOf, httpStatusOf, type Environment } from "./environment.js";
import { checkDatabaseSecretArn, clusterArn, clusterIdentifier, databaseSecretName, filesBucketName, functionName, secretsPath } from "./names.js";
import { infrastructureDeploy, processSstExec, runSst, stageOutputs, writeSstApp, type AwsAccountSettings, type FunctionCode, type SstExec, type SstInput } from "./sst.js";

/** The SDK clients of a stage's operations, all in the account's region except `globalTagging`. */
export interface AwsStageClients {
  readonly s3: S3Client;
  readonly ssm: SSMClient;
  readonly lambda: LambdaClient;
  readonly secrets: SecretsManagerClient;
  readonly rds: RDSClient;
  readonly tagging: ResourceGroupsTaggingAPIClient;
  /** The Tagging API in us-east-1, where CloudFront's resources are listed. */
  readonly globalTagging: ResourceGroupsTaggingAPIClient;
  readonly dataApi: RDSDataClient;
}

/** The region where the Tagging API lists global (CloudFront) resources. */
export const GLOBAL_TAGGING_REGION = "us-east-1";

/** Builds the stage clients for `region` with the proxy-aware handler (DEC-0479). */
export function createAwsStageClients(env: Environment, region: string): AwsStageClients {
  const config = clientConfig(env, region);
  const tagging = new ResourceGroupsTaggingAPIClient(config);
  return {
    s3: new S3Client({ ...config, followRegionRedirects: true }),
    ssm: new SSMClient(config),
    lambda: new LambdaClient(config),
    secrets: new SecretsManagerClient(config),
    rds: new RDSClient(config),
    tagging,
    globalTagging: region === GLOBAL_TAGGING_REGION ? tagging : new ResourceGroupsTaggingAPIClient(clientConfig(env, GLOBAL_TAGGING_REGION)),
    dataApi: createDataApiClient({ region }),
  };
}

/** SST's default tags on every resource of a stage (G-S2 §2). */
export const SST_TAGS = { app: "sst:app", stage: "sst:stage" } as const;

/** SST's passphrase parameter of a stage (`aws.go` `pathForPassphrase`); outside `/<app>/<stage>/`. */
export const sstPassphraseParameter = (stage: Stage): string => `/sst/passphrase/${stage.app}/${stage.stage}`;

/** SST's checkpoint of a stage in the state bucket: its presence is how SST knows the stage. */
export const sstCheckpointKey = (stage: Stage): string => `app/${stage.app}/${stage.stage}.json`;

/**
 * The stage's SST state in the state bucket, as SST's own purge lists it (`aws.go` `purge`):
 * two exact keys and four prefixes ending in `/`. Matched exactly, so another stage whose name
 * starts with this one's is never touched.
 */
export function sstStatePrefixes(stage: Stage): string[] {
  const { app, stage: s } = stage;
  return [`app/${app}/${s}.json`, `secret/${app}/${s}.json`, `update/${app}/${s}/`, `summary/${app}/${s}/`, `eventlog/${app}/${s}/`, `snapshot/${app}/${s}/`];
}

const isStageStateKey = (prefix: string, key: string): boolean => (prefix.endsWith("/") ? key.startsWith(prefix) : key === prefix);

/** The stage path whose parameters `remove` deletes (provisioning.md §2 "Removal"). */
export const stageParameterPath = (stage: Stage): string => `/${stage.app}/${stage.stage}/`;

/**
 * The stage of a CLI-owned database name `<app>-<stage>-db-<n>`. App names have no hyphens
 * (PAR-290), so the app ends at the first hyphen.
 */
export function stageOfDatabase(name: string): Stage {
  const m = /^([^-]+)-(.+)-db-\d+$/.exec(name);
  if (!m) throw new Error(`${name} is not a stage database name (<app>-<stage>-db-<n>)`);
  return { app: m[1]!, stage: m[2]! };
}

export interface AwsTargetOptions {
  /** The process environment (credentials by name; SST's environment; the proxy). */
  readonly env: Environment;
  /** The app directory; SST's app is written to `<appDir>/.framework/provision/aws/`. */
  readonly appDir: string;
  /** G-07's account operations (default `awsAccount({ env })`). */
  readonly account?: AwsAccount;
  /** Builds the stage clients for the account's region (default `createAwsStageClients`). */
  readonly clients?: (region: string) => AwsStageClients;
  /** G-09's Data API operations on the stage's cluster (default `awsDatabaseOperations`). */
  readonly databases?: (options: { readonly client: RDSDataClient; readonly resourceArn: string; readonly secretArn: string }) => AwsDatabaseOperations;
  /** The built Function (G-06); required by step 3 of a stage with a database and by `deployCode`. */
  readonly code?: FunctionCode;
  readonly sst?: SstExec;
  /** For the health check (needs `NODE_USE_ENV_PROXY=1` in the sandbox). */
  readonly fetch?: typeof fetch;
  /** A new session signing key (PAR-253: 32 random bytes, base64url). */
  readonly randomKey?: () => string;
  readonly healthTimeoutMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The directory of the stage's generated SST app. */
export const sstAppDir = (appDir: string): string => join(appDir, ".framework", "provision", "aws");

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const notFound = (error: unknown, ...names: string[]): boolean => names.includes(errorNameOf(error) ?? "") || httpStatusOf(error) === 404;

/** One fixed batch of an array. */
function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The kind of an ARN for the owner (`lambda function`, `cloudfront distribution`, …). */
export function kindOfArn(arn: string): string {
  const [, , service = "aws", , , ...rest] = arn.split(":");
  if (service === "s3") return "S3 bucket";
  const resource = rest.join(":");
  const type = /^[^:/]+/.exec(resource)?.[0] ?? "resource";
  return `${service} ${type}`;
}

export function createAwsTarget(options: AwsTargetOptions): TargetOperations {
  const account = options.account ?? awsAccount({ env: options.env });
  const sst = options.sst ?? processSstExec();
  const dir = sstAppDir(options.appDir);
  const randomKey = options.randomKey ?? (() => randomBytes(32).toString("base64url"));
  const databaseOperations = options.databases ?? ((o) => awsDatabaseOperations(o));

  let where: Promise<{ readonly accountId: string; readonly region: string; readonly clients: AwsStageClients }> | undefined;
  const located = () => {
    where ??= (async () => {
      const [accountId, region] = [await account.accountId(), await account.region()];
      return { accountId, region, clients: (options.clients ?? ((r) => createAwsStageClients(options.env, r)))(region) };
    })();
    // A failure is not remembered: the next call tries again.
    where.catch(() => (where = undefined));
    return where;
  };

  // ---- Fixed-name lookups --------------------------------------------------------------------

  async function functionArn(stage: Stage): Promise<string | undefined> {
    const { clients } = await located();
    try {
      const r = await clients.lambda.send(new GetFunctionCommand({ FunctionName: functionName(stage) }));
      return r.Configuration?.FunctionArn ?? functionName(stage);
    } catch (error) {
      if (notFound(error, "ResourceNotFoundException")) return undefined;
      throw new Error(`checking Lambda function ${functionName(stage)} failed: ${describeAwsError(error)}`);
    }
  }

  async function cluster(stage: Stage): Promise<{ readonly arn: string; readonly engineVersion?: string } | undefined> {
    const { clients } = await located();
    try {
      const r = await clients.rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: clusterIdentifier(stage) }));
      const c = r.DBClusters?.[0];
      if (!c) return undefined;
      return { arn: c.DBClusterArn ?? clusterIdentifier(stage), ...(c.EngineVersion === undefined ? {} : { engineVersion: c.EngineVersion }) };
    } catch (error) {
      if (notFound(error, "DBClusterNotFoundFault")) return undefined;
      throw new Error(`checking Aurora cluster ${clusterIdentifier(stage)} failed: ${describeAwsError(error)}`);
    }
  }

  /** The credentials secret's full ARN by its fixed name (DEC-0441), or undefined. */
  async function databaseSecretArn(stage: Stage): Promise<string | undefined> {
    const { clients, region, accountId } = await located();
    let arn: string | undefined;
    try {
      arn = (await clients.secrets.send(new DescribeSecretCommand({ SecretId: databaseSecretName(stage) }))).ARN;
    } catch (error) {
      if (notFound(error, "ResourceNotFoundException")) return undefined;
      throw new Error(`checking Secrets Manager secret ${databaseSecretName(stage)} failed: ${describeAwsError(error)}`);
    }
    if (arn === undefined) return undefined;
    checkDatabaseSecretArn(stage, region, accountId, arn);
    return arn;
  }

  async function filesBucketExists(stage: Stage): Promise<boolean> {
    const { clients, accountId } = await located();
    const bucket = filesBucketName(stage, accountId);
    try {
      await clients.s3.send(new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: accountId }));
      return true;
    } catch (error) {
      if (notFound(error, "NotFound", "NoSuchBucket")) return false;
      throw new Error(`checking S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
    }
  }

  // ---- Account settings for the program --------------------------------------------------------

  async function settings(stage: Stage): Promise<AwsAccountSettings> {
    const { accountId, region, clients } = await located();
    const network = await account.sharedNetwork();
    // An existing cluster keeps its engine version: a newer PAR-110 minor in the region must
    // never upgrade a stage's cluster as a side effect of a deploy or remove.
    const existing = await cluster(stage);
    let auroraVersion = existing?.engineVersion;
    if (auroraVersion === undefined) {
      const engine = await checkEngine(clients.rds, region);
      if (!engine.ok) throw new Error(engine.problem);
      auroraVersion = engine.version;
    }
    return { accountId, region, network: { subnetIds: network.subnetIds, securityGroupId: network.securityGroupId }, auroraVersion };
  }

  const sstRun = async (stage: Stage) => ({ dir, env: options.env, stage, region: (await located()).region });

  // ---- SSM -------------------------------------------------------------------------------------

  async function parametersUnder(path: string, recursive: boolean): Promise<Parameter[]> {
    const { clients } = await located();
    const found: Parameter[] = [];
    let token: string | undefined;
    do {
      let r;
      try {
        r = await clients.ssm.send(new GetParametersByPathCommand({ Path: path, Recursive: recursive, WithDecryption: false, ...(token ? { NextToken: token } : {}) }));
      } catch (error) {
        throw new Error(`listing the SSM parameters under ${path} failed: ${describeAwsError(error)}`);
      }
      found.push(...(r.Parameters ?? []));
      token = r.NextToken;
    } while (token);
    return found;
  }

  async function setSecret(stage: Stage, name: string, value: string): Promise<void> {
    const { clients } = await located();
    const parameter = secretLocation("aws", name, stage);
    try {
      await clients.ssm.send(new PutParameterCommand({ Name: parameter, Value: value, Type: "SecureString", Overwrite: true }));
    } catch (error) {
      // Never the SDK's message: it could echo the request (CLI-REQ-004).
      throw new Error(`setting SSM parameter ${parameter} failed: ${describeAwsError(error)}`);
    }
  }

  async function listSetSecrets(stage: Stage): Promise<Set<string>> {
    const path = secretsPath(stage);
    const names = (await parametersUnder(path, false)).map((p) => p.Name ?? "").filter((n) => n.startsWith(path));
    return new Set(names.map((n) => n.slice(path.length)));
  }

  // ---- S3 --------------------------------------------------------------------------------------

  /** Every version and delete marker of `bucket` whose key passes `keep`, under `prefix`. */
  async function objectVersions(bucket: string, prefix: string | undefined, keep: (key: string) => boolean): Promise<ObjectIdentifier[] | undefined> {
    const { clients, accountId } = await located();
    const ids: ObjectIdentifier[] = [];
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    for (;;) {
      let r;
      try {
        r = await clients.s3.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            ExpectedBucketOwner: accountId,
            ...(prefix === undefined ? {} : { Prefix: prefix }),
            ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
            ...(versionMarker === undefined ? {} : { VersionIdMarker: versionMarker }),
          }),
        );
      } catch (error) {
        if (notFound(error, "NoSuchBucket")) return undefined;
        throw new Error(`listing the objects of S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
      }
      for (const v of [...(r.Versions ?? []), ...(r.DeleteMarkers ?? [])]) {
        if (v.Key !== undefined && keep(v.Key)) ids.push({ Key: v.Key, ...(v.VersionId === undefined ? {} : { VersionId: v.VersionId }) });
      }
      if (!r.IsTruncated) return ids;
      keyMarker = r.NextKeyMarker;
      versionMarker = r.NextVersionIdMarker;
    }
  }

  async function deleteVersions(bucket: string, ids: readonly ObjectIdentifier[]): Promise<void> {
    const { clients, accountId } = await located();
    for (const batch of batches(ids, 1000)) {
      let r;
      try {
        r = await clients.s3.send(new DeleteObjectsCommand({ Bucket: bucket, ExpectedBucketOwner: accountId, Delete: { Objects: batch, Quiet: true } }));
      } catch (error) {
        throw new Error(`deleting objects of S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
      }
      const failed = r.Errors ?? [];
      if (failed.length > 0) throw new Error(`deleting ${failed.length} object(s) of S3 bucket ${bucket} failed, e.g. ${failed[0]?.Key ?? "?"}: ${failed[0]?.Code ?? "error"}`);
    }
  }

  async function stateBucket(): Promise<string | undefined> {
    const { clients, region } = await located();
    return bootstrapStateBucket({ ssm: clients.ssm, region });
  }

  /** The stage's SST state objects (every version and delete marker), or [] without a state home. */
  async function stateVersions(stage: Stage): Promise<{ readonly bucket?: string; readonly ids: ObjectIdentifier[] }> {
    const bucket = await stateBucket();
    if (bucket === undefined) return { ids: [] };
    const ids: ObjectIdentifier[] = [];
    for (const prefix of sstStatePrefixes(stage)) ids.push(...((await objectVersions(bucket, prefix, (key) => isStageStateKey(prefix, key))) ?? []));
    return { bucket, ids };
  }

  // ---- Databases -------------------------------------------------------------------------------

  const dbCache = new Map<string, Promise<AwsDatabaseOperations>>();
  function databasesOf(stage: Stage): Promise<AwsDatabaseOperations> {
    const key = `${stage.app}/${stage.stage}`;
    let p = dbCache.get(key);
    if (!p) {
      p = (async () => {
        const { clients, region, accountId } = await located();
        const secretArn = await databaseSecretArn(stage);
        if (secretArn === undefined) throw new Error(`the stage's database-credentials secret ${databaseSecretName(stage)} does not exist; step 3 (long-lived infrastructure) must run first`);
        return databaseOperations({ client: clients.dataApi, resourceArn: clusterArn(stage, region, accountId), secretArn });
      })();
      dbCache.set(key, p);
      p.catch(() => dbCache.delete(key));
    }
    return p;
  }

  async function listDatabases(stage: Stage): Promise<ListedDatabase[]> {
    if ((await cluster(stage)) === undefined) return [];
    return (await databasesOf(stage)).listDatabases();
  }

  // ---- Tagged resources --------------------------------------------------------------------------

  async function taggedArns(stage: Stage): Promise<string[]> {
    const { clients } = await located();
    const arns: string[] = [];
    const sources = clients.globalTagging === clients.tagging ? [clients.tagging] : [clients.tagging, clients.globalTagging];
    for (const client of sources) {
      let token: string | undefined;
      do {
        let r;
        try {
          r = await client.send(
            new GetResourcesCommand({
              TagFilters: [
                { Key: SST_TAGS.app, Values: [stage.app] },
                { Key: SST_TAGS.stage, Values: [stage.stage] },
              ],
              ...(token ? { PaginationToken: token } : {}),
            }),
          );
        } catch (error) {
          throw new Error(`listing the stage's tagged resources failed: ${describeAwsError(error)}`);
        }
        for (const m of r.ResourceTagMappingList ?? []) if (m.ResourceARN) arns.push(m.ResourceARN);
        token = r.PaginationToken === "" ? undefined : r.PaginationToken;
      } while (token);
    }
    return arns;
  }

  // ---- The operations ------------------------------------------------------------------------------

  return {
    target: "aws",
    dialect: "postgres",

    preflight: () => account.preflight(),
    inspectAccount: () => account.inspectAccount(),
    createSharedResources: (absent) => account.createSharedResources(absent),

    async deployInfrastructure(input: DeployInput) {
      // SST 4.17.2 resolves `--target` only in the stage's stored state (DEC-0440), so
      // step 3 targets `Files,Database` exactly when the stage has a database; without one the
      // run is untargeted and reconciles the whole stage stack, so it would delete a Function in
      // state with the app's code (root cause 2026-10-23-pass1, R1/R2).
      const { stage, database } = input;
      if (database && !options.code) throw new Error("no built Function code; build --target aws must run before deploy (step 3 of a stage with a database declares its Function)");
      if (!database && (await functionArn(stage)) !== undefined) {
        throw new Error(`the stage has a Lambda function ${functionName(stage)} but no database; step 3 would delete the function; restore the database or run remove`);
      }
      const accountSettings = await settings(stage);
      let http: SstInput["http"];
      if (database && options.code) {
        const secretArn = await databaseSecretArn(stage);
        if (secretArn === undefined) throw new Error(`the stage has database ${database.name} but no database-credentials secret ${databaseSecretName(stage)}; run remove and deploy again`);
        http = { database: database.name, databaseSecretArn: secretArn, code: options.code };
      }
      const plan = infrastructureDeploy({ stage, account: accountSettings, ...(http ? { http } : {}) }, database !== undefined);
      writeSstApp(dir, plan.input);
      await runSst(sst, await sstRun(stage), "deploy", plan.target === undefined ? {} : { target: plan.target });
    },

    async deployCode(input: DeployInput & { readonly database: StageDatabase }): Promise<DeployedCode> {
      if (!options.code) throw new Error("no built Function code; build --target aws must run before deploy");
      const { stage } = input;
      const set = await listSetSecrets(stage);
      if (!set.has(FRAMEWORK_SECRETS.sessionKey)) await setSecret(stage, FRAMEWORK_SECRETS.sessionKey, randomKey());

      const accountSettings = await settings(stage);
      const secretArn = await databaseSecretArn(stage);
      if (secretArn === undefined) throw new Error(`the stage's database-credentials secret ${databaseSecretName(stage)} does not exist; step 3 must run first`);
      writeSstApp(dir, { stage, account: accountSettings, http: { database: input.database.name, databaseSecretArn: secretArn, code: options.code } });
      await runSst(sst, await sstRun(stage), "deploy");

      const outputs = stageOutputs(dir, { stage, account: accountSettings });
      if (outputs.url === undefined) throw new Error("SST's outputs have no url (the router's public origin)");
      const publicOrigin = outputs.url.replace(/\/+$/, "");
      const cors = bucketCorsArgs(publicOrigin);
      const { clients, accountId } = await located();
      const bucket = filesBucketName(stage, accountId);
      try {
        await clients.s3.send(
          new PutBucketCorsCommand({
            Bucket: bucket,
            ExpectedBucketOwner: accountId,
            CORSConfiguration: {
              CORSRules: [{ AllowedOrigins: cors.allowOrigins, AllowedMethods: cors.allowMethods, AllowedHeaders: cors.allowHeaders, ExposeHeaders: cors.exposeHeaders, MaxAgeSeconds: Number.parseInt(cors.maxAge, 10) }],
            },
          }),
        );
      } catch (error) {
        throw new Error(`setting the CORS rule of S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
      }
      return { publicOrigin };
    },

    setSecret,
    listSetSecrets,

    async stopApp(stage) {
      const { clients } = await located();
      try {
        await clients.lambda.send(new PutFunctionConcurrencyCommand({ FunctionName: functionName(stage), ReservedConcurrentExecutions: 0 }));
      } catch (error) {
        // No function serves nothing: the app is stopped (e.g. step 5 of the first deploy failed).
        if (notFound(error, "ResourceNotFoundException")) return;
        throw new Error(`stopping Lambda function ${functionName(stage)} (reserved concurrency 0) failed: ${describeAwsError(error)}`);
      }
    },

    async startApp(stage) {
      const { clients } = await located();
      try {
        await clients.lambda.send(new DeleteFunctionConcurrencyCommand({ FunctionName: functionName(stage) }));
      } catch (error) {
        throw new Error(`starting Lambda function ${functionName(stage)} (removing its reserved concurrency) failed: ${describeAwsError(error)}`);
      }
    },

    createDatabase: async (stage, name) => (await databasesOf(stage)).createDatabase(stage, name),
    copyDatabase: async (stage, from, name) => (await databasesOf(stage)).copyDatabase(stage, from, name),
    dropDatabase: async (stage, database) => (await databasesOf(stage)).dropDatabase(stage, database),
    migrationDatabase(database) {
      const ops = () => databasesOf(stageOfDatabase(database.name));
      return {
        dialect: "postgres",
        recordedIds: async () => (await ops()).migrationDatabase(database).recordedIds(),
        applyAtomically: async (migration, appliedAt) => (await ops()).migrationDatabase(database).applyAtomically(migration, appliedAt),
      };
    },
    checkMigratedDatabase: async (input) => (await databasesOf(input.stage)).checkMigratedDatabase(input),

    async checkHealth(stage, deployed) {
      const { accountId, region } = await located();
      const withFetch = options.fetch === undefined ? {} : { fetch: options.fetch };
      return checkStageHealth({
        fetch: options.fetch ?? fetch,
        publicOrigin: deployed.publicOrigin,
        storagePreflight: (origin) => checkStorageCors({ location: { bucket: filesBucketName(stage, accountId), region, accountId }, publicOrigin: origin, ...withFetch }),
        ...(options.healthTimeoutMs === undefined ? {} : { timeoutMs: options.healthTimeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      });
    },

    async listStageResources(stage): Promise<StageResources> {
      const { accountId } = await located();
      const resources: StageResource[] = [];
      const seen = new Set<string>();
      const add = (kind: string, id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        resources.push({ kind, id });
      };
      const fn = await functionArn(stage);
      if (fn !== undefined) add("Lambda function", fn);
      const bucket = filesBucketName(stage, accountId);
      if (await filesBucketExists(stage)) add("S3 bucket", `arn:aws:s3:::${bucket}`);
      const c = await cluster(stage);
      if (c) add("Aurora cluster", c.arn);
      const secret = await databaseSecretArn(stage);
      if (secret !== undefined) add("Secrets Manager secret", secret);
      for (const p of await parametersUnder(stageParameterPath(stage), true)) if (p.Name) add("SSM parameter", p.Name);
      const { clients } = await located();
      try {
        await clients.ssm.send(new GetParameterCommand({ Name: sstPassphraseParameter(stage) }));
        add("SSM parameter", sstPassphraseParameter(stage));
      } catch (error) {
        if (!notFound(error, "ParameterNotFound")) throw new Error(`checking SSM parameter ${sstPassphraseParameter(stage)} failed: ${describeAwsError(error)}`);
      }
      const state = await stateVersions(stage);
      for (const key of new Set(state.ids.map((i) => i.Key ?? ""))) add("SST state object", `${state.bucket}/${key}`);
      // Everything else SST created for the stage (router, distribution, roles, …) by its tags.
      // The fixed-name resources were checked directly above; their tag entries are not repeated.
      const direct = new Set([fn, `arn:aws:s3:::${bucket}`, c?.arn, secret].filter((x): x is string => x !== undefined));
      for (const arn of await taggedArns(stage)) {
        if (direct.has(arn) || arn.endsWith(`:function:${functionName(stage)}`) || arn === `arn:aws:s3:::${bucket}` || arn.endsWith(`:cluster:${clusterIdentifier(stage)}`) || arn.includes(`:secret:${databaseSecretName(stage)}-`)) continue;
        add(kindOfArn(arn), arn);
      }
      return { resources, databases: c ? await listDatabases(stage) : [] };
    },

    async removeStage(stage) {
      const failures: string[] = [];
      const attempt = async (run: () => Promise<void>) => {
        try {
          await run();
        } catch (error) {
          failures.push(messageOf(error));
        }
      };

      // 1. Empty the files bucket: every version and delete marker (SST cannot delete a non-empty bucket).
      await attempt(async () => {
        const { accountId } = await located();
        const bucket = filesBucketName(stage, accountId);
        const ids = await objectVersions(bucket, undefined, () => true);
        if (ids && ids.length > 0) await deleteVersions(bucket, ids);
      });

      // 2. Delete the stage's parameters under /<app>/<stage>/ (its secrets).
      await attempt(async () => {
        const { clients } = await located();
        const names = (await parametersUnder(stageParameterPath(stage), true)).map((p) => p.Name ?? "").filter((n) => n.startsWith(stageParameterPath(stage)));
        for (const batch of batches(names, 10)) {
          try {
            await clients.ssm.send(new DeleteParametersCommand({ Names: batch }));
          } catch (error) {
            throw new Error(`deleting the SSM parameters under ${stageParameterPath(stage)} failed: ${describeAwsError(error)}`);
          }
        }
      });

      // 3. `sst remove`, skipped when SST has no checkpoint of the stage (it would fail with
      //    `Stage not found` and touch nothing). Only a check that succeeded can decide that
      //    (root cause 2026-10-23-pass1, R3).
      let sstDone = false;
      await attempt(async () => {
        let checkpoint: boolean | undefined;
        try {
          const bucket = await stateBucket();
          if (bucket === undefined) checkpoint = false;
          else {
            const { clients, accountId } = await located();
            try {
              await clients.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: sstCheckpointKey(stage), ExpectedBucketOwner: accountId }));
              checkpoint = true;
            } catch (error) {
              if (!notFound(error, "NotFound", "NoSuchKey")) throw new Error(`checking SST's checkpoint ${sstCheckpointKey(stage)} failed: ${describeAwsError(error)}`);
              checkpoint = false;
            }
          }
        } catch (error) {
          failures.push(messageOf(error));
        }
        if (checkpoint === false) {
          sstDone = true;
          return;
        }
        writeSstApp(dir, { stage, account: await settings(stage) });
        await runSst(sst, await sstRun(stage), "remove");
        sstDone = true;
      });

      // 4. Force-delete the credentials secret, with no recovery window (DEC-0441), in
      //    case SST's removal did not, so the name can be created again at once.
      await attempt(async () => {
        const { clients } = await located();
        try {
          await clients.secrets.send(new DeleteSecretCommand({ SecretId: databaseSecretName(stage), ForceDeleteWithoutRecovery: true }));
        } catch (error) {
          if (notFound(error, "ResourceNotFoundException")) return;
          throw new Error(`deleting Secrets Manager secret ${databaseSecretName(stage)} failed: ${describeAwsError(error)}`);
        }
      });

      // 5. The stage's SST state: every version of its state objects, then its passphrase. Kept
      //    when `sst remove` did not succeed: only SST's state knows the cluster's instances, the
      //    router and their dependents, so a later remove must be able to run SST again (and the
      //    state cannot be decrypted without the passphrase). They are then reported as leftovers.
      await attempt(async () => {
        if (!sstDone) throw new Error(`the stage's SST state and passphrase were kept so that remove can run sst remove again`);
        const state = await stateVersions(stage);
        if (state.bucket !== undefined && state.ids.length > 0) await deleteVersions(state.bucket, state.ids);
        const { clients } = await located();
        try {
          await clients.ssm.send(new DeleteParameterCommand({ Name: sstPassphraseParameter(stage) }));
        } catch (error) {
          if (!notFound(error, "ParameterNotFound")) throw new Error(`deleting SSM parameter ${sstPassphraseParameter(stage)} failed: ${describeAwsError(error)}`);
        }
      });

      if (failures.length > 0) throw new Error(failures.join("; "));
    },
  };
}
