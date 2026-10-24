/**
 * Test support: an in-process S3 bucket behind a `fetch` function, for the AWS store, tickets and
 * CORS preflight. Not shipped, and never AWS evidence (plan-aws.md §2: pre-check only).
 *
 * What it checks, as S3 does:
 * - SigV4 on every request, with the independent reference (`../s3/sigv4-reference.test-support.ts`):
 *   header-signed requests (`Authorization`, `X-Amz-Date` within 15 minutes of the fake clock,
 *   every `x-amz-*` header signed, the payload's SHA-256 when one is named) and presigned URLs
 *   (`X-Amz-Expires` ≤ 7 days, refused once `X-Amz-Date` + `X-Amz-Expires` has passed).
 * - The session token: when the fake's credentials have one, the request must carry it
 *   (`X-Amz-Security-Token` header, or query parameter for a presigned URL).
 * - `x-amz-expected-bucket-owner`, when sent, must be the bucket's account.
 * - Unsigned requests are refused (Block Public Access), except CORS preflights, which follow the
 *   bucket's CORS rules (`BucketCorsArgs`).
 * - `ListObjectsV2` in UTF-8 byte order with `prefix`, `start-after`, `max-keys` (optionally capped
 *   lower, to force short pages) and `encoding-type=url` (space as `+`, as S3 does).
 * - `response-content-disposition` on a signed GET.
 *
 * Fidelity gaps (live items, L-1): S3's exact error bodies and status for each failure, whether S3
 * sends CORS headers on its 403s, the exact `encoding-type=url` character set, `%2F` in a key path,
 * and 403-instead-of-404 without `s3:ListBucket` are modelled from the documentation, not observed.
 */
import { createHash } from "node:crypto";
import type { S3Credentials } from "../s3/sign.js";
import { expectedHeaderSignature, expectedSignature, parseAuthorization } from "../s3/sigv4-reference.test-support.js";
import type { BucketCorsArgs } from "./cors.js";
import type { S3BucketLocation } from "./location.js";

export interface FakeObject {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
}

export interface FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface S3FakeOptions {
  readonly location: S3BucketLocation;
  readonly credentials: S3Credentials;
  /** The fake's clock (milliseconds since the epoch); default `Date.now`. */
  readonly now?: () => number;
  /** Return at most this many keys per listing, whatever `max-keys` asks (S3: 1,000). */
  readonly maxKeysCap?: number;
  readonly cors?: BucketCorsArgs;
}

export interface S3Fake {
  readonly fetch: typeof fetch;
  readonly objects: Map<string, FakeObject>;
  readonly requests: FakeRequest[];
  /** The next request gets this answer (or is rejected with this error) instead of being served. */
  failNext(answer: Response | Error): void;
  /** Runs before each `HEAD` is served (to delete objects mid-listing). */
  beforeHead?: ((key: string) => void) | undefined;
}

const MAX_PRESIGN_SECONDS = 7 * 24 * 3600;
const MAX_SKEW_MS = 15 * 60 * 1000;

function xmlEscape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function errorResponse(status: number, code: string, method: string): Response {
  const body = method === "HEAD" ? null : `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${code}</Message><RequestId>FAKE</RequestId></Error>`;
  return new Response(body, { status, headers: body === null ? {} : { "Content-Type": "application/xml" } });
}

function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** `encoding-type=url` as S3 answers it: URL-encoded, a space as `+`, `/` kept. */
function s3UrlEncode(key: string): string {
  return encodeURIComponent(key).replaceAll("%20", "+").replaceAll("%2F", "/");
}

