import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAppLintConfig } from "./app-config.js";

const config = (rules: string, extra = ""): string => `export default [\n  { files: ["src/**/*.ts"], rules: { ${rules} } },${extra}\n];\n`;

describe("[CHECK-AC-006] app lint configuration cannot switch framework rules off (CHECK-REQ-006)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "b14-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("no app configuration: nothing to report", async () => {
    expect(await checkAppLintConfig(dir)).toEqual([]);
  });

  for (const [label, setting] of [
    ["off", '"off"'],
    ["0", "0"],
    ["warn", '"warn"'],
    ["[1]", "[1]"],
    ['["off"]', '["off"]'],
  ] as const) {
    it(`a framework rule set to ${label} fails, naming the rule and the file`, async () => {
      await writeFile(join(dir, "eslint.config.js"), config(`"prototype-framework/no-raw-sql": ${setting}`));
      const found = await checkAppLintConfig(dir);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ file: "eslint.config.js", rule: "prototype-framework/no-raw-sql" });
      expect(found[0]?.message).toMatch(/eslint\.config\.js/);
      expect(found[0]?.message).toMatch(/no-raw-sql/);
    });
  }

  it("weakening a type-escape ban counts, also with different options", async () => {
    await writeFile(
      join(dir, "eslint.config.mjs"),
      config(`"@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as" }]`),
    );
    const found = await checkAppLintConfig(dir);
    expect(found.map((d) => d.rule).sort()).toEqual(["@typescript-eslint/consistent-type-assertions", "@typescript-eslint/no-explicit-any"]);
  });

  it("a renamed plugin namespace is followed", async () => {
    await writeFile(
      join(dir, "eslint.config.js"),
      `const pf = { meta: { name: "prototype-framework" }, rules: {} };\nexport default [[{ plugins: { pf }, rules: { "pf/allowed-imports": "off" } }]];\n`,
    );
    const found = await checkAppLintConfig(dir);
    expect(found.map((d) => d.rule)).toEqual(["prototype-framework/allowed-imports"]);
  });

  it("keeping framework rules at error and configuring other rules passes", async () => {
    await writeFile(join(dir, "eslint.config.js"), config(`"prototype-framework/no-raw-sql": "error", "no-console": "off", "@typescript-eslint/ban-ts-comment": "error"`));
    expect(await checkAppLintConfig(dir)).toEqual([]);
  });

  it("an unreadable configuration fails", async () => {
    await writeFile(join(dir, "eslint.config.js"), `throw new Error("boom");\n`);
    const found = await checkAppLintConfig(dir);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/eslint\.config\.js.*boom/);
  });
});
