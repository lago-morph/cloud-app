/**
 * Test support: an independent SigV4 signature check, written from the specification (AWS
 * "Create a signed request" steps; S3 canonical URI = each decoded path segment URI-encoded) with
 * node:crypto, modelling what storage computes for a presigned URL (`expectedSignature`) and for a
 * header-signed request (`expectedHeaderSignature`). Shared by the Cloudflare and AWS tests and
 * the in-process S3 fake. Not shipped.
 */
import { createHash, createHmac } from "node:crypto";

/** RFC 3986 encoding as SigV4 requires (every byte except unreserved). */
function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface Canonical {
  readonly method: string;
  readonly url: URL;
  /** Query parameters to sign, in request order. */
  readonly query: readonly (readonly [string, string])[];
  /** Lowercase names, in the order the request lists them. */
  readonly signedHeaders: readonly string[];
  /** Request headers, lowercase names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
  readonly datetime: string;
  /** `date/region/service` from the credential scope. */
  readonly scope: readonly [string, string, string];
  readonly secret: string;
}

function signatureOf(c: Canonical): string {
  const canonicalHeaders = c.signedHeaders.map((h) => `${h}:${(h === "host" ? c.url.host : (c.headers[h] ?? "")).trim().replace(/\s+/g, " ")}`).join("\n") + "\n";
  // S3: the request path is decoded to the object key (`%2F` included), and the canonical URI is
  // that path with each `/`-separated segment URI-encoded.
  const canonicalPath = decodeURIComponent(c.url.pathname).split("/").map(uriEncode).join("/");
  const canonicalQuery = c.query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [c.method, canonicalPath, canonicalQuery, canonicalHeaders, c.signedHeaders.join(";"), c.payloadHash].join("\n");
  const [date, region, service] = c.scope;
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", c.datetime, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = createHmac("sha256", `AWS4${c.secret}`).update(date).digest();
  for (const part of [region, service, "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  return createHmac("sha256", key).update(toSign).digest("hex");
}

function lowerHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * The signature storage expects for `signedUrl` sent with `method` and `headers` (the URL's own
 * `X-Amz-Signature` excluded), using the scope and date the URL names.
 */
export function expectedSignature(signedUrl: string, method: string, headers: Readonly<Record<string, string>>, secret: string): string {
  const url = new URL(signedUrl);
  const param = (name: string) => url.searchParams.get(name) ?? "";
  const [, date = "", region = "", service = ""] = param("X-Amz-Credential").split("/");
  return signatureOf({
    method,
    url,
    query: [...url.searchParams].filter(([k]) => k !== "X-Amz-Signature"),
    signedHeaders: param("X-Amz-SignedHeaders").split(";"),
    headers: lowerHeaders(headers),
    payloadHash: "UNSIGNED-PAYLOAD",
    datetime: param("X-Amz-Date"),
    scope: [date, region, service],
    secret,
  });
}

/** What an `Authorization: AWS4-HMAC-SHA256 …` header names. */
export interface AuthorizationHeader {
  readonly accessKeyId: string;
  readonly scope: readonly [string, string, string];
  readonly signedHeaders: readonly string[];
  readonly signature: string;
}

export function parseAuthorization(value: string | null): AuthorizationHeader | undefined {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/,]+)\/(\d{8})\/([^/,]+)\/([^/,]+)\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(value ?? "");
  if (match === null) return undefined;
  const [, accessKeyId = "", date = "", region = "", service = "", signed = "", signature = ""] = match;
  return { accessKeyId, scope: [date, region, service], signedHeaders: signed.split(";"), signature };
}

/**
 * The signature storage expects for a request signed in its `Authorization` header (scope and
 * signed headers as that header names them; date from `X-Amz-Date`; payload hash from
 * `X-Amz-Content-Sha256`), or undefined when the header is not a SigV4 one.
 */
export function expectedHeaderSignature(method: string, url: string, headers: Readonly<Record<string, string>>, secret: string): string | undefined {
  const lower = lowerHeaders(headers);
  const auth = parseAuthorization(lower["authorization"] ?? null);
  if (auth === undefined) return undefined;
  const parsed = new URL(url);
  return signatureOf({
    method,
    url: parsed,
    query: [...parsed.searchParams],
    signedHeaders: auth.signedHeaders,
    headers: lower,
    payloadHash: lower["x-amz-content-sha256"] ?? "",
    datetime: lower["x-amz-date"] ?? "",
    scope: auth.scope,
    secret,
  });
}
