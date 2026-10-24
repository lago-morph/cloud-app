/**
 * The SST app of one AWS stage, built from the app definition alone (PROV-REQ-001; aws.md §2;
 * AWS-REQ-001…005; DEC-0438…DEC-0444). Apps contain no IaC: the framework writes
 * `sst.config.ts` into `<app>/.framework/provision/aws/` on every deploy and remove and runs
 * SST there. It mirrors `provision/cloudflare/sst.ts`.
 *
 * The program declares:
 * - `Files`: the stage bucket (`sst.aws.Bucket`, fixed name `<app>-<stage>-files-<account>`,
 *   SST's default public-access block, and no CORS rule unless one is given);
 * - `Database`: the stage cluster (`sst.aws.Aurora`, Postgres PAR-110, Data API, PAR-212 scaling
 *   with the PAR-213 pause, placed in the account's shared network (DEC-0074), fixed
 *   identifier, no final snapshot, no deletion protection). Its credentials secret is SST's,
 *   with recovery window 0, and is named `<app>-<stage>-database-credentials` by `$transform`;
 * - when the Function's code is given: `Router` (`sst.aws.Router`, no domain), `Site`
 *   (`sst.aws.StaticSite` on the router, the prebuilt client) and `Http` (`sst.aws.Function`,
 *   fixed name, the built bundle, `nodejs22.x` on `arm64` (PAR-272/273, both set explicitly:
 *   SST's defaults are Node 24 and x86_64), 1024 MB, PAR-270 timeout, a Function URL with no
 *   CORS of its own, routed at `/api` with the PAR-271 read timeout, `router.url` as
 *   `FRAMEWORK_PUBLIC_ORIGIN` (one phase, DEC-0439), no VPC (AWS-REQ-002), explicit
 *   `permissions` on exact ARNs and **no `link`**, and a role that trusts Lambda only
 *   (DEC-0443)).
 * `removal: "remove"` so nothing is retained; `home: "aws"` keeps state in SST's bootstrap
 * bucket; `state.purge` makes a remove that leaves nothing also delete the stage's state and
 * passphrase. All inputs are embedded as JSON, never as code. Secrets are never declared: a
 * `SECRET_*` variable is refused (they are SSM parameters read per request, SEC-REQ-003).
 *
 * Step 3 (long-lived infrastructure; DEC-0440, the AWS form of root cause
 * 2026-10-23-pass1): SST 4.17.2 resolves `--target` only in the stage's stored state and adds
 * `--target-dependents`. So a stage with a database runs `sst deploy --target Files,Database`
 * with the full program, and a stage without one (a first deploy) runs an untargeted deploy of
 * the program without the Function, which declares only `Files` and `Database`
 * (`infrastructureDeploy`). Nothing under Http, Site or Router takes an output of Files or
 * Database: they use the fixed names and the secret ARN read back from step 3's output, so a
 * targeted step 3 never redeploys the Function with new code. Step 5 runs a full `sst deploy`.
 * Not yet run against AWS: phase L's first deploy verifies the generated program.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "../core/operations.js";
import type { SstExec } from "../cloudflare/sst.js";
import { AWS_PROVIDER, logBucketName, type SharedNetwork } from "./account.js";
import { sstEnvironment, type Environment } from "./environment.js";
import { LAMBDA_VARIABLES } from "../../targets/aws/variables.js";
import { checkClusterIdentifier, checkDatabaseSecretArn, clusterArn, clusterIdentifier, databaseSecretName, filesBucketName, functionName, stageArns } from "./names.js";

export { processSstExec, sstBinary, type SstExec } from "../cloudflare/sst.js";

/** PAR-270: the HTTP Lambda timeout. */
export const LAMBDA_TIMEOUT = "55 seconds";
/** PAR-271: the API read timeout at the router (SST's and CloudFront's maximum). */
export const ROUTER_READ_TIMEOUT = "60 seconds";
/** PAR-272, PAR-273, PAR-274 (DEC-0433). */
export const LAMBDA_RUNTIME = "nodejs22.x";
export const LAMBDA_ARCHITECTURE = "arm64";
export const LAMBDA_MEMORY = "1024 MB";
/** PAR-212 (capacity range) and PAR-213 (auto-pause delay). */
export const AURORA_SCALING = { min: "0 ACU", max: "4 ACU", pauseAfter: "5 minutes" } as const;
/** The router path the Function serves (http.md; aws.md §2). */
export const API_PATH = "/api";

