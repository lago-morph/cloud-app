/**
 * Restricted Cloudflare API tokens the compliance driver creates for itself (DEC-0531; owner,
 * 2026-10-25: "Create your own test token."), and the account reads of a cloud run.
 *
 * The tokens model the two tokens of DEC-0551: the everyday token (`prototype-framework`, every
 * command but `setup-account`) and the setup token (`prototype-framework-setup`, `setup-account`
 * only). Each clause that needs a restricted credential gets one of them, with one permission
 * removed or replaced:
 * - PROV-AC-002: the everyday token itself, which has no "Account API Tokens" permission at all:
 *   deploy needs none (DEC-0550), so the deploy must succeed with it
 *   (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`, the name kept from DEC-0531);
 * - PROV-AC-003: the everyday token with "Workers R2 Storage Read" instead of "Write", so a
 *   production `remove` cannot write its backup (DEC-0543: nothing is deleted)
 *   (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_STORAGE_WRITE`);
 * - PROV-AC-004: the setup token lacking exactly one email permission of DEC-0515, here "Email
 *   Routing Addresses Write" (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION`);
 * - PROV-AC-004: the setup token without "Account API Tokens Write" (it keeps "Account API Tokens
 *   Read", with which `setup-account` reads its own policies), so it cannot create the account's
 *   R2 signing credential (DEC-0550) (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_API_TOKENS_WRITE`);
 * - PROV-AC-004: the everyday token without "Email Sending Read", with which a production deploy
 *   reads its email prerequisites (DEC-0553) (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_SENDING_READ`).
 *
 * When the run selects such a clause's criterion and the operator did not set the variable, the
 * driver creates the token at the start of the cloud run with the main token
 * (`POST /accounts/<account>/tokens`, an account-owned token; the main token has "Account API
 * Tokens Write"). The token grants only its DEC-0551 set besides the omitted permission,
 * account-scoped (zone permissions on the account's zones), and expires after
 * PAR-286 (6 hours) as a backstop. Its value is held in memory, handed to the test processes in
 * the variable, and redacted from every output and the evidence; it is never written to disk or
 * logged. The driver deletes it at the end of the run, also when the run failed, and the leftover
 * check reports every `prototype-compliance-*` token still listed.
 */
import { detectD1Plan, type CfCall, type PlanReading } from "./d1-budget.js";
import { USER_AGENT } from "./http.js";
import { guardFetch, MAIN_TOKEN_PURPOSE } from "./token-guard.js";

export const TEST_TOKEN_PREFIX = "prototype-compliance-";
/** PAR-286: lifetime of a self-created test token (a backstop; the driver deletes it at the end of the run). */
export const TEST_TOKEN_LIFETIME_MS = 6 * 60 * 60_000;

export const NO_R2_TOKEN_PERMISSION_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION";
/** PROV-AC-002's token is DEC-0551's everyday token: the variable keeps DEC-0531's name. */
export const EVERYDAY_TOKEN_ENV = NO_R2_TOKEN_PERMISSION_ENV;
export const NO_EMAIL_PERMISSION_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION";
export const NO_API_TOKENS_WRITE_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_API_TOKENS_WRITE";
export const NO_EMAIL_SENDING_READ_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_SENDING_READ";
export const NO_R2_STORAGE_WRITE_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_STORAGE_WRITE";

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

/** A token's permission groups: on the account, and on the account's zones. */
export interface TokenSet {
  readonly account: readonly string[];
  readonly zone: readonly string[];
}

/**
 * DEC-0551's everyday token (`prototype-framework`): the union of every command but
 * `setup-account`. No permission on API tokens, and no write permission on email or DNS.
 */
export const EVERYDAY_TOKEN: TokenSet = Object.freeze({
  account: Object.freeze(["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Email Sending Read"]),
  zone: Object.freeze(["Zone Read", "Analytics Read"]),
});

/** DEC-0551's setup token (`prototype-framework-setup`): `setup-account`'s set, DEC-0515's email permissions included. */
export const SETUP_TOKEN: TokenSet = Object.freeze({
  account: Object.freeze(["Workers Scripts Write", "Workers R2 Storage Write", "Account API Tokens Write", "Email Sending Write", "Email Routing Addresses Write"]),
  zone: Object.freeze(["Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read"]),
});

const without = (list: readonly string[], omitted: string, replacement?: string): string[] => list.flatMap((g) => (g === omitted ? (replacement === undefined ? [] : [replacement]) : [g]));

