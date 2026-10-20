// Root lint for the framework's own source (`npm run lint`, part of root `verify`).
// The shipped portability rules (`./check`) are for app code; framework code is Node and
// Worker library code, so it gets typescript-eslint's recommended rules (PAR-111 pins).
// Scope and exceptions: docs/decisions/decision-log.md, B-INT entries.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  {
    files: ["packages/framework/src/**/*.ts", "packages/framework/bin/**/*.js", "packages/framework/test/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    // Unit tests hold type-level fixtures: values declared only for their types and
    // expressions evaluated only by the type checker.
    files: ["packages/framework/src/**/*.unit.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    // Test-author suites (C-INT): `_`-prefixed names are deliberately unused (stub parameters,
    // fields dropped by a rest pattern), and `{}` is the empty configuration declaration passed to
    // the framework's generics (`DefinedApp<{}, never>`), which `object` or `Record<...>` would change.
    files: ["packages/framework/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-empty-object-type": ["error", { allowObjectTypes: "always" }],
    },
  },
);
