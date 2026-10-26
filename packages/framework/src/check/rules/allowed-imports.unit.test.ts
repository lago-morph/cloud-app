import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, rulesFor, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";

const FW = "@lago-morph/prototype-framework";

const FILES: Record<string, string> = {
  "src/server/bare-fs.ts": `import fs from "fs";\nexport const e = (p: string): boolean => fs.existsSync(p);\n`,
  "src/server/bare-crypto.ts": `import { createHash } from "crypto";\nexport const h = createHash;\n`,
  "src/server/bare-fs-promises.ts": `import { readFile } from "fs/promises";\nexport const r = readFile;\n`,
  "src/server/dynamic-node.ts": `export async function host(): Promise<string> {\n  const os = await import("node:os");\n  return os.hostname();\n}\n`,
  "src/server/dynamic-computed.ts": `export async function load(name: string): Promise<unknown> {\n  return import(name);\n}\n`,
  "src/server/reexport-node.ts": `export { readFile } from "node:fs/promises";\n`,
  "src/server/reexport-all.ts": `export * from "node:path";\n`,
  "src/server/via-reexport.ts": `import { readFile } from "./reexport-node";\nexport const load = (p: string): Promise<string> => readFile(p, "utf8");\n`,
  "src/server/import-equals.ts": `import fs = require("fs");\nexport const f = fs;\n`,
  "src/server/drizzle-d1.ts": `import { drizzle } from "drizzle-orm/d1";\nexport const d = drizzle;\n`,
  "src/server/drizzle-pg-core.ts": `import { pgTable, text } from "drizzle-orm/pg-core";\nexport const t = pgTable("t", { id: text("id") });\n`,
  "src/server/pglite.ts": `import { PGlite } from "@electric-sql/pglite";\nexport const p = PGlite;\n`,
  "src/server/cf-workers.ts": `import { env } from "cloudflare:workers";\nexport const b = env;\n`,
  "src/server/workers-types.ts": `import type { D1Database } from "@cloudflare/workers-types";\nexport type D = D1Database;\n`,
  "src/server/aws-sdk.ts": `import { S3Client } from "@aws-sdk/client-s3";\nexport const s = S3Client;\n`,
  "src/server/hono-adapter.ts": `import { env } from "hono/adapter";\nexport const e = env;\n`,
  "src/server/fw-targets.ts": `import * as t from "${FW}/targets/local";\nexport const x = t;\n`,
  "src/server/fw-provision.ts": `import * as p from "${FW}/provision";\nexport const x = p;\n`,
  "src/server/fw-check.ts": `import * as c from "${FW}/check";\nexport const x = c;\n`,
  "src/server/fw-testing.ts": `import { mockUsers } from "${FW}/testing";\nexport const x = mockUsers;\n`,
  "src/server/fw-client.ts": `import { api } from "${FW}/client";\nexport const x = api;\n`,
  "src/server/fw-targets-aws.ts": `import * as a from "${FW}/targets/aws";\nexport const x = a;\n`,
  "src/server/server-imports-client.ts": `import { page } from "../client/page";\nexport const x = page;\n`,
  "src/server/ok.ts": `import { Hono } from "hono";\nimport { z } from "zod";\nimport { eq } from "drizzle-orm";\nimport { defineTable, id } from "${FW}";\nimport { shape } from "../shared/shape";\nexport const t = defineTable("things", { id: id() });\nexport const x = [Hono, z, eq, shape];\n`,
  "src/shared/shape.ts": `import { z } from "zod";\nimport type { Other } from "./other";\nexport const shape = z.object({ a: z.string() });\nexport type S = Other;\n`,
  "src/shared/other.ts": `export interface Other { readonly a: string }\n`,
  "src/shared/bad-framework.ts": `import { z } from "${FW}";\nexport const s = z.string();\n`,
  "src/shared/bad-server.ts": `import { t } from "../server/ok";\nexport const s = t;\n`,
  "src/shared/bad-package.ts": `import { Hono } from "hono";\nexport const h = Hono;\n`,
  "src/client/page.ts": `import { z } from "zod";\nimport { api } from "${FW}/client";\nimport type { S } from "../shared/shape";\nimport { type Other } from "../shared/other";\nimport { helper } from "./helper";\nexport const page = [z, api, helper];\nexport type P = S | Other;\n`,
  "src/client/helper.ts": `export const helper = 1;\n`,
  "src/client/shared-value.ts": `import { shape } from "../shared/shape";\nexport const x = shape;\n`,
  "src/client/server-value.ts": `import type { t } from "../server/ok";\nexport type X = typeof t;\n`,
  "tests/ok.test.ts": `import { expect, it } from "vitest";\nimport { createTestApp, mockUsers } from "${FW}/testing";\nimport { defineApp } from "${FW}";\nimport { page } from "../src/client/page";\nimport { t } from "../src/server/ok";\nit("x", () => { expect([createTestApp, mockUsers, defineApp, page, t]).toBeDefined(); });\n`,
  "tests/node.test.ts": `import { readFileSync } from "node:fs";\nexport const r = readFileSync;\n`,
};

