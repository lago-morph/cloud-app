/**
 * The Cloudflare `TargetOperations` (PROV §2 "Per-target operations"; cloudflare.md "Deploy
 * mechanics"; DEC-0267). It owns every Cloudflare call; the target-neutral core sequences them.
 *
 * - `preflight`: the credential variables by name and the token's usability, and on a production
 *   stage the account's auth app and its registry (PROV-REQ-002's sign-in prerequisite, DEC-0725).
 *   Reads only. It needs no permission on API tokens: the stages' R2 signing credential is an
 *   account resource that `setup-account` creates (DEC-0550), checked by `inspectAccount` like the
 *   other shared resources.
 * - `inspectAccount` / `createSharedResources`: the account steps of `account.ts` (DEC-0578).
 * - No `EMAIL` binding and no email domain: since v0.2.0 a production stage's Worker binds no
 *   `EMAIL` and gets no `FRAMEWORK_MAIL_FROM`, so `deploy` reads nothing from the account settings
 *   record; a 0.1.x stage's binding goes with its next deploy's upload (DEC-0698, DEC-0732).
 * - `setupProblems` / `recordSetup`: `setup-account`'s check (the permission to create the
 *   signing credential while it is absent, DEC-0551) and its last operation, which writes the
 *   setup record (`setup-record.ts`, DEC-0577) with every step completed, at `setupVersion`
 *   (default `FIRST_SETUP_VERSION`) and the framework's version; it writes nothing when the stored
 *   record already says so. Since v0.2.0 there is no email setup (DEC-0689).
 * - The 0.1.x mail sink (`prototype-mailsink`) is still an account resource until the admin app's
 *   cleanup removes it: a stage whose fixed names would be an account resource's is refused by
 *   deploy, the stage listing and removal (`names.ts`).
 * - `deployInfrastructure` (step 3): the stage bucket only, then the bucket's CORS policy for
 *   the stage's public origin (FILES' policy, DEC-0099). With a database, the program declares
 *   the Worker and the run is `sst deploy --target Files`; without one (a first deploy), the
 *   program is bucket-only and the run is untargeted, refused when the Worker exists.
 *   SST resolves `--target` only in the stage's state (root cause 2026-10-23-pass1).
 * - `deployCode` (step 5): a full `sst deploy` with the current database as an input, then the
 *   framework-internal secrets the CLI creates: the session key and the password provider's
 *   secret `frameworkAuthSecret` (each generated when absent, PAR-253), and the account's R2
 *   signing credential as S3 credentials, copied from its record on every deploy (DEC-0550) or,
 *   when the record says it is in Secrets Store, bound from there under the same `SECRET_*` names
 *   in the upload itself, after deleting any copies (DEC-0727, DEC-0729; step 3's targeted run
 *   declares the Worker without them, which it does not deploy). On a
 *   production stage the Worker also binds `AUTH` to the auth app (with its origin), and once the
 *   code is deployed the stage's return URL `<public origin>/api/auth/callback` is registered with
 *   the auth app under the app ID `<app>-<stage>` (DEC-0667, DEC-0725; `worker.ts`).
 * - `setSecret`, `listSetSecrets`, `stopApp`, `startApp`: `worker.ts`.
 * - `readStageRecord`, `writeStageRecord`: the stage record in `sst-state` (`stage-record.ts`,
 *   DEC-0544); `removeStage` deletes it with the stage's state objects.
 * - `backupStage`, `listStageBackups`: the production `remove`'s backup into `prototype-backups` (`backup.ts`,
 *   DEC-0543), through `bytes` and the databases' `exportDatabase`.
 * - Databases: D-04's operations through `databases.ts`.
 * - `checkHealth`: `health.ts` with FILES' storage preflight.
 * - `listStageResources`: the Worker, the bucket, a legacy per-stage signing token (when the
 *   credential may list tokens) and the SST state objects, each by its exact identifier, plus
 *   every D1 database.
 * - `removeStage`: every step attempted: on a production stage clear its return URLs from the auth
 *   app's registry (DEC-0725), empty the bucket, delete a legacy token, `sst remove` (skipped
 *   when `sst-state` has no `app/<app>/<stage>`; its leftover `app/` object deleted after), then
 *   delete the Worker and the bucket by exact name if they are still there (e.g. when SST's
 *   removal failed or its state was lost), then the stage's SST state objects (DEC-0084).
 *   Failures are collected and thrown together; the core then reports leftovers.
 * Names are fixed per stage (`names.ts`), so nothing depends on local CLI state.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { secretLocation } from "../../config/secret-locations.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import type { DeployedCode, DeployInput, HealthOutcome, Stage, StageDatabase, StageResource, StageResources, TargetOperations } from "../core/operations.js";
import { accountSubdomain, createSharedResources, inspectSharedResources, type SharedResourceOptions } from "./account.js";
import { describeFailure, succeeded, type CloudflareApi, type CloudflareBytesApi } from "./api.js";
import { backupStage, IN_FLIGHT_DRAIN_MS, listStageBackups } from "./backup.js";
import { FIRST_SETUP_VERSION, frameworkVersion, SETUP_STEPS, writeSetupRecord } from "./setup-record.js";
import { readStageRecord, writeStageRecord } from "./stage-record.js";
import type { CloudflareDatabases } from "./databases.js";
import { missingCredentials, type Environment } from "./environment.js";
import { checkStageHealth } from "./health.js";
import { accountResourceClash, filesBucketName, isStageStateObject, legacySigningTokenName, publicOrigin, STATE_BUCKET, workerName } from "./names.js";
import { deleteObjects, listObjectKeys } from "./objects.js";
import { deleteSigningToken, findLegacySigningToken, readSigningPlacement, SIGNING_RESOURCE, SIGNING_SECRET_NAMES, signingCredentialState, tokenWriteProblems, type SigningPlacement } from "./r2-token.js";
import { INFRASTRUCTURE_COMPONENT, processSstExec, runSst, writeSstApp, type SecretsStoreBinding, type SstExec, type WorkerCode } from "./sst.js";
import { appOrigin } from "./oauth-clients.js";
import { AUTH_APP_SCRIPT, AUTH_CALLBACK_PATH, cloudflareAuthAppLink, deleteSecret, listSetSecrets, setRoute, setSecret, type AuthAppLink } from "./worker.js";

/** What FILES (D-02) supplies to provisioning. */
export interface CloudflareFilesProvisioning {
  /** The body of `PUT …/r2/buckets/<bucket>/cors` for the stage's public origin (DEC-0099). */
  bucketCors(origin: string): unknown;
  /** Deploy step 7's CORS preflight to the stage's storage from `origin`. */
  storagePreflight(input: { readonly accountId: string; readonly bucket: string; readonly origin: string }): Promise<HealthOutcome>;
}

