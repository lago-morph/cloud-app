/**
 * The `deploy` sequence (PROV-REQ-002 steps 1–7; MIG-REQ-006, MIG-REQ-003), target-neutral.
 *
 * Steps stop at the first failure. Every failure is printed with the failed step, the failing
 * migration file and database error where relevant, the stage's state and the next action,
 * and yields exit status 1. A failure while cleaning up after a failure is printed too, but
 * never replaces the original failure (CLI-REQ-003).
 *
 * Step 4 on a stage's first database (created in step 3 of this run) applies the migrations
 * in place: there is no running app and no data to preserve, so there is nothing to stop or
 * copy (DEC-PENDING-C-03-2). Otherwise pending migrations run MIG-REQ-006 steps 1–5: stop,
 * copy into `<app>-<stage>-db-<n+1>`, migrate, check, delete the old database; steps 5 and 6
 * of this sequence then deploy the code against the new database and start the app.
 */
import { applyMigrations, MigrationFailedError, type Histories } from "../../mig/apply.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import { databaseName, matchStageDatabases, nextDatabaseName } from "./databases.js";
import type { DeployedCode, Stage, StageDatabase, TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";
import { foreignResourcesMessage } from "./setup-account.js";

export type DeployStep = "preflight" | "databases" | "infrastructure" | "migrate" | "code" | "start" | "health";

const STEP_LABEL: Record<DeployStep, string> = {
  preflight: "step 1 (preflight)",
  databases: "step 2 (find the databases)",
  infrastructure: "step 3 (long-lived infrastructure)",
  migrate: "step 4 (migrate)",
  code: "step 5 (code)",
  start: "step 6 (start)",
  health: "step 7 (health check)",
};

/** Runner-only abort points (compliance.md §2 "Deploy recovery"); never offered to app owners. */
export type AbortPoint = "after-copy" | "after-code";

export interface DeployRequest {
  readonly stage: Stage;
  /** The framework and app migration histories for the target's dialect. */
  readonly migrations: Histories;
  /** The app's declared secret names; all must be set on the stage. */
  readonly requiredSecrets: readonly string[];
  /** `framework.google.clientId` of the stage's resolved configuration, if any. */
  readonly googleClientId?: string;
  /** Configuration problems (empty when valid), checked in step 1. */
  readonly validateConfiguration?: () => Promise<readonly string[]>;
  /** Set only by the compliance runner. */
  readonly abortAt?: AbortPoint;
  readonly clock?: () => number;
}

export interface DeployFailure {
  readonly step: DeployStep;
  readonly message: string;
  readonly migrationFile?: string;
  readonly databaseError?: string;
  readonly stageState: string;
  readonly nextAction: string;
  /** Failures while cleaning up after the original failure. */
  readonly cleanupErrors: readonly string[];
}

export interface DeployResult {
  readonly status: ProvisionStatus;
  readonly publicOrigin?: string;
  readonly failure?: DeployFailure;
}

class StepFailure extends Error {
  constructor(readonly failure: Omit<DeployFailure, "cleanupErrors"> & { readonly cleanupErrors?: readonly string[] }) {
    super(failure.message);
  }
}

const isTestStage = (stage: Stage) => stage.stage.startsWith("test-");

export async function runDeploy(ops: TargetOperations, request: DeployRequest, io: ProvisionIo): Promise<DeployResult> {
  const { stage } = request;
  try {
    const firstSecretsCheckDeferred = await preflight(ops, request);
    const current = await findDatabases(ops, stage, io);

    await step("infrastructure", "nothing of the new version was deployed; the previous version, if any, is unchanged", "fix the problem and run deploy again", () =>
      ops.deployInfrastructure({ stage, ...(current ? { database: current } : {}) }),
    );

    const database = current ? await migrate(ops, request, current) : await firstDatabase(ops, request);

    const deployed = await step(
      "code",
      `database ${database.name} is current; the app may be stopped`,
      "fix the problem and run deploy again",
      () => ops.deployCode({ stage, database }),
    );
    if (request.abortAt === "after-code") throw abort("after the code deploy", `code deployed against database ${database.name}; the app is not started`);

    if (firstSecretsCheckDeferred) await checkSecretsAfterFirstCode(ops, request);

    await step("start", `new version deployed against database ${database.name}; the app is not started`, "run deploy again", () => ops.startApp(stage));
    await healthCheck(ops, stage, deployed, database);

    line(io, `deployed ${stage.app} stage ${stage.stage} to ${ops.target}; database ${database.name}`);
    line(io, `public origin: ${deployed.publicOrigin}`);
    return { status: EXIT.ok, publicOrigin: deployed.publicOrigin };
  } catch (error) {
    const failure: DeployFailure =
      error instanceof StepFailure
        ? { cleanupErrors: [], ...error.failure }
        : { step: "preflight", message: messageOf(error), stageState: "unknown", nextAction: "fix the problem and run deploy again", cleanupErrors: [] };
    printFailure(io, failure);
    return { status: EXIT.failed, failure };
  }
}

async function step<T>(name: DeployStep, stageState: string, nextAction: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StepFailure) throw error;
    throw new StepFailure({ step: name, message: messageOf(error), stageState, nextAction });
  }
}