/** The SST components holding the long-lived infrastructure (step 3's `--target`). */
export const INFRASTRUCTURE_COMPONENTS = ["Files", "Database"] as const;
/** Step 3's `--target` value on a stage that has a database. */
export const INFRASTRUCTURE_TARGET = INFRASTRUCTURE_COMPONENTS.join(",");

/**
 * The framework variables the program sets on the Function: the runtime's own list
 * (`targets/aws/variables.ts`, read by `awsLambdaSettings`; DEC-0469).
 */
export { LAMBDA_VARIABLES };

/** The data API calls the Function makes on its cluster (SQL §2 AWS; DEC-0037). */
export const DATA_API_ACTIONS = [
  "rds-data:ExecuteStatement",
  "rds-data:BatchExecuteStatement",
  "rds-data:BeginTransaction",
  "rds-data:CommitTransaction",
  "rds-data:RollbackTransaction",
] as const;

/** The account values every stage program needs (from setup-account and the preflight). */
export interface AwsAccountSettings {
  readonly accountId: string;
  /** The account's region: the log bucket's location (DEC-0075). */
  readonly region: string;
  /** The shared network (DEC-0074): its subnets and security group place the cluster. */
  readonly network: Pick<SharedNetwork, "subnetIds" | "securityGroupId">;
  /** PAR-110 in the region, as the engine check resolved it (e.g. `17.5`). */
  readonly auroraVersion: string;
}

/** The built code of the stage's Function and its settings (from `build --target aws`, G-06). */
export interface FunctionCode {
  /** The directory holding the built Lambda bundle. */
  readonly bundle: string;
  /** The handler, relative to the bundle (e.g. `index.handler`). */
  readonly handler: string;
  /** The client's static assets, if the app has a client. */
  readonly assetsDirectory?: string;
  /** Framework variables (CFG delivery); never `SECRET_*`. The program adds `LAMBDA_VARIABLES`. */
  readonly variables?: Readonly<Record<string, string>>;
}

/** A CORS rule for the files bucket (FILES; built by the AWS files store, G-04). */
export interface FilesCors {
  readonly allowOrigins: readonly string[];
  readonly allowMethods: readonly ("GET" | "PUT" | "HEAD" | "POST" | "DELETE")[];
  readonly allowHeaders: readonly string[];
  readonly exposeHeaders: readonly string[];
  readonly maxAge: `${number} seconds`;
}

export interface SstInput {
  readonly stage: Stage;
  readonly account: AwsAccountSettings;
  /** The files bucket's CORS rule; absent means no CORS rule (no cross-origin access). */
  readonly filesCors?: FilesCors;
  /** The stage's Function; absent when only the long-lived infrastructure is declared (step 3 of a first deploy, remove). */
  readonly http?: {
    /** The current database: an input, never in SST's state. */
    readonly database: string;
    /** The credentials secret's full ARN, read back from step 3's output (`stageOutputs`). */
    readonly databaseSecretArn: string;
    readonly code: FunctionCode;
  };
}

