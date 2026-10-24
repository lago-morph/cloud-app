/**
 * CORE-AC-007: building a fixture app whose name contains a hyphen fails, naming the app-name
 * rule (core.md §2 "Deployment identity", PAR-290). Uses the package binary's `build` command
 * (CLI-REQ-001) on an on-disk fixture app. Criteria: docs/components/core.md §4.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { appModule, baseAppFiles, makeTempApp, runCli, stageConfig, type TempApp, PACKAGE_NAME } from "./harness/harness.js";

let app: TempApp | undefined;
afterEach(async () => {
  await app?.remove();
  app = undefined;
});

function fixture(name: string) {
  return {
    ...baseAppFiles("namefixture"),
    "src/app.ts": appModule({
      imports: `import { defineApp } from "${PACKAGE_NAME}";`,
      definition: `{ name: ${JSON.stringify(name)}, config: {}, secrets: [], tables: {}, routes: (api) => { api.get("/ping", (c) => c.json({ ok: true })); } }`,
    }),
    "config/local.json": stageConfig({}),
    "config/cloudflare/test.json": stageConfig({}),
  };
}

/** The rule as core.md states it: lowercase letters and digits only, no hyphens. */
const NAMES_THE_RULE = /hyphen|lowercase letters and digits|\[a-z0-9\]|PAR-290/i;

describe("CORE-AC-007 app-name rule", () => {
  it("control for CORE-AC-007: a valid app name builds", async () => {
    app = await makeTempApp(fixture("goodname1"));
    const res = await runCli(["build", "--target", "local", "--stage", "local"], { cwd: app.dir });
    expect(res.status, res.output).toBe(0);
  });

  for (const target of ["local", "cloudflare"] as const) {
    it(tag("CORE-AC-007", `building an app whose name contains a hyphen fails naming the app-name rule (--target ${target})`), async () => {
      app = await makeTempApp(fixture("bad-name"));
      const stage = target === "local" ? "local" : "test-bt1name";
      const res = await runCli(["build", "--target", target, "--stage", stage], { cwd: app.dir });
      expect(res.status).not.toBe(0);
      expect(res.status).not.toBeNull();
      expect(res.output).toContain("bad-name");
      expect(res.output).toMatch(NAMES_THE_RULE);
    });
  }
});