export interface CloudflareTargetOptions {
  readonly api: CloudflareApi;
  /** Object bytes through the R2 object endpoints (the production `remove`'s backup, DEC-0543); without it a production stage cannot be removed. */
  readonly bytes?: CloudflareBytesApi;
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
  /** The subdomain `setup-account` registers on an account without one (default random, DEC-0552). */
  readonly newSubdomain?: SharedResourceOptions["newSubdomain"];
  /** The account setup version `setup-account` records: the release's `ACCOUNT_SETUP_VERSION` (DEC-0577); default `FIRST_SETUP_VERSION`. */
  readonly setupVersion?: number;
  /** The framework version `setup-account` records; default this package's (`frameworkVersion()`). */
  readonly frameworkVersion?: string;
  /** A production stage's link to the account's auth app (DEC-0725); default `cloudflareAuthAppLink` over `api`. */
  readonly authApp?: AuthAppLink;
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
  const origin = async (stage: Stage) => publicOrigin(stage, await accountSubdomain(api, accountId));
  const authApp = options.authApp ?? cloudflareAuthAppLink(api, accountId);
  /** Production stages sign in through the auth app; test stages use the mock only (plan §4.3, DEC-0667). */
  const production = (stage: Stage) => !stage.stage.startsWith("test-");
  /** The stage Worker as SST declares it: on a production stage with the auth app's binding and origin (DEC-0667). */
  async function workerInput(input: DeployInput, database: StageDatabase, code: WorkerCode) {
    const subdomain = await accountSubdomain(api, accountId);
    const authAppSettings = production(input.stage) ? { authApp: { service: AUTH_APP_SCRIPT, origin: appOrigin("signin", subdomain) } } : {};
    return { publicOrigin: publicOrigin(input.stage, subdomain), database, code, ...authAppSettings };
  }
  const sstRun = (stage: Stage) => ({ dir, env: options.env, stage });
  /** Whether this setup-account run created a shared resource, so the setup record's time is renewed. */
  let setupChanged = false;

