import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";

const FW = "@lago-morph/prototype-framework";
const thrower = (code: string): string => `import { FrameworkError } from "${FW}";\nexport function reject(): never {\n  throw new FrameworkError(${code});\n}\n`;

const FILES: Record<string, string> = {
  "src/server/sql-conflict.ts": thrower(`"SQL.CONFLICT", "duplicate"`),
  "src/server/kv.ts": thrower(`"KV.INVALID_KEY"`),
  "src/server/core.ts": thrower(`"CORE.INTERNAL"`),
  "src/server/unauthorized.ts": thrower(`"AUTH.UNAUTHORIZED"`),
  "src/server/const-alias.ts": `import { FrameworkError } from "${FW}";\nexport function reject(): never {\n  const code = "SEC.MISSING" as const;\n  throw new FrameworkError(code);\n}\n`,
  "src/server/wide.ts": `import { FrameworkError, type ErrorCode } from "${FW}";\nexport function reject(code: ErrorCode): never {\n  throw new FrameworkError(code);\n}\n`,
  "src/server/errors.ts": `export { FrameworkError as AppError } from "${FW}";\n`,
  "src/server/reexported.ts": `import { AppError } from "./errors";\nexport function reject(): never {\n  throw new AppError("FILES.NOT_FOUND");\n}\n`,
  "src/server/ok.ts": `import { FrameworkError } from "${FW}";\nexport const nf = (): never => { throw new FrameworkError("HTTP.NOT_FOUND", "no"); };\nexport const fb = (): never => { throw new FrameworkError("AUTH.FORBIDDEN"); };\nexport const inv = (): never => { throw new FrameworkError("HTTP.INVALID_INPUT"); };\nexport const conflict = (which: boolean): never => { throw new FrameworkError(which ? "HTTP.CONFLICT" : "HTTP.NOT_FOUND"); };\nexport const check = (e: unknown): boolean => e instanceof FrameworkError && e.code === "SQL.CONFLICT";\n`,
};

describe("[CHECK-AC-001] app-error-codes", () => {
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
    ["src/server/sql-conflict.ts", /SQL\.CONFLICT/],
    ["src/server/kv.ts", /KV\.INVALID_KEY/],
    ["src/server/core.ts", /CORE\.INTERNAL/],
    ["src/server/unauthorized.ts", /AUTH\.UNAUTHORIZED/],
    ["src/server/const-alias.ts", /SEC\.MISSING/],
    ["src/server/wide.ts", /code/],
    ["src/server/reexported.ts", /FILES\.NOT_FOUND/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/app-error-codes");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("accepts the four CORE-REQ-007 codes, and reading other codes", () => {
    expect(forFile(diagnostics, "src/server/ok.ts")).toEqual([]);
    expect(forFile(diagnostics, "src/server/errors.ts")).toEqual([]);
  });
});