/** One IAM statement of the Function's role. */
export interface PolicyStatement {
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

/**
 * The Function's explicit IAM statements (AWS-REQ-003; SEC-AC-003): exact ARNs only. A wildcard
 * appears only in an object-key or parameter-path position under the stage's own prefix, never
 * in a resource name. With no `link`, SST adds only `AWSLambdaBasicExecutionRole`.
 */
export function functionPermissions(input: Pick<SstInput, "stage" | "account">, databaseSecretArn: string): PolicyStatement[] {
  const { stage, account } = input;
  checkDatabaseSecretArn(stage, account.region, account.accountId, databaseSecretArn);
  const arns = stageArns(stage, account.region, account.accountId);
  return [
    { actions: [...DATA_API_ACTIONS], resources: [arns.cluster] },
    { actions: ["secretsmanager:GetSecretValue"], resources: [databaseSecretArn] },
    { actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resources: [arns.filesObjects] },
    { actions: ["s3:ListBucket"], resources: [arns.filesBucket] },
    { actions: ["s3:PutObject"], resources: [arns.logObjects] },
    { actions: ["ssm:GetParameter"], resources: [arns.secretParameters] },
  ];
}

const RESERVED_PREFIXES = ["SECRET_", "AWS_", "LAMBDA_", "SST_"];
const FRAMEWORK_SET: ReadonlySet<string> = new Set(Object.values(LAMBDA_VARIABLES));

function refuseVariables(names: readonly string[]): void {
  for (const name of names) {
    if (name.startsWith("SECRET_")) throw new Error(`the Lambda variable ${name}: SECRET_* names are never environment variables; secrets are SSM parameters read per request (SEC-REQ-003)`);
    if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) throw new Error(`the Lambda variable ${name} uses a prefix the Lambda runtime or SST reserves`);
    if (FRAMEWORK_SET.has(name)) throw new Error(`the Lambda variable ${name} is set by the stage program itself`);
  }
}

const isNonEmpty = (values: readonly string[]): boolean => values.length > 0 && values.every((v) => v !== "");

