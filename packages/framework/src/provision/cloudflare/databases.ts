/**
 * The seam between the Cloudflare target (D-03) and its D1 database operations (D-04,
 * `provision/cloudflare/d1/**`; DEC-0337). The type matches D-04's
 * `D1DatabaseOperations` (returned by `d1DatabaseOperations({ api, accountId })` in
 * `d1/operations.ts`): the five `TargetOperations` database methods plus `listDatabases()`, the
 * account's D1 databases (name and UUID) for `listStageResources`. It is declared here
 * structurally so this module does not depend on `d1/**`; the CLI (D-05) passes D-04's object
 * to `createCloudflareTarget` as `databases`.
 */
import type { ListedDatabase, StageDatabase, TargetOperations } from "../core/operations.js";

export type CloudflareDatabases = Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase"> & {
  /** Every D1 database of the account; the core keeps the stage's exact matches. */
  listDatabases(): Promise<readonly ListedDatabase[]>;
  /** The database's SQL dump through D1's export, for the production `remove`'s backup (DEC-0543), with the lossless rows of tables the dump does not keep (DEC-0556). */
  exportDatabase(database: StageDatabase): Promise<DatabaseExport>;
};

/** One database's backup export (DEC-0543, DEC-0556). */
export interface DatabaseExport {
  /** D1's own dump. */
  readonly dump: Uint8Array;
  /**
   * Present when a table holds a value the dump does not keep (a NUL in text, an integer beyond
   * ±2^53; DEC-0096): those tables' rows as lossless JSON and as SQL (`d1/lossless.ts`).
   */
  readonly lossless?: { readonly tables: readonly string[]; readonly json: Uint8Array; readonly sql: Uint8Array };
}

/** Stand-in until D-04's implementation is wired: every call fails, naming what is missing. */
export function unwiredDatabases(): CloudflareDatabases {
  const fail = (): never => {
    throw new Error("the Cloudflare D1 database operations are not wired into this CLI (D-04)");
  };
  return {
    listDatabases: async () => fail(),
    createDatabase: async () => fail(),
    copyDatabase: async () => fail(),
    dropDatabase: async () => fail(),
    migrationDatabase: () => fail(),
    checkMigratedDatabase: async () => fail(),
    exportDatabase: async () => fail(),
  };
}
