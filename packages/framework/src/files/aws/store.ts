/**
 * The AWS `FilesStore` (files.md §2 "AWS"; FILES-REQ-001): the stage's S3 bucket over its REST API,
 * every request SigV4-signed in its header with aws4fetch and the Lambda role's session
 * credentials (`X-Amz-Security-Token`), and carrying `x-amz-expected-bucket-owner` (aws.md §2).
 * The shared service (`../service.ts`) runs over it unchanged, as over the R2 binding.
 *
 * Keys are the names themselves (no U+0001 ending, unlike Cloudflare's DEC-0430): S3 general
 * purpose buckets list in UTF-8 byte order, a proper prefix first, and `start-after` follows that
 * order, so the listing is already code point order.
 *
 * - `put` buffers a stream body: S3 needs a length for a single PUT, and a Lambda request body is
 *   buffered anyway. The payload's SHA-256 is signed, so S3 checks it.
 * - `get`/`head` return null on 404 (`NoSuchKey`; a `HEAD` has no body, so any 404). `delete` of an
 *   absent key succeeds (S3 answers 204). The Lambda role needs `s3:ListBucket` on the bucket, or
 *   S3 answers 403 instead of 404 for an absent key.
 * - `list` is one `ListObjectsV2` (`encoding-type=url`) plus, when metadata is asked for, one
 *   `HEAD` per listed object (S3 listings carry no content type), at most `HEAD_CONCURRENCY` at a
 *   time. An object deleted between the two is left out.
 * - Any other answer throws `S3RequestError` (status and S3 error code, never the body), and a
 *   network failure is thrown as it is; the service turns both into `FILES.UNAVAILABLE`
 *   (DEC-0164). No retry: the failure surfaces at once.
 *
 * Workers- and Node-compatible (`fetch` and Web Crypto only).
 */
import type { FilesStore, StoredObject, StoreListOptions } from "../service.js";
import { objectPath } from "../s3/path.js";
import { signRequest, type S3Credentials, type SignedRequest } from "../s3/sign.js";
import { bucketOrigin, checkLocation, type S3BucketLocation } from "./location.js";
import { errorCode, parseListObjectsV2 } from "./xml.js";

/** At most this many `HEAD`s of one listing run at once. */
export const HEAD_CONCURRENCY = 8;
/** S3's `max-keys` maximum (PAR-232 is the same). */
const MAX_KEYS = 1000;

export interface S3StoreOptions {
  readonly location: S3BucketLocation;
  /** The role's session credentials, read for each request. */
  readonly credentials: () => S3Credentials | Promise<S3Credentials>;
  /** Default the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Clock (milliseconds since the epoch) for the signing time; default `Date.now`. */
  readonly now?: () => number;
}

/** An S3 answer the store does not expect; the service reports it as `FILES.UNAVAILABLE`. */
export class S3RequestError extends Error {
  override readonly name = "S3RequestError";
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`S3 ${operation} answered HTTP ${status}${code === undefined ? "" : ` (${code})`}`);
  }
}

async function bytesOf(value: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  if (value instanceof Uint8Array) return value.buffer instanceof ArrayBuffer ? (value as Uint8Array<ArrayBuffer>) : new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(await new Response(value).arrayBuffer());
}

/** The response's error code (body read, never kept). */
async function codeOf(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  return errorCode(text) ?? response.headers.get("x-amz-error-code") ?? undefined;
}

async function failure(operation: string, response: Response): Promise<S3RequestError> {
  return new S3RequestError(operation, response.status, await codeOf(response));
}

function contentLength(operation: string, response: Response): number {
  const size = Number(response.headers.get("Content-Length"));
  if (response.headers.get("Content-Length") === null || !Number.isSafeInteger(size) || size < 0) {
    throw new S3RequestError(operation, response.status, "MissingContentLength");
  }
  return size;
}

function metadataOf(key: string, operation: string, response: Response): StoredObject {
  const contentType = response.headers.get("Content-Type");
  return { key, size: contentLength(operation, response), httpMetadata: contentType === null ? {} : { contentType } };
}

