import { describe, expect, it } from "vitest";
import * as check from "./public.js";

describe("./check exports (CHECK §2, CHECK-REQ-006)", () => {
  it("[CHECK-AC-006] the shipped configuration names every framework rule under the plugin prefix", () => {
    const rules = check.config.flatMap((c) => Object.keys(c.rules ?? {}));
    for (const name of check.RULE_NAMES) expect(rules).toContain(`prototype-framework/${name}`);
    expect(check.config[0]?.plugins?.["prototype-framework"]).toBe(check.plugin);
  });

  it("the plugin carries the rule implementations", () => {
    const rules: unknown = Reflect.get(check.plugin, "rules");
    expect(Object.keys(rules ?? {})).toEqual(expect.arrayContaining([...check.RULE_NAMES]));
  });

  it("exposes the engine, the formatter, the app compiler options and the reference names for the CLI", () => {
    expect(typeof check.runPortabilityRules).toBe("function");
    expect(typeof check.formatDiagnostics).toBe("function");
    expect(typeof check.checkAppLintConfig).toBe("function");
    expect(check.APP_COMPILER_OPTIONS.types).toEqual([]);
    expect(check.REFERENCE_FILES).toContain("sql-and-migrations.md");
  });
});
