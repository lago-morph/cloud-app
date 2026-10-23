/**
 * Skill reference files named by CHECK diagnostics (CHECK-REQ-003). This file fixes the names:
 * E-01/E-02 must create exactly these files under `skill/reference/` (plan B-14, E-01).
 * One file per topic of skill.md §2, plus the owner tasks of SKILL-REQ-006 (E-02).
 */
import { PLUGIN_NAME } from "./rule-names.js";

export const REFERENCE_FILES = [
  "http-and-validation.md",
  "sql-and-migrations.md",
  "kv.md",
  "files.md",
  "secrets.md",
  "configuration.md",
  "current-user.md",
  "log.md",
  "local-development.md",
  "deploying.md",
  "testing.md",
  "troubleshooting.md",
  "owner-tasks.md",
] as const;

export type ReferenceFile = (typeof REFERENCE_FILES)[number];

const ref = (file: ReferenceFile): string => `skill/reference/${file}`;

/** The reference each framework rule's diagnostic names. */
const BY_RULE: Readonly<Record<string, ReferenceFile>> = {
  "allowed-imports": "http-and-validation.md",
  "no-env-access": "configuration.md",
  "browser-api-only": "http-and-validation.md",
  "no-raw-sql": "sql-and-migrations.md",
  "no-dialect-features": "sql-and-migrations.md",
  "framework-order": "sql-and-migrations.md",
  "no-transactions": "sql-and-migrations.md",
  "no-relational-queries": "sql-and-migrations.md",
  "framework-ids": "sql-and-migrations.md",
  "app-error-codes": "http-and-validation.md",
  "no-raw-html": "http-and-validation.md",
  "no-suppression-comments": "troubleshooting.md",
};

/**
 * The skill reference (`skill/reference/<file>`) for a full rule ID as diagnostics carry it,
 * e.g. `prototype-framework/no-raw-sql`. Rules from other plugins (the type-escape bans) and
 * anything unknown point to troubleshooting.
 */
export function referenceFor(ruleId: string | null | undefined): string {
  const prefix = `${PLUGIN_NAME}/`;
  if (ruleId?.startsWith(prefix) === true) {
    const file = BY_RULE[ruleId.slice(prefix.length)];
    if (file !== undefined) return ref(file);
  }
  return ref("troubleshooting.md");
}
