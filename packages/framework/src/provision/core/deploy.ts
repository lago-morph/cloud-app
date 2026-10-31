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
 * copy (DEC-0268). Otherwise pending migrations run MIG-REQ-006 steps 1–5: stop,
 * copy into `<app>-<stage>-db-<n+1>`, migrate, check, delete the old database; steps 5 and 6
 * of this sequence then deploy the code against the new database and start the app.
 *
 * A stopped stage (its record says `stopped`, written by `stop`; DEC-0544) stays stopped: step 6
 * turns the app off again instead of starting it (the code deploy may itself turn the route
 * on, DEC-0091), the health check is skipped, and a failed migration leaves the previous version
 * stopped. A failure at or after step 5 (the code deploy itself, the deferred secrets check, the
 * runner's after-code abort) turns the app off again too, and the failure says whether that worked.
 * `start: true` (`deploy --start`) clears the record and starts the app as usual.
 * A database copy's method (native export/import or row by row, DEC-0545) is printed as soon as the
 * copy returns, so also when a later migration step fails (DEC-0561). After a failed migration the
 * previous version is reported restarted only once step 7's health wait finds it answering (DEC-0561).
 */
import { applyMigrations, MigrationFailedError, type Histories } from "../../mig/apply.js";
import { databaseName, matchStageDatabases, nextDatabaseName } from "./databases.js";
import type { DeployedCode, HealthOutcome, Stage, StageDatabase, TargetOperations } from "./operations.js";
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
  /** Configuration problems (empty when valid), checked in step 1. */
  readonly validateConfiguration?: () => Promise<readonly string[]>;
  /** Set only by the compliance runner. */
  readonly abortAt?: AbortPoint;
  /** `deploy --start`: start a stage that `stop` stopped (DEC-0544). Without it a stopped stage stays stopped. */
  readonly start?: boolean;
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
  /** How this deploy copied the database, when it copied one (DEC-0545). */
  readonly copyMethod?: string;
  /** The stage is stopped after the deploy (recorded by `stop`, no `--start`; DEC-0544). */
  readonly stopped?: boolean;
}

class StepFailure extends Error {
  constructor(readonly failure: Omit<DeployFailure, "cleanupErrors"> & { readonly cleanupErrors?: readonly string[] }) {
    super(failure.message);
  }
}

