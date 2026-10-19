import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { typeCheckApp } from "./type-check.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function app(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "type-check-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe("verify's type check (CLI-REQ-002 step 1, CHECK §2 app lib set)", () => {
  it("[CLI-AC-002] reports a type error with its file, position and TS code", async () => {
    const dir = app({ "src/server/broken.ts": 'export const n: number = "x";\n', "src/server/ok.ts": "export const m = 1;\n" });
    const diagnostics = await typeCheckApp(dir);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ file: "src/server/broken.ts", line: 1, column: 14, rule: "TS2322" });
  });

  it("uses the app lib set, not the app's tsconfig.json: Node globals fail in server code", async () => {
    const dir = app({
      "tsconfig.json": JSON.stringify({ compilerOptions: { types: ["node"], strict: false } }),
      "src/server/buffer.ts": 'export const b = Buffer.from("x");\n',
    });
    const diagnostics = await typeCheckApp(dir);
    expect(diagnostics.map((d) => [d.file, d.rule])).toEqual([["src/server/buffer.ts", "TS2591"]]);
  });

  it("passes a clean app, and an app with no TypeScript files", async () => {
    expect(await typeCheckApp(app({ "src/app.ts": "export const x: string = 'a';\n", "tests/a.test.ts": "export {};\n" }))).toEqual([]);
    expect(await typeCheckApp(app({}))).toEqual([]);
  });
});
