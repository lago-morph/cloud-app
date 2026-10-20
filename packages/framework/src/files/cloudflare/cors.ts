/**
 * Cross-origin configuration of a stage's R2 bucket (files.md §2 "Cross-origin configuration";
 * DEC-0099; FILES-REQ-004): the policy provisioning sets, and the one CORS preflight deploy's
 * health step sends to storage (provisioning.md §2 step 7). App code never sees either.
 * Workers- and Node-compatible (`fetch` only).
 */
import { FrameworkError } from "../../core/errors.js";

/** The body of `PUT /accounts/<account>/r2/buckets/<bucket>/cors` (Cloudflare API). */
export interface BucketCorsPolicy {
  readonly rules: readonly {
    readonly allowed: { readonly origins: readonly string[]; readonly methods: readonly string[]; readonly headers: readonly string[] };
    readonly maxAgeSeconds: number;
  }[];
}

/** The one origin `origin` names exactly (scheme, host, port; no path, no wildcard), or a throw. */
function exactOrigin(origin: string): string {
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

/** One rule: PUT and GET from the stage's public origin only, with the Content-Type header. */
export function bucketCorsPolicy(publicOrigin: string): BucketCorsPolicy {
  return {
    rules: [{ allowed: { origins: [exactOrigin(publicOrigin)], methods: ["PUT", "GET"], headers: ["Content-Type"] }, maxAgeSeconds: 60 }],
  };
}

/** The health step's outcome (the shape of PROV's `HealthOutcome`). */
export type StorageCorsOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly status?: number };

export interface StorageCorsCheck {
  readonly accountId: string;
  readonly bucket: string;
  readonly publicOrigin: string;
  /** Default the global `fetch` (in Node, run with `NODE_USE_ENV_PROXY=1` behind a proxy). */
  readonly fetch?: typeof fetch;
}

/** Key the preflight names; a preflight reads and writes nothing, so it need not exist. */
const PROBE_KEY = "__framework-cors-check";

/**
 * One CORS preflight to the bucket's S3 endpoint as the browser would send it before an upload.
 * Passes when storage allows exactly the stage's public origin; never throws, never includes
 * storage's response body (it is not read).
 */
export async function checkStorageCors(check: StorageCorsCheck): Promise<StorageCorsOutcome> {
  const url = `https://${check.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(check.bucket)}/${PROBE_KEY}`;
  let response: Response;
  try {
    response = await (check.fetch ?? fetch)(url, {
      method: "OPTIONS",
      headers: { "Origin": check.publicOrigin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
  } catch (thrown) {
    const cause = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    return { ok: false, message: `the stage's file storage could not be reached for its CORS preflight (${cause})` };
  }
  await response.body?.cancel();
  const allowed = response.headers.get("Access-Control-Allow-Origin");
  if (response.status >= 200 && response.status < 300 && allowed === check.publicOrigin) return { ok: true };
  return {
    ok: false,
    status: response.status,
    message: `the stage's file storage refused a CORS preflight from ${check.publicOrigin} (HTTP ${response.status}, Access-Control-Allow-Origin ${allowed === null ? "absent" : JSON.stringify(allowed)})`,
  };
}

/** The Cloudflare API path (under `/client/v4`) of a bucket's CORS configuration. */
export function bucketCorsPath(accountId: string, bucket: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/cors`;
}
