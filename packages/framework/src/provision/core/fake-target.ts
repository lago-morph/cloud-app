/**
 * An in-memory target implementing the per-target operations, for unit tests of the PROV core
 * and of the CLI commands that use it (COMPL-AC-007, PROV-AC-007, CLI-AC-003). It keeps one
 * account: shared resources, databases of every stage, and per stage its resources, secrets,
 * deployed code and whether the app answers. Failures are injected per operation.
 *
 * Not a real target: it is never selectable from the CLI.
 */
import type { MigrationDatabase } from "../../mig/apply.js";
import type { Migration } from "../../mig/history.js";
import type { Dialect } from "../../sql/dialect.js";
import type {
  AccountSettings,
  DeployedCode,
  DeployInput,
  HealthOutcome,
  ListedDatabase,
  MigrationCheckInput,
  SharedResource,
  Stage,
  StageDatabase,
  StageResource,
  StageResources,
  TargetOperations,
} from "./operations.js";

export type OperationName = Exclude<keyof TargetOperations, "target" | "dialect">;

interface FakeDatabase {
  readonly id: string;
  readonly records: Set<string>;
  /** Stands for the data: copied by `copyDatabase`, never changed by migrations here. */
  readonly rows: number;
}

interface FakeStage {
  resources: StageResource[];
  /** `null`: the runtime does not exist yet, so secrets cannot be set or read. */
  secrets: Set<string> | null;
  code: { database: string } | null;
  running: boolean;
}

export interface FakeTargetOptions {
  readonly sharedResources?: Readonly<Record<string, SharedResource["state"]>>;
  readonly databases?: readonly { readonly name: string; readonly records?: readonly string[]; readonly rows?: number }[];
  readonly dialect?: Dialect;
  /** The account settings record; default `{ emailDomain: "example.test" }` (a reserved name). */
  readonly accountSettings?: AccountSettings;
}

const key = (s: Stage) => `${s.app}/${s.stage}`;

export class FakeTarget implements TargetOperations {
  readonly target = "fake";
  readonly dialect: Dialect;
  /** Every operation call, in order, as `<operation> <detail>`. */
  readonly calls: string[] = [];
  readonly shared = new Map<string, SharedResource["state"]>();
  readonly databases = new Map<string, FakeDatabase>();
  readonly stages = new Map<string, FakeStage>();
  /** Returned by `preflight`. */
  missingPrerequisites: string[] = [];
  /** The account settings record (`readAccountSettings` / `writeAccountSettings`). */
  accountSettings: AccountSettings;
  /** Returned by `emailPrerequisites`. */
  missingEmailPrerequisites: string[] = [];
  /** Returned by the next `setUpEmail` (then emptied: a second run finds everything in place). */
  emailToCreate: string[] = [];
  /** The `emailDomain` of each `deployInfrastructure` and `deployCode` input, in order. */
  readonly deployedEmailDomains: (string | undefined)[] = [];
  /** Returned by `checkHealth`. */
  health: HealthOutcome = { ok: true };
  /** Migration IDs whose application throws (and is not recorded). */
  readonly failingMigrations = new Map<string, Error>();
  /** Thrown by `checkMigratedDatabase`. */
  checkFailure: Error | undefined;
  /** Resources `removeStage` cannot delete (they stay listed). */
  readonly undeletable = new Set<string>();
  private readonly failures = new Map<OperationName, { error: Error; times: number }>();
  private nextId = 1;

  constructor(options: FakeTargetOptions = {}) {
    this.dialect = options.dialect ?? "sqlite";
    this.accountSettings = options.accountSettings ?? { emailDomain: "example.test" };
    const shared: Readonly<Record<string, SharedResource["state"]>> = options.sharedResources ?? { "log bucket": "owned" };
    for (const [name, state] of Object.entries(shared)) this.shared.set(name, state);
    for (const db of options.databases ?? []) {
      this.databases.set(db.name, { id: this.id(), records: new Set(db.records ?? []), rows: db.rows ?? 0 });
    }
  }

