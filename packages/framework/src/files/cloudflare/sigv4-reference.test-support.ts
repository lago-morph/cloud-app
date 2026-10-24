/**
 * Test support: an independent SigV4 query-signature check, written from the specification (AWS
 * "Create a signed request" steps; S3 canonical URI = each decoded path segment URI-encoded) with
 * node:crypto, modelling what storage computes for a presigned URL. Not shipped.
 */
import { createHash, createHmac } from "node:crypto";

/** RFC 3986 encoding as SigV4 requires (every byte except unreserved). */
function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The signature storage expects for `signedUrl` sent with `method` and `headers` (the URL's own
 * `X-Amz-Signature` excluded), using the scope and date the URL names.
 */
export function expectedSignature(signedUrl: string, method: string, headers: Readonly<Record<string, string>>, secret: string): string {
  const url = new URL(signedUrl);
  const query = [...url.searchParams].filter(([k]) => k !== "X-Amz-Signature");
  const param = (name: string) => url.searchParams.get(name) ?? "";
  const datetime = param("X-Amz-Date");
  const [, date = "", region = "", service = ""] = param("X-Amz-Credential").split("/");
  const signedHeaders = param("X-Amz-SignedHeaders").split(";");
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${(h === "host" ? url.host : (lower[h] ?? "")).trim()}`).join("\n") + "\n";
  // S3: the request path is decoded to the object key (`%2F` included), and the canonical URI is
  // that path with each `/`-separated segment URI-encoded.
  const canonicalPath = decodeURIComponent(url.pathname).split("/").map(uriEncode).join("/");
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", datetime, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  for (const part of [region, service, "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  return createHmac("sha256", key).update(toSign).digest("hex");
}
