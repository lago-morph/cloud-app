/**
 * The cross-origin parts every S3 endpoint shares (files.md §2 "Cross-origin configuration";
 * DEC-0099; FILES-REQ-004): the stage's public origin as exactly one origin, and the one CORS
 * preflight deploy's health step sends to storage (provisioning.md §2 step 7). The Cloudflare and
 * AWS modules (branch `aws`, DEC-0508) wrap these with their bucket URLs and policy shapes. Workers- and Node-compatible
 * (`fetch` only).
 */
import { FrameworkError } from "../../core/errors.js";

/** The one origin `origin` names exactly (scheme, host, port; no path, no wildcard), or a throw. */
export function exactOrigin(origin: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(origin);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || parsed.origin !== origin || origin.includes("*")) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the stage's public origin ${JSON.stringify(origin)} is not exactly one origin`);
  }
  return origin;
}

/** The health step's outcome (the shape of PROV's `HealthOutcome`). */
export type StorageCorsOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly status?: number };

/** Key the preflight names; a preflight reads and writes nothing, so it need not exist. */
export const CORS_PROBE_KEY = "__framework-cors-check";

/**
 * One CORS preflight to `url` (an object URL in the stage's bucket) as the browser would send it
 * before an upload. Passes when storage allows exactly the stage's public origin; never throws,
 * never includes storage's response body (it is not read).
 */
export async function preflightStorageCors(url: string, publicOrigin: string, fetcher: typeof fetch = fetch): Promise<StorageCorsOutcome> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "OPTIONS",
      headers: { "Origin": publicOrigin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
  } catch (thrown) {
    const cause = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    return { ok: false, message: `the stage's file storage could not be reached for its CORS preflight (${cause})` };
  }
  await response.body?.cancel();
  const allowed = response.headers.get("Access-Control-Allow-Origin");
  if (response.status >= 200 && response.status < 300 && allowed === publicOrigin) return { ok: true };
  return {
    ok: false,
    status: response.status,
    message: `the stage's file storage refused a CORS preflight from ${publicOrigin} (HTTP ${response.status}, Access-Control-Allow-Origin ${allowed === null ? "absent" : JSON.stringify(allowed)})`,
  };
}