  /** The next `times` calls of `operation` throw `error` (default: every call). */
  fail(operation: OperationName, error: Error = new Error(`${operation} failed`), times = Number.POSITIVE_INFINITY): this {
    this.failures.set(operation, { error, times });
    return this;
  }

  /** Clears injected failures of `operation` (all operations when omitted). */
  heal(operation?: OperationName): this {
    if (operation) this.failures.delete(operation);
    else this.failures.clear();
    return this;
  }

  stageState(stage: Stage): FakeStage {
    let s = this.stages.get(key(stage));
    if (!s) {
      s = { resources: [], secrets: null, code: null, running: false };
      this.stages.set(key(stage), s);
    }
    return s;
  }

  /** Database names of the stage (by plain prefix, for assertions only). */
  databaseNames(stage: Stage): string[] {
    return [...this.databases.keys()].filter((n) => n.startsWith(`${stage.app}-${stage.stage}-db-`)).sort();
  }

  /** Whether the stage's app answers, and against which database. */
  answering(stage: Stage): string | null {
    const s = this.stageState(stage);
    return s.running && s.code && this.databases.has(s.code.database) ? s.code.database : null;
  }

  private id(): string {
    return `fake-${this.nextId++}`;
  }

  private enter(operation: OperationName, detail = ""): void {
    this.calls.push(detail ? `${operation} ${detail}` : operation);
    const f = this.failures.get(operation);
    if (f && f.times > 0) {
      f.times -= 1;
      throw f.error;
    }
  }

  private db(database: StageDatabase): FakeDatabase {
    const db = this.databases.get(database.name);
    if (!db) throw new Error(`database ${database.name} does not exist`);
    return db;
  }

  async preflight(stage: Stage): Promise<readonly string[]> {
    this.enter("preflight", key(stage));
    return [...this.missingPrerequisites];
  }

  async inspectAccount(): Promise<readonly SharedResource[]> {
    this.enter("inspectAccount");
    return [...this.shared].map(([name, state]) => ({ name, state }));
  }

  async createSharedResources(absent: readonly SharedResource[]): Promise<void> {
    this.enter("createSharedResources", absent.map((r) => r.name).join(","));
    for (const r of absent) {
      if (this.shared.get(r.name) === "foreign") throw new Error(`${r.name} belongs to another account`);
      this.shared.set(r.name, "owned");
    }
  }

  async readAccountSettings(): Promise<AccountSettings> {
    this.enter("readAccountSettings");
    return { ...this.accountSettings };
  }

  async writeAccountSettings(settings: AccountSettings): Promise<void> {
    this.enter("writeAccountSettings", settings.emailDomain ?? "");
    this.accountSettings = { ...settings };
  }

  async setUpEmail(emailDomain: string): Promise<readonly string[]> {
    this.enter("setUpEmail", emailDomain);
    const created = this.emailToCreate;
    this.emailToCreate = [];
    return created;
  }

  async emailPrerequisites(stage: Stage, emailDomain: string): Promise<readonly string[]> {
    this.enter("emailPrerequisites", `${key(stage)} ${emailDomain}`);
    return [...this.missingEmailPrerequisites];
  }

  async deployInfrastructure(input: DeployInput): Promise<void> {
    this.enter("deployInfrastructure", key(input.stage));
    this.deployedEmailDomains.push(input.emailDomain);
    const s = this.stageState(input.stage);
    if (!s.resources.some((r) => r.kind === "bucket")) s.resources.push({ kind: "bucket", id: `${key(input.stage)}/bucket` });
  }

  async deployCode(input: DeployInput & { readonly database: StageDatabase }): Promise<DeployedCode> {
    this.enter("deployCode", `${key(input.stage)} ${input.database.name}`);
    this.deployedEmailDomains.push(input.emailDomain);
    this.db(input.database);
    const s = this.stageState(input.stage);
    if (!s.resources.some((r) => r.kind === "runtime")) s.resources.push({ kind: "runtime", id: `${key(input.stage)}/runtime` });
    s.secrets ??= new Set();
    s.code = { database: input.database.name };
    return { publicOrigin: `https://${input.stage.app}-${input.stage.stage}.fake.example` };
  }

