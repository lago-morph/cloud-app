/**
 * The reference app in-process (`createTestApp`), for the scenario parts that run that way
 * locally: E2E-007's local part (stub login provider, rebuild = a new test app) and E2E-011's
 * injected failing log writer.
 *
 * The app module is imported at run time from `apps/reference/src/app.ts` (its `app` export,
 * DEC-0214), and the test app is created with the app directory as the working directory so
 * the committed migrations are the ones applied.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";
import { REFERENCE_DIR } from "./process.js";

type DefinedReferenceApp = Parameters<typeof createTestApp>[0];

let loaded: DefinedReferenceApp | undefined;

async function referenceApp(): Promise<DefinedReferenceApp> {
  if (loaded === undefined) {
    const mod = (await import(pathToFileURL(join(REFERENCE_DIR, "src", "app.ts")).href)) as { app?: DefinedReferenceApp; default?: DefinedReferenceApp };
    const app = mod.app ?? mod.default;
    if (app === undefined) throw new Error("apps/reference/src/app.ts exports no app");
    loaded = app;
  }
  return loaded;
}

/** A fresh in-process reference app (one build, fresh storage). */
export async function referenceTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const app = await referenceApp();
  const cwd = process.cwd();
  process.chdir(REFERENCE_DIR);
  try {
    return await createTestApp(app, options);
  } finally {
    process.chdir(cwd);
  }
}
