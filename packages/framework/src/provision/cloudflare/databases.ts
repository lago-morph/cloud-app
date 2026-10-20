/**
 * The seam between the Cloudflare target (D-03) and its D1 database operations (D-04,
 * `provision/cloudflare/d1/**`; DEC-PENDING-D-03-7). The target's database operations
 * (`createDatabase`, `copyDatabase`, `dropDatabase`, `migrationDatabase`,
 * `checkMigratedDatabase`, and the database part of `listStageResources`) call exactly this
 * interface; D-04 implements it over the D1 HTTP API with the same `CloudflareApi`, and the CLI
 * (D-05) passes D-04's implementation to `createCloudflareTarget`. The methods have the
 * meaning of the `TargetOperations` methods of the same purpose (`core/operations.ts`).
 */
import type { MigrationDatabase } from "../../mig/apply.js";
import type { ListedDatabase, MigrationCheckInput, Stage, StageDatabase } from "../core/operations.js";

export interface CloudflareDatabases {
  /** Every D1 database of the account (name and UUID); the core keeps the stage's exact matches. */
  list(): Promise<readonly ListedDatabase[]>;
  create(stage: Stage, name: string): Promise<StageDatabase>;
  /** Full copy of `from` into a new database `name` (the fallback page-by-page copy, DEC-0096). */
  copy(stage: Stage, from: StageDatabase, name: string): Promise<StageDatabase>;
  drop(stage: Stage, database: StageDatabase): Promise<void>;
  migrationDatabase(database: StageDatabase): MigrationDatabase;
  check(input: MigrationCheckInput): Promise<void>;
}

/** Stand-in until D-04's implementation is wired: every call fails, naming what is missing. */
export function unwiredDatabases(): CloudflareDatabases {
  const fail = (): never => {
    throw new Error("the Cloudflare D1 database operations are not wired into this CLI (D-04)");
  };
  return { list: async () => fail(), create: async () => fail(), copy: async () => fail(), drop: async () => fail(), migrationDatabase: () => fail(), check: async () => fail() };
}
