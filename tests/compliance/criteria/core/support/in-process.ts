/**
 * The reference app run in-process with `createTestApp` (`<package>/testing`, testing.d.ts), for
 * the clauses a criterion states for the local case only (outages forced with `unavailable`,
 * injected log writers, the stub login provider).
 *
 * The app module and the testing helpers are loaded at run time through the installed package
 * (`dist/`, built by the driver first), so the app and the helpers share one framework instance.
 * Types come from the framework sources, so type checking does not need a build.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConfigDeclaration, DefinedApp } from "../../../../../packages/framework/src/index.js";
import type { TestApp, TestAppOptions } from "../../../../../packages/framework/src/testing/public.js";
import { requireBuiltFramework } from "./processes.js";
import { PACKAGE_NAME, REFERENCE_DIR } from "./repo.js";

export type { TestApp, TestAppOptions };

type AnyApp = DefinedApp<ConfigDeclaration, string>;
type CreateTestApp = (app: AnyApp, options?: TestAppOptions) => Promise<TestApp>;

let loaded: Promise<{ app: AnyApp; createTestApp: CreateTestApp }> | undefined;

async function load(): Promise<{ app: AnyApp; createTestApp: CreateTestApp }> {
  requireBuiltFramework();
  const testingSpecifier = `${PACKAGE_NAME}/testing`;
  const testing = (await import(testingSpecifier)) as { createTestApp: CreateTestApp };
  const mod = (await import(pathToFileURL(join(REFERENCE_DIR, "src", "app.ts")).href)) as { default: AnyApp };
  return { app: mod.default, createTestApp: testing.createTestApp };
}

/** A fresh in-process reference app (one build, fresh local storage, migrations applied). */
export async function referenceTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  loaded ??= load();
  const { app, createTestApp } = await loaded;
  return createTestApp(app, options);
}

/** Reads a response body as JSON (or undefined when it is not JSON). */
export async function jsonOf(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
