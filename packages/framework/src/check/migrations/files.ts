/**
 * Offline file checks of the migration checker (CHECK-REQ-004, MIG-REQ-001): every committed
 * migration still matches `migrations/checksums.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readHistory, type Migration } from "../../mig/history.js";
import type { Dialect } from "../../sql/dialect.js";
import { migrationDiagnostic, type MigrationDiagnostic } from "./diagnostic.js";

const DIALECTS: readonly Dialect[] = ["sqlite", "postgres"];
const SUMS = "migrations/checksums.json";
/** Base names as generate-migration writes them (DEC-PENDING-B-07-1). */
const NAME = /^\d{4}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Diagnostics for the app's `migrations/` files; none when the app has no migrations. */
export function checkMigrationFiles(appDir: string): MigrationDiagnostic[] {
  const root = join(appDir, "migrations");
  const histories = DIALECTS.map((dialect) => ({ dialect, files: readHistory(root, dialect, "app") }));
  if (histories.every((h) => h.files.length === 0)) return [];
  const recorded = readChecksums(join(appDir, SUMS));
  if (typeof recorded === "string") return [migrationDiagnostic("migration-checksums", SUMS, recorded)];

  const out: MigrationDiagnostic[] = [];
  const present = new Set<string>();
  const names = new Map(histories.map((h) => [h.dialect, new Set(h.files.map((m) => m.name))]));
  for (const { dialect, files } of histories) {
    const other: Dialect = dialect === "sqlite" ? "postgres" : "sqlite";
    let expected = 0;
    for (const m of files) {
      const key = `${dialect}/${m.name}.sql`;
      present.add(key);
      const file = `migrations/${key}`;
      const n = NAME.test(m.name) ? Number.parseInt(m.name, 10) : undefined;
      if (n === undefined) {
        out.push(migrationDiagnostic("migration-history", file, `migration file name ${key} is not <nnnn>_<slug>.sql (four digits, then lowercase snake_case); migrations are named by generate-migration.`));
      } else {
        if (n !== expected) {
          out.push(
            migrationDiagnostic(
              "migration-history",
              file,
              `migration ${key} is numbered ${m.name.slice(0, 4)} but the next number in order is ${String(expected).padStart(4, "0")}: migrations are numbered 0000, 0001, … in the order they apply, without gaps or repeats. A new migration always comes after every existing one; do not renumber or insert migrations.`,
            ),
          );
        }
        expected = Math.max(expected, n + 1);
      }
      if (names.get(other)?.has(m.name) !== true) {
        out.push(
          migrationDiagnostic(
            "migration-history",
            file,
            `migration ${key} has no counterpart ${other}/${m.name}.sql: every migration is generated once per dialect with the same name (generate-migration writes both).`,
          ),
        );
      }
      const problem = checksumProblem(key, m, recorded[key]);
      if (problem !== undefined) out.push(migrationDiagnostic("migration-checksums", `migrations/${key}`, problem));
    }
  }
  for (const key of Object.keys(recorded).sort()) {
    if (!present.has(key)) {
      out.push(
        migrationDiagnostic(
          "migration-checksums",
          SUMS,
          `${SUMS} lists ${key}, which does not exist. A migration that may have been applied must not be deleted: restore it. Only a migration never applied to any cloud stage may be deleted, together with its entry.`,
        ),
      );
    }
  }
  return out;
}

function readChecksums(path: string): Record<string, unknown> | string {
  if (!existsSync(path)) return `${SUMS} is missing; generate-migration writes it next to the migrations it generates. Migrations must be generated, not written by hand.`;
  try {
    const json: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (json !== null && typeof json === "object" && !Array.isArray(json)) return json as Record<string, unknown>;
  } catch {
    // reported below
  }
  return `${SUMS} is not a JSON object mapping "<dialect>/<file>.sql" to SHA-256 digests; it is written by generate-migration and must not be edited by hand.`;
}

function checksumProblem(key: string, m: Migration, recorded: unknown): string | undefined {
  if (recorded === undefined) {
    return `migration ${key} is not listed in ${SUMS}: it was not made by generate-migration. Migrations must be generated from the table definitions, not written by hand; delete it and run generate-migration.`;
  }
  if (recorded !== m.checksum) {
    return `migration ${key} was edited after it was generated: its SHA-256 no longer matches ${SUMS}. Generated migrations must not be edited by hand; undo the edit and add a new migration with generate-migration instead.`;
  }
  return undefined;
}
