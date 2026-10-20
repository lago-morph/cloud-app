/**
 * The harness API for compliance test authors (C-T1…C-T4, D-T*). Vitest criteria import from
 * here; Playwright specs import `test`/`expect` from `./playwright.js` as well.
 *
 *   import { describe, it } from "vitest";
 *   import { tag, target, client } from "../../harness/index.js";
 *
 *   it(tag("KV-AC-001", "put, overwrite, get"), async () => {
 *     const api = client();
 *     const admin = await api.as("admin");
 *     admin.expectStatus(await admin.post("/api/kv/x", { value: "1" }), 204);
 *   });
 */
import { createClient, type ComplianceClient } from "./http.js";
import { readTargetEnv, type TargetEnv } from "./env.js";

export { tag, parseTags } from "../../support/tags.js";
export { createClient, HttpCheckError, USER_AGENT, type ComplianceClient, type HttpResponse, type Level, type RequestOptions } from "./http.js";
export { approxEqual, expectMultisetEqual, floatsClose, multisetDiff } from "./compare.js";
export { CLOUD_WAITS, waitFor, type WaitOptions } from "./wait.js";
export { prerequisiteMissing, PrerequisiteMissingError, PREREQUISITE_MARKER } from "./blocked.js";
export { readTargetEnv, type TargetEnv } from "./env.js";

/** The target this run is on (`local`, `cloudflare`, `aws`), its stage and base URL. */
export function target(): TargetEnv {
  return readTargetEnv();
}

/** A new anonymous client for the reference app on this run's target, with its own cookie jar. */
export function client(): ComplianceClient {
  return createClient({ baseUrl: readTargetEnv().baseUrl });
}