/** The generated `sst.config.ts`. */
export function sstProgram(input: SstInput): string {
  const { stage, account } = input;
  checkClusterIdentifier(stage);
  if (!isNonEmpty(account.network.subnetIds) || account.network.securityGroupId === "") throw new Error("the shared network's subnets and security group are required; run setup-account --target aws");
  if (account.auroraVersion === "") throw new Error("the Aurora engine version (PAR-110) is required");
  const h = input.http;
  if (h) refuseVariables(Object.keys(h.code.variables ?? {}));
  const http = h
    ? {
        name: functionName(stage),
        bundle: h.code.bundle,
        handler: h.code.handler,
        assetsDirectory: h.code.assetsDirectory ?? null,
        runtime: LAMBDA_RUNTIME,
        architecture: LAMBDA_ARCHITECTURE,
        memory: LAMBDA_MEMORY,
        timeout: LAMBDA_TIMEOUT,
        readTimeout: ROUTER_READ_TIMEOUT,
        path: API_PATH,
        environment: {
          ...h.code.variables,
          [LAMBDA_VARIABLES.databaseName]: h.database,
          [LAMBDA_VARIABLES.databaseClusterArn]: clusterArn(stage, account.region, account.accountId),
          [LAMBDA_VARIABLES.databaseSecretArn]: h.databaseSecretArn,
          [LAMBDA_VARIABLES.filesBucket]: filesBucketName(stage, account.accountId),
          [LAMBDA_VARIABLES.logBucket]: logBucketName(account.accountId),
          [LAMBDA_VARIABLES.accountId]: account.accountId,
        },
        publicOriginVariable: LAMBDA_VARIABLES.publicOrigin,
        permissions: functionPermissions(input, h.databaseSecretArn),
      }
    : null;
  const data = {
    app: stage.app,
    region: account.region,
    provider: AWS_PROVIDER,
    filesBucket: filesBucketName(stage, account.accountId),
    filesCors: input.filesCors ?? null,
    cluster: clusterIdentifier(stage),
    databaseSecret: databaseSecretName(stage),
    vpc: { subnets: [...account.network.subnetIds], securityGroups: [account.network.securityGroupId] },
    auroraVersion: account.auroraVersion,
    scaling: AURORA_SCALING,
    http,
  };
  return `/// <reference path="./.sst/platform/config.d.ts" />
// Generated by @lago-morph/prototype-framework (PROV) for stage ${stage.stage}. Do not edit: rewritten on every deploy and remove.
type Seconds = \`\${number} seconds\`;
interface StageInput {
  app: string;
  region: string;
  provider: string;
  filesBucket: string;
  filesCors: null | {
    allowOrigins: string[];
    allowMethods: ("GET" | "PUT" | "HEAD" | "POST" | "DELETE")[];
    allowHeaders: string[];
    exposeHeaders: string[];
    maxAge: Seconds;
  };
  cluster: string;
  databaseSecret: string;
  vpc: { subnets: string[]; securityGroups: string[] };
  auroraVersion: string;
  scaling: { min: \`\${number} ACU\`; max: \`\${number} ACU\`; pauseAfter: \`\${number} minutes\` };
  http: null | {
    name: string;
    bundle: string;
    handler: string;
    assetsDirectory: string | null;
    runtime: "nodejs22.x";
    architecture: "arm64";
    memory: \`\${number} MB\`;
    timeout: Seconds;
    readTimeout: Seconds;
    path: string;
    environment: Record<string, string>;
    publicOriginVariable: string;
    permissions: { actions: string[]; resources: string[] }[];
  };
}
const input: StageInput = ${JSON.stringify(data, null, 2)};

export default $config({
  app() {
    return {
      name: input.app,
      removal: "remove",
      home: "aws",
      state: { purge: true },
      providers: { aws: { version: input.provider, region: input.region as aws.Region } },
    };
  },
  async run() {
    // The Aurora credentials secret has no component transform: name it so remove and
    // listStageResources find it by exact name. SST already sets its recovery window to 0.
    $transform(aws.secretsmanager.Secret, (args, _opts, name) => {
      if (args && name === "DatabaseProxySecret") args.name = input.databaseSecret;
    });

    new sst.aws.Bucket("Files", {
      cors: input.filesCors ?? false,
      transform: { bucket: (args) => { args.bucket = input.filesBucket; } },
    });

    const database = new sst.aws.Aurora("Database", {
      engine: "postgres",
      version: input.auroraVersion,
      dataApi: true,
      scaling: input.scaling,
      vpc: input.vpc,
      transform: {
        cluster: (args) => {
          args.clusterIdentifier = input.cluster;
          args.skipFinalSnapshot = true;
          args.deletionProtection = false;
        },
      },
    });

    const h = input.http;
    if (!h) return { databaseSecretArn: database.secretArn, clusterArn: database.clusterArn };

    // Nothing below takes an output of Files or Database (step 3 safety): literals only.
    const router = new sst.aws.Router("Router");
    if (h.assetsDirectory !== null) {
      new sst.aws.StaticSite("Site", { path: h.assetsDirectory, router: { instance: router } });
    }
    const http = new sst.aws.Function("Http", {
      name: h.name,
      bundle: h.bundle,
      handler: h.handler,
      runtime: h.runtime,
      architecture: h.architecture,
      memory: h.memory,
      timeout: h.timeout,
      environment: { ...h.environment, [h.publicOriginVariable]: router.url },
      permissions: h.permissions,
      url: {
        cors: false,
        router: { instance: router, path: h.path, readTimeout: h.readTimeout },
      },
      transform: {
        // SST 4.17.2 tests \`!dev\` on an Output (always truthy), so every role would also trust
        // the account root. Trust Lambda only.
        role: (args) => {
          args.assumeRolePolicy = aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" });
        },
      },
    });
    return { databaseSecretArn: database.secretArn, clusterArn: database.clusterArn, url: router.url, functionUrl: http.url };
  },
});
`;
}