describe("[CHECK-AC-001] allowed-imports", () => {
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
    ["src/server/bare-fs.ts", /"fs"/],
    ["src/server/bare-crypto.ts", /"crypto"/],
    ["src/server/bare-fs-promises.ts", /"fs\/promises"/],
    ["src/server/dynamic-node.ts", /node:os/],
    ["src/server/dynamic-computed.ts", /dynamic import/i],
    ["src/server/reexport-node.ts", /node:fs\/promises/],
    ["src/server/reexport-all.ts", /node:path/],
    ["src/server/via-reexport.ts", /readFile.*node:fs\/promises/],
    ["src/server/import-equals.ts", /"fs"/],
    ["src/server/drizzle-d1.ts", /drizzle-orm\/d1/],
    ["src/server/drizzle-pg-core.ts", /drizzle-orm\/pg-core/],
    ["src/server/pglite.ts", /@electric-sql\/pglite/],
    ["src/server/cf-workers.ts", /cloudflare:workers/],
    ["src/server/workers-types.ts", /@cloudflare\/workers-types/],
    ["src/server/aws-sdk.ts", /@aws-sdk\/client-s3/],
    ["src/server/hono-adapter.ts", /hono\/adapter/],
    ["src/server/fw-targets.ts", /targets\/local/],
    ["src/server/fw-provision.ts", /provision/],
    ["src/server/fw-check.ts", /\/check/],
    ["src/server/fw-testing.ts", /\/testing/],
    ["src/server/fw-client.ts", /\/client/],
    ["src/server/fw-targets-aws.ts", /targets\/aws/],
    ["src/server/server-imports-client.ts", /client\/page/],
    ["src/shared/bad-framework.ts", /prototype-framework/],
    ["src/shared/bad-server.ts", /server\/ok/],
    ["src/shared/bad-package.ts", /hono/],
    ["src/client/shared-value.ts", /shared\/shape/],
    ["src/client/server-value.ts", /server\/ok/],
    ["tests/node.test.ts", /node:fs/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/allowed-imports");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  for (const file of ["src/server/ok.ts", "src/shared/shape.ts", "src/shared/other.ts", "src/client/page.ts", "src/client/helper.ts", "tests/ok.test.ts"]) {
    it(`accepts ${file}`, () => {
      expect(rulesFor(diagnostics, file)).not.toContain("allowed-imports");
    });
  }
});

describe("[CHECK-AC-001] allowed-imports: npm aliases", () => {
  it("an import of an npm alias (\"s3\": \"npm:@aws-sdk/client-s3@…\") is judged by the package it installs", async () => {
    const app = await createCheckApp({
      "package.json": `${JSON.stringify({ name: "notes", type: "module", dependencies: { s3: "npm:@aws-sdk/client-s3@^3.700.0", pg2: "npm:pg", nice: "npm:hono@4.13.13" } }, null, 2)}\n`,
      "src/server/alias.ts": `import { S3Client } from "s3";\nexport const s = S3Client;\n`,
      "src/server/alias-sub.ts": `import * as p from "pg2/lib/client";\nexport const x = p;\n`,
      "src/server/alias-ok.ts": `import { Hono } from "nice";\nexport const h = Hono;\n`,
    });
    try {
      const diagnostics = await app.lint();
      const of = (file: string) => forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/allowed-imports");
      expect(of("src/server/alias.ts").map((d) => d.message)).toEqual([expect.stringMatching(/"s3".*npm alias of "@aws-sdk\/client-s3".*platform SDK or database driver/)]);
      expect(of("src/server/alias-sub.ts").map((d) => d.message)).toEqual([expect.stringMatching(/npm alias of "pg"/)]);
      expect(of("src/server/alias-ok.ts")).toEqual([]);
    } finally {
      await app.dispose();
    }
  }, 120_000);
});
