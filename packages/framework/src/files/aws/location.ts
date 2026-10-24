/**
 * Where a stage's S3 bucket is, and the credentials FILES signs with on AWS (files.md §2 "AWS";
 * aws.md §2). The bucket is addressed virtual-hosted style over the regional endpoint
 * (`https://<bucket>.s3.<region>.amazonaws.com/<key>`), which needs a bucket name without dots
 * (TLS wildcard certificates cover one label). The credentials are the Lambda role's session
 * credentials, which the Lambda runtime puts in the environment; the session token is required,
 * since role credentials are always temporary. Workers- and browser-compatible (no Node APIs).
 */
import { FrameworkError } from "../../core/errors.js";
import type { S3Credentials } from "../s3/sign.js";

/** Delivered to the Lambda as deployment-time settings (CFG). */
export interface S3BucketLocation {
  /** The stage's bucket. */
  readonly bucket: string;
  /** The account's region (DEC-0075). */
  readonly region: string;
  /** The account ID, sent as `x-amz-expected-bucket-owner` on every runtime S3 call (aws.md §2). */
  readonly accountId: string;
}

/** S3 bucket name rules, minus dots (virtual-hosted TLS). */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const ACCOUNT = /^\d{12}$/;

/** The location unchanged, or CORE.MISCONFIGURED naming the bad field. */
export function checkLocation(location: S3BucketLocation): S3BucketLocation {
  const bad = (what: string, value: string): never => {
    throw new FrameworkError("CORE.MISCONFIGURED", `the stage's file storage ${what} ${JSON.stringify(value)} is not valid`);
  };
  if (!BUCKET.test(location.bucket)) bad("bucket name", location.bucket);
  if (!REGION.test(location.region)) bad("region", location.region);
  if (!ACCOUNT.test(location.accountId)) bad("account ID", location.accountId);
  return location;
}

/** The bucket's origin: `https://<bucket>.s3.<region>.amazonaws.com`. */
export function bucketOrigin(location: S3BucketLocation): string {
  return `https://${location.bucket}.s3.${location.region}.amazonaws.com`;
}

/** The Lambda runtime's credential variables (AWS-provided, never `SECRET_*`). */
export interface LambdaCredentialEnv {
  readonly AWS_ACCESS_KEY_ID?: string | undefined;
  readonly AWS_SECRET_ACCESS_KEY?: string | undefined;
  readonly AWS_SESSION_TOKEN?: string | undefined;
}

/** The role's session credentials from the Lambda environment, or CORE.MISCONFIGURED naming what is missing. */
export function lambdaSessionCredentials(env: LambdaCredentialEnv): S3Credentials {
  const missing = (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] as const).filter((k) => (env[k] ?? "") === "");
  if (missing.length > 0) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the Lambda environment has no ${missing.join(", ")}, so file storage cannot be signed for`);
  }
  return { accessKeyId: env.AWS_ACCESS_KEY_ID ?? "", secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "", sessionToken: env.AWS_SESSION_TOKEN ?? "" };
}
