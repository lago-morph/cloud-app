import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";

const FW = "@lago-morph/prototype-framework";
const app = (routes: string): string =>
  `import { defineApp } from "${FW}";\nexport const fixture = defineApp({\n  name: "fixture",\n  config: {},\n  secrets: [],\n  tables: {},\n  routes: (api) => {\n${routes}\n  },\n});\n`;

const FILES: Record<string, string> = {
  "src/server/process-env.ts": `declare const process: { readonly env: Record<string, string | undefined> };\nexport const region = process.env["REGION"] ?? "none";\n`,
  "src/server/process-destructured.ts": `declare const process: { readonly env: Record<string, string | undefined> };\nconst { env } = process;\nexport const region = env["REGION"];\n`,
  "src/server/global-process.ts": `declare global { var process: { env: Record<string, string> }; }\nexport const r = globalThis.process.env["X"];\n`,
  "src/server/import-meta-env.ts": `declare global {\n  interface ImportMeta {\n    readonly env: Record<string, string>;\n  }\n}\nexport const mode = import.meta.env["MODE"];\n`,
  "src/server/c-env.ts": app(`    api.get("/b", (c) => c.json({ names: Object.keys(c.env) }));`),
  "src/server/c-env-destructured.ts": app(`    api.get("/b", (c) => {\n      const { env } = c;\n      return c.json({ n: Object.keys(env).length });\n    });`),
  "src/server/c-alias.ts": app(`    api.get("/b", (c) => {\n      const ctx = c;\n      const platform = ctx.env;\n      return c.json({ n: Object.keys(platform).length });\n    });`),
  "src/server/execution-ctx.ts": app(`    api.get("/later", (c) => {\n      c.executionCtx.waitUntil(Promise.resolve());\n      return c.body(null, 204);\n    });`),
  "src/server/on-error.ts": app(`    api.onError((err, c) => c.json({ message: err.message }, 500));`),
  "src/server/not-found.ts": app(`    api.notFound((c) => c.text("nothing here", 404));`),
  "src/server/ok.ts": `${app(`    api.get("/hello", (c) => c.json({ greeting: c.var.config.get("x"), path: c.req.path }));`)}const settings = { env: "x" };\nexport const s = settings.env;\n`,
};

describe("[CHECK-AC-001] no-env-access", () => {
  let checkApp: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    checkApp = await createCheckApp(FILES);
    diagnostics = await checkApp.lint();
  }, 120_000);

  afterAll(async () => {
    await checkApp.dispose();
  });

  const rejects: [string, RegExp][] = [
    ["src/server/process-env.ts", /process\.env/],
    ["src/server/process-destructured.ts", /process/],
    ["src/server/global-process.ts", /process\.env/],
    ["src/server/import-meta-env.ts", /import\.meta\.env/],
    ["src/server/c-env.ts", /\benv\b/],
    ["src/server/c-env-destructured.ts", /\benv\b/],
    ["src/server/c-alias.ts", /\benv\b/],
    ["src/server/execution-ctx.ts", /executionCtx/],
    ["src/server/on-error.ts", /onError/],
    ["src/server/not-found.ts", /notFound/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/no-env-access");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("accepts c.var, c.req and unrelated env properties", () => {
    expect(forFile(diagnostics, "src/server/ok.ts")).toEqual([]);
  });
});