function abort(point: string, stageState: string): StepFailure {
  return new StepFailure({
    step: point.includes("copy") ? "migrate" : "code",
    message: `stopped at the runner abort point ${point}`,
    stageState,
    nextAction: "run deploy again",
  });
}

/** Step 1. Returns true when the stage's secrets cannot be read yet (checked after step 5). */
async function preflight(ops: TargetOperations, request: DeployRequest): Promise<boolean> {
  const { stage } = request;
  const missing: string[] = [];
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      missing.push(`${what}: ${messageOf(error)}`);
    }
  };
  let deferred = false;

  await attempt("credentials", async () => {
    missing.push(...(await ops.preflight(stage)));
  });
  await attempt("account's shared resources", async () => {
    const shared = await ops.inspectAccount();
    const foreign = shared.filter((r) => r.state === "foreign").map((r) => r.name);
    const absent = shared.filter((r) => r.state === "absent").map((r) => r.name);
    if (foreign.length > 0) missing.push(foreignResourcesMessage(foreign));
    if (absent.length > 0) missing.push(`the account's shared resources are missing (${absent.join(", ")}); run setup-account --target ${ops.target} first`);
  });
  if (request.validateConfiguration) {
    const validate = request.validateConfiguration;
    await attempt("configuration", async () => {
      missing.push(...(await validate()).map((p) => `configuration: ${p}`));
    });
  }
  const production = !isTestStage(stage);
  if (production && !request.googleClientId) missing.push("framework.google.clientId (required for a production stage)");
  await attempt("secrets", async () => {
    const set = await ops.listSetSecrets(stage);
    if (set === null) {
      deferred = true;
      return;
    }
    const required = [...request.requiredSecrets, ...(production ? [FRAMEWORK_SECRETS.googleClientSecret] : [])];
    for (const name of required) if (!set.has(name)) missing.push(`secret ${name} is not set (set it with secrets set)`);
  });

  if (missing.length > 0) {
    throw new StepFailure({
      step: "preflight",
      message: `missing prerequisites:\n  - ${missing.join("\n  - ")}`,
      stageState: "nothing was created or changed",
      nextAction: "provide the missing prerequisites and run deploy again",
    });
  }
  return deferred;
}

