/**
 * The shipped lint configuration (`./check`, CHECK §2). `verify` uses it directly and never reads
 * app-editable configuration for its rules (CHECK-REQ-006).
 */
import type { Linter } from "eslint";
import type ts from "typescript";
import tseslint from "typescript-eslint";
import { plugin, rules } from "./plugin.js";
import { PLUGIN_NAME } from "./rule-names.js";

/** App code globs: `src/**` and `tests/**` TypeScript files (CHECK-REQ-001 classification). */
export const APP_FILES = ["src/**/*.{ts,tsx,mts,cts}", "tests/**/*.{ts,tsx,mts,cts}"];

/**
 * CHECK-REQ-002 type-escape bans, from typescript-eslint (PAR-111): `any`, every type assertion
 * except `as const` (`satisfies` is not an assertion), non-null assertions, and `@ts-…` comments.
 */
const TYPE_ESCAPE_RULES: Linter.RulesRecord = {
  "@typescript-eslint/no-explicit-any": ["error", { fixToUnknown: false, ignoreRestArgs: false }],
  "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/ban-ts-comment": ["error", { "ts-check": false, "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }],
};

/** Every rule of the shipped configuration with its setting. All are errors. */
export function shippedRules(): Linter.RulesRecord {
  const out: Linter.RulesRecord = {};
  for (const name of Object.keys(rules)) out[`${PLUGIN_NAME}/${name}`] = "error";
  return { ...out, ...TYPE_ESCAPE_RULES };
}

export interface PortabilityConfigOptions {
  /** TypeScript programs holding every linted file (what `verify` passes); default: the project service. */
  readonly programs?: readonly ts.Program[];
}

/**
 * The flat configuration array. Without `programs`, type information comes from typescript-eslint's
 * project service (the app's `tsconfig.json`), which is what an editor integration uses.
 */
export function portabilityConfig(options: PortabilityConfigOptions = {}): Linter.Config[] {
  const parserOptions: Linter.ParserOptions =
    options.programs === undefined ? { projectService: true } : { programs: [...options.programs] };
  return [
    {
      name: `${PLUGIN_NAME}/portability`,
      files: APP_FILES,
      languageOptions: { parser: tseslint.parser, parserOptions },
      plugins: { [PLUGIN_NAME]: plugin, "@typescript-eslint": tseslint.plugin },
      rules: shippedRules(),
    },
  ];
}
