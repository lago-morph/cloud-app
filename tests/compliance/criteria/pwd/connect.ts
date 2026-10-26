/**
 * `connectTestStage()` (docs/contracts/ts/testing.d.ts) for the run's cloud test stage.
 *
 * `connectTestStage` connects to the stage that the running `smoke` command targets: `smoke`
 * hands it the connection in the environment variable `PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION`
 * (`{"target","stage","baseUrl"}`, DEC-0273). A compliance run is not a `smoke` run, so this
 * helper sets that variable from the driver's own target variables (harness/env.ts) for the one
 * call, then restores it. The helper is loaded from the built package, like `createTestApp`
 * (core/support/in-process.ts).
 */
import type { TestApp } from "../../../../docs/contracts/ts/testing.js";
import { target } from "../../harness/index.js";
import { requireBuiltFramework } from "../core/support/processes.js";
import { PACKAGE_NAME } from "../core/support/repo.js";

/** The variable `smoke` passes the connection in (DEC-0273). */
export const SMOKE_CONNECTION_ENV = "PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION";

/** `connectTestStage()` on the run's test stage; rejects on a local run. */
export async function connectRunStage(): Promise<TestApp> {
  const t = target();
  if (t.target === "local") throw new Error("connectRunStage is for the run's cloud test stage");
  const stage = t.stage;
  if (stage === undefined || !stage.startsWith("test-")) throw new Error(`the run's stage ${String(stage)} is not a test stage (test-…)`);
  requireBuiltFramework();
  const testing = (await import(`${PACKAGE_NAME}/testing`)) as { connectTestStage: () => Promise<TestApp> };
  const before = process.env[SMOKE_CONNECTION_ENV];
  process.env[SMOKE_CONNECTION_ENV] = JSON.stringify({ target: t.target, stage, baseUrl: t.baseUrl });
  try {
    return await testing.connectTestStage();
  } finally {
    if (before === undefined) delete process.env[SMOKE_CONNECTION_ENV];
    else process.env[SMOKE_CONNECTION_ENV] = before;
  }
}