export function createS3FilesStore(options: S3StoreOptions): FilesStore {
  const location = checkLocation(options.location);
  const origin = bucketOrigin(location);
  const now = options.now ?? Date.now;
  const send = async (request: Omit<SignedRequest, "region" | "credentials" | "now">): Promise<Response> => {
    const signed = await signRequest({
      ...request,
      headers: { ...request.headers, "x-amz-expected-bucket-owner": location.accountId },
      region: location.region,
      credentials: await options.credentials(),
      now: new Date(now()),
    });
    return (options.fetch ?? fetch)(signed);
  };
  const objectUrl = (key: string) => `${origin}/${objectPath(key)}`;

  const head = async (key: string): Promise<StoredObject | null> => {
    const response = await send({ method: "HEAD", url: objectUrl(key) });
    await response.body?.cancel();
    if (response.status === 404) return null;
    if (response.status !== 200) throw new S3RequestError("HeadObject", response.status, response.headers.get("x-amz-error-code") ?? undefined);
    return metadataOf(key, "HeadObject", response);
  };

  const listPage = async (listOptions: StoreListOptions, startAfter: string | undefined) => {
    const limit = Math.min(Math.max(1, listOptions.limit ?? MAX_KEYS), MAX_KEYS);
    const query = new URLSearchParams({ "list-type": "2", "encoding-type": "url", "max-keys": String(limit) });
    if (listOptions.prefix !== undefined && listOptions.prefix !== "") query.set("prefix", listOptions.prefix);
    if (startAfter !== undefined) query.set("start-after", startAfter);
    // URLSearchParams writes a space as `+`; S3 reads the query as RFC 3986 (`+` itself is `%2B`).
    const response = await send({ method: "GET", url: `${origin}/?${query.toString().replaceAll("+", "%20")}` });
    if (response.status !== 200) throw await failure("ListObjectsV2", response);
    return parseListObjectsV2(await response.text());
  };

  /** Each listed object's metadata, `HEAD_CONCURRENCY` at a time, in listing order; deleted ones left out. */
  const describe = async (listed: readonly { readonly key: string }[]): Promise<StoredObject[]> => {
    const described = new Array<StoredObject | null>(listed.length).fill(null);
    let next = 0;
    const worker = async () => {
      for (let index = next++; index < listed.length; index = next++) {
        const entry = listed[index];
        if (entry !== undefined) described[index] = await head(entry.key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, listed.length) }, worker));
    return described.filter((o): o is StoredObject => o !== null);
  };

  return {
    async put(key, value, putOptions) {
      const body = await bytesOf(value);
      const contentType = putOptions?.httpMetadata?.contentType;
      const response = await send({ method: "PUT", url: objectUrl(key), body, headers: contentType === undefined ? {} : { "Content-Type": contentType } });
      if (response.status !== 200) throw await failure("PutObject", response);
      await response.body?.cancel();
    },
    async get(key) {
      const response = await send({ method: "GET", url: objectUrl(key) });
      if (response.status === 404) {
        const code = await codeOf(response);
        if (code === "NoSuchKey") return null;
        throw new S3RequestError("GetObject", 404, code);
      }
      if (response.status !== 200) throw await failure("GetObject", response);
      const object = metadataOf(key, "GetObject", response);
      return { ...object, body: response.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() }) };
    },
    head,
    async delete(key) {
      const response = await send({ method: "DELETE", url: objectUrl(key) });
      if (response.status === 204 || response.status === 200) {
        await response.body?.cancel();
        return;
      }
      const code = await codeOf(response);
      if (response.status === 404 && code === "NoSuchKey") return;
      throw new S3RequestError("DeleteObject", response.status, code);
    },
    async list(listOptions: StoreListOptions) {
      const withMetadata = (listOptions.include ?? []).includes("httpMetadata");
      let startAfter = listOptions.startAfter;
      for (;;) {
        const page = await listPage(listOptions, startAfter);
        if (!withMetadata) return page;
        const described = await describe(page.objects);
        const last = page.objects.at(-1);
        // Every listed object deleted before its HEAD: list on, so a truncated page is never empty.
        if (described.length > 0 || !page.truncated || last === undefined) return { objects: described, truncated: page.truncated };
        startAfter = last.key;
      }
    },
  };
}
