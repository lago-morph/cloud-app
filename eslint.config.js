// Root lint for the framework's own source (`npm run lint`, part of root `verify`).
// The shipped portability rules (`./check`) are for app code; framework code is Node and
// Worker library code, so it gets typescript-eslint's recommended rules (PAR-111 pins).
// Scope and exceptions: docs/decisions/decision-log.md, B-INT entries.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  {
    files: ["packages/framework/src/**/*.ts", "packages/framework/bin/**/*.js"],
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
);
