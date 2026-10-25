/**
 * Restricted Cloudflare API tokens the compliance driver creates for itself (DEC-0531; owner,
 * 2026-10-25: "Create your own test token."), and the account reads of a cloud run.
 *
 * Two clauses need a credential that lacks one permission:
 * - PROV-AC-002: a token without "Account API Tokens" (Read and Write), so it cannot create the
 *   stage's R2 signing token (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`);
 * - PROV-AC-004: a token lacking exactly one email permission of DEC-0515, here "Email Routing
 *   Addresses Write" (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION`).
 *
 * When the run selects such a clause's criterion and the operator did not set the variable, the
 * driver creates the token at the start of the cloud run with the main token
 * (`POST /accounts/<account>/tokens`, an account-owned token; the main token has "Account API
 * Tokens Write"). The token grants only what the command under test needs besides the omitted
 * permission, account-scoped (zone permissions on the account's zones), and expires after
 * PAR-286 (6 hours) as a backstop. Its value is held in memory, handed to the test processes in
 * the variable, and redacted from every output and the evidence; it is never written to disk or
 * logged. The driver deletes it at the end of the run, also when the run failed, and the leftover
 * check reports every `prototype-compliance-*` token still listed.
 */
import { detectD1Plan, type CfCall, type PlanReading } from "./d1-budget.js";
import { USER_AGENT } from "./http.js";

export const TEST_TOKEN_PREFIX = "prototype-compliance-";
/** PAR-286: lifetime of a self-created test token (a backstop; the driver deletes it at the end of the run). */
export const TEST_TOKEN_LIFETIME_MS = 6 * 60 * 60_000;

export const NO_R2_TOKEN_PERMISSION_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION";
export const NO_EMAIL_PERMISSION_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION";

export interface RestrictedTokenSpec {
  /** Name suffix: the token is `prototype-compliance-<run ID>-<suffix>`. */
  readonly suffix: string;
  /** The variable the tests read it from. */
  readonly env: string;
  /** The criterion whose clause needs it; the token is created only when the run selects it. */
  readonly criterion: string;
  /** Permission groups granted on the account. */
  readonly account: readonly string[];
  /** Permission groups granted on the account's zones. */
  readonly zone: readonly string[];
  /** The permission it lacks, for the log. */
  readonly omitted: string;
}

/** The stage permissions of DEC-0374 without "Account API Tokens". */
const STAGE = ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write"] as const;

export const RESTRICTED_TOKENS: readonly RestrictedTokenSpec[] = Object.freeze([
  { suffix: "no-r2-token", env: NO_R2_TOKEN_PERMISSION_ENV, criterion: "PROV-AC-002", account: [...STAGE], zone: [], omitted: "Account API Tokens (Read and Write)" },
  {
    suffix: "no-email",
    env: NO_EMAIL_PERMISSION_ENV,
    criterion: "PROV-AC-004",
    // Reads its own policies (the DEC-0515 check) and the token reads of the deploy preflight, but creates no token.
    account: [...STAGE, "Account API Tokens Read", "Email Sending Write"],
    zone: ["Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read"],
    omitted: "Email Routing Addresses Write",
  },
]);

export interface CreatedToken {
  readonly id: string;
  readonly name: string;
  readonly value: string;
}

const ok = (r: { readonly status: number; readonly body: unknown }): boolean => r.status >= 200 && r.status < 300 && (r.body as { success?: unknown } | undefined)?.success === true;

function failure(what: string, r: { readonly status: number; readonly body: unknown }): Error {
  const errors = ((r.body as { errors?: { code?: unknown; message?: unknown }[] } | undefined)?.errors ?? []).map((e) => `${String(e.code ?? "")} ${String(e.message ?? "")}`.trim()).join("; ");
  return new Error(`${what} failed: HTTP ${String(r.status)}${errors === "" ? "" : ` (${errors})`}`);
}

/** The policies of a restricted token, by permission group IDs read from `permission_groups`. */
export function restrictedPolicies(spec: RestrictedTokenSpec, groups: readonly { readonly id: string; readonly name: string }[], accountId: string): unknown[] {
  const idOf = (name: string): { id: string } => {
    const g = groups.find((x) => x.name === name);
    if (g === undefined) throw new Error(`the API token permission group "${name}" was not found on this account`);
    return { id: g.id };
  };
  const account = `com.cloudflare.api.account.${accountId}`;
  const policies: unknown[] = [{ effect: "allow", permission_groups: spec.account.map(idOf), resources: { [account]: "*" } }];
  if (spec.zone.length > 0) policies.push({ effect: "allow", permission_groups: spec.zone.map(idOf), resources: { [account]: { "com.cloudflare.api.account.zone.*": "*" } } });
  return policies;
}