/** Step 2: the lowest-numbered stage database is current; higher-numbered ones are deleted and reported. */
async function findDatabases(ops: TargetOperations, stage: Stage, io: ProvisionIo): Promise<StageDatabase | undefined> {
  const found = await step("databases", "nothing was changed", "run deploy again", async () =>
    matchStageDatabases(stage, (await ops.listStageResources(stage)).databases),
  );
  const [current, ...leftovers] = found;
  for (const db of leftovers) {
    await step("databases", `database ${current?.name} is current; leftover database ${db.name} could not be deleted`, "run deploy again", () =>
      ops.dropDatabase(stage, db),
    );
    line(io, `removed leftover database ${db.name} (left by an interrupted deploy)`);
  }
  return current;
}

function migrationFailure(error: unknown): { message: string; migrationFile?: string; databaseError?: string } {
  if (error instanceof MigrationFailedError) {
    return { message: `migration ${error.migration} failed`, migrationFile: error.file, databaseError: messageOf(error.cause) };
  }
  return { message: messageOf(error) };
}

/** Step 3's first database, with its migrations applied in place (no app is running yet). */
async function firstDatabase(ops: TargetOperations, request: DeployRequest): Promise<StageDatabase> {
  const { stage } = request;
  const database = await step("infrastructure", "no version deployed; no database exists", "fix the problem and run deploy again", () =>
    ops.createDatabase(stage, databaseName(stage, 1)),
  );
  try {
    await applyMigrations(ops.migrationDatabase(database), request.migrations, request.clock);
  } catch (error) {
    const cleanupErrors: string[] = [];
    await ops.dropDatabase(stage, database).catch((e: unknown) => cleanupErrors.push(`deleting new database ${database.name}: ${messageOf(e)}`));
    throw new StepFailure({
      step: "migrate",
      ...migrationFailure(error),
      stageState: cleanupErrors.length === 0 ? "no version deployed; the new database was deleted" : `no version deployed; database ${database.name} left behind (the next deploy reuses or replaces it)`,
      nextAction: "fix the migration and run deploy again",
      cleanupErrors,
    });
  }
  return database;
}

async function pendingCount(ops: TargetOperations, database: StageDatabase, migrations: Histories): Promise<number> {
  const recorded = await ops.migrationDatabase(database).recordedIds();
  return [...migrations.framework, ...migrations.app].filter((m) => !recorded.has(m.id)).length;
}

/** Step 4 on an existing database: MIG-REQ-006 steps 1–5; returns the database the code must use. */
async function migrate(ops: TargetOperations, request: DeployRequest, current: StageDatabase): Promise<StageDatabase> {
  const { stage } = request;
  const pending = await step("migrate", `database ${current.name} unchanged; the app was not stopped`, "run deploy again", () =>
    pendingCount(ops, current, request.migrations),
  );
  if (pending === 0) return current;

  const nextName = nextDatabaseName(stage, current);
  let next: StageDatabase | undefined;
  try {
    await ops.stopApp(stage);
    next = await ops.copyDatabase(stage, current, nextName);
    if (request.abortAt === "after-copy") {
      throw abort("after the database copy", `the app is stopped; databases ${current.name} (current) and ${nextName} (copy) exist; the next deploy deletes the copy`);
    }
    const migrationDb = ops.migrationDatabase(next);
    const { applied } = await applyMigrations(migrationDb, request.migrations, request.clock);
    try {
      await ops.checkMigratedDatabase({ stage, previous: current, next, applied, migrations: request.migrations });
    } catch (error) {
      throw new CheckFailedError(messageOf(error));
    }
    await ops.dropDatabase(stage, current);
    return next;
  } catch (error) {
    if (error instanceof StepFailure) throw error;
    const cleanupErrors = await restorePrevious(ops, stage, nextName, next);
    const restarted = !cleanupErrors.some((e) => e.startsWith("restarting"));
    const leftBehind = cleanupErrors.some((e) => e.startsWith("deleting new database"));
    throw new StepFailure({
      step: "migrate",
      ...(error instanceof CheckFailedError ? { message: `the check of the migrated database failed: ${error.message}` } : migrationFailure(error)),
      stageState:
        `${restarted ? "previous version restarted" : "previous version NOT restarted (start it with deploy again)"}; database ${current.name} unchanged` +
        (leftBehind ? `; new database ${nextName} left behind (the next deploy deletes it)` : ""),
      nextAction: "fix the problem (migration, data or target) and run deploy again",
      cleanupErrors,
    });
  }
}

