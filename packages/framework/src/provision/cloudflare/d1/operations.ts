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
import { DEFAULT_NATIVE_LIMITS, exportDump, fetchTransfer, nativeCopy, nativeCopyPrecheck, type DumpOptions, type NativeCopyLimits, type SignedTransfer } from "./native-copy.js";
import { databaseLimitText, type WorkersPlanReader } from "../plan.js";
import type { DatabaseExport } from "../databases.js";
import { buildLossless, readLossyTables } from "./lossless.js";
import { d1HttpMigrationDatabase } from "./migration-database.js";
import { d1Client, D1RequestError, DATABASE_LIMIT_CODE, type D1Client } from "./client.js";

export interface D1Options {
  /** D-03's Cloudflare API client. It may throw when no answer arrives (timeout, reset). */
  readonly api: CloudflareApi;
  readonly accountId: string;
  /** Copy page limits; tests only. Defaults: PAR-216, PAR-218. */
  readonly limits?: Partial<CopyLimits>;
  /**
   * The native export/import path (DEC-0545), tried when the pre-check allows it; the CLI always
   * passes it. Without it `copyDatabase` copies row by row only. `transfer` also downloads the
   * export of `exportDatabase` (default: the global `fetch`). Limits default to PAR-312…PAR-314.
   */
  readonly native?: { readonly transfer: SignedTransfer; readonly limits?: Partial<NativeCopyLimits>; readonly now?: () => number; readonly sleep?: (ms: number) => Promise<void> };
  /** Reads the account's Workers plan for the database-limit message (DEC-0546); default: the plan is not known. */
  readonly plan?: WorkersPlanReader;
}

export type D1DatabaseOperations = Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase"> & {
  /** Every D1 database of the account, for `listStageResources`. */
  listDatabases(): Promise<ListedDatabase[]>;
  /**
   * The database's SQL dump through D1's export (the production `remove`'s backup, DEC-0543).
   * First the tables are scanned for values the dump does not keep (DEC-0096); those tables are
   * also exported losslessly, row by row (`lossless.ts`, DEC-0556).
   */
  exportDatabase(database: StageDatabase): Promise<DatabaseExport>;
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const NUMBER = /-db-(\d+)$/;

function stageDatabase(name: string, id: string): StageDatabase {
  const m = NUMBER.exec(name);
  if (!m) throw new Error(`database name ${name} does not end in -db-<n>`);
  return { name, number: Number(m[1]), id };
}

/** Creates `name`; an unclear answer is resolved by listing the exact name (DEC-0094). */
async function create(client: D1Client, name: string, plan: WorkersPlanReader | undefined): Promise<StageDatabase> {
  try {
    return stageDatabase(name, await client.create(name));
  } catch (error) {
    if (error instanceof D1RequestError && error.code === DATABASE_LIMIT_CODE) {
      // The limit depends on the account's Workers plan (PAR-219, DEC-0546); read only now, when it is hit.
      const reading = plan === undefined ? undefined : await plan().catch(() => undefined);
      throw new Error(
        `cannot create D1 database ${name}: the Cloudflare account already has the maximum number of D1 databases (${databaseLimitText(reading)}; code ${DATABASE_LIMIT_CODE}). ` +
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
  const dump: DumpOptions = {
    transfer: options.native?.transfer ?? fetchTransfer(),
    limits: { ...DEFAULT_NATIVE_LIMITS, ...options.native?.limits },
    ...(options.native?.now === undefined ? {} : { now: options.native.now }),
    ...(options.native?.sleep === undefined ? {} : { sleep: options.native.sleep }),
  };
  const nativeLimits = dump.limits as NativeCopyLimits;

  /**
   * The native export/import when the pre-check allows it (DEC-0545): `done`, or why the
   * row-by-row copy runs instead; `dirty` when a failed import may have left part of the dump.
   */
  async function tryNative(from: StageDatabase, next: StageDatabase): Promise<{ done: true } | { done: false; why: string; dirty: boolean }> {
    if (options.native === undefined) return { done: false, why: "the native copy is not configured", dirty: false };
    let check;
    try {
      check = await nativeCopyPrecheck(client, from.id, nativeLimits);
    } catch (error) {
      // The pre-check only reads; D1 may refuse its scan (a big database, a limit). The row-by-row copy needs no pre-check.
      return { done: false, why: `the native copy's pre-check failed (${messageOf(error)})`, dirty: false };
    }
    if (!check.safe) return { done: false, why: check.reason, dirty: false };
    try {
      await nativeCopy(client, from.id, next.id, check.tables, dump);
      return { done: true };
    } catch (error) {
      return { done: false, why: `the native export/import failed (${messageOf(error)})`, dirty: true };
    }
  }

  return {
    createDatabase: (_stage: Stage, name: string) => create(client, name, options.plan),
    async copyDatabase(_stage: Stage, from: StageDatabase, name: string) {
      let next = await create(client, name, options.plan);
      try {
        const native = await tryNative(from, next);
        if (native.done) return { ...next, method: "D1 native export/import" };
        if (native.dirty) {
          // Start the row-by-row copy on an empty database: the failed import may have left part of the dump.
          await client.delete(next.id);
          next = await create(client, name, options.plan);
        }
        await copyD1Database(client, from.id, next.id, limits);
        return { ...next, method: `row-by-row copy (${native.why})` };
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
    async exportDatabase(database: StageDatabase): Promise<DatabaseExport> {
      try {
        const lossy = await readLossyTables(client, database.id, limits.pageRows);
        const exported = await exportDump(client, database.id, dump);
        return { dump: exported, ...(lossy === undefined ? {} : { lossless: buildLossless(lossy, exported, database.name) }) };
      } catch (error) {
        throw new Error(`exporting D1 database ${database.name}: ${messageOf(error)}`);
      }
    },
  };
}
