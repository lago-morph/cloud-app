/**
 * The Cloudflare REST API as the cloud test hooks use it (plan item D-T2).
 *
 * - Every request sends the token from `CLOUDFLARE_API_TOKEN` as a bearer token, in the sandbox
 *   and on an owner machine alike: the sandbox proxy no longer injects one (plan §10.6, DEC-0420).
 *   The token is read from the environment only and never printed.
 * - Node `fetch` uses the proxy only with `NODE_USE_ENV_PROXY=1`, which the driver sets for
 *   cloud targets (DEC-0085).
 * - Explicit User-Agent (DEC-0089); every request bounded by `CLOUD_WAITS.requestMs`.
 * - Usage is countable (plan §1 "Cloud usage limits"): every request increments a per-process
 *   counter, printed once on exit as `[d-t2] cloudflare api requests in this process: <n>` so a
 *   run's raw output shows its API request count.
 */
import { CLOUD_WAITS, prerequisiteMissing, USER_AGENT } from "../../harness/index.js";

export const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CfEnvelope<T> {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[];
  readonly result_info?: { readonly page?: number; readonly per_page?: number; readonly total_pages?: number; readonly count?: number; readonly total_count?: number; readonly cursor?: string };
}

export interface CfResponse<T> {
  readonly status: number;
  /** Undefined when the body is not JSON. */
  readonly body: CfEnvelope<T> | undefined;
}

let requests = 0;
let reporting = false;

/** Cloudflare API requests made by this process so far. */
export function apiRequestCount(): number {
  return requests;
}

function count(): void {
  requests += 1;
  if (!reporting) {
    reporting = true;
    process.once("exit", () => process.stderr.write(`[d-t2] cloudflare api requests in this process: ${String(requests)}\n`));
  }
}

/** The account ID (not a credential) from `CLOUDFLARE_ACCOUNT_ID`; a missing prerequisite without it. */
export function accountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (id === undefined || id === "") return prerequisiteMissing("CLOUDFLARE_ACCOUNT_ID is not set: the cloud test hooks need the Cloudflare account ID");
  return id;
}

export function authHeader(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  // The token always comes from CLOUDFLARE_API_TOKEN, with or without HTTPS_PROXY: the sandbox
  // proxy no longer injects one (DEC-0420, superseding the placeholder of DEC-0083). Never printed.
  const token = env.CLOUDFLARE_API_TOKEN;
  return token === undefined || token === "" ? {} : { authorization: `Bearer ${token}` };
}

/** One Cloudflare API call. `path` is relative to `/client/v4` and starts with `/`. */
export async function cfApi<T>(method: string, path: string, body?: unknown): Promise<CfResponse<T>> {
  count();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...authHeader() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(CLOUD_WAITS.requestMs),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as CfEnvelope<T> };
  } catch {
    return { status: response.status, body: undefined };
  }
}

/** Short description of a failed call, without any credential (Cloudflare error bodies hold none). */
export function failure(what: string, r: CfResponse<unknown>): Error {
  const errors = (r.body?.errors ?? []).map((e) => `${String(e.code ?? "")} ${e.message ?? ""}`.trim()).join("; ");
  return new Error(`${what} failed: HTTP ${String(r.status)}${errors === "" ? "" : ` (${errors})`}`);
}

/** A call that must succeed; returns its `result`. */
export async function cfOk<T>(what: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await cfApi<T>(method, path, body);
  if (r.status < 200 || r.status > 299 || r.body === undefined || !r.body.success) throw failure(what, r);
  return r.body.result;
}

/**
 * Every item of a page-numbered listing (`page`, `per_page`), bounded to `maxPages` pages so a
 * listing never runs unbounded (plan §1); more pages than that is an error, never a silent cut.
 */
export async function cfList<T>(what: string, path: string, perPage: number, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    const r = await cfApi<T[]>("GET", `${path}${sep}page=${String(page)}&per_page=${String(perPage)}`);
    if (r.status !== 200 || r.body === undefined || !r.body.success) throw failure(what, r);
    out.push(...r.body.result);
    const total = r.body.result_info?.total_pages;
    if (r.body.result.length < perPage || (total !== undefined && page >= total)) return out;
  }
  throw new Error(`${what}: more than ${String(maxPages * perPage)} items; the hook does not list further`);
}
