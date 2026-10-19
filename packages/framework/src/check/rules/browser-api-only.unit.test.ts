import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckApp, forFile, rulesFor, type CheckApp } from "../harness.js";
import type { CheckDiagnostic } from "../engine.js";

const FW = "@lago-morph/prototype-framework";

const FILES: Record<string, string> = {
  "src/client/framework-root.ts": `import { z } from "${FW}";\nexport const s = z.string();\n`,
  "src/client/framework-root-type.ts": `import type { ErrorCode } from "${FW}";\nexport type C = ErrorCode;\n`,
  "src/client/testing.ts": `import { mockUsers } from "${FW}/testing";\nexport const v = mockUsers.anonymous;\n`,
  "src/client/fetch.ts": `export async function load(): Promise<unknown> {\n  const res = await fetch("/api/notes");\n  return res.json();\n}\n`,
  "src/client/fetch-alias.ts": `const get = globalThis.fetch;\nexport const load = (): Promise<Response> => get("/api/notes");\n`,
  "src/client/window-fetch.ts": `export const load = (): Promise<Response> => window.fetch("/api/notes");\n`,
  "src/client/xhr.ts": `export function load(): XMLHttpRequest {\n  const xhr = new XMLHttpRequest();\n  xhr.open("GET", "/api/notes");\n  return xhr;\n}\n`,
  "src/client/websocket.ts": `export const live = (): WebSocket => new WebSocket("ws://localhost:5173/api/live");\n`,
  "src/client/eventsource.ts": `export const events = (): EventSource => new EventSource("/api/events");\n`,
  "src/client/ok.ts": `import { z } from "zod";\nimport { api, ApiError, getCurrentUser } from "${FW}/client";\nexport type Handle = WebSocket | null;\nconst fetchLike = { fetch: (): number => 1 };\nexport async function load(): Promise<unknown> {\n  try {\n    return [await api<{ a: string }>("/x"), await getCurrentUser(), z.string(), fetchLike.fetch()];\n  } catch (e) {\n    return e instanceof ApiError ? null : e;\n  }\n}\n`,
  "src/server/fetch-on-server.ts": `export const f = (): Promise<Response> => fetch("https://example.invalid/");\n`,
};

describe("[CHECK-AC-001] browser-api-only", () => {
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
    ["src/client/framework-root.ts", /prototype-framework/],
    ["src/client/framework-root-type.ts", /prototype-framework/],
    ["src/client/testing.ts", /testing/],
    ["src/client/fetch.ts", /fetch/],
    ["src/client/fetch-alias.ts", /fetch/],
    ["src/client/window-fetch.ts", /fetch/],
    ["src/client/xhr.ts", /XMLHttpRequest/],
    ["src/client/websocket.ts", /WebSocket/],
    ["src/client/eventsource.ts", /EventSource/],
  ];

  for (const [file, construct] of rejects) {
    it(`rejects ${file}`, () => {
      const found = forFile(diagnostics, file).filter((d) => d.rule === "prototype-framework/browser-api-only");
      expect(found.length, JSON.stringify(forFile(diagnostics, file))).toBeGreaterThan(0);
      expect(found.some((d) => construct.test(d.message)), JSON.stringify(found)).toBe(true);
    });
  }

  it("reports each direct network use once (not again for the type annotation)", () => {
    expect(forFile(diagnostics, "src/client/websocket.ts")).toHaveLength(1);
  });

  it("accepts ./client helpers, zod, network types, and same-named members of app objects", () => {
    expect(forFile(diagnostics, "src/client/ok.ts")).toEqual([]);
  });

  it("applies to browser code only", () => {
    expect(rulesFor(diagnostics, "src/server/fetch-on-server.ts")).not.toContain("browser-api-only");
  });
});
