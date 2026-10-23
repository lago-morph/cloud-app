/**
 * Migration histories on disk (migrations.md §2 "Generation"): one directory per dialect,
 * `<root>/sqlite/` and `<root>/postgres/`, holding drizzle-kit SQL files named
 * `<nnnn>_<slug>.sql` and applied in file-name order. `meta/` keeps the schema snapshot of
 * each file for the next generation; it is not part of the applied history.
 *
 * Two histories exist per database: the framework's (shipped in the package, `FW/migrations/`)
 * and the app's (`<app>/migrations/`). A migration's record ID is `<history>/<base name>`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Dialect } from "../sql/dialect.js";

export type HistoryName = "framework" | "app";

export interface Migration {
  /** Record ID: `<history>/<base name>`, e.g. `app/0001_schema`. */
  readonly id: string;
  /** Base name without `.sql`. */
  readonly name: string;
  readonly file: string;
  readonly text: string;
  /** SHA-256 hex of the file text (as in `migrations/checksums.json`). */
  readonly checksum: string;
  /** The statements, split at drizzle-kit's `--> statement-breakpoint` markers. */
  readonly statements: readonly string[];
}

export const BREAKPOINT = "--> statement-breakpoint";

export function checksumOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function splitStatements(text: string): string[] {
  return text
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The `.sql` file names of `<root>/<dialect>/`, sorted. */
export function migrationFileNames(root: string, dialect: Dialect): string[] {
  const dir = join(root, dialect);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && statSync(join(dir, f)).isFile())
    .sort();
}

export function readHistory(root: string, dialect: Dialect, history: HistoryName): Migration[] {
  return migrationFileNames(root, dialect).map((fileName) => {
    const file = join(root, dialect, fileName);
    const text = readFileSync(file, "utf8");
    const name = fileName.slice(0, -".sql".length);
    return { id: `${history}/${name}`, name, file, text, checksum: checksumOf(text), statements: splitStatements(text) };
  });
}
