/**
 * Hub for `./testing` (CORE-REQ-005): test helpers, exactly the names of
 * docs/contracts/ts/testing.d.ts. Re-exports only; owners testing (public.ts) and AUTH (auth/testing.ts).
 */
export { createTestApp, connectTestStage } from "./public.js";
export type { LogEntry, TestApp, TestAppOptions, TestCapability, TestRole } from "./public.js";
export { mockUsers } from "../auth/testing.js";
