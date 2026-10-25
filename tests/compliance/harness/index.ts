/**
 * The harness API for compliance test authors (C-T1…C-T4, D-T*). Vitest criteria
 * (`tests/compliance/criteria/**\/*.test.ts`) import from here; Playwright specs
 * (`*.spec.ts`) import `test`/`expect` from `./playwright.js` instead of `@playwright/test`.
 *
 *   import { it } from "vitest";
 *   import { client, tag } from "../../harness/index.js";
 *
 *   it(tag("AUTH-AC-004", "a user gets 403 on an admin route"), async () => {
 *     const user = await client().as("user");
 *     user.expectError(await user.get("/api/levels/admin"), 403, "AUTH.FORBIDDEN");
 *   });
 *
 * Rules (COMPL-REQ-001…003, plan §10.3, "Cloud usage limits"):
 * - every test title starts with its IDs: `tag(id | ids, title)`;
 * - tests address the reference app only through `client()` / the Playwright `baseURL`, and do
 *   not branch on `target()` except where a criterion states a per-target expectation;
 * - fail HTTP checks with `expectStatus` / `expectError`, so the evidence `detail` carries the
 *   status, error code and requestId;
 * - a missing prerequisite (not a defect, e.g. the cloud database is unavailable) is reported
 *   with `prerequisiteMissing(detail)`: the criterion is recorded `blocked`, never passed;
 * - tens of rows per test, never generated in loops; cloud waits only through `waitFor` with a
 *   `CLOUD_WAITS` bound.
 */
import { newRunId, testStageName } from "../../../packages/framework/src/evidence/public.js";
import { createClient, type ComplianceClient } from "./http.js";
import { readTargetEnv, type TargetEnv } from "./env.js";

export { tag, parseTags } from "../../support/tags.js";
export { createClient, HttpCheckError, USER_AGENT, type ComplianceClient, type HttpResponse, type Level, type RequestOptions } from "./http.js";
export { approxEqual, expectMultisetEqual, floatsClose, multisetDiff } from "./compare.js";
export { CLOUD_WAITS, waitFor, type WaitOptions } from "./wait.js";
export { DATE_HEADER_SLACK_MS, inWindow, serverWindow, timed, type TimeWindow } from "./server-time.js";
export { prerequisiteMissing, PrerequisiteMissingError, PREREQUISITE_MARKER } from "./blocked.js";
export { readTargetEnv, type TargetEnv } from "./env.js";
export { REFERENCE_APP } from "./leftovers.js";

/** The target this run is on (`local` or `cloudflare`; AWS is deferred, DEC-0508), its stage and base URL. */
export function target(): TargetEnv {
  return readTargetEnv();
}

/** A new anonymous client for the reference app on this run's target, with its own cookie jar. */
export function client(): ComplianceClient {
  return createClient({ baseUrl: readTargetEnv().baseUrl });
}

/**
 * A further test-stage name, `test-<random run ID>`, for a stage-lifecycle criterion that
 * creates and removes its own stage (compliance.md "Test stages"). The test removes it itself.
 */
export function newTestStage(): string {
  return testStageName(newRunId());
}
