/**
 * SigV4 query signing of one storage request with aws4fetch (PAR-105, DEC-0098). Every header
 * passed is signed (`allHeaders: true`): aws4fetch leaves `Content-Type` unsigned by default,
 * which would let an upload ticket accept another content type. The expiry is always explicit
 * (aws4fetch's default is a day). The URL carries the access key ID and the signature, never the
 * secret. Workers-compatible (Web Crypto).
 */
import { AwsClient } from "aws4fetch";

/** S3-compatible signing credentials. */
export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
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
function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** The signed URL. */
export async function presignUrl(request: PresignRequest): Promise<string> {
  const client = new AwsClient({ ...request.credentials, service: "s3", region: request.region });
  const url = new URL(request.url);
  url.searchParams.set("X-Amz-Expires", String(request.expiresInSeconds));
  const signed = await client.sign(new Request(url, { method: request.method, headers: request.headers ?? {} }), {
    aws: { signQuery: true, allHeaders: true, datetime: amzDate(request.now) },
  });
  return signed.url;
}
