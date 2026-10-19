/**
 * The migration checker (CHECK-REQ-004; MIG-REQ-001, MIG-REQ-003), run by `verify`:
 * 1. offline file checks: every committed migration matches `migrations/checksums.json`, and
 *    the histories are paired and numbered in order (`files.ts`). The local applier checks
 *    neither (DEC-0145), so this is where edits and reordering are caught;
 * 2. both histories are applied — the framework's first, then the app's, one migration at a
 *    time, exactly as `dev` and `createTestApp` apply them — to fresh local D1 and PGlite
 *    databases, and the schema is introspected after each migration;
 * 3. each migration's schema effect must be a supported change of migrations.md §2, and it
 *    must not change data (`compare.ts`); hand-written files are judged like generated ones;
 * 4. after each pair the two dialects must have the same logical schema.
 *
 * Diagnostics have the portability rules' shape (`CheckDiagnostic`); render them with
 * `formatDiagnostics`.
 */
import { join } from "node:path";
import { applyMigrations, MigrationFailedError } from "../../mig/apply.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { readHistory, type Migration } from "../../mig/history.js";
import type { Dialect } from "../../sql/dialect.js";
import { compareDialects, dataStatements, unsupportedChanges } from "./compare.js";
import { openCheckDatabase, type DatabaseSchema } from "./databases.js";
import { migrationDiagnostic, type MigrationDiagnostic } from "./diagnostic.js";
import { checkMigrationFiles } from "./files.js";

interface Replay {
  readonly dialect: Dialect;
  readonly migrations: readonly Migration[];
  /** `states[0]`: after the framework history; `states[i + 1]`: after app migration `i`. */
  readonly states: readonly DatabaseSchema[];
  readonly diagnostics: readonly MigrationDiagnostic[];
}

/** All migration-checker diagnostics for the app in `appDir`; empty when its migrations pass. */
export async function runMigrationChecker(appDir: string): Promise<MigrationDiagnostic[]> {
  const out = checkMigrationFiles(appDir);
  const root = join(appDir, "migrations");
  const [sqlite, postgres] = await Promise.all([replay("sqlite", root), replay("postgres", root)]);
  out.push(...sqlite.diagnostics, ...postgres.diagnostics, ...compareReplays(sqlite, postgres));
  return out;
}

const fileOf = (dialect: Dialect, m: Migration): string => `migrations/${dialect}/${m.name}.sql`;

async function replay(dialect: Dialect, root: string): Promise<Replay> {
  const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework");
  const migrations = readHistory(root, dialect, "app");
  const states: DatabaseSchema[] = [];
  const diagnostics: MigrationDiagnostic[] = [];
  const db = await openCheckDatabase(dialect);
  try {
    await applyMigrations(db.migrations, { framework, app: [] });
    states.push(await db.introspect());
    for (const [i, m] of migrations.entries()) {
      const file = fileOf(dialect, m);
      for (const message of dataStatements(m.statements)) diagnostics.push(migrationDiagnostic("migration-supported-changes", file, message));
      try {
        await applyMigrations(db.migrations, { framework, app: migrations.slice(0, i + 1) });
      } catch (error) {
        if (!(error instanceof MigrationFailedError)) throw error;
        const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
        diagnostics.push(
          migrationDiagnostic(
            "migration-apply",
            file,
            `migration ${dialect}/${m.name}.sql fails on a fresh ${dialect === "sqlite" ? "local D1" : "PGlite"} database after the migrations before it: ${cause}. Later ${dialect} migrations were not checked.`,
          ),
        );
        break;
      }
      const state = await db.introspect();
      const previous = states[states.length - 1] ?? {};
      for (const message of unsupportedChanges(previous, state)) diagnostics.push(migrationDiagnostic("migration-supported-changes", file, `${dialect}/${m.name}.sql: ${message}`));
      states.push(state);
    }
  } finally {
    await db.close();
  }
  return { dialect, migrations, states, diagnostics };
}

/**
 * Same logical schema after each pair (paired histories), else after the whole histories.
 * Only the first divergence is reported: later pairs inherit it.
 */
function compareReplays(sqlite: Replay, postgres: Replay): MigrationDiagnostic[] {
  const names = (r: Replay) => r.migrations.map((m) => m.name).join("\n");
  const paired = names(sqlite) === names(postgres);
  const steps = paired
    ? Array.from({ length: Math.min(sqlite.states.length, postgres.states.length) - 1 }, (_, i) => [i + 1, i + 1] as const)
    : sqlite.states.length === sqlite.migrations.length + 1 && postgres.states.length === postgres.migrations.length + 1
      ? [[sqlite.migrations.length, postgres.migrations.length] as const]
      : [];
  for (const [si, pi] of steps) {
    const differences = compareDialects(sqlite.states[si] ?? {}, postgres.states[pi] ?? {});
    if (differences.length === 0) continue;
    const s = sqlite.migrations[si - 1];
    const p = postgres.migrations[pi - 1];
    const after = [s && `sqlite/${s.name}.sql`, p && `postgres/${p.name}.sql`].filter(Boolean).join(" and ");
    const file = s ? fileOf("sqlite", s) : p ? fileOf("postgres", p) : "migrations";
    return [
      migrationDiagnostic(
        "migration-dialects",
        file,
        `the two dialect histories yield different schemas after ${after}: ${differences.join("; ")}. Both histories must describe the same tables; generate migrations with generate-migration instead of editing one dialect's file.`,
      ),
    ];
  }
  return [];
}
