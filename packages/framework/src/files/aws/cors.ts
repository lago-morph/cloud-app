/**
 * Cross-origin configuration of a stage's S3 bucket (files.md §2 "Cross-origin configuration";
 * DEC-0099; FILES-REQ-004): the CORS value the provision program sets on the stage's
 * `sst.aws.Bucket`, and the one CORS preflight deploy's health step sends to storage
 * (provisioning.md §2 step 7). App code never sees either. Same rule as Cloudflare's: PUT and GET
 * from the stage's public origin only, with the `Content-Type` request header, max age 60 s.
 * Workers- and Node-compatible (`fetch` only).
 */
import { CORS_PROBE_KEY, exactOrigin, preflightStorageCors, type StorageCorsOutcome } from "../s3/cors.js";
import { bucketOrigin, checkLocation, type S3BucketLocation } from "./location.js";

export type { StorageCorsOutcome } from "../s3/cors.js";

/**
 * SST 4.17.2's `BucketArgs.cors` (`sst.aws.Bucket`), which SST turns into one
 * `aws.s3.BucketCorsConfigurationV2` rule. Every field is set: SST's defaults allow every origin,
 * every method and every header, and expose `ETag`.
 */
export interface BucketCorsArgs {
  // Mutable arrays, so the value is assignable to SST's `Input<Input<string>[]>` fields.
  readonly allowOrigins: string[];
  readonly allowMethods: ("GET" | "PUT")[];
  readonly allowHeaders: string[];
  readonly exposeHeaders: string[];
  readonly maxAge: "60 seconds";
}

export function bucketCorsArgs(publicOrigin: string): BucketCorsArgs {
  return { allowOrigins: [exactOrigin(publicOrigin)], allowMethods: ["PUT", "GET"], allowHeaders: ["Content-Type"], exposeHeaders: [], maxAge: "60 seconds" };
}

export interface StorageCorsCheck {
  readonly location: S3BucketLocation;
  readonly publicOrigin: string;
  /** Default the global `fetch` (in Node, run with `NODE_USE_ENV_PROXY=1` behind a proxy). */
  readonly fetch?: typeof fetch;
}

/**
 * One CORS preflight to the bucket's S3 endpoint as the browser would send it before an upload.
 * Passes when storage allows exactly the stage's public origin; never throws for storage's
 * answer, never includes storage's response body.
 */
export async function checkStorageCors(check: StorageCorsCheck): Promise<StorageCorsOutcome> {
  return preflightStorageCors(`${bucketOrigin(checkLocation(check.location))}/${CORS_PROBE_KEY}`, check.publicOrigin, check.fetch);
}
