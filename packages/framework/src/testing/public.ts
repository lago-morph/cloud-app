/**
 * Test helpers owned by the testing component (contract: docs/contracts/ts/testing.d.ts:
 * `createTestApp`, `connectTestStage` and their types). `mockUsers` is AUTH's (auth/testing.ts).
 * `createTestApp` lives in `test-app.ts` (B-16); `connectTestStage` in `connect.ts` (C-04).
 */
export type { LogEntry } from "../log/entry.js";
export { createTestApp } from "./test-app.js";
export type { MailMessage, TestApp, TestAppOptions, TestAuthApp, TestCapability, TestClock, TestMail, TestRole } from "./test-app.js";
export { connectTestStage } from "./connect.js";
