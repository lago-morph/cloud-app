/**
 * AWS's database operations of PROV's per-target interface (provisioning.md §2; migrations.md §2
 * "AWS"; aws.md "Deploy mechanics"; plan-aws G-09): the stage's Aurora PostgreSQL databases
 * created, copied, migrated, checked and dropped through the RDS Data API from the CLI. G-10
 * spreads these into its `TargetOperations` and uses `listDatabases()` for
 * `StageResources.databases`. A `StageDatabase.id` is the database name: Postgres names a
 * database uniquely within its cluster, and the cluster is the stage's (DEC-PENDING-g-09-1).
 *
 * - **Resume.** Every Data API call is retried while the cluster resumes, with sql/data-api.ts's
 *   loop (proposed PAR-275 backoff) inside PAR-210 per call. Before its first operation an
 *   instance waits for the cluster with one `SELECT 1` on `postgres` (`waitForResume`).
 * - **Create, copy, drop** run connected to the `postgres` database, outside any transaction,
 *   with every name quoted: `CREATE DATABASE "<n>" TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
 *   `CREATE DATABASE "<new>" TEMPLATE "<old>"` (the copy inherits C collation) and
 *   `DROP DATABASE "<n>" WITH (FORCE)`. A drop of a database that is gone (SQLSTATE 3D000)
 *   counts as done. A SQL error (SQLSTATE in the message) means nothing was created. Any other
 *   failure is unclear: the exact name is looked up in `pg_database`, and a database found there
 *   counts as created (CREATE DATABASE is atomic in Postgres, so a database that exists is whole;
 *   DEC-0094). So a failed copy leaves no new database behind and needs no cleanup drop.
 * - **List**: the names of `pg_database` that are not templates.
 * - **Migrate**: one Data API transaction per migration file: `BeginTransaction`, each statement
 *   of the file unchanged, its `__framework_migrations` row, `CommitTransaction`;
 *   `RollbackTransaction` after any failure (DEC-PENDING-g-09-2).
 * - **Check** (step 4): mig/cloud/check.ts's comparison over a Postgres `CheckReader`: tables of
 *   `public` with columns (`information_schema`) and exact row counts, rows whose foreign key
 *   points at no row (every `pg_constraint` FK, MATCH SIMPLE), and the column rule of added
 *   columns from the declared type (DEC-PENDING-g-09-3).
 *
 * Errors are thrown with messages naming the database and the cause; ARNs are not secrets, and no
 * credential value is ever in a message (CLI-REQ-004). Makes no call but through `client`.
 */
import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  type ExecuteStatementCommandOutput,
  type Field,
  type RDSDataClient,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import type { MigrationDatabase } from "../../mig/apply.js";
import { checkMigrated, type CheckReader, type ColumnShape, type TableShape } from "../../mig/cloud/check.js";
import { MIGRATIONS_TABLE } from "../../mig/framework.js";
import { whileResuming, type DataApiClock } from "../../sql/data-api.js";
import { PAR_210_MS } from "../../sql/guard.js";
import type { ListedDatabase, MigrationCheckInput, Stage, StageDatabase, TargetOperations } from "../core/operations.js";

/** The administration database every create, copy, drop and listing is connected to. */
export const ADMIN_DATABASE = "postgres";

/** Postgres's identifier limit (NAMEDATALEN − 1): a longer name would be silently truncated. */
export const MAX_DATABASE_NAME_BYTES = 63;

export interface AwsDatabaseOptions {
  /** The CLI's Data API client (`createDataApiClient({ region })`), or the fake in tests. */
  readonly client: RDSDataClient;
  /** The stage's cluster ARN (names.ts `clusterArn`). */
  readonly resourceArn: string;
  /** The stage's database-credentials secret ARN. */
  readonly secretArn: string;
  /** Resume wait per call; default PAR-210. */
  readonly budgetMs?: number;
  /** Default: `Date.now`, `setTimeout`, `Math.random`. */
  readonly clock?: DataApiClock;
}

export type AwsDatabaseOperations = Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase"> & {
  /** Every database of the stage's cluster except templates, for `listStageResources`. */
  listDatabases(): Promise<ListedDatabase[]>;
  /** Waits until the cluster answers (resumed), within the per-call budget; throws `SQL.UNAVAILABLE` otherwise. */
  waitForResume(): Promise<void>;
};

const systemClock: DataApiClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const nameOf = (e: unknown): string => (typeof e === "object" && e !== null && typeof (e as { name?: unknown }).name === "string" ? (e as { name: string }).name : "");

