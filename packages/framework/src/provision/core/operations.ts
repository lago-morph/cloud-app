/**
 * The per-target operations interface of PROV (provisioning.md §2 "Per-target operations").
 *
 * The target-neutral core (`deploy.ts`, `remove.ts`, `setup-account.ts`) sequences these
 * operations; each target (Cloudflare: D-03/D-04; AWS later) implements them. Nothing here
 * names a cloud: the core never learns how a target stops an app, copies a database or keeps
 * its shared resources. `createServices` (runtime) lives in each target runtime, not here.
 *
 * Errors: an operation reports failure by throwing; the core turns every throw into a
 * reported failure (failed step, stage state, next action) and a non-zero exit status.
 * Error messages must never contain a credential or secret value (CLI-REQ-004).
 */
import type { MigrationDatabase, Histories } from "../../mig/apply.js";
import type { Dialect } from "../../sql/dialect.js";

/** One stage of one app. Names follow PAR-290 / PAR-291 (checked by the build before PROV runs). */
export interface Stage {
  readonly app: string;
  readonly stage: string;
}

/** A CLI-owned stage database, named `<app>-<stage>-db-<n>` (migrations.md §2). */
export interface StageDatabase {
  /** The logical and physical name, `<app>-<stage>-db-<n>`. */
  readonly name: string;
  /** `<n>` of the name. */
  readonly number: number;
  /** The target's exact identifier for it (Cloudflare: the D1 UUID). */
  readonly id: string;
}

/** A database as a target lists it, before the core matches its name against the anchored pattern. */
export interface ListedDatabase {
  readonly name: string;
  readonly id: string;
}

/**
 * One account-level shared resource (PROV-REQ-004; e.g. the shared log bucket, the state home).
 * `foreign`: a resource of that name exists but this account does not own it.
 */
export interface SharedResource {
  /** The resource's name as printed to the owner, e.g. `R2 bucket prototype-logs`. */
  readonly name: string;
  readonly state: "owned" | "absent" | "foreign";
}

/** A resource of one stage, by the target's exact identifier (never a wildcard). */
export interface StageResource {
  /** What it is, for the owner, e.g. `Worker`, `R2 bucket`, `R2 API token`. */
  readonly kind: string;
  readonly id: string;
}

/** What `listStageResources` returns: the stage's resources and every database the target lists. */
export interface StageResources {
  readonly resources: readonly StageResource[];
  /** All databases the target can see; the core keeps only exact pattern matches for this stage. */
  readonly databases: readonly ListedDatabase[];
}

/** Input to `deployInfrastructure` (step 3) and `deployCode` (step 5). */
export interface DeployInput {
  readonly stage: Stage;
  /** The current database: an input to the provisioning tool, never in its state. Absent in step 3 of a first deploy. */
  readonly database?: StageDatabase;
}

/** What `deployCode` returns. */
export interface DeployedCode {
  /** The stage's public origin, printed after a successful deploy. */
  readonly publicOrigin: string;
}

/** Result of step 7. On failure, the error code and requestId the stage answered with, where it gave them. */
export type HealthOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly status?: number; readonly code?: string; readonly requestId?: string };

/** The MIG step-4 check's input (migrations.md §2 "Schema-changing cloud deploy" step 4). */
export interface MigrationCheckInput {
  readonly stage: Stage;
  readonly previous: StageDatabase;
  readonly next: StageDatabase;
  /** IDs applied to `next` by this deploy, in order. */
  readonly applied: readonly string[];
  readonly migrations: Histories;
}

export interface TargetOperations {
  /** The target's name, for messages only (`cloudflare`). The core never branches on it. */
  readonly target: string;
  /** The SQL dialect of this target's databases (selects the migration histories). */
  readonly dialect: Dialect;

  /**
   * Deploy step 1, target part: names of missing or unusable prerequisites (credentials, by
   * name only; on Cloudflare the permission to create R2 API tokens). Empty when all is well.
   * Creates nothing.
   */
  preflight(stage: Stage): Promise<readonly string[]>;

  /** The account's shared resources and their state. Changes nothing (PROV-REQ-004; deploy step 1). */
  inspectAccount(): Promise<readonly SharedResource[]>;
  /** Creates the given absent shared resources and records the account settings. Called only when none is foreign. */
  createSharedResources(absent: readonly SharedResource[]): Promise<void>;

  /** Deploy step 3: long-lived infrastructure only (buckets, roles), no new app code. */
  deployInfrastructure(input: DeployInput): Promise<void>;
  /** Deploy step 5: code and bindings, wired to the resolved configuration, secret locations and the current database. */
  deployCode(input: DeployInput & { readonly database: StageDatabase }): Promise<DeployedCode>;

  /** Writes one secret value to its SEC-REQ-003 location. */
  setSecret(stage: Stage, name: string, value: string): Promise<void>;
  /**
   * Names of the secrets set on the stage, or `null` when they cannot be read yet because the
   * stage's runtime does not exist (a stage's first Cloudflare deploy: provisioning.md §2).
   */
  listSetSecrets(stage: Stage): Promise<ReadonlySet<string> | null>;

  /** Stops the app without deleting its code, secrets or bindings (DEC-0078). */
  stopApp(stage: Stage): Promise<void>;
  /** Restarts it; called explicitly on every deploy and after a failed migration or check. */
  startApp(stage: Stage): Promise<void>;

  createDatabase(stage: Stage, name: string): Promise<StageDatabase>;
  /** Creates database `name` as a full copy of `from`. */
  copyDatabase(stage: Stage, from: StageDatabase, name: string): Promise<StageDatabase>;
  dropDatabase(stage: Stage, database: StageDatabase): Promise<void>;
  /** Access to one database's migration record and atomic per-file application (MIG §2 "Record"). */
  migrationDatabase(database: StageDatabase): MigrationDatabase;
  /** The MIG step-4 check; throws with a message naming what failed. */
  checkMigratedDatabase(input: MigrationCheckInput): Promise<void>;

  /** Deploy step 7: health endpoint, plus on a cloud target one CORS preflight to the stage's storage. */
  checkHealth(stage: Stage, deployed: DeployedCode): Promise<HealthOutcome>;

  /** The stage's resources by exact identifier, and the databases the target lists. */
  listStageResources(stage: Stage): Promise<StageResources>;
  /**
   * Removes everything of the stage except its databases, which the core deletes by the exact
   * pattern first: buckets emptied, credentials and secrets the CLI created, provisioning-tool
   * removal (never retaining resources), provisioning state of the stage. Never touches shared
   * resources or other stages. May throw; the core then reports leftovers from `listStageResources`.
   */
  removeStage(stage: Stage): Promise<void>;
}
