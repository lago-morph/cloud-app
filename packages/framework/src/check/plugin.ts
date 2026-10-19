/**
 * The framework's ESLint plugin: every portability rule (CHECK-REQ-001) and the framework's own
 * raw-HTML and suppression-comment rules.
 */
import type { FrameworkRule } from "./rule-kit.js";
import { PLUGIN_NAME, type ExtraRuleName, type RuleName } from "./rule-names.js";
import { allowedImports } from "./rules/allowed-imports.js";
import { noRawSql } from "./rules/no-raw-sql.js";

export const rules: Readonly<Partial<Record<RuleName | ExtraRuleName, FrameworkRule>>> = {
  "allowed-imports": allowedImports,
  "no-raw-sql": noRawSql,
};

/**
 * ESLint's and typescript-eslint's rule types differ in detail; like typescript-eslint's own
 * `plugin` export, the plugin is typed only by what every ESLint version agrees on. The rules
 * are present at run time (`plugin.rules`).
 */
export interface PortablePlugin {
  readonly meta: { readonly name: string; readonly version: string };
}

const pluginObject = { meta: { name: PLUGIN_NAME, version: "0.1.0" }, rules };

export const plugin: PortablePlugin = pluginObject;
