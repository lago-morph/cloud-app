/**
 * Migration-checker diagnostics share the portability rules' shape and layout
 * (`CheckDiagnostic`, `formatDiagnostics`; CHECK-REQ-003). Their rules are named
 * `prototype-framework/migration-<check>`; all point to the SQL and migrations skill reference.
 */
import type { CheckDiagnostic } from "../engine.js";
import type { ReferenceFile } from "../references.js";
import { PLUGIN_NAME } from "../rule-names.js";

export type MigrationDiagnostic = CheckDiagnostic;

/** The checks of the migration checker, one rule ID each (`prototype-framework/<check>`). */
export const MIGRATION_CHECKS = ["migration-checksums", "migration-history", "migration-apply", "migration-supported-changes", "migration-dialects"] as const;
export type MigrationCheck = (typeof MIGRATION_CHECKS)[number];

const REFERENCE: ReferenceFile = "sql-and-migrations.md";

export function migrationDiagnostic(check: MigrationCheck, file: string, message: string, line = 1): MigrationDiagnostic {
  return { file, line, column: 1, rule: `${PLUGIN_NAME}/${check}`, message, reference: `skill/reference/${REFERENCE}` };
}
