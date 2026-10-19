import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, type CheckApp } from "./harness.js";
import type { CheckDiagnostic } from "./engine.js";

describe("rule engine (independent of type checking)", () => {
  let app: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    app = await createCheckApp({
      "src/server/clean.ts": `export const one = 1;\n`,
      "src/server/fs.ts": `import { readFileSync } from "node:fs";\n\nexport const read = (p: string): string => readFileSync(p, "utf8");\n`,
      "tests/a.test.ts": `export const two = 2;\n`,
      "vite.config.ts": `import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n`,
    });
    diagnostics = await app.lint();
  }, 120_000);

  afterAll(async () => {
    await app.dispose();
  });

  it("[CHECK-AC-001] reports a diagnostic with app-relative file, position, full rule ID and skill reference", () => {
    const found = forFile(diagnostics, "src/server/fs.ts");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: "src/server/fs.ts",
      line: 1,
      rule: "prototype-framework/allowed-imports",
      reference: "skill/reference/http-and-validation.md",
    });
    expect(found[0]?.message).toMatch(/node:fs/);
  });

  it("[CHECK-AC-006] the app's lint configuration is not used for the rules, but a weakening one is reported", async () => {
    await app.write({ "eslint.config.js": `export default [{ rules: { "prototype-framework/allowed-imports": "off" } }];\n` });
    const again = await app.lint();
    expect(forFile(again, "src/server/fs.ts").map((d) => d.rule)).toEqual(["prototype-framework/allowed-imports"]);
    expect(forFile(again, "eslint.config.js").map((d) => d.rule)).toEqual(["prototype-framework/allowed-imports"]);
  });

  it("clean files and files outside src/ and tests/ get no diagnostic", () => {
    expect(forFile(diagnostics, "src/server/clean.ts")).toEqual([]);
    expect(forFile(diagnostics, "tests/a.test.ts")).toEqual([]);
    expect(forFile(diagnostics, "vite.config.ts")).toEqual([]);
  });
});
