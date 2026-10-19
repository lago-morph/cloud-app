/**
 * Test helpers owned by the testing component (contract: docs/contracts/ts/testing.d.ts:
 * `createTestApp`, `connectTestStage` and their types). `mockUsers` is AUTH's (auth/testing.ts).
 * `createTestApp` lives in `test-app.ts` (B-16); `connectTestStage` is C-04's.
 */
import type { TestApp } from "./test-app.js";

export type { LogEntry } from "../log/entry.js";
export { createTestApp } from "./test-app.js";
export type { TestApp, TestAppOptions } from "./test-app.js";

/** Connects to the deployed test stage that `smoke` targets, or to the local `dev` server. */
export function connectTestStage(): Promise<TestApp> {
  throw new Error("not implemented: connectTestStage");
}
