/**
 * Cloudflare account setup, shared-resource part (PROV-REQ-004; cloudflare.md "Deploy
 * mechanics" `setupAccount`; LOG §2; PROV §2 "State home"). The account's shared resources are:
 * - the shared R2 log bucket `prototype-logs`;
 * - SST's state home, the R2 bucket `sst-state` (DEC-0084);
 * - the account's `workers.dev` subdomain (DEC-0086), the account setting that every stage's
 *   public origin is built from. Cloudflare keeps it; it is read from there on every deploy,
 *   never only recorded on the owner's machine (DEC-0333);
 * - the account's R2 signing credential `prototype-r2-signing` and its record in `sst-state`
 *   (`r2-token.ts`, DEC-0550), which every stage's upload and download tickets are signed with.
 * Used by `setupAccount` (create when absent) and by the deploy preflight (inspect only),
 * through the per-target operations `inspectAccount` and `createSharedResources`.
 *
 * Bucket ownership (DEC-0270): R2 bucket names are scoped to an account, so a bucket is
 * read through this account's API path. Found → owned; Cloudflare's "not found" (HTTP 404)
 * → absent; refused (HTTP 403) → it exists but this account does not own it (or its
 * credentials cannot see it). Every other answer is an error naming the bucket and the
 * status; nothing is guessed. A creation that conflicts with an existing bucket (HTTP 409,
 * code 10004) is read back with the same GET (DEC-0421): owned → the bucket
 * exists in this account, no error; refused → foreign; not found → an error naming the
 * bucket and the 409. Pass 0 check 3 confirmed the 200, 404 and 409 answers live: the 409
 * says "already exists, and you own it". The 403 reading stays unverified (one account
 * cannot produce it, DEC-0334).
 */
import { randomBytes } from "node:crypto";
import type { SharedResource } from "../core/operations.js";
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";
import { STATE_BUCKET } from "./names.js";
import { createAccountSigningCredential, readSigningCredentials, SIGNING_RESOURCE } from "./r2-token.js";

export type { CloudflareApi } from "./api.js";

/** The account's shared log bucket on Cloudflare (LOG §2). */
export const LOG_BUCKET = "prototype-logs";
/** The shared resources' names as printed to the owner. */
export const LOG_BUCKET_RESOURCE = `R2 bucket ${LOG_BUCKET}`;
export const STATE_HOME_RESOURCE = `R2 bucket ${STATE_BUCKET}`;
export const SUBDOMAIN_RESOURCE = "workers.dev subdomain";

export async function inspectBucket(api: CloudflareApi, accountId: string, bucket: string): Promise<SharedResource> {
  const name = `R2 bucket ${bucket}`;
  const r = await api("GET", `/accounts/${accountId}/r2/buckets/${bucket}`);
  if (succeeded(r)) return { name, state: "owned" };
  if (r.status === 404) return { name, state: "absent" };
  if (r.status === 403) return { name, state: "foreign" };
  throw new Error(`checking ${name} failed: ${describeFailure(r)}`);
}

export async function createBucket(api: CloudflareApi, accountId: string, bucket: string): Promise<void> {
  const name = `R2 bucket ${bucket}`;
  const r = await api("POST", `/accounts/${accountId}/r2/buckets`, { name: bucket });
  if (succeeded(r)) return;
  if (r.status === 409) {
    const now = await inspectBucket(api, accountId, bucket);
    if (now.state === "owned") return; // exists in this account: the end state PROV-REQ-004 requires
    if (now.state === "foreign") {
      throw new Error(`${name} already exists but belongs to another account (or this account's credentials cannot read it); nothing was created`);
    }
    throw new Error(`creating ${name} failed: ${describeFailure(r)}; reading it back found it absent`);
  }
  throw new Error(`creating ${name} failed: ${describeFailure(r)}`);
}

/** The account's `workers.dev` subdomain, or undefined when it has none. */
async function readSubdomain(api: CloudflareApi, accountId: string): Promise<string | undefined> {
  const r = await api("GET", `/accounts/${accountId}/workers/subdomain`);
  if (r.status === 404) return undefined;
  const result = resultOf<{ subdomain?: unknown } | null>(r, `checking the ${SUBDOMAIN_RESOURCE}`);
  return typeof result?.subdomain === "string" && result.subdomain !== "" ? result.subdomain : undefined;
}

/**
 * The subdomain `setup-account` registers on an account that has none: `pf-` and 12 random (PAR-320)
 * lowercase letters and digits (DEC-0552). It is never derived from the account ID, the owner's
 * name or any other personal data, since it is part of every stage's public address.
 */
export function randomSubdomain(random: (size: number) => Uint8Array = randomBytes): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  // 252 is the largest multiple of 36 not above 256: dropping bytes from 252 up keeps every character equally likely.
  let out = "";
  while (out.length < 12) for (const byte of random(24)) if (byte < 252 && out.length < 12) out += alphabet[byte % 36];
  return `pf-${out}`;
}

export interface SharedResourceOptions {
  /** The subdomain to register when there is none; default `randomSubdomain()`. */
  readonly newSubdomain?: () => string;
}

async function registerSubdomain(api: CloudflareApi, accountId: string, options: SharedResourceOptions): Promise<void> {
  const subdomain = (options.newSubdomain ?? randomSubdomain)();
  const r = await api("PUT", `/accounts/${accountId}/workers/subdomain`, { subdomain });
  if (succeeded(r)) return;
  throw new Error(
    `registering the ${SUBDOMAIN_RESOURCE} ${subdomain} failed: ${describeFailure(r)}; register one in the Cloudflare dashboard (Workers & Pages) and run setup-account again`,
  );
}

/** The account subdomain every stage's public origin is built from; fails when there is none. */
export async function accountSubdomain(api: CloudflareApi, accountId: string): Promise<string> {
  const subdomain = await readSubdomain(api, accountId);
  if (subdomain === undefined) throw new Error(`the account has no ${SUBDOMAIN_RESOURCE}; run setup-account --target cloudflare first`);
  return subdomain;
}

/** The account's shared resources on Cloudflare and their state. Sends only reads. */
export async function inspectSharedResources(api: CloudflareApi, accountId: string): Promise<SharedResource[]> {
  return [
    await inspectBucket(api, accountId, LOG_BUCKET),
    await inspectBucket(api, accountId, STATE_BUCKET),
    { name: SUBDOMAIN_RESOURCE, state: (await readSubdomain(api, accountId)) === undefined ? "absent" : "owned" },
    { name: SIGNING_RESOURCE, state: (await readSigningCredentials(api, accountId)) === undefined ? "absent" : "owned" },
  ];
}

/** Creates the given absent shared resources. The core calls it only when none is foreign. */
export async function createSharedResources(api: CloudflareApi, accountId: string, absent: readonly SharedResource[], options: SharedResourceOptions = {}): Promise<void> {
  // The signing credential's record lives in the state home, so it comes after the buckets.
  const ordered = [...absent].sort((a, b) => Number(a.name === SIGNING_RESOURCE) - Number(b.name === SIGNING_RESOURCE));
  for (const resource of ordered) {
    if (resource.name === LOG_BUCKET_RESOURCE) await createBucket(api, accountId, LOG_BUCKET);
    else if (resource.name === STATE_HOME_RESOURCE) await createBucket(api, accountId, STATE_BUCKET);
    else if (resource.name === SUBDOMAIN_RESOURCE) await registerSubdomain(api, accountId, options);
    else if (resource.name === SIGNING_RESOURCE) await createAccountSigningCredential(api, accountId);
    else throw new Error(`unknown Cloudflare shared resource ${resource.name}`);
  }
}