  async function exists(path: string, what: string): Promise<boolean> {
    const r = await api("GET", path);
    if (succeeded(r)) return true;
    if (r.status === 404) return false;
    throw new Error(`checking ${what} failed: ${describeFailure(r)}`);
  }
  const workerPath = (stage: Stage) => `/accounts/${accountId}/workers/scripts/${workerName(stage)}`;
  const bucketPath = (stage: Stage) => `/accounts/${accountId}/r2/buckets/${filesBucketName(stage)}`;

  /** Where this deploy takes the signing credential from (DEC-0729); throws when the account has none. */
  async function signingPlacement(): Promise<SigningPlacement> {
    const placement = await readSigningPlacement(api, accountId);
    if (!placement) throw new Error(`the account's ${SIGNING_RESOURCE} is missing; run setup-account --target cloudflare with the setup token (DEC-0551)`);
    return placement;
  }

  /** The signing credential's Secrets Store bindings, under the names of the Worker secrets they replace (DEC-0727). */
  const signingBindings = (storeId: string): SecretsStoreBinding[] => [
    { binding: secretLocation("cloudflare", FRAMEWORK_SECRETS.r2AccessKeyId), storeId, secretName: SIGNING_SECRET_NAMES.accessKeyId },
    { binding: secretLocation("cloudflare", FRAMEWORK_SECRETS.r2SecretAccessKey), storeId, secretName: SIGNING_SECRET_NAMES.secretAccessKey },
  ];

  async function ensureFrameworkSecrets(stage: Stage, placement: SigningPlacement): Promise<void> {
    const set = (await listSetSecrets(api, accountId, stage)) ?? new Set<string>();
    for (const name of [FRAMEWORK_SECRETS.sessionKey, FRAMEWORK_SECRETS.authSecret]) {
      if (!set.has(name)) await setSecret(api, accountId, stage, name, randomKey());
    }
    // Bound from Secrets Store by the upload itself (DEC-0729); otherwise the Worker-secret fallback.
    if (placement.kind === "secrets-store") return;
    // Written on every deploy, so a stage with a legacy per-stage token, or one deployed before the
    // credential was replaced, signs with the account's current credential (DEC-0550).
    const { credentials } = placement;
    await setSecret(api, accountId, stage, FRAMEWORK_SECRETS.r2AccessKeyId, credentials.accessKeyId);
    await setSecret(api, accountId, stage, FRAMEWORK_SECRETS.r2SecretAccessKey, credentials.secretAccessKey);
  }

  /** Refuses a stage whose fixed names are an account resource's (`names.ts`), before any request. */
  function refuseAccountResourceClash(stage: Stage): void {
    const clash = accountResourceClash(stage);
    if (clash !== undefined) throw new Error(clash);
  }

  async function stateObjects(stage: Stage): Promise<string[]> {
    return (await listObjectKeys(api, accountId, STATE_BUCKET)).filter((key) => isStageStateObject(stage, key));
  }

