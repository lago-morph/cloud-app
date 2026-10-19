/** The plugin namespace of the framework's rules in the shipped configuration (`./check`). */
export const PLUGIN_NAME = "prototype-framework";

/** The CHECK-REQ-001 portability rules (check.md §1), in the table's order. */
export const RULE_NAMES = [
  "allowed-imports",
  "no-env-access",
  "browser-api-only",
  "no-raw-sql",
  "no-dialect-features",
  "framework-order",
  "no-transactions",
  "no-relational-queries",
  "framework-ids",
  "app-error-codes",
] as const;

export type RuleName = (typeof RULE_NAMES)[number];

/**
 * Framework rules beyond the CHECK-REQ-001 table: raw-HTML sinks in browser code (CHECK-REQ-001
 * last paragraph) and lint-suppression comments (CHECK-REQ-002).
 */
export const EXTRA_RULE_NAMES = ["no-raw-html", "no-suppression-comments"] as const;

export type ExtraRuleName = (typeof EXTRA_RULE_NAMES)[number];
