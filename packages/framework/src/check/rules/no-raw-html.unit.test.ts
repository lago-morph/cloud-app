import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, rulesFor, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";

const FILES: Record<string, string> = {
  "src/client/inner.ts": `export function show(t: HTMLElement, s: string): void {\n  t.innerHTML = s;\n}\n`,
  "src/client/outer.ts": `export function show(t: HTMLElement, s: string): void {\n  t.outerHTML += s;\n}\n`,
  "src/client/adjacent.ts": `export function add(t: HTMLElement, s: string): void {\n  t.insertAdjacentHTML("beforeend", s);\n}\n`,
  "src/client/write.ts": `export const w = (s: string): void => document.write(s);\n`,
  "src/client/fragment.ts": `export const f = (s: string): DocumentFragment => document.createRange().createContextualFragment(s);\n`,
  "src/client/react-danger.tsx": `declare global { namespace JSX { interface IntrinsicElements { div: { dangerouslySetInnerHTML?: { __html: string } } } } }\nexport const v = (s: string): unknown => <div dangerouslySetInnerHTML={{ __html: s }} />;\n`,
  "src/client/ok.ts": `export function show(t: HTMLElement, s: string): void {\n  t.textContent = s;\n  const read = t.innerHTML;\n  t.replaceChildren(document.createTextNode(read));\n}\n`,
  "src/server/server-html.ts": `export const page = (o: { innerHTML: string }): void => { o.innerHTML = "<p>x</p>"; };\n`,
};

describe("[CHECK-AC-001] raw-HTML sinks in browser code (no-raw-html)", () => {
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
    ["src/client/inner.ts", /innerHTML/],
    ["src/client/outer.ts", /outerHTML/],
    ["src/client/adjacent.ts", /insertAdjacentHTML/],
    ["src/client/write.ts", /document\.write|write/],
    ["src/client/fragment.ts", /createContextualFragment/],
    ["src/client/react-danger.tsx", /dangerouslySetInnerHTML/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/no-raw-html");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("accepts text insertion and reading innerHTML", () => {
    expect(forFile(diagnostics, "src/client/ok.ts")).toEqual([]);
  });

  it("applies to browser code only", () => {
    expect(rulesFor(diagnostics, "src/server/server-html.ts")).not.toContain("no-raw-html");
  });
});
