/**
 * The `generate-migration` engine (migrations.md §2 "Generation", "Supported changes";
 * MIG-REQ-001). drizzle-kit (PAR-103) is driven through its programmatic API, so it never
 * prompts: the engine compares the table definitions with the schema snapshot stored next to
 * the newest migration of each dialect, refuses a diff that both removes and adds tables, or
 * both removes and adds columns of one table (drizzle-kit would have to ask whether that is a
 * rename), and otherwise writes one new SQL file per dialect with the same base name, its
 * snapshot under `meta/`, and its checksum in `checksums.json`.
 *
 * Layout under `root` (an app's `migrations/`, or the package's `migrations/`):
 *   sqlite/<nnnn>_<slug>.sql, sqlite/meta/<nnnn>_<slug>.json,
 *   postgres/<nnnn>_<slug>.sql, postgres/meta/<nnnn>_<slug>.json,
 *   checksums.json  — { "<dialect>/<file>.sql": "<sha256 hex>" }, keys sorted.
 */
import { generateDrizzleJson, generateMigration, generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dialect } from "../sql/dialect.js";
import { tableFor } from "../sql/table.js";
import type { AnyTable } from "../sql/types.js";
import { BREAKPOINT, checksumOf, migrationFileNames } from "./history.js";

export const DIALECTS: readonly Dialect[] = ["sqlite", "postgres"];

/** A diff the engine will not generate; the message says what to do instead. */
export class MigrationGenerationError extends Error {
  override readonly name = "MigrationGenerationError";
}

export interface GenerateOptions {
  /** The migrations directory. */
  readonly root: string;
  /** The Drizzle tables of each dialect, keyed by any name. */
  readonly schema: (dialect: Dialect) => Record<string, unknown>;
  /** File slug: lowercase snake_case. Default `schema`. */
  readonly name?: string;
}

export type GenerateResult =
  | { readonly status: "created"; readonly files: readonly string[] }
  | { readonly status: "unchanged" };

/** The schema of an app's tables (made by `defineTable`) in each dialect. */
export function appSchema(tables: Readonly<Record<string, AnyTable>>): (dialect: Dialect) => Record<string, unknown> {
  return (dialect) => Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, tableFor(table, dialect)]));
}

interface Snapshot {
  readonly id: string;
  readonly tables: Readonly<Record<string, { readonly name: string; readonly columns: Readonly<Record<string, unknown>> }>>;
}

const SLUG = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export async function generateMigrations(options: GenerateOptions): Promise<GenerateResult> {
  const slug = options.name ?? "schema";
  if (!SLUG.test(slug)) throw new MigrationGenerationError(`migration name ${JSON.stringify(slug)} must be lowercase snake_case (letters, digits, single underscores)`);

  const plans = [];
  for (const dialect of DIALECTS) {
    const previous = baseline(options.root, dialect);
    const current = await snapshotOf(dialect, options.schema(dialect), previous?.id);
    refuseRenames(dialect, previous ?? (await snapshotOf(dialect, {}, undefined)), current);
    const statements = await diff(dialect, previous ?? (await snapshotOf(dialect, {}, undefined)), current);
    plans.push({ dialect, current, statements });
  }
  if (plans.every((p) => p.statements.length === 0)) return { status: "unchanged" };

  const next = Math.max(-1, ...DIALECTS.flatMap((d) => migrationFileNames(options.root, d).map((f) => Number.parseInt(f, 10)).filter(Number.isFinite))) + 1;
  const base = `${String(next).padStart(4, "0")}_${slug}`;
  const files: string[] = [];
  for (const { dialect, current, statements } of plans) {
    mkdirSync(join(options.root, dialect, "meta"), { recursive: true });
    writeFileSync(join(options.root, dialect, `${base}.sql`), statements.map((s) => s.trim()).join(`\n${BREAKPOINT}\n`) + "\n");
    writeFileSync(join(options.root, dialect, "meta", `${base}.json`), JSON.stringify(current, null, 2) + "\n");
    files.push(`${dialect}/${base}.sql`);
  }
  writeChecksums(options.root, files);
  return { status: "created", files };
}

/** The snapshot stored for the newest migration of `dialect`, or undefined for an empty history. */
function baseline(root: string, dialect: Dialect): Snapshot | undefined {
  const names = migrationFileNames(root, dialect);
  const last = names[names.length - 1];
  if (last === undefined) return undefined;
  const file = join(root, dialect, "meta", `${last.slice(0, -".sql".length)}.json`);
  if (!existsSync(file)) {
    throw new MigrationGenerationError(`${dialect}/${last} has no schema snapshot (${dialect}/meta/${last.slice(0, -".sql".length)}.json); migrations must be generated, not hand-written`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as Snapshot;
}

async function snapshotOf(dialect: Dialect, imports: Record<string, unknown>, prevId: string | undefined): Promise<Snapshot> {
  const snapshot = dialect === "sqlite" ? await generateSQLiteDrizzleJson(imports, prevId) : generateDrizzleJson(imports, prevId);
  return snapshot as unknown as Snapshot;
}

async function diff(dialect: Dialect, previous: Snapshot, current: Snapshot): Promise<string[]> {
  type SqliteJson = Parameters<typeof generateSQLiteMigration>[0];
  type PgJson = Parameters<typeof generateMigration>[0];
  return dialect === "sqlite"
    ? generateSQLiteMigration(previous as unknown as SqliteJson, current as unknown as SqliteJson)
    : generateMigration(previous as unknown as PgJson, current as unknown as PgJson);
}

function refuseRenames(dialect: Dialect, previous: Snapshot, current: Snapshot): void {
  const byName = (s: Snapshot) => new Map(Object.values(s.tables).map((t) => [t.name, t]));
  const before = byName(previous);
  const after = byName(current);
  const removed = [...before.keys()].filter((n) => !after.has(n));
  const added = [...after.keys()].filter((n) => !before.has(n));
  if (removed.length > 0 && added.length > 0) {
    throw new MigrationGenerationError(
      `this schema change both removes tables (${removed.join(", ")}) and adds tables (${added.join(", ")}). ` +
        "Renames are not supported: generate the drop and the add as separate migrations (remove the old table and run generate-migration, then add the new one and run it again).",
    );
  }
  for (const [name, table] of after) {
    const old = before.get(name);
    if (old === undefined) continue;
    const gone = Object.keys(old.columns).filter((c) => !(c in table.columns));
    const fresh = Object.keys(table.columns).filter((c) => !(c in old.columns));
    if (gone.length > 0 && fresh.length > 0) {
      throw new MigrationGenerationError(
        `this schema change both removes columns (${gone.join(", ")}) and adds columns (${fresh.join(", ")}) of table ${name} (${dialect}). ` +
          "Renames and type changes are not supported: generate the drop and the add as separate migrations, and copy values with the add-copy-drop pattern (migrations.md §2).",
      );
    }
  }
}

/** Adds the new files' checksums; keeps every existing file's recorded checksum; drops entries of deleted files. */
function writeChecksums(root: string, added: readonly string[]): void {
  const path = join(root, "checksums.json");
  const existing = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
  const out: Record<string, string> = {};
  for (const [file, sum] of Object.entries(existing)) if (existsSync(join(root, file))) out[file] = sum;
  for (const file of added) out[file] = checksumOf(readFileSync(join(root, file), "utf8"));
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
}
