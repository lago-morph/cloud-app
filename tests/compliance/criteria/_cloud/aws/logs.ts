/**
 * The shared log bucket `prototype-logs-<account-id>` (log.md §2 "AWS"), read through S3 with
 * the operator's credentials (LOG-AC-002, LOG-AC-004, LOG-AC-005, SEC-AC-002, E2E-011/012).
 *
 * - Every request sends `ExpectedBucketOwner` with the account ID, so a bucket of that name in
 *   another account is never read (PROV-REQ-004 ownership).
 * - Listing is `ListObjectsV2`, 1,000 keys per page, at most `MAX_PAGES` pages; reading is one
 *   `GetObject`. The bucket itself is never changed (LOG-AC-001: "The shared bucket itself is
 *   never altered").
 * - Existence is `HeadBucket`: 200 → yes; 404 → no; anything else (403 for a bucket of another
 *   account) is an error naming the bucket.
 */
import { GetObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsAccountId, awsCall, awsClients, awsFailure, errorName, errorStatus, MAX_PAGES } from "./api.js";
import { logBucketName } from "./names.js";

/** The account's shared log bucket name. */
export async function awsLogBucket(): Promise<string> {
  return logBucketName(await awsAccountId());
}

/** Whether a bucket exists and is owned by this account (false only on 404). */
export async function ownedBucketExists(bucket: string): Promise<boolean> {
  const account = await awsAccountId();
  const what = `reading S3 bucket ${bucket} (HeadBucket, expected owner ${account})`;
  try {
    await awsCall(what, () => awsClients().s3.send(new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: account })));
    return true;
  } catch (error) {
    if (errorName(error) === "NotFound" || errorName(error) === "NoSuchBucket" || errorStatus(error) === 404) return false;
    if (errorStatus(error) === 403) throw new Error(`${what} failed: HTTP 403, the bucket exists but is not this account's or cannot be read`);
    throw awsFailure(what, error);
  }
}

/** Whether the shared log bucket exists in this account. */
export async function awsLogBucketExists(): Promise<boolean> {
  return ownedBucketExists(await awsLogBucket());
}

/** Every key in `bucket` starting with `prefix`, sorted; bounded. */
export async function listBucketKeys(bucket: string, prefix: string): Promise<string[]> {
  const account = await awsAccountId();
  const keys: string[] = [];
  let token: string | undefined;
  const what = `listing S3 bucket ${bucket} (prefix ${prefix})`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () =>
        awsClients().s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ExpectedBucketOwner: account, ...(token === undefined ? {} : { ContinuationToken: token }) })),
      );
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const o of r.Contents ?? []) if (o.Key !== undefined) keys.push(o.Key);
    if (r.IsTruncated !== true) return keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    token = r.NextContinuationToken;
    if (token === undefined || token === "") throw new Error(`${what}: truncated listing without a continuation token`);
  }
  throw new Error(`${what}: more than ${String(MAX_PAGES * 1000)} keys; the hook does not list further`);
}

/** Every key of the shared log bucket starting with `prefix`, sorted. */
export async function listAwsLogKeys(prefix: string): Promise<string[]> {
  return listBucketKeys(await awsLogBucket(), prefix);
}

/** One object of the shared log bucket as UTF-8 text. */
export async function readAwsLogObject(key: string): Promise<string> {
  const bucket = await awsLogBucket();
  const account = await awsAccountId();
  const what = `reading S3 object ${bucket}/${key}`;
  let body: { transformToString(encoding?: string): Promise<string> } | undefined;
  try {
    body = (await awsCall(what, () => awsClients().s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, ExpectedBucketOwner: account })))).Body;
  } catch (error) {
    throw awsFailure(what, error);
  }
  if (body === undefined) throw new Error(`${what}: the response has no body`);
  return body.transformToString("utf-8");
}

export interface StoredLogEntry {
  readonly key: string;
  readonly body: string;
}

/** DEC-0279's `listLogEntries` on AWS: every object under `<app>/<stage>/<day>/` (day `yyyy/mm/dd`), with its body, sorted by key. */
export async function listAwsLogEntries(input: { readonly app: string; readonly stage: string; readonly day: string }): Promise<StoredLogEntry[]> {
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(input.day)) throw new Error(`day must be yyyy/mm/dd, not ${input.day}`);
  const keys = await listAwsLogKeys(`${input.app}/${input.stage}/${input.day}/`);
  const out: StoredLogEntry[] = [];
  for (const key of keys) out.push({ key, body: await readAwsLogObject(key) });
  return out;
}