  async setSecret(stage: Stage, name: string, value: string): Promise<void> {
    this.enter("setSecret", `${key(stage)} ${name}`);
    void value;
    const s = this.stageState(stage);
    if (s.secrets === null) throw new Error("the stage's runtime does not exist yet");
    s.secrets.add(name);
  }

  async listSetSecrets(stage: Stage): Promise<ReadonlySet<string> | null> {
    this.enter("listSetSecrets", key(stage));
    const s = this.stageState(stage);
    return s.secrets === null ? null : new Set(s.secrets);
  }

  async stopApp(stage: Stage): Promise<void> {
    this.enter("stopApp", key(stage));
    this.stageState(stage).running = false;
  }

  async startApp(stage: Stage): Promise<void> {
    this.enter("startApp", key(stage));
    this.stageState(stage).running = true;
  }

  async createDatabase(stage: Stage, name: string): Promise<StageDatabase> {
    this.enter("createDatabase", name);
    void stage;
    if (this.databases.has(name)) throw new Error(`database ${name} already exists`);
    const db: FakeDatabase = { id: this.id(), records: new Set(), rows: 0 };
    this.databases.set(name, db);
    return { name, number: Number(name.slice(name.lastIndexOf("-") + 1)), id: db.id };
  }

  async copyDatabase(stage: Stage, from: StageDatabase, name: string): Promise<StageDatabase> {
    this.enter("copyDatabase", `${from.name} ${name}`);
    void stage;
    const source = this.db(from);
    if (this.databases.has(name)) throw new Error(`database ${name} already exists`);
    const db: FakeDatabase = { id: this.id(), records: new Set(source.records), rows: source.rows };
    this.databases.set(name, db);
    return { name, number: Number(name.slice(name.lastIndexOf("-") + 1)), id: db.id };
  }

  async dropDatabase(stage: Stage, database: StageDatabase): Promise<void> {
    this.enter("dropDatabase", database.name);
    void stage;
    this.databases.delete(database.name);
  }

  migrationDatabase(database: StageDatabase): MigrationDatabase {
    return {
      dialect: this.dialect,
      recordedIds: async () => new Set(this.db(database).records),
      applyAtomically: async (migration: Migration) => {
        this.calls.push(`applyMigration ${database.name} ${migration.id}`);
        const failure = this.failingMigrations.get(migration.id);
        if (failure) throw failure;
        this.db(database).records.add(migration.id);
      },
    };
  }

  async checkMigratedDatabase(input: MigrationCheckInput): Promise<void> {
    this.enter("checkMigratedDatabase", input.next.name);
    if (this.checkFailure) throw this.checkFailure;
  }

  async checkHealth(stage: Stage, deployed: DeployedCode): Promise<HealthOutcome> {
    this.enter("checkHealth", deployed.publicOrigin);
    if (this.health.ok && !this.answering(stage)) return { ok: false, message: "the stage does not answer", status: 404 };
    return this.health;
  }

  async listStageResources(stage: Stage): Promise<StageResources> {
    this.enter("listStageResources", key(stage));
    const databases: ListedDatabase[] = [...this.databases].map(([name, db]) => ({ name, id: db.id }));
    return { resources: [...(this.stages.get(key(stage))?.resources ?? [])], databases };
  }

  async removeStage(stage: Stage): Promise<void> {
    this.enter("removeStage", key(stage));
    const s = this.stageState(stage);
    s.resources = s.resources.filter((r) => this.undeletable.has(r.id));
    s.code = null;
    s.running = false;
    s.secrets = null;
    if (s.resources.length > 0) throw new Error(`could not delete ${s.resources.map((r) => r.id).join(", ")}`);
  }
}