const SQL_ERROR_NAMES = new Set(["BadRequestException", "DatabaseErrorException"]);
const SQLSTATE = /SQLState:\s*([0-9A-Z]{5})\b/;

/** The SQLSTATE of a Data API SQL error (in its message, G-S1 finding (b)), or undefined. */
export function sqlStateOf(error: unknown): string | undefined {
  if (!SQL_ERROR_NAMES.has(nameOf(error))) return undefined;
  return SQLSTATE.exec(messageOf(error))?.[1];
}

/** A quoted Postgres identifier. */
export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const NUMBER = /-db-(\d+)$/;

function stageDatabase(name: string): StageDatabase {
  const m = NUMBER.exec(name);
  if (!m) throw new Error(`database name ${name} does not end in -db-<n>`);
  return { name, number: Number(m[1]), id: name };
}

function checkName(name: string): void {
  if (Buffer.byteLength(name, "utf8") > MAX_DATABASE_NAME_BYTES) {
    throw new Error(`database name ${name} is longer than Postgres's ${MAX_DATABASE_NAME_BYTES}-byte limit`);
  }
}

/** One Data API field as a JS value. */
function valueOf(field: Field): unknown {
  if (field.isNull) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.longValue !== undefined) return field.longValue;
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  return null;
}

type Row = Readonly<Record<string, unknown>>;

/** The Data API session of one cluster: every call retried while the cluster resumes. */
class Session {
  private ready: Promise<void> | undefined;
  constructor(private readonly options: AwsDatabaseOptions) {}

  private send<T>(command: unknown): Promise<T> {
    const { client, budgetMs = PAR_210_MS, clock = systemClock } = this.options;
    const send = client.send.bind(client) as (c: unknown) => Promise<T>;
    return whileResuming(() => send(command), budgetMs, clock, undefined);
  }

  waitForResume(): Promise<void> {
    this.ready ??= this.execute(ADMIN_DATABASE, "SELECT 1").then(
      () => undefined,
      (error: unknown) => {
        this.ready = undefined;
        throw new Error(`the stage's Aurora cluster did not answer: ${messageOf(error)}`);
      },
    );
    return this.ready;
  }

  execute(database: string, sql: string, parameters?: SqlParameter[], transactionId?: string): Promise<ExecuteStatementCommandOutput> {
    const { resourceArn, secretArn } = this.options;
    return this.send(
      new ExecuteStatementCommand({
        resourceArn,
        secretArn,
        database,
        sql,
        includeResultMetadata: true,
        ...(parameters === undefined ? {} : { parameters }),
        ...(transactionId === undefined ? {} : { transactionId }),
      }),
    );
  }

  async rows(database: string, sql: string, parameters?: SqlParameter[]): Promise<Row[]> {
    const out = await this.execute(database, sql, parameters);
    const names = (out.columnMetadata ?? []).map((c, i) => c.label ?? c.name ?? String(i));
    return (out.records ?? []).map((record) => Object.fromEntries(record.map((f, i) => [names[i] ?? String(i), valueOf(f)])));
  }

  /** Runs `body` in one Data API transaction on `database`: committed when it resolves, rolled back otherwise. */
  async transaction(database: string, body: (run: (sql: string, parameters?: SqlParameter[]) => Promise<unknown>) => Promise<void>): Promise<void> {
    const { resourceArn, secretArn } = this.options;
    const begun = await this.send<{ transactionId?: string }>(new BeginTransactionCommand({ resourceArn, secretArn, database }));
    const transactionId = begun.transactionId;
    if (transactionId === undefined) throw new Error(`the Data API began no transaction on database ${database}`);
    try {
      await body((sql, parameters) => this.execute(database, sql, parameters, transactionId));
      await this.send(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }));
    } catch (error) {
      await this.send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId })).catch(() => undefined);
      throw error;
    }
  }

  async exists(name: string): Promise<boolean> {
    const found = await this.rows(ADMIN_DATABASE, `SELECT "datname" FROM pg_database WHERE "datname" = :name`, [{ name: "name", value: { stringValue: name } }]);
    return found.length === 1;
  }
}

/**
 * Runs `CREATE DATABASE` (`sql`) for `name`. A SQL error is definitive; any other failure is
 * resolved by looking the exact name up in `pg_database` (DEC-0094).
 */
