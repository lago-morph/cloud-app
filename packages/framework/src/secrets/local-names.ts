/**
 * Local-only framework secret names (secrets.md §2 "Framework-internal secrets"; CORE-REQ-006).
 * Imported only by the local target runtime, `createTestApp` and Node-side code (CLI, `.dev.vars`
 * store), never by a module a cloud bundle contains, so these names never appear in one
 * (DEC-0194). Workers-compatible (no Node APIs).
 */
import { FRAMEWORK_SECRETS } from "./names.js";

/** FILES' local transfer-route ticket key; local only. */
export const LOCAL_TICKET_KEY = "frameworkLocalTicketKey";

export type LocalFrameworkSecretName = typeof LOCAL_TICKET_KEY;

/** Framework-internal secrets that exist only on the local target. */
export const LOCAL_FRAMEWORK_SECRETS: readonly LocalFrameworkSecretName[] = Object.freeze([LOCAL_TICKET_KEY]);

/** Development-only framework secrets that `dev` generates into `.dev.vars` when absent. */
export const DEV_GENERATED_SECRETS: readonly (typeof FRAMEWORK_SECRETS.sessionKey | typeof FRAMEWORK_SECRETS.authSecret | LocalFrameworkSecretName)[] = Object.freeze([
  FRAMEWORK_SECRETS.sessionKey,
  FRAMEWORK_SECRETS.authSecret,
  LOCAL_TICKET_KEY,
]);
