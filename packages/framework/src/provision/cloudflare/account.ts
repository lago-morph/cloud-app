/**
 * Cloudflare account setup, shared-resource part (PROV-REQ-004; cloudflare.md "Deploy
 * mechanics" `setupAccount`; LOG §2): the shared R2 log bucket `prototype-logs` and the check
 * that this account owns it. Used by `setupAccount` (create when absent) and by the deploy
 * preflight (inspect only), through the per-target operations `inspectAccount` and
 * `createSharedResources`. D-03 adds the state home (`sst-state`, DEC-0084) and the
 * `workers.dev` subdomain (DEC-0086) here.
 *
 * Ownership (DEC-PENDING-C-03-4): R2 bucket names are scoped to an account, so the bucket is
 * read through this account's API path. Found → owned; Cloudflare's "not found" (HTTP 404)
 * → absent; refused (HTTP 403), or a creation that conflicts with an existing bucket
 * (HTTP 409) → it exists but this account does not own it (or its credentials cannot see it).
 * Every other answer is an error naming the bucket and the status; nothing is guessed.
 */
import type { SharedResource } from "../core/operations.js";

/**
 * One Cloudflare API request, relative to `https://api.cloudflare.com/client/v4`. The caller
 * (D-03) supplies authentication and the proxy settings (DEC-0107); this module never sees a
 * credential.
 */
export type CloudflareApi = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;

/** The account's shared log bucket on Cloudflare (LOG §2). */
export const LOG_BUCKET = "prototype-logs";
/** The shared resource's name as printed to the owner. */
export const LOG_BUCKET_RESOURCE = `R2 bucket ${LOG_BUCKET}`;

function firstError(body: unknown): string {
  const errors = (body as { errors?: { code?: unknown; message?: unknown }[] } | null)?.errors;
  const e = Array.isArray(errors) ? errors[0] : undefined;
  return e ? `${String(e.message ?? "")}${e.code !== undefined ? ` (code ${String(e.code)})` : ""}` : "no error detail";
}

const succeeded = (r: { status: number; body: unknown }) => r.status >= 200 && r.status < 300 && (r.body as { success?: unknown } | null)?.success === true;

async function inspectLogBucket(api: CloudflareApi, accountId: string): Promise<SharedResource> {
  const r = await api("GET", `/accounts/${accountId}/r2/buckets/${LOG_BUCKET}`);
  if (succeeded(r)) return { name: LOG_BUCKET_RESOURCE, state: "owned" };
  if (r.status === 404) return { name: LOG_BUCKET_RESOURCE, state: "absent" };
  if (r.status === 403) return { name: LOG_BUCKET_RESOURCE, state: "foreign" };
  throw new Error(`checking ${LOG_BUCKET_RESOURCE} failed: HTTP ${r.status}: ${firstError(r.body)}`);
}

async function createLogBucket(api: CloudflareApi, accountId: string): Promise<void> {
  const r = await api("POST", `/accounts/${accountId}/r2/buckets`, { name: LOG_BUCKET });
  if (succeeded(r)) return;
  if (r.status === 409) throw new Error(`${LOG_BUCKET_RESOURCE} already exists but belongs to another account; nothing was created`);
  throw new Error(`creating ${LOG_BUCKET_RESOURCE} failed: HTTP ${r.status}: ${firstError(r.body)}`);
}

/** The account's shared resources on Cloudflare and their state. Sends only reads. */
export async function inspectSharedResources(api: CloudflareApi, accountId: string): Promise<SharedResource[]> {
  return [await inspectLogBucket(api, accountId)];
}

/** Creates the given absent shared resources. The core calls it only when none is foreign. */
export async function createSharedResources(api: CloudflareApi, accountId: string, absent: readonly SharedResource[]): Promise<void> {
  for (const resource of absent) {
    if (resource.name === LOG_BUCKET_RESOURCE) await createLogBucket(api, accountId);
    else throw new Error(`unknown Cloudflare shared resource ${resource.name}`);
  }
}