async function createAs(session: Session, name: string, sql: string, what: string): Promise<StageDatabase> {
  checkName(name);
  await session.waitForResume();
  try {
    await session.execute(ADMIN_DATABASE, sql);
    return stageDatabase(name);
  } catch (error) {
    const state = sqlStateOf(error);
    if (state === undefined && (await session.exists(name).catch(() => false))) return stageDatabase(name);
    throw new Error(`${what} failed${state === undefined ? "" : ` (SQLSTATE ${state})`}: ${messageOf(error)}${hint(state)}`);
  }
}

function hint(state: string | undefined): string {
  if (state === "55006") {
    return "; another session is connected to the source database. The app is stopped during a copy, so this is a connection the Data API or another client holds; wait a minute and run deploy again";
  }
  if (state === "42P04") return "; a database of that name already exists; run deploy again, which removes leftover databases first";
  return "";
}

/** MIG's `MigrationDatabase` on one database of the cluster: one Data API transaction per file. */
function dataApiMigrationDatabase(session: Session, database: string): MigrationDatabase {
  return {
    dialect: "postgres",
    async recordedIds() {
      const [exists] = await session.rows(database, `SELECT to_regclass(:table)::text AS "t"`, [{ name: "table", value: { stringValue: `public.${MIGRATIONS_TABLE}` } }]);
      if (exists?.["t"] == null) return new Set();
      const ids = await session.rows(database, `SELECT "id" FROM ${quoteIdent(MIGRATIONS_TABLE)}`);
      return new Set(ids.map((r) => String(r["id"])));
    },
    async applyAtomically(migration, appliedAt) {
      await session.transaction(database, async (run) => {
        for (const statement of migration.statements) await run(statement);
        await run(`INSERT INTO ${quoteIdent(MIGRATIONS_TABLE)} ("id", "dialect", "checksum", "applied_at") VALUES (:id, :dialect, :checksum, :applied_at)`, [
          { name: "id", value: { stringValue: migration.id } },
          { name: "dialect", value: { stringValue: "postgres" } },
          { name: "checksum", value: { stringValue: migration.checksum } },
          { name: "applied_at", value: { longValue: appliedAt } },
        ]);
      });
    },
  };
}

/** SQL that is true when `c`'s value keeps its column rule (sql.md §2.1), from its declared Postgres type. */
export function ruleHolds(c: ColumnShape): string {
  const col = quoteIdent(c.name);
  const type = c.type.toLowerCase();
  // integer, boolean and text are enforced by the type itself (int4 range; bool; UTF-8 text never holds NUL)
  const typed =
    type === "double precision" || type === "real"
      ? `${col} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`
      : type === "bigint"
        ? `${col} BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}`
        : "TRUE";
  return c.notNull ? `(${col} IS NOT NULL AND ${typed})` : `(${col} IS NULL OR ${typed})`;
}

