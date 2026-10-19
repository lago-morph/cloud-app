/**
 * MIG public names. No contract file declares app-facing names for this component, and none
 * are exported: migrations are generated files in the app repository (migrations.md).
 *
 * Framework-internal entry points (B-07, local), imported directly by their users:
 * - `./generate.js` — `generateAppMigrations` / `generateMigrations` (CLI `generate-migration`, B-17);
 * - `./apply.js` — `migrateLocal`, `d1MigrationDatabase`, `pgliteMigrationDatabase`,
 *   `MigrationFailedError` (`dev`, B-17; `createTestApp`, B-16);
 * - `./history.js` — `readHistory`, `checksumOf` (migration checker, B-15; cloud deploys, D-04);
 * - `./framework.js` — `frameworkTables` (KV, B-08), `FRAMEWORK_MIGRATIONS_DIR`.
 * The cloud copy-migrate-check-replace flow is D-04's (`FW/src/mig/cloud/**`).
 */
export {};
