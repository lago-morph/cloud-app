/**
 * `generate-migration [--name <slug>]` (CLI-REQ-001, MIG-REQ-001): the next migration pair
 * (SQLite and Postgres) from the app's table definitions, under `<app>/migrations/`.
 * A diff the generator refuses (e.g. a rename) fails with its message.
 */
import { relative } from "node:path";
import { parseOptions } from "../args.js";
import { EXIT, type Command } from "../io.js";

export type GenerateOutcome = { readonly status: "created"; readonly files: readonly string[] } | { readonly status: "unchanged" };

export interface GenerateMigrationDeps<T> {
  /** The table definitions of the app in `appDir` (its `defineApp` call). */
  loadTables(appDir: string): Promise<T>;
  generate(appDir: string, tables: T, name: string | undefined): Promise<GenerateOutcome>;
}

export function generateMigrationCommand<T>(deps: GenerateMigrationDeps<T>): Command {
  return async (args, io) => {
    const name = parseOptions(args, ["name"]).get("name");
    const tables = await deps.loadTables(io.cwd);
    const result = await deps.generate(io.cwd, tables, name);
    if (result.status === "unchanged") {
      io.stdout("no changes: the table definitions match the latest migrations\n");
      return EXIT.ok;
    }
    for (const file of result.files) io.stdout(`created ${relative(io.cwd, file).split("\\").join("/")}\n`);
    return EXIT.ok;
  };
}
