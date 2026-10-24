/**
 * Cloudflare transfer tickets (files.md §2 "Cloudflare"; DEC-0098, DEC-0160): SigV4 query-signed,
 * path-style URLs for R2's S3-compatible endpoint, signed with the stage's R2 API token (the
 * framework-internal Worker secrets `frameworkR2AccessKeyId` / `frameworkR2SecretAccessKey`,
 * DEC-0100). Same JSON shape as every target's tickets, so the browser helpers are unchanged.
 * R2 omits CORS headers on its 403s, so in a browser an expired or mismatched ticket fails with
 * status null (DEC-0101); nothing here works around that. Workers-compatible (Web Crypto).
 */
import { FRAMEWORK_SECRETS, type FrameworkSecretName } from "../../secrets/names.js";
import type { TicketIssuer } from "../service.js";
import { TICKET_LIFETIME_MS, type DownloadTicketData, type UploadTicketData } from "../tickets.js";
import { downloadDisposition } from "./disposition.js";
import { storedKey } from "./keys.js";
import { objectPath } from "../s3/path.js";
import { presignUrl, type S3Credentials } from "../s3/sign.js";

/** R2's SigV4 region. */
const R2_REGION = "auto";

export interface CloudflareTicketOptions {
  /** The Cloudflare account ID (the R2 S3 endpoint's host is `<account>.r2.cloudflarestorage.com`). */
  readonly accountId: string;
  /** The stage's R2 bucket name. */
  readonly bucket: string;
  /** The stage's S3 credentials, read when a ticket is created. */
  readonly credentials: () => Promise<S3Credentials>;
  /** Clock (milliseconds since the epoch); default `Date.now`. */
  readonly now?: () => number;
}

/**
 * The name's stored key (`storedKey`: the name with its U+0001 ending, sent as `%01`) as a URL
 * path (`objectPath`, DEC-0328): the dot-segment rules test the *name*, not the stored key, so
 * they behave as before the ending was added (DEC-0430).
 */
function keyPath(name: string): string {
  return objectPath(name, storedKey(name));
}

/** The Cloudflare issuer. A download is always an `attachment` named after the file (DEC-0313, DEC-0414). */
export interface CloudflareTicketIssuer extends TicketIssuer {
  upload(name: string, contentType: string): Promise<UploadTicketData>;
  download(name: string): Promise<DownloadTicketData>;
}

export function createCloudflareTicketIssuer(options: CloudflareTicketOptions): CloudflareTicketIssuer {
  const now = options.now ?? Date.now;
  const base = `https://${options.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(options.bucket)}/`;
  const sign = async (method: "GET" | "PUT", url: string, signedAt: number, headers?: Record<string, string>) =>
    presignUrl({
      method,
      url,
      ...(headers === undefined ? {} : { headers }),
      region: R2_REGION,
      credentials: await options.credentials(),
      expiresInSeconds: TICKET_LIFETIME_MS / 1000,
      now: new Date(signedAt),
    });
  return {
    async upload(name, contentType) {
      const signedAt = now();
      const headers = { "Content-Type": contentType };
      const url = await sign("PUT", `${base}${keyPath(name)}`, signedAt, headers);
      return { url, method: "PUT", headers, expiresAt: signedAt + TICKET_LIFETIME_MS };
    },
    async download(name) {
      const signedAt = now();
      // R2's S3 GetObject override names the saved file; it is a signed query parameter.
      const query = new URLSearchParams({ "response-content-disposition": downloadDisposition(name) });
      const url = await sign("GET", `${base}${keyPath(name)}?${query.toString()}`, signedAt);
      return { url, expiresAt: signedAt + TICKET_LIFETIME_MS };
    },
  };
}

/** Where the stage's bucket is; delivered to the Worker as deployment-time settings (CFG). */
export interface R2BucketLocation {
  readonly accountId: string;
  readonly bucket: string;
}

/**
 * The issuer a Cloudflare Worker uses (`StageOptions.tickets`): signs with the stage's R2 token,
 * read from the framework-internal secrets on each ticket (DEC-0100).
 */
export function createWorkerTicketIssuer(location: R2BucketLocation, frameworkSecret: (name: FrameworkSecretName) => Promise<string>): CloudflareTicketIssuer {
  return createCloudflareTicketIssuer({
    ...location,
    credentials: async () => ({
      accessKeyId: await frameworkSecret(FRAMEWORK_SECRETS.r2AccessKeyId),
      secretAccessKey: await frameworkSecret(FRAMEWORK_SECRETS.r2SecretAccessKey),
    }),
  });
}