export async function runDeploy(ops: TargetOperations, request: DeployRequest, io: ProvisionIo): Promise<DeployResult> {
  const { stage } = request;
  try {
    const { deferred: firstSecretsCheckDeferred, stopped } = await preflight(ops, request);
    const keepStopped = stopped && request.start !== true;
    const current = await findDatabases(ops, stage, io);
    if (keepStopped) line(io, `stage ${stage.stage} is stopped (recorded by stop); the deploy leaves it stopped (add --start to start it)`);

    await step("infrastructure", "nothing of the new version was deployed; the previous version, if any, is unchanged", "fix the problem and run deploy again", () =>
      ops.deployInfrastructure({ stage, ...(current ? { database: current } : {}) }),
    );

    const migrated = current ? await migrate(ops, request, current, keepStopped, io) : { database: await firstDatabase(ops, request) };
    const { database } = migrated;
    const copied = migrated.copyMethod === undefined ? {} : { copyMethod: migrated.copyMethod };

    let deployed: DeployedCode;
    try {
      deployed = await step(
        "code",
        keepStopped ? `database ${database.name} is current; the code deploy may be partial` : `database ${database.name} is current; the app may be stopped`,
        "fix the problem and run deploy again",
        () => ops.deployCode({ stage, database }),
      );
      if (request.abortAt === "after-code") throw abort("after the code deploy", `code deployed against database ${database.name}; the app is not started`);

      if (firstSecretsCheckDeferred) await checkSecretsAfterFirstCode(ops, request);
    } catch (error) {
      // The code deploy may have turned the route on (DEC-0091) before it failed: a stage recorded
      // as stopped is turned off again on every path after the code step (DEC-0544).
      if (keepStopped && error instanceof StepFailure) throw await stopAgain(ops, stage, error);
      throw error;
    }

    if (keepStopped) {
      // The code deploy may have turned the route on (DEC-0091): turn it off again.
      await step("start", `new version deployed against database ${database.name}; the app may be answering although the stage is recorded as stopped`, "run stop again", () => ops.stopApp(stage));
      line(io, `deployed ${stage.app} stage ${stage.stage} to ${ops.target}; database ${database.name}; the stage is stopped, so the health check was skipped`);
      line(io, `public origin: ${deployed.publicOrigin} (stopped; start it with start --target ${ops.target} --stage ${stage.stage})`);
      return { status: EXIT.ok, publicOrigin: deployed.publicOrigin, stopped: true, ...copied };
    }
    if (stopped) {
      await step("start", `new version deployed against database ${database.name}; the app is not started and is still recorded as stopped`, "run deploy --start again", () =>
        ops.writeStageRecord(stage, { stopped: false }),
      );
    }
    await step("start", `new version deployed against database ${database.name}; the app is not started`, "run deploy again", () => ops.startApp(stage));
    await healthCheck(ops, stage, deployed, database);

    line(io, `deployed ${stage.app} stage ${stage.stage} to ${ops.target}; database ${database.name}`);
    line(io, `public origin: ${deployed.publicOrigin}`);
    // provisioning.md §2 "Publishing the result": the public origin only; since v0.2.0 there is no
    // sign-in page and no sender address to print (DEC-0698, DEC-0732).
    return { status: EXIT.ok, publicOrigin: deployed.publicOrigin, ...copied };
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

/** After a failure at or after the code step of a stage recorded as stopped: turns the app off again and says whether that worked. */
async function stopAgain(ops: TargetOperations, stage: Stage, failure: StepFailure): Promise<StepFailure> {
  const f = failure.failure;
  try {
    await ops.stopApp(stage);
    return new StepFailure({ ...f, stageState: `${f.stageState}; the app was turned off again, as recorded by stop` });
  } catch (error) {
    return new StepFailure({
      ...f,
      cleanupErrors: [...(f.cleanupErrors ?? []), `turning the app off again (the stage is recorded as stopped): ${messageOf(error)}`],
      stageState: `${f.stageState}; the app may be answering although the stage is recorded as stopped`,
      nextAction: `run stop --target ${ops.target} --stage ${stage.stage} now, then ${f.nextAction}`,
    });
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

/**
 * Step 1. `deferred`: the stage's secrets cannot be read yet (checked after step 5).
 * A production stage's login prerequisites (the auth app and its registry) are checked by the
 * target's `preflight`; since v0.2.0 no email domain is needed, and the account settings record is
 * not read (PROV-REQ-002 step 1, DEC-0698, DEC-0732).
 */
async function preflight(ops: TargetOperations, request: DeployRequest): Promise<{ deferred: boolean; stopped: boolean }> {
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
  let stopped = false;

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
  await attempt("stage record", async () => {
    stopped = (await ops.readStageRecord(stage)).stopped;
  });
  await attempt("secrets", async () => {
    const set = await ops.listSetSecrets(stage);
    if (set === null) {
      deferred = true;
      return;
    }
    for (const name of request.requiredSecrets) if (!set.has(name)) missing.push(`secret ${name} is not set (set it with secrets set)`);
  });

  if (missing.length > 0) {
    throw new StepFailure({
      step: "preflight",
      message: `missing prerequisites:\n  - ${missing.join("\n  - ")}`,
      stageState: "nothing was created or changed",
      nextAction: "provide the missing prerequisites and run deploy again",
    });
  }
  return { deferred, stopped };
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

/** Step 4 on an existing database: MIG-REQ-006 steps 1–5; returns the database the code must use and how it was copied. */
async function migrate(
  ops: TargetOperations,
  request: DeployRequest,
  current: StageDatabase,
  keepStopped: boolean,
  io: ProvisionIo,
): Promise<{ database: StageDatabase; copyMethod?: string }> {
  const { stage } = request;
  const pending = await step("migrate", `database ${current.name} unchanged; the app was not stopped`, "run deploy again", () =>
    pendingCount(ops, current, request.migrations),
  );
  if (pending === 0) return { database: current };

  const nextName = nextDatabaseName(stage, current);
  let next: (StageDatabase & { readonly method?: string }) | undefined;
  try {
    await ops.stopApp(stage);
    next = await ops.copyDatabase(stage, current, nextName);
    // provisioning.md §2: which copy ran, printed also when a later step fails (DEC-0561).
    if (next.method !== undefined) line(io, `copied database ${current.name} into ${next.name}: ${next.method}`);
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
    return { database: next, ...(next.method === undefined ? {} : { copyMethod: next.method }) };
  } catch (error) {
    if (error instanceof StepFailure) throw error;
    const { errors: cleanupErrors, health } = await restorePrevious(ops, stage, nextName, next, keepStopped);
    const restarted = !cleanupErrors.some((e) => e.startsWith("restarting"));
    const leftBehind = cleanupErrors.some((e) => e.startsWith("deleting new database"));
    const previous = keepStopped
      ? "previous version left stopped, as recorded by stop"
      : !restarted
        ? "previous version NOT restarted (start it with deploy again)"
        : health === undefined || health.ok
          ? "previous version restarted"
          : `previous version restarted but not answering (${healthSummary(health)})`;
    throw new StepFailure({
      step: "migrate",
      ...(error instanceof CheckFailedError ? { message: `the check of the migrated database failed: ${error.message}` } : migrationFailure(error)),
      stageState:
        `${previous}; database ${current.name} unchanged` +
        (leftBehind ? `; new database ${nextName} left behind (the next deploy deletes it)` : ""),
      nextAction: "fix the problem (migration, data or target) and run deploy again",
      cleanupErrors,
    });
  }
}

class CheckFailedError extends Error {}

/**
 * MIG-REQ-003: delete the new database (if it was created), restart the previous version (unless
 * the stage is recorded as stopped) and run step 7's health wait on it, so that "restarted" means
 * it answers again (PROV-AC-002, MIG-AC-003; DEC-0561). `health` is the wait's outcome, absent
 * when the app was not (re)started. Never throws.
 */
async function restorePrevious(
  ops: TargetOperations,
  stage: Stage,
  nextName: string,
  next: StageDatabase | undefined,
  keepStopped: boolean,
): Promise<{ errors: string[]; health?: HealthOutcome }> {
  const errors: string[] = [];
  try {
    const created = next ?? matchStageDatabases(stage, (await ops.listStageResources(stage)).databases).find((d) => d.name === nextName);
    if (created) await ops.dropDatabase(stage, created);
  } catch (error) {
    errors.push(`deleting new database ${nextName}: ${messageOf(error)}`);
  }
  if (keepStopped) return { errors };
  try {
    await ops.startApp(stage);
  } catch (error) {
    errors.push(`restarting the previous version: ${messageOf(error)}`);
    return { errors };
  }
  let health: HealthOutcome;
  try {
    health = await ops.checkHealth(stage);
  } catch (error) {
    health = { ok: false, message: messageOf(error) };
  }
  return { errors, health };
}

/** A failed health outcome's status and error code, or its message when it has neither. */
function healthSummary(outcome: Extract<HealthOutcome, { ok: false }>): string {
  const details = [outcome.status !== undefined ? `status ${outcome.status}` : undefined, outcome.code !== undefined ? `error code ${outcome.code}` : undefined].filter(
    (d): d is string => d !== undefined,
  );
  return details.length > 0 ? details.join(", ") : outcome.message;
}

/** provisioning.md §2 "First Cloudflare deploy": the secrets are checked once step 5 created the runtime. */
async function checkSecretsAfterFirstCode(ops: TargetOperations, request: DeployRequest): Promise<void> {
  const { stage } = request;
  const required = request.requiredSecrets;
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