  return {
    target: "cloudflare",
    dialect: "sqlite",
    appResourceKind: "Worker",

    async preflight(stage) {
      const clash = accountResourceClash(stage);
      if (clash !== undefined) return [clash];
      const missing = missingCredentials(options.env);
      if (missing.length > 0) return missing;
      const verify = await api("GET", `/accounts/${accountId}/tokens/verify`);
      if (!succeeded(verify)) return [`CLOUDFLARE_API_TOKEN is not usable: ${describeFailure(verify)}`];
      // PROV-REQ-002 step 1, a production stage's sign-in prerequisite: the auth app and its registry (DEC-0725).
      return production(stage) ? await authApp.problems() : [];
    },

    inspectAccount: () => inspectSharedResources(api, accountId),
    async createSharedResources(absent, note) {
      if (absent.length > 0) setupChanged = true;
      await createSharedResources(api, accountId, absent, options.newSubdomain === undefined ? {} : { newSubdomain: options.newSubdomain }, note);
    },
    async setupProblems() {
      return (await signingCredentialState(api, accountId)) === "absent" ? [...(await tokenWriteProblems(api, accountId))] : [];
    },
    async recordSetup() {
      const written: string[] = [];
      // The last step of setup-account: every step is done now, so the setup record is written (DEC-0577).
      // A write is reported, so a run that only records a new version does not say "nothing changed".
      await writeSetupRecord(
        api,
        accountId,
        {
          completedSteps: SETUP_STEPS,
          setupVersion: options.setupVersion ?? FIRST_SETUP_VERSION,
          frameworkVersion: options.frameworkVersion ?? frameworkVersion(),
          now: () => new Date((options.now ?? Date.now)()),
        },
        setupChanged,
        (record) => written.push(`account setup record (setup version ${String(record.setupVersion)})`),
      );
      setupChanged = false;
      return written;
    },

    async deployInfrastructure(input: DeployInput) {
      // SST 4.17.2 resolves `--target` only in the stage's previous state (run.go:348-360), so
      // step 3 targets `Files` exactly when the stage has a database: the first database is
      // created only after a step 3 succeeded, which put `Files` in SST's state. Without a
      // database the program is bucket-only and the run is untargeted, which reconciles the
      // whole stage stack and would delete a Worker in state (root cause 2026-10-23-pass1, R1/R2).
      const { database } = input;
      refuseAccountResourceClash(input.stage);
      if (database && !options.code) throw new Error("no built Worker code; build --target cloudflare must run before deploy (step 3 of a stage with a database declares its Worker)");
      if (!database && (await exists(`${workerPath(input.stage)}/settings`, `Worker ${workerName(input.stage)}`))) {
        throw new Error(
          `the stage has a Worker ${workerName(input.stage)} but no database; step 3 would delete the Worker with its secrets; restore the database or run remove`,
        );
      }
      const stageOrigin = await origin(input.stage);
      if (database && options.code) {
        writeSstApp(dir, { stage: input.stage, worker: await workerInput(input, database, options.code) });
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
      refuseAccountResourceClash(input.stage);
      const placement = await signingPlacement();
      const fromStore = placement.kind === "secrets-store" ? { secretsStore: signingBindings(placement.storeId) } : {};
      const worker = { ...(await workerInput(input, input.database, options.code)), ...fromStore };
      // A Worker cannot hold a secret and a binding of one name: copies an earlier deploy made go first (DEC-0727).
      if (placement.kind === "secrets-store") for (const name of [FRAMEWORK_SECRETS.r2AccessKeyId, FRAMEWORK_SECRETS.r2SecretAccessKey]) await deleteSecret(api, accountId, input.stage, name);
      writeSstApp(dir, { stage: input.stage, worker });
      await runSst(sst, sstRun(input.stage), "deploy");
      await ensureFrameworkSecrets(input.stage, placement);
      // The return URL is registered once the Worker that answers it exists, before step 6 starts it (DEC-0725).
      if (production(input.stage)) await authApp.register(workerName(input.stage), `${worker.publicOrigin}${AUTH_CALLBACK_PATH}`);
      return { publicOrigin: worker.publicOrigin };
    },

    setSecret: (stage, name, value) => setSecret(api, accountId, stage, name, value),
    listSetSecrets: (stage) => listSetSecrets(api, accountId, stage),
    stopApp: (stage) => setRoute(api, accountId, stage, false),
    startApp: (stage) => setRoute(api, accountId, stage, true),
    readStageRecord: (stage) => readStageRecord(api, accountId, stage),
    writeStageRecord: (stage, record) => writeStageRecord(api, accountId, stage, record),

    async backupStage(stage, stageDatabases) {
      refuseAccountResourceClash(stage);
      if (!options.bytes) throw new Error("no byte transfer for R2 objects is configured, so the stage's files cannot be backed up");
      return backupStage(
        { api, bytes: options.bytes, accountId, exportDatabase: (d) => databases.exportDatabase(d), ...(options.now === undefined ? {} : { now: options.now }) },
        stage,
        stageDatabases,
      );
    },

    async waitForInFlight() {
      // A request the route took before it was turned off may still be writing: wait PAR-315 for it.
      await (options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(IN_FLIGHT_DRAIN_MS);
      return `waited ${IN_FLIGHT_DRAIN_MS / 1000} s (PAR-315) for requests in flight`;
    },

    async listStageBackups(stage) {
      refuseAccountResourceClash(stage);
      if (!options.bytes) throw new Error("no byte transfer for R2 objects is configured, so the stage's backups cannot be read");
      return listStageBackups({ api, bytes: options.bytes, accountId }, stage);
    },

    createDatabase: (stage, name) => databases.createDatabase(stage, name),
    copyDatabase: (stage, from, name) => databases.copyDatabase(stage, from, name),
    dropDatabase: (stage, database) => databases.dropDatabase(stage, database),
    migrationDatabase: (database) => databases.migrationDatabase(database),
    checkMigratedDatabase: (input) => databases.checkMigratedDatabase(input),

    checkHealth: async (stage, deployed) =>
      checkStageHealth({
        fetch: options.fetch ?? fetch,
        publicOrigin: deployed?.publicOrigin ?? (await origin(stage)),
        storagePreflight: (o) => options.files.storagePreflight({ accountId, bucket: filesBucketName(stage), origin: o }),
        ...(options.healthTimeoutMs === undefined ? {} : { timeoutMs: options.healthTimeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      }),

    async listStageResources(stage): Promise<StageResources> {
      refuseAccountResourceClash(stage);
      const resources: StageResource[] = [];
      if (await exists(`${workerPath(stage)}/settings`, `Worker ${workerName(stage)}`)) resources.push({ kind: "Worker", id: workerName(stage) });
      if (await exists(bucketPath(stage), `R2 bucket ${filesBucketName(stage)}`)) resources.push({ kind: "R2 bucket", id: filesBucketName(stage) });
      const token = await findLegacySigningToken(api, accountId, stage);
      if (token) resources.push({ kind: "R2 API token", id: token.id });
      for (const key of await stateObjects(stage)) resources.push({ kind: key.startsWith("framework/") ? "stage record" : "SST state object", id: key });
      return { resources, databases: await databases.listDatabases() };
    },

    // The core calls this before it deletes anything of the stage: nobody new signs in to a stage
    // being removed, and its outstanding codes go too (DEC-0725, DEC-0730). Test stages are not registered.
    async unregisterStage(stage) {
      if (production(stage)) await authApp.unregister(workerName(stage));
    },

    async removeStage(stage) {
      refuseAccountResourceClash(stage);
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
        const token = await findLegacySigningToken(api, accountId, stage);
        if (token) await deleteSigningToken(api, accountId, token.id, legacySigningTokenName(stage));
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
