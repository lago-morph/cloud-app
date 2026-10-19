// typescript-eslint type-checked config (CHECK rules use type information).
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", ".wrangler/**", "drizzle/**", "scripts/**", "eslint.config.js"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { project: "./tsconfig.lint.json", tsconfigRootDir: import.meta.dirname } },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: { "@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/ban-ts-comment": "error" },
  },
);
