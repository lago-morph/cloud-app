/**
 * G-S2 spike (throwaway): the SST program of one AWS stage, generated from JSON inputs the way
 * `FW/src/provision/cloudflare/sst.ts` does it for Cloudflare. Not framework code.
 *
 * Components (aws.md §2; plan-aws.md G-S2):
 * - `Files`: `sst.aws.Bucket`, fixed bucket name.                              long-lived (step 3)
 * - `Database`: `sst.aws.Aurora` postgres, Data API, 0–4 ACU, pause after 5 min,
 *   the account's shared VPC ids (setup-account), no final snapshot.           long-lived (step 3)
 * - `Router`: `sst.aws.Router` (CloudFront, no domain, protection "none").     step 5
 * - `Site`: `sst.aws.StaticSite` on the router (prebuilt client).              step 5
 * - `Http`: `sst.aws.Function` with `bundle`, `url.router` path `/api`, PAR-270 timeout,
 *   PAR-271 readTimeout on the route, explicit `permissions`, no `link`.       step 5
 *
 * The Function names the bucket, cluster and credentials secret by LITERAL strings only (inputs),
 * never by component outputs: SST adds `--target-dependents` to every `--target` run, and the
 * spike's target experiment shows that a dependent of a targeted component is redeployed with the
 * new code even when the target itself is unchanged (RESULT.md Q3). `router.url` is an output and
 * may feed the Function: the Router is never a step-3 target and does not depend on the Function.
 */

/** PAR-270 (HTTP Lambda timeout) and PAR-271 (router read timeout). */
export const LAMBDA_TIMEOUT = "55 seconds";
export const ROUTER_READ_TIMEOUT = "60 seconds";
/** PAR-212 / PAR-213. */
export const AURORA_SCALING = { min: "0 ACU", max: "4 ACU", pauseAfter: "5 minutes" } as const;
/** PAR-109. */
export const AWS_PROVIDER = "7.20.0";
/** The SST components holding the long-lived infrastructure (step 3's `--target Files,Database`). */
export const INFRASTRUCTURE_COMPONENTS = ["Files", "Database"] as const;

export interface AwsStageInput {
  readonly app: string;
  readonly stage: string;
  /** The account setting recorded by setup-account (DEC-0075). */
  readonly region: string;
  readonly accountId: string;
  /** The shared VPC of the account and region (DEC-0074), from setup-account. */
  readonly vpc: { readonly subnets: readonly string[]; readonly securityGroups: readonly string[] };
  /** PAR-110, resolved per region by setup-account / preflight. */
  readonly auroraVersion: string;
  /** Present from step 5 on: the built Lambda bundle, the client, and the values only known after step 3. */
  readonly code?: {
    readonly bundle: string;
    readonly handler: string;
    readonly assetsDirectory?: string;
    /** Framework variables (CFG delivery); never `SECRET_*`. */
    readonly variables: Readonly<Record<string, string>>;
    /** The current database (CLI-owned, never in SST state). */
    readonly database: string;
    /** The credentials secret's full ARN, read back after step 3 (it has a random suffix). */
    readonly databaseSecretArn: string;
  };
}

export const names = (i: Pick<AwsStageInput, "app" | "stage" | "accountId" | "region">) => ({
  filesBucket: `${i.app}-${i.stage}-files-${i.accountId}`,
  logBucket: `prototype-logs-${i.accountId}`,
  cluster: `${i.app}-${i.stage}`,
  clusterArn: `arn:aws:rds:${i.region}:${i.accountId}:cluster:${i.app}-${i.stage}`,
  databaseSecret: `${i.app}-${i.stage}-database-credentials`,
  function: `${i.app}-${i.stage}-http`,
  secretsPath: `/${i.app}/${i.stage}/secrets/`,
});

/** The Function's explicit IAM statements (no `link`, so SST adds nothing else but the basic-execution policy). */
export function permissions(i: AwsStageInput) {
  const n = names(i);
  if (!i.code) return [];
  return [
    {
      actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement", "rds-data:BeginTransaction", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"],
      resources: [n.clusterArn],
    },
    { actions: ["secretsmanager:GetSecretValue"], resources: [i.code.databaseSecretArn] },
    { actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resources: [`arn:aws:s3:::${n.filesBucket}/*`] },
    { actions: ["s3:ListBucket"], resources: [`arn:aws:s3:::${n.filesBucket}`] },
    { actions: ["s3:PutObject"], resources: [`arn:aws:s3:::${n.logBucket}/${i.app}/${i.stage}/*`] },
    { actions: ["ssm:GetParameter"], resources: [`arn:aws:ssm:${i.region}:${i.accountId}:parameter${n.secretsPath}*`] },
  ];
}

