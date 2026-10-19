/**
 * In-place application of pending migrations to a local database (migrations.md §2 "Local",
 * "Record"; MIG-REQ-002, MIG-REQ-003 local reading): used by `dev` on the persistent local D1
 * database and by `createTestApp` on fresh local D1 or PGlite.
 *
 * Framework migrations come first, then the app's, each history in file order. A migration
 * is pending when its ID is not in `__framework_migrations`. Each pending migration runs as
 * one atomic unit together with its record row — local D1: one `batch` (one transaction),
 * prefixed with `PRAGMA defer_foreign_keys = on` as on Cloudflare (DEC-0093); PGlite: one
 * transaction — so a failing migration leaves the database exactly as it was, and the
 * remaining migrations are not attempted. With nothing pending, nothing is written.
 *
 * An error is not taken as proof that nothing was applied (DEC-0094): after a failure the
 * record is read again, and a migration found there counts as applied.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { Dialect } from "../sql/dialect.js";
import { FRAMEWORK_MIGRATIONS_DIR, MIGRATIONS_TABLE } from "./framework.js";
import { readHistory, type Migration } from "./history.js";

/** The subset of a D1 binding (local Wrangler/Miniflare) the applier uses. */
export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

/** A database the applier can read the record of and apply one migration to atomically. */
export interface MigrationDatabase {
  readonly dialect: Dialect;
  /** IDs in the record; empty when the record table does not exist yet. */
  recordedIds(): Promise<Set<string>>;
  /** Runs the migration's statements and inserts its record row, all or nothing. */
  applyAtomically(migration: Migration, appliedAt: number): Promise<void>;
}

/** A migration failed; the database is unchanged by it and later migrations were not attempted. */
export class MigrationFailedError extends Error {
  override readonly name = "MigrationFailedError";
  constructor(
    readonly migration: string,
    readonly file: string,
    override readonly cause: unknown,
    readonly applied: readonly string[],
  ) {
    super(`migration ${migration} (${file}) failed and was not applied; the database is unchanged by it: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface Histories {
  readonly framework: readonly Migration[];
  readonly app: readonly Migration[];
}

export interface ApplyResult {
  /** IDs applied by this call, in order (empty when nothing was pending). */
  readonly applied: readonly string[];
}

export async function applyMigrations(db: MigrationDatabase, histories: Histories, clock: () => number = Date.now): Promise<ApplyResult> {
  const recorded = await db.recordedIds();
  const applied: string[] = [];
  for (const migration of [...histories.framework, ...histories.app]) {
    if (recorded.has(migration.id)) continue;
    try {
      await db.applyAtomically(migration, clock());
    } catch (error) {
      const after = await db.recordedIds().catch(() => new Set<string>());
      if (!after.has(migration.id)) throw new MigrationFailedError(migration.id, migration.file, error, applied);
    }
    applied.push(migration.id);
  }
  return { applied };
}

/**
 * Applies the package's framework history, then the app's history found in
 * `appMigrationsDir` (an app's `migrations/`; missing = no app migrations).
 */
export function migrateLocal(db: MigrationDatabase, appMigrationsDir: string, clock: () => number = Date.now): Promise<ApplyResult> {
  return applyMigrations(
    db,
    {
      framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, db.dialect, "framework"),
      app: readHistory(appMigrationsDir, db.dialect, "app"),
    },
    clock,
  );
}

const RECORD_COLUMNS = `"id", "dialect", "checksum", "applied_at"`;

export function d1MigrationDatabase(binding: D1Like): MigrationDatabase {
  return {
    dialect: "sqlite",
    async recordedIds() {
      const exists = await binding.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(MIGRATIONS_TABLE).all();
      if (exists.results.length === 0) return new Set();
      const rows = await binding.prepare(`SELECT "id" FROM "${MIGRATIONS_TABLE}"`).all<{ id: string }>();
      return new Set(rows.results.map((r) => r.id));
    },
    async applyAtomically(migration, appliedAt) {
      await binding.batch([
        binding.prepare("PRAGMA defer_foreign_keys = on"),
        ...migration.statements.map((s) => binding.prepare(s)),
        binding.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" (${RECORD_COLUMNS}) VALUES (?, ?, ?, ?)`).bind(migration.id, "sqlite", migration.checksum, appliedAt),
      ]);
    },
  };
}

export function pgliteMigrationDatabase(client: PGlite): MigrationDatabase {
  return {
    dialect: "postgres",
    async recordedIds() {
      const exists = await client.query<{ t: string | null }>(`SELECT to_regclass('public.${MIGRATIONS_TABLE}')::text AS t`);
      if (exists.rows[0]?.t == null) return new Set();
      const rows = await client.query<{ id: string }>(`SELECT "id" FROM "${MIGRATIONS_TABLE}"`);
      return new Set(rows.rows.map((r) => r.id));
    },
    async applyAtomically(migration, appliedAt) {
      await client.transaction(async (tx) => {
        for (const statement of migration.statements) await tx.exec(statement);
        await tx.query(`INSERT INTO "${MIGRATIONS_TABLE}" (${RECORD_COLUMNS}) VALUES ($1, $2, $3, $4)`, [migration.id, "postgres", migration.checksum, appliedAt]);
      });
    },
  };
}
