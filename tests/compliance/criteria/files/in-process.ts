/**
 * The reference app in-process (`createTestApp`), for the local-only clauses whose condition
 * cannot be produced on a running `dev` server: storage unreachable (FILES-AC-006), a clock
 * moved past a session's expiry (AUTH-AC-006 "Locally, …"), and the stub login provider
 * (AUTH-AC-006 transaction cookie). Loaded by path at run time so that the compliance
 * typecheck does not compile the app with the tooling settings.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";

const here = path.dirname(fileURLToPath(import.meta.url));
const appModule = pathToFileURL(path.resolve(here, "../../../../apps/reference/src/app.ts")).href;

type ReferenceApp = Parameters<typeof createTestApp>[0];

let cached: ReferenceApp | undefined;

export async function referenceApp(): Promise<ReferenceApp> {
  cached ??= ((await import(appModule)) as { default: ReferenceApp }).default;
  return cached;
}

const opened: TestApp[] = [];

export async function openReference(options?: TestAppOptions): Promise<TestApp> {
  const app = await createTestApp(await referenceApp(), options);
  opened.push(app);
  return app;
}

export async function disposeReference(): Promise<void> {
  await Promise.all(opened.splice(0).map((a) => a.dispose()));
}