/** `20261020T010203Z` as milliseconds. */
function parseAmzDate(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return m === null ? Number.NaN : Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export function createS3Fake(options: S3FakeOptions): S3Fake {
  const { location, credentials } = options;
  const now = options.now ?? Date.now;
  const host = `${location.bucket}.s3.${location.region}.amazonaws.com`;
  const objects = new Map<string, FakeObject>();
  const requests: FakeRequest[] = [];
  let pending: Response | Error | undefined;

  /** The refusal for a request whose authentication S3 would not accept, or undefined. */
  const authenticate = (method: string, url: URL, headers: Record<string, string>, body: Uint8Array): Response | undefined => {
    const query = url.searchParams;
    const deny = (code: string, status = 403) => errorResponse(status, code, method);
    if (query.has("X-Amz-Signature")) {
      if (query.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") return deny("AuthorizationQueryParametersError", 400);
      const [keyId, , region, service] = (query.get("X-Amz-Credential") ?? "").split("/");
      if (keyId !== credentials.accessKeyId) return deny("InvalidAccessKeyId");
      if (region !== location.region || service !== "s3") return deny("AuthorizationQueryParametersError", 400);
      const expires = Number(query.get("X-Amz-Expires"));
      if (!Number.isInteger(expires) || expires < 1 || expires > MAX_PRESIGN_SECONDS) return deny("AuthorizationQueryParametersError", 400);
      const signedAt = parseAmzDate(query.get("X-Amz-Date") ?? "");
      if (Number.isNaN(signedAt)) return deny("AuthorizationQueryParametersError", 400);
      if (now() > signedAt + expires * 1000) return deny("AccessDenied");
      if (credentials.sessionToken !== undefined && query.get("X-Amz-Security-Token") !== credentials.sessionToken) return deny("InvalidToken", 400);
      if (query.get("X-Amz-Signature") !== expectedSignature(url.href, method, headers, credentials.secretAccessKey)) return deny("SignatureDoesNotMatch");
      return undefined;
    }
    const auth = parseAuthorization(headers["authorization"] ?? null);
    if (auth === undefined) return deny("AccessDenied");
    if (auth.accessKeyId !== credentials.accessKeyId) return deny("InvalidAccessKeyId");
    if (auth.scope[1] !== location.region || auth.scope[2] !== "s3") return deny("AuthorizationHeaderMalformed", 400);
    const signedAt = parseAmzDate(headers["x-amz-date"] ?? "");
    if (Number.isNaN(signedAt) || Math.abs(now() - signedAt) > MAX_SKEW_MS) return deny("RequestTimeTooSkewed");
    for (const name of Object.keys(headers)) if (name.startsWith("x-amz-") && !auth.signedHeaders.includes(name)) return deny("AccessDenied");
    if (credentials.sessionToken !== undefined && headers["x-amz-security-token"] !== credentials.sessionToken) return deny("InvalidToken", 400);
    if (auth.signature !== expectedHeaderSignature(method, url.href, headers, credentials.secretAccessKey)) return deny("SignatureDoesNotMatch");
    const payload = headers["x-amz-content-sha256"];
    if (payload === undefined) return deny("InvalidRequest", 400);
    if (payload !== "UNSIGNED-PAYLOAD" && payload !== createHash("sha256").update(body).digest("hex")) return deny("XAmzContentSHA256Mismatch", 400);
    return undefined;
  };

  const preflight = (headers: Record<string, string>): Response => {
    const origin = headers["origin"];
    const method = headers["access-control-request-method"];
    const asked = (headers["access-control-request-headers"] ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => h !== "");
    const rules = options.cors;
    const allowed =
      rules !== undefined &&
      origin !== undefined &&
      rules.allowOrigins.includes(origin) &&
      (rules.allowMethods as readonly string[]).includes(method ?? "") &&
      asked.every((h) => rules.allowHeaders.some((a) => a.toLowerCase() === h));
    if (!allowed) return errorResponse(403, "AccessForbidden", "OPTIONS");
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": rules.allowMethods.join(", "),
        "Access-Control-Allow-Headers": asked.join(", "),
        "Access-Control-Max-Age": "60",
        "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
      },
    });
  };

  const list = (query: URLSearchParams): Response => {
    const prefix = query.get("prefix") ?? "";
    const startAfter = query.get("start-after");
    const maxKeys = Math.min(Number(query.get("max-keys") ?? "1000"), 1000, options.maxKeysCap ?? 1000);
    const encode = query.get("encoding-type") === "url";
    const keys = [...objects.keys()]
      .filter((k) => k.startsWith(prefix) && (startAfter === null || compareBytes(k, startAfter) > 0))
      .sort(compareBytes);
    const page = keys.slice(0, maxKeys);
    const out = (text: string) => xmlEscape(encode ? s3UrlEncode(text) : text);
    const contents = page.map((k) => `<Contents><Key>${out(k)}</Key><LastModified>2026-10-24T00:00:00.000Z</LastModified><ETag>&quot;x&quot;</ETag><Size>${objects.get(k)?.bytes.byteLength ?? 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${location.bucket}</Name><Prefix>${out(prefix)}</Prefix>${startAfter === null ? "" : `<StartAfter>${out(startAfter)}</StartAfter>`}<KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>${encode ? "<EncodingType>url</EncodingType>" : ""}<IsTruncated>${keys.length > page.length}</IsTruncated>${contents.join("")}</ListBucketResult>`;
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
  };

  const serve = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== host) throw new TypeError(`fetch failed: the S3 fake serves only ${host}, not ${url.host}`);
    const method = request.method;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    requests.push({ method, url: url.href, headers });
    if (pending !== undefined) {
      const answer = pending;
      pending = undefined;
      if (answer instanceof Error) throw answer;
      return answer;
    }
    if (method === "OPTIONS") return preflight(headers);
    const body = new Uint8Array(await request.arrayBuffer());
    const refused = authenticate(method, url, headers, body);
    if (refused !== undefined) return refused;
    const owner = headers["x-amz-expected-bucket-owner"];
    if (owner !== undefined && owner !== location.accountId) return errorResponse(403, "AccessDenied", method);
    if (url.pathname === "/" && method === "GET" && url.searchParams.get("list-type") === "2") return list(url.searchParams);
    const key = decodeURIComponent(url.pathname.slice(1));
    if (key === "") return errorResponse(400, "InvalidRequest", method);
    if (new TextEncoder().encode(key).byteLength > 1024) return errorResponse(400, "KeyTooLongError", method);
    switch (method) {
      case "PUT":
        objects.set(key, { bytes: body, contentType: headers["content-type"] ?? "binary/octet-stream" });
        return new Response(null, { status: 200, headers: { ETag: '"x"' } });
      case "GET":
      case "HEAD": {
        if (method === "HEAD") fake.beforeHead?.(key);
        const object = objects.get(key);
        if (object === undefined) return errorResponse(404, "NoSuchKey", method);
        const disposition = url.searchParams.get("response-content-disposition");
        return new Response(method === "HEAD" ? null : object.bytes, {
          status: 200,
          headers: {
            "Content-Type": object.contentType,
            "Content-Length": String(object.bytes.byteLength),
            ...(disposition === null ? {} : { "Content-Disposition": disposition }),
          },
        });
      }
      case "DELETE":
        objects.delete(key);
        return new Response(null, { status: 204 });
      default:
        return errorResponse(405, "MethodNotAllowed", method);
    }
  };

  const fake: S3Fake = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => serve(new Request(input, init))) as typeof fetch,
    objects,
    requests,
    failNext(answer) {
      pending = answer;
    },
    beforeHead: undefined,
  };
  return fake;
}
