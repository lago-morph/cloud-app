/**
 * Cross-origin configuration of a stage's R2 bucket (files.md §2 "Cross-origin configuration";
 * DEC-0099; FILES-REQ-004): the policy provisioning sets, and the one CORS preflight deploy's
 * health step sends to storage (provisioning.md §2 step 7). App code never sees either. The
 * origin check and the preflight are shared with AWS (`../s3/cors.ts`).
 * Workers- and Node-compatible (`fetch` only).
 */
import { CORS_PROBE_KEY, exactOrigin, preflightStorageCors, type StorageCorsOutcome } from "../s3/cors.js";

export type { StorageCorsOutcome } from "../s3/cors.js";

/** The body of `PUT /accounts/<account>/r2/buckets/<bucket>/cors` (Cloudflare API). */
export interface BucketCorsPolicy {
  readonly rules: readonly {
    readonly allowed: { readonly origins: readonly string[]; readonly methods: readonly string[]; readonly headers: readonly string[] };
    readonly maxAgeSeconds: number;
  }[];
}

/** One rule: PUT and GET from the stage's public origin only, with the Content-Type header. */
export function bucketCorsPolicy(publicOrigin: string): BucketCorsPolicy {
  return {
    rules: [{ allowed: { origins: [exactOrigin(publicOrigin)], methods: ["PUT", "GET"], headers: ["Content-Type"] }, maxAgeSeconds: 60 }],
  };
}

export interface StorageCorsCheck {
  readonly accountId: string;
  readonly bucket: string;
  readonly publicOrigin: string;
  /** Default the global `fetch` (in Node, run with `NODE_USE_ENV_PROXY=1` behind a proxy). */
  readonly fetch?: typeof fetch;
}

/**
 * One CORS preflight to the bucket's S3 endpoint as the browser would send it before an upload.
 * Passes when storage allows exactly the stage's public origin; never throws, never includes
 * storage's response body (it is not read).
 */
export async function checkStorageCors(check: StorageCorsCheck): Promise<StorageCorsOutcome> {
  const url = `https://${check.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(check.bucket)}/${CORS_PROBE_KEY}`;
  return preflightStorageCors(url, check.publicOrigin, check.fetch);
}

/** The Cloudflare API path (under `/client/v4`) of a bucket's CORS configuration. */
export function bucketCorsPath(accountId: string, bucket: string): string {
  return `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/cors`;
}
