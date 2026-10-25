/**
 * The Cloudflare `TargetOperations` (PROV §2 "Per-target operations"; cloudflare.md "Deploy
 * mechanics"; DEC-0267). It owns every Cloudflare call; the target-neutral core sequences them.
 *
 * - `preflight`: the credential variables by name, the token's usability, and the permission
 *   to create R2 API tokens. Reads only.
 * - `inspectAccount` / `createSharedResources`: `account.ts`.
 * - `readAccountSettings` / `writeAccountSettings`: the account settings record
 *   `framework/account.json` in `sst-state` (`account-settings.ts`, DEC-0514).
 * - `setUpEmail` / `emailPrerequisites`: `email.ts`'s seam (the API calls are item I-F).
 * - `deployInfrastructure` (step 3): the stage bucket only, then the bucket's CORS policy for
 *   the stage's public origin (FILES' policy, DEC-0099). With a database, the program declares
 *   the Worker and the run is `sst deploy --target Files`; without one (a first deploy), the
 *   program is bucket-only and the run is untargeted, refused when the Worker exists.
 *   SST resolves `--target` only in the stage's state (root cause 2026-10-23-pass1).
 * - `deployCode` (step 5): a full `sst deploy` with the current database as an input, then the
 *   framework-internal secrets the CLI creates: the session key and the password provider's
 *   secret `frameworkAuthSecret` (each generated when absent, PAR-253), and the stage's R2 signing token as S3 credentials (created when absent; a token whose secrets are
 *   missing is replaced, since its value is shown only once).
 * - `setSecret`, `listSetSecrets`, `stopApp`, `startApp`: `worker.ts`.
 * - Databases: D-04's operations through `databases.ts`.
 * - `checkHealth`: `health.ts` with FILES' storage preflight.
 * - `listStageResources`: the Worker, the bucket, the token and the SST state objects, each by
 *   its exact identifier, plus every D1 database.
 * - `removeStage`: every step attempted: empty the bucket, delete the token, `sst remove` (skipped
 *   when `sst-state` has no `app/<app>/<stage>`; its leftover `app/` object deleted after), then
 *   delete the Worker and the bucket by exact name if they are still there (e.g. when SST's
 *   removal failed or its state was lost), then the stage's SST state objects (DEC-0084).
 *   Failures are collected and thrown together; the core then reports leftovers.
 * Names are fixed per stage (`names.ts`), so nothing depends on local CLI state.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import type { DeployedCode, DeployInput, HealthOutcome, Stage, StageDatabase, StageResource, StageResources, TargetOperations } from "../core/operations.js";
import { accountSubdomain, createSharedResources, inspectSharedResources } from "./account.js";
import { readAccountSettings, writeAccountSettings } from "./account-settings.js";
import { pendingEmailSetup, type CloudflareEmailSetup } from "./email.js";
import { describeFailure, succeeded, type CloudflareApi } from "./api.js";
import type { CloudflareDatabases } from "./databases.js";
import { missingCredentials, type Environment } from "./environment.js";
import { checkStageHealth } from "./health.js";
import { filesBucketName, isStageStateObject, publicOrigin, STATE_BUCKET, workerName } from "./names.js";
import { deleteObjects, listObjectKeys } from "./objects.js";
import { createSigningToken, deleteSigningToken, findSigningToken, tokenCreationProblems } from "./r2-token.js";
import { INFRASTRUCTURE_COMPONENT, processSstExec, runSst, writeSstApp, type SstExec, type WorkerCode } from "./sst.js";
import { listSetSecrets, setRoute, setSecret } from "./worker.js";

/** What FILES (D-02) supplies to provisioning. */
export interface CloudflareFilesProvisioning {
  /** The body of `PUT …/r2/buckets/<bucket>/cors` for the stage's public origin (DEC-0099). */
  bucketCors(origin: string): unknown;
  /** Deploy step 7's CORS preflight to the stage's storage from `origin`. */
  storagePreflight(input: { readonly accountId: string; readonly bucket: string; readonly origin: string }): Promise<HealthOutcome>;
}