/** The generated `sst.config.ts`. */
export function awsStageProgram(i: AwsStageInput): string {
  const n = names(i);
  for (const k of Object.keys(i.code?.variables ?? {})) if (k.startsWith("SECRET_")) throw new Error(`${k}: SECRET_* is never an environment variable`);
  const data = {
    app: i.app,
    region: i.region,
    provider: AWS_PROVIDER,
    names: n,
    vpc: i.vpc,
    auroraVersion: i.auroraVersion,
    scaling: AURORA_SCALING,
    infrastructure: INFRASTRUCTURE_COMPONENTS,
    code: i.code
      ? {
          bundle: i.code.bundle,
          handler: i.code.handler,
          assetsDirectory: i.code.assetsDirectory ?? null,
          environment: { ...i.code.variables, FRAMEWORK_DATABASE: i.code.database, FRAMEWORK_DATABASE_SECRET_ARN: i.code.databaseSecretArn, FRAMEWORK_DATABASE_CLUSTER_ARN: n.clusterArn },
          timeout: LAMBDA_TIMEOUT,
          readTimeout: ROUTER_READ_TIMEOUT,
          permissions: permissions(i),
        }
      : null,
  };
  return `/// <reference path="./.sst/platform/config.d.ts" />
// Generated (G-S2 spike) for stage ${i.stage}. Do not edit.
type Seconds = \`\${number} seconds\`;
interface StageInput {
  app: string;
  region: string;
  provider: string;
  names: { filesBucket: string; logBucket: string; cluster: string; clusterArn: string; databaseSecret: string; function: string; secretsPath: string };
  vpc: { subnets: string[]; securityGroups: string[] };
  auroraVersion: string;
  scaling: { min: \`\${number} ACU\`; max: \`\${number} ACU\`; pauseAfter: \`\${number} minutes\` };
  infrastructure: string[];
  code: null | {
    bundle: string;
    handler: string;
    assetsDirectory: string | null;
    environment: Record<string, string>;
    timeout: Seconds;
    readTimeout: Seconds;
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
      // A remove that leaves no resources also deletes the stage's state objects and its
      // /sst/passphrase/<app>/<stage> parameter (run.go:673-682, provider.go:192-204).
      state: { purge: true },
      providers: { aws: { version: input.provider, region: input.region as aws.Region } },
    };
  },
  async run() {
    // The Aurora credentials secret has no component transform; name it so remove and
    // listStageResources can find it by exact name.
    $transform(aws.secretsmanager.Secret, (args, _opts, name) => {
      if (args && name === "DatabaseProxySecret") args.name = input.names.databaseSecret;
    });

    new sst.aws.Bucket("Files", {
      transform: { bucket: (args) => { args.bucket = input.names.filesBucket; } },
    });

    const database = new sst.aws.Aurora("Database", {
      engine: "postgres",
      version: input.auroraVersion,
      dataApi: true,
      scaling: input.scaling,
      vpc: input.vpc,
      transform: {
        cluster: (args) => {
          args.clusterIdentifier = input.names.cluster;
          args.skipFinalSnapshot = true;
          args.deletionProtection = false;
        },
      },
    });

    const c = input.code;
    if (!c) return { databaseSecretArn: database.secretArn, clusterArn: database.clusterArn };

    const router = new sst.aws.Router("Router");
    if (c.assetsDirectory !== null) {
      new sst.aws.StaticSite("Site", { path: c.assetsDirectory, router: { instance: router } });
    }
    const http = new sst.aws.Function("Http", {
      name: input.names.function,
      bundle: c.bundle,
      handler: c.handler,
      runtime: "nodejs22.x",
      architecture: "arm64",
      timeout: c.timeout,
      environment: { ...c.environment, FRAMEWORK_PUBLIC_ORIGIN: router.url },
      permissions: c.permissions,
      url: {
        cors: false,
        router: { instance: router, path: "/api", readTimeout: c.readTimeout },
      },
      transform: {
        // SST 4.17.2 function.ts createRole tests \`!dev\` on an Output (always truthy), so it always
        // writes the dev trust policy, which also trusts the account root. Trust Lambda only.
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
