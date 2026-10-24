/**
 * AWS transfer tickets (files.md §2 "AWS"; DEC-0062, DEC-0160): SigV4 query-signed URLs for the
 * stage's S3 bucket, virtual-hosted on the regional endpoint, signed with the Lambda role's
 * session credentials. The URL carries the access key ID, the signature and the session token
 * (`X-Amz-Security-Token`, signed), never the secret (DEC-0062). Same JSON shape as every
 * target's tickets, so the browser helpers are unchanged.
 *
 * - An upload signs `Content-Type` (`X-Amz-SignedHeaders=content-type;host`), so S3 refuses
 *   another content type.
 * - A download signs `host` and S3's `response-content-disposition`, always `attachment` with the
 *   file's whole name (DEC-0313, DEC-0414).
 * - Both last PAR-233 (`X-Amz-Expires`). A presigned URL also stops working when the session it
 *   was signed with expires; the ticket assumes the session outlasts PAR-233 (files.md §2).
 * - The key is the name itself (no U+0001 ending, DEC-0430 is Cloudflare only); `objectPath`
 *   applies DEC-0328's dot-segment rules.
 *
 * Workers-compatible (Web Crypto).
 */
import type { TicketIssuer } from "../service.js";
import { downloadDisposition } from "../disposition.js";
import { objectPath } from "../s3/path.js";
import { presignUrl, type S3Credentials } from "../s3/sign.js";
import { TICKET_LIFETIME_MS, type DownloadTicketData, type UploadTicketData } from "../tickets.js";
import { bucketOrigin, checkLocation, type S3BucketLocation } from "./location.js";

export interface AwsTicketOptions {
  readonly location: S3BucketLocation;
  /** The role's session credentials, read when a ticket is created. */
  readonly credentials: () => S3Credentials | Promise<S3Credentials>;
  /** Clock (milliseconds since the epoch); default `Date.now`. */
  readonly now?: () => number;
}

export interface AwsTicketIssuer extends TicketIssuer {
  upload(name: string, contentType: string): Promise<UploadTicketData>;
  download(name: string): Promise<DownloadTicketData>;
}

export function createAwsTicketIssuer(options: AwsTicketOptions): AwsTicketIssuer {
  const location = checkLocation(options.location);
  const origin = bucketOrigin(location);
  const now = options.now ?? Date.now;
  const sign = async (method: "GET" | "PUT", url: string, signedAt: number, headers?: Record<string, string>) =>
    presignUrl({
      method,
      url,
      ...(headers === undefined ? {} : { headers }),
      region: location.region,
      credentials: await options.credentials(),
      expiresInSeconds: TICKET_LIFETIME_MS / 1000,
      now: new Date(signedAt),
    });
  return {
    async upload(name, contentType) {
      const signedAt = now();
      const headers = { "Content-Type": contentType };
      const url = await sign("PUT", `${origin}/${objectPath(name)}`, signedAt, headers);
      return { url, method: "PUT", headers, expiresAt: signedAt + TICKET_LIFETIME_MS };
    },
    async download(name) {
      const signedAt = now();
      // S3's GetObject override names the saved file; it is a signed query parameter. aws4fetch
      // writes the query back form-encoded (a space as `+`), as on Cloudflare.
      const query = new URLSearchParams({ "response-content-disposition": downloadDisposition(name) });
      const url = await sign("GET", `${origin}/${objectPath(name)}?${query.toString()}`, signedAt);
      return { url, expiresAt: signedAt + TICKET_LIFETIME_MS };
    },
  };
}