/** Writes the stage's SST app into `dir`. */
export function writeSstApp(dir: string, input: SstInput): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sst.config.ts"), sstProgram(input));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: `${input.stage.app}-sst`, private: true, type: "module" }, null, 2)}\n`);
}

/**
 * Step 3's program and run (DEC-0440; root cause 2026-10-23-pass1). A stage with a
 * database has passed a step 3 before (its first database is created only after one), so
 * `Files` and `Database` are in SST's state and `--target Files,Database` resolves; the program
 * is the full one, so the targeted run deletes nothing. A stage without one gets an untargeted
 * run of the program without the Function. Refused: a database without built code, since the
 * Function-less program would then be targeted at a stage whose Function exists. The caller
 * (G-10) also refuses the untargeted run when the stage's Function exists, which it would delete.
 */
export function infrastructureDeploy(input: SstInput, hasDatabase: boolean): { readonly input: SstInput; readonly target?: string } {
  if (!hasDatabase) {
    return { input: { stage: input.stage, account: input.account, ...(input.filesCors === undefined ? {} : { filesCors: input.filesCors }) } };
  }
  if (!input.http) throw new Error("no built Function code; build --target aws must run before deploy (step 3 of a stage with a database declares its Function)");
  return { input, target: INFRASTRUCTURE_TARGET };
}

/** The outputs a deploy of the stage program returns (SST writes them to `.sst/outputs.json`). */
export interface StageOutputs {
  readonly databaseSecretArn: string;
  readonly clusterArn: string;
  /** Present after a deploy that declared the Function. */
  readonly url?: string;
  readonly functionUrl?: string;
}

/** Reads the last deploy's outputs from the SST app directory and checks they are the stage's. */
export function stageOutputs(dir: string, input: Pick<SstInput, "stage" | "account">): StageOutputs {
  const file = join(dir, ".sst", "outputs.json");
  if (!existsSync(file)) throw new Error(`SST wrote no outputs (${file}); run the stage's step 3 first`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const text = (key: string): string | undefined => (typeof raw[key] === "string" && raw[key] !== "" ? raw[key] : undefined);
  const secret = text("databaseSecretArn");
  const cluster = text("clusterArn");
  if (secret === undefined || cluster === undefined) throw new Error(`SST's outputs (${file}) have no databaseSecretArn or clusterArn`);
  const { stage, account } = input;
  checkDatabaseSecretArn(stage, account.region, account.accountId, secret);
  if (cluster !== clusterArn(stage, account.region, account.accountId)) throw new Error(`SST's output clusterArn ${cluster} is not the stage's cluster ${clusterArn(stage, account.region, account.accountId)}`);
  const url = text("url");
  const functionUrl = text("functionUrl");
  return { databaseSecretArn: secret, clusterArn: cluster, ...(url === undefined ? {} : { url }), ...(functionUrl === undefined ? {} : { functionUrl }) };
}

export interface SstRun {
  /** The SST app directory written by `writeSstApp`. */
  readonly dir: string;
  readonly env: Environment;
  readonly stage: Stage;
  /** The account's region; SST and its provider run there. */
  readonly region: string;
}

const TAIL_LINES = 25;

/** `sst <command> --stage <stage>` (installing SST's platform first when the directory has none). */
export async function runSst(exec: SstExec, run: SstRun, command: "deploy" | "remove", options: { readonly target?: string } = {}): Promise<void> {
  const env = sstEnvironment(run.env, run.region);
  const invoke = async (args: string[]) => {
    const r = await exec(args, { cwd: run.dir, env });
    if (r.code !== 0) {
      const tail = r.output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
      throw new Error(`sst ${args.join(" ")} failed (exit ${r.code}):\n${tail}`);
    }
  };
  if (!existsSync(join(run.dir, ".sst", "platform"))) await invoke(["install", "--stage", run.stage.stage]);
  await invoke([command, "--stage", run.stage.stage, ...(options.target === undefined ? [] : ["--target", options.target])]);
}
