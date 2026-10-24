/**
 * `deploy --target <t> --stage <s>` (CLI-REQ-001; PROV-REQ-002; D-05).
 *
 * 1. Options: a cloud target (local has `dev`) and a stage; the runner-only abort point comes
 *    from the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT` (`after-copy` | `after-code`,
 *    DEC-0269), which only the compliance runner sets, so it never appears among the owner's
 *    options.
 * 2. The process must be able to reach the cloud (`NODE_USE_ENV_PROXY=1` behind a proxy).
 * 3. `prepare`: build the deployment (`build --target <t> --stage <s>`, plus the client's static
 *    assets) and read what the core needs from the app: the migration histories, the declared
 *    secrets, the stage's Google client ID. Only local files are written.
 * 4. The target-neutral PROV core (`runDeploy`, steps 1–7) on the target's operations. It never
 *    creates the account's shared resources: only `setup-account` does (PROV-REQ-004).
 * 5. On success: record the stage's public origin for `smoke` (`recordDeployOutput`, DEC-0272)
 *    and, for a production stage, print the Google callback URL to register (GOOGLE-REQ-004).
 * Exit 0 only when every step passed (CLI-REQ-003).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildApp, COMPATIBILITY_DATE, type BuildOptions, type BuildResult } from "../../build/build.js";
import { AwsNotImplementedError } from "../../core/aws-pending.js";
import type { Target } from "../../core/identity.js";
import { bucketCorsPolicy, checkStorageCors } from "../../files/cloudflare/cors.js";
import type { Histories } from "../../mig/apply.js";
import { readHistory } from "../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { createCloudflareApi } from "../../provision/cloudflare/api.js";
import { d1DatabaseOperations } from "../../provision/cloudflare/d1/operations.js";
import { missingCredentials } from "../../provision/cloudflare/environment.js";
import { filesBucketName } from "../../provision/cloudflare/names.js";
import type { WorkerCode } from "../../provision/cloudflare/sst.js";
import { createCloudflareTarget } from "../../provision/cloudflare/target.js";
import { runDeploy, type AbortPoint } from "../../provision/core/deploy.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { BINDINGS } from "../../targets/cloudflare/bindings.js";
import { UsageError } from "../args.js";
import { describeFailure } from "../failure.js";
import { EXIT, type Command } from "../io.js";
import { recordDeployOutput } from "./smoke.js";
import { parseCloudTargetStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

/** The runner-only abort point's variable (compliance.md §2 "Deploy recovery"; DEC-0269). */
export const ABORT_AT_VARIABLE = "PROTOTYPE_FRAMEWORK_ABORT_AT";
const ABORT_POINTS: readonly AbortPoint[] = ["after-copy", "after-code"];

/** What `prepare` reads and builds for one deploy. */
export interface PreparedDeploy {
  /** The app's name (`defineApp`). */
  readonly app: string;
  readonly migrations: Histories;
  /** The app's declared secret names. */
  readonly requiredSecrets: readonly string[];
  /** The stage's `framework.google.clientId`, if configured. */
  readonly googleClientId?: string;
  /** The built code, handed to the target's operations as is. */
  readonly code: unknown;
}

export interface DeployDeps {
  readonly env: ProcessEnvironment;
  prepare(appDir: string, target: Target, stage: string): Promise<PreparedDeploy>;
  operations(input: { readonly appDir: string; readonly target: Target; readonly code?: unknown }): TargetOperations;
  recordDeployOutput(appDir: string, target: Target, stage: string, publicOrigin: string): void;
}

function abortPoint(env: ProcessEnvironment): AbortPoint | undefined {
  const value = env[ABORT_AT_VARIABLE];
  if (value === undefined || value === "") return undefined;
  if (!(ABORT_POINTS as readonly string[]).includes(value)) throw new UsageError(`${ABORT_AT_VARIABLE} must be one of: ${ABORT_POINTS.join(", ")} (it is set only by the compliance runner)`);
  return value as AbortPoint;
}

export function deployCommand(deps: DeployDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseCloudTargetStage("deploy", args);
    const abortAt = abortPoint(deps.env);
    const refused = refuseUnreachableCloud("deploy", deps.env, io);
    if (refused !== undefined) return refused;

    let prepared: PreparedDeploy;
    try {
      prepared = await deps.prepare(io.cwd, target, stage);
    } catch (error) {
      io.stderr(`deploy failed before step 1 (building the deployment): ${describeFailure(error)}\n  stage state: nothing was created or changed\n  next action: fix the problem and run deploy again\n`);
      return EXIT.failed;
    }

    const ops = deps.operations({ appDir: io.cwd, target, code: prepared.code });
    const result = await runDeploy(
      ops,
      {
        stage: { app: prepared.app, stage },
        migrations: prepared.migrations,
        requiredSecrets: prepared.requiredSecrets,
        ...(prepared.googleClientId === undefined ? {} : { googleClientId: prepared.googleClientId }),
        ...(abortAt === undefined ? {} : { abortAt }),
      },
      io,
    );
    if (result.status !== EXIT.ok || result.publicOrigin === undefined) return EXIT.failed;

    deps.recordDeployOutput(io.cwd, target, stage, result.publicOrigin);
    if (!stage.startsWith("test-")) io.stdout(`Google callback URL to register: ${result.publicOrigin}/api/auth/callback\n`);
    return EXIT.ok;
  };
}

