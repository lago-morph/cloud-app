/**
 * CHECK-REQ-006: `verify` loads the portability rules from the package and fails when the
 * app's own lint configuration turns a framework rule off.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { FixtureApp, PACKAGE_NAME, assertFrameworkBuilt, namesRule, type RunResult } from "../../fixtures/support/app.js";

const RULE = "no-raw-sql";

/**
 * The rule's full ID as the shipped configuration (`<package>/check`) names it, e.g.
 * `prototype-framework/no-raw-sql`. Found by searching the module's exports, so the test
 * does not guess the plugin prefix (DEC-PENDING-B-T4-9).
 */
async function shippedRuleId(rule: string): Promise<string | undefined> {
  const specifier = `${PACKAGE_NAME}/check`;
  const mod: unknown = await import(specifier);
  const prefixed = new Set<string>();
  const pluginNames = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || (typeof node !== "object" && typeof node !== "function") || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith(`/${rule}`)) prefixed.add(key);
      if (key === "plugins" && value !== null && typeof value === "object") {
        for (const [name, plugin] of Object.entries(value)) {
          const rules: unknown = plugin !== null && typeof plugin === "object" ? Reflect.get(plugin, "rules") : undefined;
          if (rules !== null && typeof rules === "object" && rule in rules) pluginNames.add(name);
        }
      }
      visit(value, depth + 1);
    }
  };
  visit(mod, 0);
  return [...prefixed][0] ?? (pluginNames.size > 0 ? `${[...pluginNames][0]}/${rule}` : undefined);
}

describe("app lint configuration cannot switch rules off", () => {
  let ruleId: string | undefined;
  const apps: FixtureApp[] = [];
  const results = new Map<string, RunResult>();

  beforeAll(async () => {
    await assertFrameworkBuilt();
    ruleId = await shippedRuleId(RULE);
    if (ruleId === undefined) return;
    for (const [variant, severity] of [
      ["off", '"off"'],
      ["zero", "0"],
    ] as const) {
      const app = await FixtureApp.create({
        layers: ["apps/base"],
        files: {
          "eslint.config.js": `// App-editable lint configuration that switches a framework rule off.\nexport default [\n  { files: ["src/**/*.ts", "tests/**/*.ts"], rules: { ${JSON.stringify(ruleId)}: ${severity} } },\n];\n`,
        },
      });
      apps.push(app);
      results.set(variant, await app.cli(["verify"]));
    }
  }, 900_000);

  afterAll(async () => {
    for (const app of apps) await app.dispose();
  });

  for (const variant of ["off", "zero"] as const) {
    it(tag("CHECK-AC-006", `turning ${RULE} off in eslint.config.js (${variant === "off" ? '"off"' : "0"}) makes verify fail, naming the rule`), () => {
      expect(ruleId, `the shipped configuration from ${PACKAGE_NAME}/check exposes no rule ID ending in /${RULE}`).toBeDefined();
      const result = results.get(variant);
      expect(result).toBeDefined();
      if (result === undefined) return;
      const log = `verify exit ${String(result.code)}:\n${result.output.slice(-20_000)}`;
      expect(result.code, log).not.toBe(0);
      // The app has no raw SQL, so the rule can only be named because its configuration was rejected.
      expect(result.output.split("\n").some((l) => namesRule(l, RULE)), log).toBe(true);
      expect(result.output, log).toMatch(/eslint\.config/);
    });
  }
});