/** MIG step-4 facts of one database, read through the Data API. */
function dataApiCheckReader(session: Session, database: string): CheckReader {
  return {
    async tables() {
      const columns = await session.rows(
        database,
        `SELECT t."table_name" AS "table", c."column_name" AS "column", c."data_type" AS "type", c."is_nullable" AS "nullable"
         FROM information_schema.tables t
         LEFT JOIN information_schema.columns c ON c."table_schema" = t."table_schema" AND c."table_name" = t."table_name"
         WHERE t."table_schema" = 'public' AND t."table_type" = 'BASE TABLE'
         ORDER BY t."table_name", c."ordinal_position"`,
      );
      const byTable = new Map<string, ColumnShape[]>();
      for (const r of columns) {
        const table = String(r["table"]);
        const list = byTable.get(table) ?? [];
        if (r["column"] != null) list.push({ name: String(r["column"]), type: String(r["type"]).toLowerCase(), notNull: r["nullable"] === "NO" });
        byTable.set(table, list);
      }
      const names = [...byTable.keys()];
      if (names.length === 0) return [];
      const counts = await session.rows(database, names.map((t) => `SELECT ${sqlString(t)} AS "table", count(*) AS "n" FROM ${quoteIdent(t)}`).join(" UNION ALL "));
      const rowsOf = new Map(counts.map((r) => [String(r["table"]), Number(r["n"])]));
      return names.map((name): TableShape => ({ name, columns: byTable.get(name) ?? [], rows: rowsOf.get(name) ?? 0 }));
    },
    async referenceViolations() {
      const pairs = await session.rows(
        database,
        `SELECT c."oid"::text AS "constraint", child."relname" AS "child", parent."relname" AS "parent", ca."attname" AS "childColumn", pa."attname" AS "parentColumn"
         FROM pg_constraint c
         JOIN pg_class child ON child."oid" = c."conrelid"
         JOIN pg_namespace n ON n."oid" = child."relnamespace"
         JOIN pg_class parent ON parent."oid" = c."confrelid"
         JOIN LATERAL unnest(c."conkey", c."confkey") WITH ORDINALITY AS k("childNum", "parentNum", "ord") ON TRUE
         JOIN pg_attribute ca ON ca."attrelid" = c."conrelid" AND ca."attnum" = k."childNum"
         JOIN pg_attribute pa ON pa."attrelid" = c."confrelid" AND pa."attnum" = k."parentNum"
         WHERE c."contype" = 'f' AND n."nspname" = 'public'
         ORDER BY c."oid", k."ord"`,
      );
      const constraints = new Map<string, { child: string; parent: string; columns: [string, string][] }>();
      for (const p of pairs) {
        const id = String(p["constraint"]);
        const entry = constraints.get(id) ?? { child: String(p["child"]), parent: String(p["parent"]), columns: [] };
        entry.columns.push([String(p["childColumn"]), String(p["parentColumn"])]);
        constraints.set(id, entry);
      }
      if (constraints.size === 0) return [];
      const counts = await session.rows(
        database,
        [...constraints.values()]
          .map(({ child, parent, columns }) => {
            const present = columns.map(([c]) => `ch.${quoteIdent(c)} IS NOT NULL`).join(" AND ");
            const match = columns.map(([c, p]) => `pa.${quoteIdent(p)} = ch.${quoteIdent(c)}`).join(" AND ");
            return `SELECT ${sqlString(child)} AS "table", count(*) AS "n" FROM ${quoteIdent(child)} ch WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(parent)} pa WHERE ${match})`;
          })
          .join(" UNION ALL "),
      );
      const byTable = new Map<string, number>();
      for (const r of counts) byTable.set(String(r["table"]), (byTable.get(String(r["table"])) ?? 0) + Number(r["n"]));
      return [...byTable].filter(([, n]) => n > 0).map(([table, rows]) => ({ table, rows }));
    },
    async columnRuleViolations(table, columns) {
      if (columns.length === 0) return [];
      const [row] = await session.rows(
        database,
        `SELECT ${columns.map((c, i) => `count(*) FILTER (WHERE NOT COALESCE(${ruleHolds(c)}, FALSE)) AS "n${i}"`).join(", ")} FROM ${quoteIdent(table)}`,
      );
      return columns.map((_, i) => Number(row?.[`n${i}`] ?? 0));
    },
    recordedIds: () => dataApiMigrationDatabase(session, database).recordedIds(),
  };
}

const sqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export function awsDatabaseOperations(options: AwsDatabaseOptions): AwsDatabaseOperations {
  const session = new Session(options);
  return {
    waitForResume: () => session.waitForResume(),
    createDatabase: (_stage: Stage, name: string) =>
      createAs(session, name, `CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`, `creating database ${name}`),
    copyDatabase: (_stage: Stage, from: StageDatabase, name: string) =>
      createAs(session, name, `CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(from.name)}`, `copying database ${from.name} into ${name}`),
    async dropDatabase(_stage: Stage, database: StageDatabase) {
      await session.waitForResume();
      try {
        await session.execute(ADMIN_DATABASE, `DROP DATABASE ${quoteIdent(database.name)} WITH (FORCE)`);
      } catch (error) {
        if (sqlStateOf(error) === "3D000") return; // already gone counts as deleted
        throw new Error(`deleting database ${database.name}: ${messageOf(error)}`);
      }
    },
    async listDatabases() {
      await session.waitForResume();
      const rows = await session.rows(ADMIN_DATABASE, `SELECT "datname" FROM pg_database WHERE NOT "datistemplate" ORDER BY "datname"`);
      return rows.map((r) => ({ name: String(r["datname"]), id: String(r["datname"]) }));
    },
    migrationDatabase: (database: StageDatabase) => {
      const db = dataApiMigrationDatabase(session, database.name);
      return {
        dialect: db.dialect,
        recordedIds: async () => {
          await session.waitForResume();
          return db.recordedIds();
        },
        applyAtomically: async (migration, appliedAt) => {
          await session.waitForResume();
          return db.applyAtomically(migration, appliedAt);
        },
      };
    },
    async checkMigratedDatabase(input: MigrationCheckInput) {
      await session.waitForResume();
      const problems = await checkMigrated({
        previous: dataApiCheckReader(session, input.previous.name),
        next: dataApiCheckReader(session, input.next.name),
        applied: input.applied,
        migrations: input.migrations,
      });
      if (problems.length > 0) throw new Error(`database ${input.next.name}: ${problems.join("; ")}`);
    },
  };
}
