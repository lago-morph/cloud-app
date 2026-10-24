/**
 * The AWS log sink (LOG-REQ-001, LOG-REQ-004; log.md §2 "AWS"; aws.md §2): each entry is one
 * JSON object, stored with an S3 `PutObject` in the account's shared log bucket
 * (`prototype-logs-<account-id>`) under the shared LOG-REQ-004 key (`../keys.ts`).
 *
 * - The request is SigV4-signed with aws4fetch (PAR-105) using the execution role's temporary
 *   credentials from the Lambda environment, so it carries `x-amz-security-token`. The body's
 *   SHA-256 is signed (`x-amz-content-sha256`), not `UNSIGNED-PAYLOAD`.
 * - It sends `x-amz-expected-bucket-owner` with the account ID: a bucket of that name owned by
 *   anyone else refuses the write (aws.md §2), and the entry is dropped.
 * - The write is handed to the invocation's `PendingWrites`, which the handler awaits for at
 *   most PAR-260 before it returns, since a frozen Lambda would lose it.
 * - A failed write (a denied `PutObject`, any non-2xx answer, a network error) is dropped: the
 *   request still succeeds (LOG-AC-001). aws4fetch's own retries are not used (the fetch is
 *   sent once), so the PAR-260 bound is the only time budget.
 * - Without a complete log-bucket setting (a misconfigured Lambda) entries are printed as the
 *   local runtime's marked output lines instead, as the Cloudflare sink does without its binding
 *   (DEC-0323); they then show in the function's own log stream.
 */
import { AwsClient } from "aws4fetch";
import type { LogEntry } from "../entry.js";
import { logObjectKey } from "../keys.js";
import { formatLogLine } from "../local.js";
import type { LogSink } from "../writer.js";
import type { PendingWrites } from "./pending.js";

/** The shared log bucket, the expected owner, and the role's credentials. */
export interface S3LogBucket {
  readonly bucket: string;
  readonly accountId: string;
  readonly region: string;
  readonly credentials: { readonly accessKeyId: string; readonly secretAccessKey: string; readonly sessionToken?: string };
}

export interface S3LogSinkOptions {
  /** Undefined when the Lambda's settings are incomplete. */
  readonly bucket: S3LogBucket | undefined;
  /** The invocation's pending writes, awaited by the handler. */
  readonly pending: PendingWrites;
  /** The fetch used to send the signed request (tests; default the global `fetch`). */
  readonly fetch?: (request: Request) => Promise<Response>;
  /** Signing time (tests). */
  readonly now?: () => Date;
  /** Where entries go without a bucket (default `console.log`). */
  readonly print?: (line: string) => void;
  /** Random final key part for entries without a request ID (tests). */
  readonly random?: () => string;
}

/** The S3 header naming the account that must own the bucket. */
export const EXPECTED_OWNER_HEADER = "x-amz-expected-bucket-owner";

/** `20130524T000000Z` from a date. */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** The virtual-hosted-style object URL, each key segment encoded. */
export function logObjectUrl(bucket: S3LogBucket, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${bucket.bucket}.s3.${bucket.region}.amazonaws.com/${path}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Signs and sends one `PutObject`; rejects on any failure, including a non-2xx answer. */
async function putEntry(bucket: S3LogBucket, key: string, body: string, options: S3LogSinkOptions): Promise<void> {
  const client = new AwsClient({ ...bucket.credentials, service: "s3", region: bucket.region, retries: 0 });
  // aws4fetch sends UNSIGNED-PAYLOAD for S3 unless the hash is given; the body's hash is signed.
  const signed = await client.sign(logObjectUrl(bucket, key), {
    method: "PUT",
    headers: { "content-type": "application/json", [EXPECTED_OWNER_HEADER]: bucket.accountId, "x-amz-content-sha256": await sha256Hex(body) },
    body,
    aws: { allHeaders: true, ...(options.now === undefined ? {} : { datetime: amzDate(options.now()) }) },
  });
  const send = options.fetch ?? ((r: Request) => fetch(r));
  const response = await send(signed);
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new Error(`PutObject answered ${response.status}`);
}

export function s3LogSink(options: S3LogSinkOptions): LogSink {
  const { bucket, pending } = options;
  const print = options.print ?? ((line: string) => console.log(line));
  return (entry: LogEntry) => {
    if (bucket === undefined) {
      try {
        print(formatLogLine(entry));
      } catch {
        // dropped (LOG-REQ-001)
      }
      return;
    }
    try {
      const key = logObjectKey(entry, options.random);
      pending.track(putEntry(bucket, key, JSON.stringify(entry), options));
    } catch {
      // A failed write is dropped (LOG-REQ-001).
    }
  };
}
