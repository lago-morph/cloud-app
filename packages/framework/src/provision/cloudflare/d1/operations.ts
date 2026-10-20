/**
 * Cloudflare's database operations of PROV's per-target interface (provisioning.md §2;
 * migrations.md §2 "Cloudflare"): D1 databases created, copied, migrated, checked and deleted
 * through the D1 HTTP API from the CLI. D-03 spreads these into its `TargetOperations`:
 *
 *   { ...d1DatabaseOperations({ api, accountId }), target: "cloudflare", dialect: "sqlite", … }
 *
 * and uses `listDatabases()` for `StageResources.databases`. A `StageDatabase.id` is the D1 UUID.
 */
import type { CloudflareApi } from "../account.js";
import type { ListedDatabase, Stage, StageDatabase, TargetOperations } from "../../core/operations.js";
import { d1HttpMigrationDatabase } from "./migration-database.js";
import { d1Client, D1RequestError, DATABASE_LIMIT_CODE, type D1Client } from "./client.js";

export interface D1Options {
  /** D-03's Cloudflare API client. It may throw when no answer arrives (timeout, reset). */
  readonly api: CloudflareApi;
  readonly accountId: string;
}

export type D1DatabaseOperations = Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase"> & {
  /** Every D1 database of the account, for `listStageResources`. */
  listDatabases(): Promise<ListedDatabase[]>;
};

const NUMBER = /-db-(\d+)$/;

function stageDatabase(name: string, id: string): StageDatabase {
  const m = NUMBER.exec(name);
  if (!m) throw new Error(`database name ${name} does not end in -db-<n>`);
  return { name, number: Number(m[1]), id };
}

/** Creates `name`; an unclear answer is resolved by listing the exact name (DEC-0094). */
async function create(client: D1Client, name: string): Promise<StageDatabase> {
  try {
    return stageDatabase(name, await client.create(name));
  } catch (error) {
    if (error instanceof D1RequestError && error.code === DATABASE_LIMIT_CODE) {
      throw new Error(
        `cannot create D1 database ${name}: the Cloudflare account already has the maximum number of D1 databases (PAR-219: 10; code ${DATABASE_LIMIT_CODE}). ` +
          "A schema-changing deploy needs one more database for a while; remove unused stages (remove --target cloudflare --stage <stage>) or other D1 databases, then run deploy again.",
      );
    }
    if (!(error instanceof D1RequestError) || error.kind !== "ambiguous") throw error;
    const found = (await client.list(name).catch(() => [])).filter((d) => d.name === name);
    if (found.length === 1 && found[0]) return stageDatabase(name, found[0].id);
    throw error;
  }
}

export function d1DatabaseOperations(options: D1Options): D1DatabaseOperations {
  const client = d1Client(options.api, options.accountId);
  const notYet = () => Promise.reject(new Error("not implemented"));
  return {
    createDatabase: (_stage: Stage, name: string) => create(client, name),
    copyDatabase: notYet,
    async dropDatabase(_stage: Stage, database: StageDatabase) {
      try {
        await client.delete(database.id);
      } catch (error) {
        throw new Error(`deleting D1 database ${database.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    migrationDatabase: (database: StageDatabase) => d1HttpMigrationDatabase(client, database.id),
    checkMigratedDatabase: notYet,
    listDatabases: () => client.list(),
  };
}