/** Cloudflare's `expires_on` form: ISO 8601 in UTC without milliseconds. */
export const expiresOn = (now: Date, lifetimeMs = TEST_TOKEN_LIFETIME_MS): string => new Date(now.getTime() + lifetimeMs).toISOString().replace(/\.\d{3}Z$/, "Z");

export async function createRestrictedToken(call: CfCall, accountId: string, spec: RestrictedTokenSpec, runId: string, now: Date): Promise<CreatedToken> {
  const g = await call("GET", `/accounts/${accountId}/tokens/permission_groups`);
  if (!ok(g)) throw failure("reading the API token permission groups", g);
  const groups = (g.body as { result: { id: string; name: string }[] }).result;
  const name = `${TEST_TOKEN_PREFIX}${runId}-${spec.suffix}`;
  const r = await call("POST", `/accounts/${accountId}/tokens`, { name, policies: restrictedPolicies(spec, groups, accountId), expires_on: expiresOn(now) });
  if (!ok(r)) throw failure(`creating the test token ${name}`, r);
  const result = (r.body as { result?: { id?: unknown; value?: unknown } }).result;
  if (typeof result?.id !== "string" || typeof result.value !== "string") throw new Error(`creating the test token ${name}: Cloudflare returned no token id or value`);
  return { id: result.id, name, value: result.value };
}

/** Every listed token whose name starts with `prototype-compliance-` (bounded: 20 pages of 50). */
export async function listTestTokens(call: CfCall, accountId: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call("GET", `/accounts/${accountId}/tokens?per_page=50&page=${String(page)}`);
    if (!ok(r)) throw failure("listing the account's API tokens", r);
    const body = r.body as { result: { id: string; name?: string }[]; result_info?: { total_pages?: unknown } };
    for (const t of body.result) if ((t.name ?? "").startsWith(TEST_TOKEN_PREFIX)) out.push({ id: t.id, name: t.name ?? "" });
    const total = body.result_info?.total_pages;
    // Cloudflare may serve fewer per page than asked: the page count decides when it is given.
    if (typeof total === "number" ? page >= total : body.result.length < 50) return out;
  }
  throw new Error("listing the account's API tokens: more than 1,000 tokens; not listed further");
}

export async function deleteToken(call: CfCall, accountId: string, id: string): Promise<void> {
  const r = await call("DELETE", `/accounts/${accountId}/tokens/${id}`);
  if (ok(r) || r.status === 404) return;
  throw failure(`deleting API token ${id}`, r);
}

/** What the driver does on a cloud account besides the stage operations. */
export interface CloudAccountOps {
  /** The account's Workers plan and its D1 budget (one request). */
  d1Plan(): Promise<PlanReading>;
  createRestrictedToken(spec: RestrictedTokenSpec, runId: string): Promise<CreatedToken>;
  deleteToken(id: string): Promise<void>;
  /** The `prototype-compliance-*` tokens the account lists. */
  testTokens(): Promise<readonly { readonly id: string; readonly name: string }[]>;
  /** Set when these operations are fakes. */
  readonly dryRun?: string;
}

/** A `CfCall` over `fetch` with the main token from `CLOUDFLARE_API_TOKEN` (never printed). Needs `NODE_USE_ENV_PROXY=1` behind a proxy. */
export function fetchCfCall(env: Readonly<Record<string, string | undefined>> = process.env, doFetch: typeof fetch = fetch): CfCall {
  return async (method, path, body) => {
    const token = env.CLOUDFLARE_API_TOKEN;
    const response = await doFetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token === undefined || token === "" ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status, body: undefined };
    }
  };
}

export function cloudflareAccountOps(options: { readonly call: CfCall; readonly accountId: string; readonly env?: Readonly<Record<string, string | undefined>>; readonly now?: () => Date; readonly dryRun?: string }): CloudAccountOps {
  const { call, accountId } = options;
  const now = options.now ?? (() => new Date());
  return {
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    d1Plan: () => detectD1Plan(call, accountId, options.env ?? process.env),
    createRestrictedToken: (spec, runId) => createRestrictedToken(call, accountId, spec, runId, now()),
    deleteToken: (id) => deleteToken(call, accountId, id),
    testTokens: () => listTestTokens(call, accountId),
  };
}
