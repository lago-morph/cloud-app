/**
 * Cloudflare account setup, shared-resource part (PROV-REQ-004; cloudflare.md "Deploy
 * mechanics" `setupAccount`; LOG §2; PROV §2 "State home"). The account's shared resources are:
 * - the shared R2 log bucket `prototype-logs`;
 * - SST's state home, the R2 bucket `sst-state` (DEC-0084);
 * - the backup bucket `prototype-backups` and its PAR-311 lifecycle rule, where the production
 *   `remove` writes a stage's data before deleting it (DEC-0543; `backup.ts`);
 * - the account's `workers.dev` subdomain (DEC-0086), the account setting that every stage's
 *   public origin is built from. Cloudflare keeps it; it is read from there on every deploy,
 *   never only recorded on the owner's machine (DEC-0333);
 * - the account's R2 signing credential `prototype-r2-signing` and its record in `sst-state`
 *   (`r2-token.ts`, DEC-0550), which every stage's upload and download tickets are signed with;
 *   it is denied on every account bucket above, the backup bucket included.
 * Each is one account step (`accountSteps`, DEC-0578): a read-only inspection and its creation.
 * Used by `setupAccount` (create when absent) and by the deploy preflight (inspect only),
 * through the per-target operations `inspectAccount` and `createSharedResources`, and by the
 * stepwise setup of `setup-steps.ts`.
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
import { BACKUP_BUCKET, BACKUP_LIFECYCLE_RESOURCE, hasBackupLifecycle, setBackupLifecycle } from "./backup.js";
import { STATE_BUCKET } from "./names.js";
import { createAccountSigningCredential, SIGNING_RESOURCE, signingCredentialState } from "./r2-token.js";

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

/**
 * The account steps of the setup (DEC-0578; `setup-steps.ts` adds the email steps after them): one
 * per shared resource, in the order `setup-account` creates them. The signing credential's record
 * lives in the state home, so it comes after the buckets.
 */
export const ACCOUNT_STEP_IDS = ["log-bucket", "state-bucket", "backup-bucket", "backup-lifecycle", "subdomain", "signing-record"] as const;
export type AccountStepId = (typeof ACCOUNT_STEP_IDS)[number];

export interface AccountStep {
  readonly id: AccountStepId;
  /** The shared resource's name as printed to the owner. */
  readonly resource: string;
  /** Reads only; `earlier` holds the states of the steps before it in the same inspection. */
  inspect(api: CloudflareApi, accountId: string, earlier: ReadonlyMap<AccountStepId, SharedResource["state"]>): Promise<SharedResource["state"]>;
  /** Makes the absent resource exist (a bucket created meanwhile is not an error). */
  create(api: CloudflareApi, accountId: string, options: SharedResourceOptions, note: (message: string) => void): Promise<void>;
}

const bucketStep = (id: AccountStepId, bucket: string): AccountStep => ({
  id,
  resource: `R2 bucket ${bucket}`,
  inspect: async (api, accountId) => (await inspectBucket(api, accountId, bucket)).state,
  create: (api, accountId) => createBucket(api, accountId, bucket),
});

/** The account steps, built on each call: `backup.ts` imports this module, so its names are read only once both are loaded. */
export function accountSteps(): readonly AccountStep[] {
  return [
    bucketStep("log-bucket", LOG_BUCKET),
    bucketStep("state-bucket", STATE_BUCKET),
    bucketStep("backup-bucket", BACKUP_BUCKET),
    {
      id: "backup-lifecycle",
      resource: BACKUP_LIFECYCLE_RESOURCE,
      // Only a bucket of this account can hold the rule; it is not read otherwise.
      inspect: async (api, accountId, earlier) => (earlier.get("backup-bucket") === "owned" && (await hasBackupLifecycle(api, accountId)) ? "owned" : "absent"),
      create: (api, accountId) => setBackupLifecycle(api, accountId),
    },
    {
      id: "subdomain",
      resource: SUBDOMAIN_RESOURCE,
      inspect: async (api, accountId) => ((await readSubdomain(api, accountId)) === undefined ? "absent" : "owned"),
      create: (api, accountId, options) => registerSubdomain(api, accountId, options),
    },
    {
      id: "signing-record",
      resource: SIGNING_RESOURCE,
      inspect: (api, accountId) => signingCredentialState(api, accountId),
      async create(api, accountId, _options, note) {
        const { replaced } = await createAccountSigningCredential(api, accountId);
        if (replaced.length > 0) {
          note(
            `replaced the ${SIGNING_RESOURCE}; every deployed stage keeps the old key until it is redeployed: run deploy --target cloudflare --stage <stage> for each ` +
              "deployed stage now (until then its file uploads and downloads fail)",
          );
        }
      },
    },
  ];
}

/** The account's shared resources on Cloudflare and their state, one per account step. Sends only reads. */
export async function inspectSharedResources(api: CloudflareApi, accountId: string): Promise<SharedResource[]> {
  const states = new Map<AccountStepId, SharedResource["state"]>();
  const out: SharedResource[] = [];
  for (const step of accountSteps()) {
    const state = await step.inspect(api, accountId, states);
    states.set(step.id, state);
    out.push({ name: step.resource, state });
  }
  return out;
}

/** Creates the given absent shared resources through their account steps. The core calls it only when none is foreign. */
export async function createSharedResources(
  api: CloudflareApi,
  accountId: string,
  absent: readonly SharedResource[],
  options: SharedResourceOptions = {},
  note: (message: string) => void = () => undefined,
): Promise<void> {
  const steps = accountSteps();
  // The signing credential's record lives in the state home, so it comes after the buckets.
  const ordered = [...absent].sort((a, b) => Number(a.name === SIGNING_RESOURCE) - Number(b.name === SIGNING_RESOURCE));
  for (const resource of ordered) {
    const step = steps.find((s) => s.resource === resource.name);
    if (!step) throw new Error(`unknown Cloudflare shared resource ${resource.name}`);
    await step.create(api, accountId, options, note);
  }
}
