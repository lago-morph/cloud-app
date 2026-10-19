/**
 * The in-process SQL suite app. Imports the framework, so only suites (loaded after the
 * dialect is selected) may import this module.
 *
 * `createTestApp` gives "fresh local storage, migrations applied" (testing.d.ts). The
 * migrations are the app's generated ones (MIG-REQ-001), so the suite first writes a
 * scratch app with the same tables, runs `generate-migration` there, and makes that
 * directory the working directory of this test process (DEC-0192).
 */
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import * as fw from "../../../../src/index.js";
import { createTestApp, type TestApp, type TestAppOptions } from "../../../../src/testing/index.js";
import { createAppDir, removeAppDir, runCli } from "./app-dir.js";
import { probeRoutes } from "./probe.js";
import { defineSuiteSchema, SCRATCH_APP_SOURCE, SUITE_APP_NAME, type SuiteSchema } from "../fixtures/schema.js";

const schemaSource = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/schema.ts");

export const tables: SuiteSchema = defineSuiteSchema(fw);

export const suiteApp = fw.defineApp({
  name: SUITE_APP_NAME,
  config: {},
  secrets: [],
  tables,
  routes: (api) => probeRoutes(api),
});

let appDir: string | undefined;
let previousCwd: string | undefined;

/** Once per test file: scratch app with generated migrations, made the working directory. */
export async function prepareSuiteDir(): Promise<void> {
  if (appDir !== undefined) return;
  appDir = createAppDir({ "src/app.ts": SCRATCH_APP_SOURCE });
  copyFileSync(schemaSource, join(appDir, "src/schema.ts"));
  const generated = await runCli(appDir, ["generate-migration"]);
  expect(generated.status, `generate-migration failed:\n${generated.output}`).toBe(0);
  previousCwd = process.cwd();
  process.chdir(appDir);
}

export function cleanupSuiteDir(): void {
  if (previousCwd !== undefined) process.chdir(previousCwd);
  removeAppDir(appDir);
  appDir = undefined;
  previousCwd = undefined;
}

export function newTestApp(options?: TestAppOptions): Promise<TestApp> {
  return createTestApp(suiteApp, options);
}

/** Fixed, valid UUID v4 values, so orderings that end in `id` are known in advance. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
