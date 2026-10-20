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
import type { ListedDatabase, MigrationCheckInput, Stage, StageDatabase, TargetOperations } from "../../core/operations.js";
import { checkMigrated } from "../../../mig/cloud/check.js";
import { d1CheckReader } from "./check-reader.js";
import { copyD1Database, DEFAULT_COPY_LIMITS, type CopyLimits } from "./copy.js";
import { d1HttpMigrationDatabase } from "./migration-database.js";
import { d1Client, D1RequestError, DATABASE_LIMIT_CODE, type D1Client } from "./client.js";

export interface D1Options {
  /** D-03's Cloudflare API client. It may throw when no answer arrives (timeout, reset). */
  readonly api: CloudflareApi;
  readonly accountId: string;
  /** Copy page limits; tests only. Defaults: PAR-216, PAR-218. */
  readonly limits?: Partial<CopyLimits>;
}

export type D1DatabaseOperations = Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase"> & {
  /** Every D1 database of the account, for `listStageResources`. */
  listDatabases(): Promise<ListedDatabase[]>;
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  const limits: CopyLimits = { ...DEFAULT_COPY_LIMITS, ...options.limits };
  return {
    createDatabase: (_stage: Stage, name: string) => create(client, name),
    async copyDatabase(_stage: Stage, from: StageDatabase, name: string) {
      const next = await create(client, name);
      try {
        await copyD1Database(client, from.id, next.id, limits);
        return next;
      } catch (error) {
        const dropped = await client.delete(next.id).then(
          () => "the new database was deleted",
          (e: unknown) => `the new database could not be deleted (${messageOf(e)})`,
        );
        throw new Error(`copying D1 database ${from.name} into ${name} failed: ${messageOf(error)}; ${dropped}`);
      }
    },
    async dropDatabase(_stage: Stage, database: StageDatabase) {
      try {
        await client.delete(database.id);
      } catch (error) {
        throw new Error(`deleting D1 database ${database.name}: ${messageOf(error)}`);
      }
    },
    migrationDatabase: (database: StageDatabase) => d1HttpMigrationDatabase(client, database.id),
    async checkMigratedDatabase(input: MigrationCheckInput) {
      const problems = await checkMigrated({
        previous: d1CheckReader(client, input.previous.id),
        next: d1CheckReader(client, input.next.id),
        applied: input.applied,
        migrations: input.migrations,
      });
      if (problems.length > 0) throw new Error(`database ${input.next.name}: ${problems.join("; ")}`);
    },
    listDatabases: () => client.list(),
  };
}
