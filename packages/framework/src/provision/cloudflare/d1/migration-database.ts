/**
 * MIG's `MigrationDatabase` for a D1 database reached through the HTTP API (migrations.md §2
 * "Cloudflare"; DEC-0093, DEC-0094). Each pending migration file is one `/query` request: a batch
 * of `PRAGMA defer_foreign_keys = on`, the file's statements unchanged (split at drizzle-kit's
 * breakpoints, as locally), and its `__framework_migrations` row, so record and schema change
 * commit together or not at all. No BEGIN/SAVEPOINT (D1 refuses them).
 *
 * `applied_at` travels as decimal text cast to INTEGER: D1 binds JSON numbers as REAL (A-06 E5d).
 * A failed request throws; MIG's `applyMigrations` then re-reads the record, so an unclear answer
 * after a committed batch counts as applied (DEC-0094).
 */
import { MIGRATIONS_TABLE } from "../../../mig/framework.js";
import type { MigrationDatabase } from "../../../mig/apply.js";
import type { D1Client } from "./client.js";

export function d1HttpMigrationDatabase(client: D1Client, uuid: string): MigrationDatabase {
  return {
    dialect: "sqlite",
    async recordedIds() {
      const [exists] = await client.batch(uuid, [{ sql: `SELECT "name" FROM sqlite_master WHERE "type" = 'table' AND "name" = ?`, params: [MIGRATIONS_TABLE] }]);
      if (!exists || exists.length === 0) return new Set();
      const [ids] = await client.batch(uuid, [{ sql: `SELECT "id" FROM "${MIGRATIONS_TABLE}"` }]);
      return new Set((ids ?? []).map((r) => String(r["id"])));
    },
    async applyAtomically(migration, appliedAt) {
      await client.batch(uuid, [
        { sql: "PRAGMA defer_foreign_keys = on" },
        ...migration.statements.map((sql) => ({ sql })),
        {
          sql: `INSERT INTO "${MIGRATIONS_TABLE}" ("id", "dialect", "checksum", "applied_at") VALUES (?, ?, ?, CAST(? AS INTEGER))`,
          params: [migration.id, "sqlite", migration.checksum, String(appliedAt)],
        },
      ]);
    },
  };
}
