/**
 * Q4: drizzle 0.45.4 `aws-data-api/pg` behind the framework's portable handle and SQL guard.
 * Mirrors packages/framework/src/sql/postgres.ts (postgresDb) with the Data API driver.
 */
import type { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle, type AwsDataApiPgDatabase } from "drizzle-orm/aws-data-api/pg";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SqlAdapterOptions } from "../../../../../packages/framework/src/sql/d1.js";
import { createGuard } from "../../../../../packages/framework/src/sql/guard.js";
import { portableHandle, type DrizzleDb } from "../../../../../packages/framework/src/sql/handle.js";
import type { PortableDb } from "../../../../../packages/framework/src/sql/types.js";
import { withValueRules } from "../../../../../packages/framework/src/sql/write-rules.js";

export interface DataApiTarget {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

/** The app-facing handle over the RDS Data API (one client per cold start, passed in). */
export function dataApiDb(client: RDSDataClient, target: DataApiTarget, options: SqlAdapterOptions = {}): PortableDb {
  const guard = createGuard(options);
  const db: AwsDataApiPgDatabase = drizzle(client, { ...target });
  // Type-level proof, no cast: the driver's database provides every PortableDb member with
  // the same pg-core builder types (only the query-result HKT differs).
  const members: Pick<PgDatabase<PgQueryResultHKT>, "select" | "selectDistinct" | "insert" | "update" | "delete" | "$with" | "with"> = db;
  void members;
  const ruled: AwsDataApiPgDatabase = withValueRules(db);
  // Same cast as postgres.ts: DrizzleDb is an index-signature record a class instance is not.
  return portableHandle({ dialect: "postgres", db: ruled as unknown as DrizzleDb, guard });
}
