/**
 * SigV4 signing of S3 requests with aws4fetch (PAR-105, DEC-0098), shared by the Cloudflare
 * tickets (R2's S3-compatible endpoint) and the AWS store and tickets (S3; branch `aws`, DEC-0508).
 *
 * - `presignUrl`: query signing for a browser ticket. Every header passed is signed
 *   (`allHeaders: true`): aws4fetch leaves `Content-Type` unsigned by default, which would let an
 *   upload ticket accept another content type. The expiry is always explicit (aws4fetch's default
 *   is a day). The URL carries the access key ID, the signature and, for temporary credentials,
 *   the session token (`X-Amz-Security-Token`, signed), never the secret.
 * - `signRequest`: header signing (`Authorization`) of one server-side request.
 *
 * Workers-compatible (Web Crypto).
 */
import { AwsClient } from "aws4fetch";

/** S3-compatible signing credentials; `sessionToken` for temporary (role session) credentials. */
export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string | undefined;
}

export interface PresignRequest {
  readonly method: "GET" | "PUT";
  /** The request URL, already encoded; any query parameters on it are signed too. */
  readonly url: string;
  /** Headers the request must send exactly; all are signed. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly region: string;
  readonly credentials: S3Credentials;
  readonly expiresInSeconds: number;
  /** Signing time. */
  readonly now: Date;
}

/** `20130524T000000Z` from a date. */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function client(credentials: S3Credentials, region: string): AwsClient {
  const { accessKeyId, secretAccessKey, sessionToken } = credentials;
  return new AwsClient({ accessKeyId, secretAccessKey, ...(sessionToken === undefined ? {} : { sessionToken }), service: "s3", region });
}

/** The signed URL. */
export async function presignUrl(request: PresignRequest): Promise<string> {
  const url = new URL(request.url);
  url.searchParams.set("X-Amz-Expires", String(request.expiresInSeconds));
  const signed = await client(request.credentials, request.region).sign(new Request(url, { method: request.method, headers: request.headers ?? {} }), {
    aws: { signQuery: true, allHeaders: true, datetime: amzDate(request.now) },
  });
  return signed.url;
}

export interface SignedRequest {
  readonly method: "GET" | "HEAD" | "PUT" | "DELETE";
  readonly url: string;
  /** Sent and signed (every header, `Content-Type` included). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array<ArrayBuffer>;
  readonly region: string;
  readonly credentials: S3Credentials;
  /** Signing time. */
  readonly now: Date;
}

/**
 * The request, signed in its `Authorization` header. A body's SHA-256 is sent and signed as
 * `X-Amz-Content-Sha256`, so storage checks the payload; without a body it is `UNSIGNED-PAYLOAD`
 * (aws4fetch's S3 default; there is nothing to check).
 */
export async function signRequest(request: SignedRequest): Promise<Request> {
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", request.body));
    headers["X-Amz-Content-Sha256"] = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return client(request.credentials, request.region).sign(request.url, {
    method: request.method,
    headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    aws: { allHeaders: true, datetime: amzDate(request.now) },
  });
}
