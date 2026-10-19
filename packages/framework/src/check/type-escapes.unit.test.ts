import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, type CheckApp } from "./harness.js";
import type { CheckDiagnostic } from "./engine.js";

const FILES: Record<string, string> = {
  "src/server/any-param.ts": `export function d(value: any): string {\n  return String(value);\n}\n`,
  "src/server/any-generic.ts": `export const bag: Array<any> = [];\n`,
  "src/server/as-unknown-as.ts": `interface Note { readonly title: string }\nexport const note = 42 as unknown as Note;\n`,
  "src/server/as-unrelated.ts": `interface Point { readonly x: number }\nexport const p = { label: "a" } as Point;\n`,
  "src/server/angle.ts": `export const n = <number>(<unknown>"x");\n`,
  "src/server/non-null.ts": `export const first = (xs: string[]): string => xs[0]!;\n`,
  "src/server/ts-ignore.ts": `// @ts-ignore\nexport const count: number = "three";\n`,
  "src/server/ts-expect-error.ts": `// @ts-expect-error: on purpose\nexport const count: number = "three";\n`,
  "src/server/ts-nocheck.ts": `// @ts-nocheck\nexport const count = 3;\n`,
  "src/server/eslint-disable.ts": `/* eslint-disable */\nexport const count = 3;\n`,
  "src/server/eslint-disable-next-line.ts": `// eslint-disable-next-line no-console\nexport const count = 3;\n`,
  "src/server/eslint-inline-config.ts": `/* eslint prototype-framework/no-raw-sql: "off" */\nexport const count = 3;\n`,
  "src/server/disable-hides-nothing.ts": `// eslint-disable-next-line prototype-framework/allowed-imports\nimport { readFileSync } from "node:fs";\nexport const r = readFileSync;\n`,
  "tests/any-in-test.test.ts": `export const x: any = 1;\n`,
  "src/server/ok.ts": `export const keys = ["a", "b"] as const;\nexport const limits = { page: 20 } satisfies Record<string, number>;\nexport const codes = ["HTTP.NOT_FOUND"] as const satisfies readonly string[];\n// An ordinary comment mentioning eslint and ts-ignore in prose is fine.\nexport const parsed: unknown = JSON.parse("1");\n`,
};

describe("[CHECK-AC-002] no type escapes (CHECK-REQ-002)", () => {
  let app: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    app = await createCheckApp(FILES);
    diagnostics = await app.lint();
  }, 120_000);

  afterAll(async () => {
    await app.dispose();
  });

  const rejects: [string, RegExp][] = [
    ["src/server/any-param.ts", /no-explicit-any/],
    ["src/server/any-generic.ts", /no-explicit-any/],
    ["src/server/as-unknown-as.ts", /consistent-type-assertions/],
    ["src/server/as-unrelated.ts", /consistent-type-assertions/],
    ["src/server/angle.ts", /consistent-type-assertions/],
    ["src/server/non-null.ts", /no-non-null-assertion/],
    ["src/server/ts-ignore.ts", /no-suppression-comments/],
    ["src/server/ts-expect-error.ts", /no-suppression-comments/],
    ["src/server/ts-nocheck.ts", /no-suppression-comments/],
    ["src/server/eslint-disable.ts", /no-suppression-comments/],
    ["src/server/eslint-disable-next-line.ts", /no-suppression-comments/],
    ["src/server/eslint-inline-config.ts", /no-suppression-comments/],
    ["tests/any-in-test.test.ts", /no-explicit-any/],
  ];

  for (const [file, rule] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file);
      expect(found.some((d) => rule.test(d.rule)), JSON.stringify(found)).toBe(true);
    });
  }

  it("a disable comment does not switch a rule off", () => {
    const rules = forFile(diagnostics, "src/server/disable-hides-nothing.ts").map((d) => d.rule);
    expect(rules).toContain("prototype-framework/allowed-imports");
    expect(rules).toContain("prototype-framework/no-suppression-comments");
  });

  it("type-escape diagnostics name a skill reference", () => {
    expect(forFile(diagnostics, "src/server/any-param.ts")[0]?.reference).toBe("skill/reference/troubleshooting.md");
  });

  it("as const, satisfies and prose comments pass", () => {
    expect(forFile(diagnostics, "src/server/ok.ts")).toEqual([]);
  });
});
