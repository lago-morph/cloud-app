/**
 * CHECK (`./check` subpath, CORE-REQ-005: CLI and lint configuration only). No contract file
 * declares these names; they are this component's own (check.md §2).
 *
 * - `config` (also the default export): the shipped flat lint configuration; an editor can use
 *   it from the app's `eslint.config.js`. `verify` does not read that file for its rules
 *   (CHECK-REQ-006); it only checks that it does not weaken them.
 * - `runPortabilityRules(appDir)`: the portability rules on every app file, independent of type
 *   checking, plus the app-configuration check; `formatDiagnostics` renders them (CHECK-REQ-003).
 * - `APP_COMPILER_OPTIONS`: the app lib set the rules type-check with (also for `verify`'s type check).
 * - `runMigrationChecker(appDir)`: the migration checker (CHECK-REQ-004, `./migrations/`); its
 *   diagnostics have the same shape, so `formatDiagnostics` renders both lists together.
 */
import { portabilityConfig } from "./config.js";

export { plugin } from "./plugin.js";
export type { PortablePlugin } from "./plugin.js";
export { portabilityConfig, shippedRules, APP_FILES } from "./config.js";
export type { PortabilityConfigOptions } from "./config.js";
export { runPortabilityRules, collectAppFiles, APP_COMPILER_OPTIONS } from "./engine.js";
export type { CheckDiagnostic } from "./engine.js";
export { checkAppLintConfig, APP_LINT_CONFIG_FILES } from "./app-config.js";
export { formatDiagnostic, formatDiagnostics } from "./format.js";
export { REFERENCE_FILES, referenceFor } from "./references.js";
export { RULE_NAMES, EXTRA_RULE_NAMES, PLUGIN_NAME } from "./rule-names.js";
export { classifyPath } from "./paths.js";
export { runMigrationChecker } from "./migrations/checker.js";
export { MIGRATION_CHECKS } from "./migrations/diagnostic.js";
export type { MigrationCheck } from "./migrations/diagnostic.js";
export type { CodeKind } from "./paths.js";

/** The shipped lint configuration (type information from the app's `tsconfig.json`). */
export const config = portabilityConfig();

export default config;