class CheckFailedError extends Error {}

/** MIG-REQ-003: delete the new database (if it was created), restart the previous version. Never throws. */
async function restorePrevious(ops: TargetOperations, stage: Stage, nextName: string, next: StageDatabase | undefined): Promise<string[]> {
  const errors: string[] = [];
  try {
    const created = next ?? matchStageDatabases(stage, (await ops.listStageResources(stage)).databases).find((d) => d.name === nextName);
    if (created) await ops.dropDatabase(stage, created);
  } catch (error) {
    errors.push(`deleting new database ${nextName}: ${messageOf(error)}`);
  }
  try {
    await ops.startApp(stage);
  } catch (error) {
    errors.push(`restarting the previous version: ${messageOf(error)}`);
  }
  return errors;
}

/** provisioning.md §2 "First Cloudflare deploy": the secrets are checked once step 5 created the runtime. */
async function checkSecretsAfterFirstCode(ops: TargetOperations, request: DeployRequest): Promise<void> {
  const { stage } = request;
  const production = !isTestStage(stage);
  const required = [...request.requiredSecrets, ...(production ? [FRAMEWORK_SECRETS.googleClientSecret] : [])];
  const set = await step("code", "code deployed; the app's secrets could not be read", "run deploy again", async () => (await ops.listSetSecrets(stage)) ?? new Set<string>());
  const missing = required.filter((n) => !set.has(n));
  if (missing.length === 0) return;
  const cleanupErrors: string[] = [];
  await ops.stopApp(stage).catch((e: unknown) => cleanupErrors.push(`stopping the app: ${messageOf(e)}`));
  throw new StepFailure({
    step: "code",
    message: `required secrets are not set: ${missing.join(", ")}`,
    stageState: cleanupErrors.length === 0 ? "code deployed; the app is stopped" : "code deployed; the app could not be stopped",
    nextAction: `set them with secrets set --target ${ops.target} --stage ${stage.stage} <name> (value on standard input), then run deploy again`,
    cleanupErrors,
  });
}

async function healthCheck(ops: TargetOperations, stage: Stage, deployed: DeployedCode, database: StageDatabase): Promise<void> {
  const outcome = await step("health", `new version running against database ${database.name}; health unknown`, "run deploy again", () => ops.checkHealth(stage, deployed));
  if (outcome.ok) return;
  const details = [
    outcome.status !== undefined ? `status ${outcome.status}` : undefined,
    outcome.code !== undefined ? `error code ${outcome.code}` : undefined,
    outcome.requestId !== undefined ? `requestId ${outcome.requestId}` : undefined,
  ].filter((d): d is string => d !== undefined);
  throw new StepFailure({
    step: "health",
    message: `${outcome.message}${details.length > 0 ? ` (${details.join(", ")})` : ""}`,
    stageState: `new version running against database ${database.name}; health check failed`,
    nextAction: "look up the requestId in the stage's log, fix the problem and run deploy again",
  });
}

function printFailure(io: ProvisionIo, f: DeployFailure): void {
  errorLine(io, `deploy failed at ${STEP_LABEL[f.step]}: ${f.message}`);
  if (f.migrationFile !== undefined) errorLine(io, `  migration file: ${f.migrationFile}`);
  if (f.databaseError !== undefined) errorLine(io, `  database error: ${f.databaseError}`);
  for (const e of f.cleanupErrors) errorLine(io, `  cleanup also failed: ${e}`);
  errorLine(io, `  stage state: ${f.stageState}`);
  errorLine(io, `  next action: ${f.nextAction}`);
}