// ---------------------------------------------------------------------------------------------
// Real dependencies (Cloudflare). The Cloudflare API is reached only through `fetch`, which the
// unit tests stub: no test of this module contacts Cloudflare.

export interface PrepareDeps {
  /** The build pipeline (`buildApp`). */
  build(options: BuildOptions): Promise<Pick<BuildResult, "deployment" | "resolved" | "outDir" | "bundle">>;
  /** Builds the client's static assets into `outDir`; undefined when the app has no client. */
  buildClient(appDir: string, outDir: string): Promise<string | undefined>;
  /** The package's framework migration histories (`FRAMEWORK_MIGRATIONS_DIR`). */
  readonly frameworkMigrationsDir: string;
  /** `CLOUDFLARE_ACCOUNT_ID`, delivered to the Worker for its R2 tickets. */
  readonly accountId: string | undefined;
}

/** `deploy`'s `prepare` on Cloudflare: build, client, migrations, secrets and the Worker code. */
export function prepareDeploy(deps: PrepareDeps): DeployDeps["prepare"] {
  return async (appDir, target, stage) => {
    if (target === "aws") throw new AwsNotImplementedError("deploy's build, migrations and Lambda code for --target aws (G-06, G-10, G-11)");
    if (target !== "cloudflare") throw new Error(`deploy has no provisioning for target ${target}`);
    const built = await deps.build({ appDir, target, stage });
    const assetsDirectory = await deps.buildClient(appDir, join(built.outDir, "client"));
    const app = built.deployment.app;
    const accountId = deps.accountId ?? "";
    const code: WorkerCode = {
      bundle: built.bundle,
      ...(assetsDirectory === undefined ? {} : { assetsDirectory }),
      compatibilityDate: COMPATIBILITY_DATE,
      variables: { ...(accountId === "" ? {} : { [BINDINGS.r2AccountId]: accountId }), [BINDINGS.filesBucket]: filesBucketName({ app, stage }) },
      logBucketBinding: BINDINGS.logs,
    };
    return {
      app,
      migrations: {
        framework: readHistory(deps.frameworkMigrationsDir, "sqlite", "framework"),
        app: readHistory(join(appDir, "migrations"), "sqlite", "app"),
      },
      requiredSecrets: built.resolved.secrets.map((s) => s.name),
      ...(built.resolved.google === undefined ? {} : { googleClientId: built.resolved.google.clientId }),
      code,
    };
  };
}

/**
 * The client's static assets: Vite builds `<app>/index.html` and what it loads into `outDir`,
 * with the framework's options only (no app Vite configuration, as in `dev`). An app without
 * `index.html` has no client and deploys without assets.
 */
export async function buildClientAssets(appDir: string, outDir: string): Promise<string | undefined> {
  if (!existsSync(join(appDir, "index.html"))) return undefined;
  const { build } = await import("vite");
  await build({
    configFile: false,
    root: appDir,
    cacheDir: join(outDir, "..", ".vite"),
    logLevel: "warn",
    clearScreen: false,
    build: { outDir, emptyOutDir: true },
  });
  return outDir;
}

export interface OperationsOptions {
  readonly env: ProcessEnvironment;
  /** Default the global `fetch` (the process runs with `NODE_USE_ENV_PROXY=1` behind a proxy). */
  readonly fetch?: typeof fetch;
  /**
   * Refuse, naming them, when credential variables are missing (remove, setup-account, secrets).
   * `deploy` leaves it off: its step 1 reports every missing prerequisite itself.
   */
  readonly requireCredentials: boolean;
}

/** The target's PROV operations from the process environment (Cloudflare: D-03 with D-04's databases and D-02's CORS parts). */
export function cloudflareOperations(options: OperationsOptions): DeployDeps["operations"] {
  return ({ appDir, target, code }) => {
    if (target === "aws") throw new AwsNotImplementedError("the AWS provisioning operations (G-07…G-11)");
    if (target !== "cloudflare") throw new Error(`there are no provisioning operations for target ${target}`);
    const env = options.env;
    if (options.requireCredentials) {
      const missing = missingCredentials(env);
      if (missing.length > 0) throw new Error(`missing Cloudflare credentials: ${missing.join(", ")} (set them in the environment; values are never printed)`);
    }
    const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
    const withFetch = options.fetch === undefined ? {} : { fetch: options.fetch };
    const api = createCloudflareApi({ token: env.CLOUDFLARE_API_TOKEN ?? "", ...withFetch });
    return createCloudflareTarget({
      api,
      accountId,
      env,
      appDir,
      databases: d1DatabaseOperations({ api, accountId }),
      files: {
        bucketCors: (origin) => bucketCorsPolicy(origin),
        storagePreflight: ({ accountId: account, bucket, origin }) => checkStorageCors({ accountId: account, bucket, publicOrigin: origin, ...withFetch }),
      },
      ...(code === undefined ? {} : { code: code as WorkerCode }),
      ...withFetch,
    });
  };
}

/** `deploy` bound to the build pipeline, the Cloudflare operations and the recorded deploy output. */
export function deployBinding(env: ProcessEnvironment = process.env): Command {
  return deployCommand({
    env,
    prepare: prepareDeploy({ build: buildApp, buildClient: buildClientAssets, frameworkMigrationsDir: FRAMEWORK_MIGRATIONS_DIR, accountId: env.CLOUDFLARE_ACCOUNT_ID }),
    operations: cloudflareOperations({ env, requireCredentials: false }),
    recordDeployOutput,
  });
}