export const RESTRICTED_TOKENS: readonly RestrictedTokenSpec[] = Object.freeze([
  { suffix: "no-r2-token", env: NO_R2_TOKEN_PERMISSION_ENV, criterion: "PROV-AC-002", account: [...EVERYDAY_TOKEN.account], zone: [...EVERYDAY_TOKEN.zone], omitted: "Account API Tokens (Read and Write)" },
  { suffix: "no-r2-write", env: NO_R2_STORAGE_WRITE_ENV, criterion: "PROV-AC-003", account: without(EVERYDAY_TOKEN.account, "Workers R2 Storage Write", "Workers R2 Storage Read"), zone: [...EVERYDAY_TOKEN.zone], omitted: "Workers R2 Storage Write" },
  { suffix: "no-email", env: NO_EMAIL_PERMISSION_ENV, criterion: "PROV-AC-004", account: without(SETUP_TOKEN.account, "Email Routing Addresses Write"), zone: [...SETUP_TOKEN.zone], omitted: "Email Routing Addresses Write" },
  { suffix: "no-tokens-write", env: NO_API_TOKENS_WRITE_ENV, criterion: "PROV-AC-004", account: without(SETUP_TOKEN.account, "Account API Tokens Write", "Account API Tokens Read"), zone: [...SETUP_TOKEN.zone], omitted: "Account API Tokens Write" },
  { suffix: "no-sending-read", env: NO_EMAIL_SENDING_READ_ENV, criterion: "PROV-AC-004", account: without(EVERYDAY_TOKEN.account, "Email Sending Read"), zone: [...EVERYDAY_TOKEN.zone], omitted: "Email Sending Read" },
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

/** A listed `prototype-compliance-*` token, with the times Cloudflare gives for it (ISO 8601), when it gives them. */
export interface ListedTestToken {
  readonly id: string;
  readonly name: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
}

/**
 * The test tokens an interrupted earlier run left (compliance.md §4), which a run may delete at
 * its start: not the current run's (`prototype-compliance-<run ID>-*`), and older than PAR-286.
 * The age is read from the creation time, or else from the expiry (the driver gives each token
 * a PAR-286 lifetime, so a passed expiry means it was created at least PAR-286 ago). A token
 * whose age is unknown is kept: it may belong to a run still going.
 */
export function staleTestTokens<T extends ListedTestToken>(tokens: readonly T[], runId: string, now: Date, lifetimeMs = TEST_TOKEN_LIFETIME_MS): T[] {
  const own = `${TEST_TOKEN_PREFIX}${runId}-`;
  const time = (iso: string | undefined): number | undefined => {
    const t = iso === undefined ? NaN : Date.parse(iso);
    return Number.isNaN(t) ? undefined : t;
  };
  return tokens.filter((t) => {
    if (!t.name.startsWith(TEST_TOKEN_PREFIX) || t.name.startsWith(own)) return false;
    const issued = time(t.issuedOn);
    if (issued !== undefined) return now.getTime() - issued >= lifetimeMs;
    const expires = time(t.expiresOn);
    return expires !== undefined && expires <= now.getTime();
  });
}

/** Every listed token whose name starts with `prototype-compliance-` (bounded: 20 pages of 50). */
export async function listTestTokens(call: CfCall, accountId: string): Promise<ListedTestToken[]> {
  const out: ListedTestToken[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call("GET", `/accounts/${accountId}/tokens?per_page=50&page=${String(page)}`);
    if (!ok(r)) throw failure("listing the account's API tokens", r);
    const body = r.body as { result: { id: string; name?: string; issued_on?: unknown; expires_on?: unknown }[]; result_info?: { total_pages?: unknown } };
    for (const t of body.result) {
      if (!(t.name ?? "").startsWith(TEST_TOKEN_PREFIX)) continue;
      out.push({ id: t.id, name: t.name ?? "", ...(typeof t.issued_on === "string" ? { issuedOn: t.issued_on } : {}), ...(typeof t.expires_on === "string" ? { expiresOn: t.expires_on } : {}) });
    }
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

/**
 * What a Cloudflare API token is for, for messages (never its value): the main token, a
 * restricted test token by its criterion and variable, or else a token a test gave a CLI call.
 */
export function purposeOfToken(token: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (token !== undefined && token !== "" && token === env.CLOUDFLARE_API_TOKEN) return MAIN_TOKEN_PURPOSE;
  const spec = token === undefined || token === "" ? undefined : RESTRICTED_TOKENS.find((s) => env[s.env] === token);
  return spec === undefined ? "a Cloudflare API token a test gave this CLI call (CLOUDFLARE_API_TOKEN)" : `the ${spec.criterion} test token (${spec.env}, lacks ${spec.omitted})`;
}

/** What the driver does on a cloud account besides the stage operations. */
export interface CloudAccountOps {
  /** The account's Workers plan and its D1 budget (one request). */
  d1Plan(): Promise<PlanReading>;
  createRestrictedToken(spec: RestrictedTokenSpec, runId: string): Promise<CreatedToken>;
  deleteToken(id: string): Promise<void>;
  /** The `prototype-compliance-*` tokens the account lists. */
  testTokens(): Promise<readonly ListedTestToken[]>;
  /** Set when these operations are fakes. */
  readonly dryRun?: string;
}

/**
 * A `CfCall` over `fetch` with the main token from `CLOUDFLARE_API_TOKEN` (never printed). Needs
 * `NODE_USE_ENV_PROXY=1` behind a proxy. A 401 answer rejects with `InvalidTokenError`, and the
 * token is then sent no further request in this process (token-guard.ts).
 */
export function fetchCfCall(env: Readonly<Record<string, string | undefined>> = process.env, doFetch: typeof fetch = fetch): CfCall {
  return async (method, path, body) => {
    const token = env.CLOUDFLARE_API_TOKEN;
    const response = await guardFetch(doFetch, token, MAIN_TOKEN_PURPOSE)(`https://api.cloudflare.com/client/v4${path}`, {
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