export interface CloudflareTargetOptions {
  readonly api: CloudflareApi;
  /** `CLOUDFLARE_ACCOUNT_ID`. */
  readonly accountId: string;
  /** The process environment (credential check by name; SST's environment). */
  readonly env: Environment;
  /** The app directory; SST's app is written to `<appDir>/.framework/provision/cloudflare/`. */
  readonly appDir: string;
  /** D-04's D1 operations: `d1DatabaseOperations({ api, accountId })`. */
  readonly databases: CloudflareDatabases;
  readonly files: CloudflareFilesProvisioning;
  /** The built Worker; required by `deployCode` only (the CLI builds before deploy). */
  readonly code?: WorkerCode;
  readonly sst?: SstExec;
  /** For the health check (needs `NODE_USE_ENV_PROXY=1` in the sandbox). */
  readonly fetch?: typeof fetch;
  /** A new generated framework key: the session key or the auth secret (PAR-253: 32 random bytes, base64url). */
  readonly randomKey?: () => string;
  /** The email setup's Cloudflare calls (item I-F); default `pendingEmailSetup`. */
  readonly email?: CloudflareEmailSetup;
  readonly healthTimeoutMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The directory of the stage's generated SST app. */
export const sstAppDir = (appDir: string): string => join(appDir, ".framework", "provision", "cloudflare");

export function createCloudflareTarget(options: CloudflareTargetOptions): TargetOperations {
  const { api, accountId, databases } = options;
  const sst = options.sst ?? processSstExec();
  const dir = sstAppDir(options.appDir);
  const randomKey = options.randomKey ?? (() => randomBytes(32).toString("base64url"));
  const email = options.email ?? pendingEmailSetup;
  const origin = async (stage: Stage) => publicOrigin(stage, await accountSubdomain(api, accountId));
  const sstRun = (stage: Stage) => ({ dir, env: options.env, stage });
  const mail = (input: DeployInput) => (input.emailDomain === undefined ? {} : { emailDomain: input.emailDomain });

  async function exists(path: string, what: string): Promise<boolean> {
    const r = await api("GET", path);
    if (succeeded(r)) return true;
    if (r.status === 404) return false;
    throw new Error(`checking ${what} failed: ${describeFailure(r)}`);
  }
  const workerPath = (stage: Stage) => `/accounts/${accountId}/workers/scripts/${workerName(stage)}`;
  const bucketPath = (stage: Stage) => `/accounts/${accountId}/r2/buckets/${filesBucketName(stage)}`;

  async function ensureFrameworkSecrets(stage: Stage): Promise<void> {
    const set = (await listSetSecrets(api, accountId, stage)) ?? new Set<string>();
    for (const name of [FRAMEWORK_SECRETS.sessionKey, FRAMEWORK_SECRETS.authSecret]) {
      if (!set.has(name)) await setSecret(api, accountId, stage, name, randomKey());
    }
    if (set.has(FRAMEWORK_SECRETS.r2AccessKeyId) && set.has(FRAMEWORK_SECRETS.r2SecretAccessKey)) return;
    const existing = await findSigningToken(api, accountId, stage);
    if (existing) await deleteSigningToken(api, accountId, existing.id);
    const credentials = await createSigningToken(api, accountId, stage);
    await setSecret(api, accountId, stage, FRAMEWORK_SECRETS.r2AccessKeyId, credentials.accessKeyId);
    await setSecret(api, accountId, stage, FRAMEWORK_SECRETS.r2SecretAccessKey, credentials.secretAccessKey);
  }

  async function stateObjects(stage: Stage): Promise<string[]> {
    return (await listObjectKeys(api, accountId, STATE_BUCKET)).filter((key) => isStageStateObject(stage, key));
  }

  return {
    target: "cloudflare",
    dialect: "sqlite",

    async preflight() {
      const missing = missingCredentials(options.env);
      if (missing.length > 0) return missing;
      const verify = await api("GET", `/accounts/${accountId}/tokens/verify`);
      if (!succeeded(verify)) return [`CLOUDFLARE_API_TOKEN is not usable: ${describeFailure(verify)}`];
      return tokenCreationProblems(api, accountId);
    },

    inspectAccount: () => inspectSharedResources(api, accountId),
    createSharedResources: (absent) => createSharedResources(api, accountId, absent),
    readAccountSettings: () => readAccountSettings(api, accountId),
    writeAccountSettings: (settings) => writeAccountSettings(api, accountId, settings),
    setUpEmail: (emailDomain) => email.setUp(emailDomain),
    emailPrerequisites: (_stage, emailDomain) => email.productionPrerequisites(emailDomain),

    async deployInfrastructure(input: DeployInput) {
      // SST 4.17.2 resolves `--target` only in the stage's previous state (run.go:348-360), so
      // step 3 targets `Files` exactly when the stage has a database: the first database is
      // created only after a step 3 succeeded, which put `Files` in SST's state. Without a
      // database the program is bucket-only and the run is untargeted, which reconciles the
      // whole stage stack and would delete a Worker in state (root cause 2026-10-23-pass1, R1/R2).
      const { database } = input;
      if (database && !options.code) throw new Error("no built Worker code; build --target cloudflare must run before deploy (step 3 of a stage with a database declares its Worker)");
      if (!database && (await exists(`${workerPath(input.stage)}/settings`, `Worker ${workerName(input.stage)}`))) {
        throw new Error(
          `the stage has a Worker ${workerName(input.stage)} but no database; step 3 would delete the Worker with its secrets; restore the database or run remove`,
        );
      }
      const stageOrigin = await origin(input.stage);
      if (database && options.code) {
        writeSstApp(dir, { stage: input.stage, worker: { publicOrigin: stageOrigin, database, code: options.code, ...mail(input) } });
        await runSst(sst, sstRun(input.stage), "deploy", { target: INFRASTRUCTURE_COMPONENT });
      } else {
        writeSstApp(dir, { stage: input.stage });
        await runSst(sst, sstRun(input.stage), "deploy");
      }
      const r = await api("PUT", `${bucketPath(input.stage)}/cors`, options.files.bucketCors(stageOrigin));
      if (!succeeded(r)) throw new Error(`setting the CORS policy of R2 bucket ${filesBucketName(input.stage)} failed: ${describeFailure(r)}`);
    },

    async deployCode(input: DeployInput & { readonly database: StageDatabase }): Promise<DeployedCode> {
      if (!options.code) throw new Error("no built Worker code; build --target cloudflare must run before deploy");
      const stageOrigin = await origin(input.stage);
      writeSstApp(dir, { stage: input.stage, worker: { publicOrigin: stageOrigin, database: input.database, code: options.code, ...mail(input) } });
      await runSst(sst, sstRun(input.stage), "deploy");
      await ensureFrameworkSecrets(input.stage);
      return { publicOrigin: stageOrigin };
    },

    setSecret: (stage, name, value) => setSecret(api, accountId, stage, name, value),
    listSetSecrets: (stage) => listSetSecrets(api, accountId, stage),
    stopApp: (stage) => setRoute(api, accountId, stage, false),
    startApp: (stage) => setRoute(api, accountId, stage, true),

    createDatabase: (stage, name) => databases.createDatabase(stage, name),
    copyDatabase: (stage, from, name) => databases.copyDatabase(stage, from, name),
    dropDatabase: (stage, database) => databases.dropDatabase(stage, database),
    migrationDatabase: (database) => databases.migrationDatabase(database),
    checkMigratedDatabase: (input) => databases.checkMigratedDatabase(input),

    checkHealth: (stage, deployed) =>
      checkStageHealth({
        fetch: options.fetch ?? fetch,
        publicOrigin: deployed.publicOrigin,
        storagePreflight: (o) => options.files.storagePreflight({ accountId, bucket: filesBucketName(stage), origin: o }),
        ...(options.healthTimeoutMs === undefined ? {} : { timeoutMs: options.healthTimeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      }),

    async listStageResources(stage): Promise<StageResources> {
      const resources: StageResource[] = [];
      if (await exists(`${workerPath(stage)}/settings`, `Worker ${workerName(stage)}`)) resources.push({ kind: "Worker", id: workerName(stage) });
      if (await exists(bucketPath(stage), `R2 bucket ${filesBucketName(stage)}`)) resources.push({ kind: "R2 bucket", id: filesBucketName(stage) });
      const token = await findSigningToken(api, accountId, stage);
      if (token) resources.push({ kind: "R2 API token", id: token.id });
      for (const key of await stateObjects(stage)) resources.push({ kind: "SST state object", id: key });
      return { resources, databases: await databases.listDatabases() };
    },

    async removeStage(stage) {
      const failures: string[] = [];
      const attempt = async (run: () => Promise<void>) => {
        try {
          await run();
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      };
      const bucket = filesBucketName(stage);
      await attempt(async () => deleteObjects(api, accountId, bucket, await listObjectKeys(api, accountId, bucket)));
      await attempt(async () => {
        const token = await findSigningToken(api, accountId, stage);
        if (token) await deleteSigningToken(api, accountId, token.id);
      });
      await attempt(async () => {
        // SST knows a stage only by its `app/<app>/<stage>` object (PullState); without it,
        // `sst remove` fails with `Stage not found` and touches nothing, so it is skipped. Only a
        // listing that succeeded can decide that (root cause 2026-10-23-pass1, R3).
        const appState = `app/${stage.app}/${stage.stage}`;
        let keys: string[] | undefined;
        try {
          keys = await listObjectKeys(api, accountId, STATE_BUCKET);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
        if (keys && !keys.includes(appState)) return;
        writeSstApp(dir, { stage });
        await runSst(sst, sstRun(stage), "remove");
        // A successful `sst remove` leaves `app/` behind as an empty checkpoint.
        await deleteObjects(api, accountId, STATE_BUCKET, [appState]);
      });
      await attempt(async () => {
        if (!(await exists(`${workerPath(stage)}/settings`, `Worker ${workerName(stage)}`))) return;
        const r = await api("DELETE", `${workerPath(stage)}?force=true`);
        if (!succeeded(r) && r.status !== 404) throw new Error(`deleting Worker ${workerName(stage)} failed: ${describeFailure(r)}`);
      });
      await attempt(async () => {
        if (!(await exists(bucketPath(stage), `R2 bucket ${bucket}`))) return;
        const r = await api("DELETE", bucketPath(stage));
        if (!succeeded(r) && r.status !== 404) throw new Error(`deleting R2 bucket ${bucket} failed: ${describeFailure(r)}`);
      });
      await attempt(async () => deleteObjects(api, accountId, STATE_BUCKET, await stateObjects(stage)));
      if (failures.length > 0) throw new Error(failures.join("; "));
    },
  };
}
