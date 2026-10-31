/**
 * The everyday token, made or updated through the signed-in admin's grant (v0.2.0 plan §5.2 page
 * 2; DEC-0715). It runs in the admin app's Worker, with the person's access token (scopes
 * `account-api-tokens.write` plus one per everyday group, PAR-447), so it imports nothing from
 * Node.
 *
 * - **No everyday token** (none named `prototype-framework`): one is created with exactly
 *   `EVERYDAY_V2`, as one `allow` policy on this account. Its value is returned once, for the page to
 *   show to the person; it is never logged or stored.
 * - **One or more exist** (a 0.1.x token among them): each is updated in place to exactly
 *   `EVERYDAY_V2` (`PUT …/tokens/<id>` keeps the value, plan §2.3). Its name, status, expiry, start
 *   and IP condition are kept; its policies are replaced, so the email and zone groups go. A token
 *   already holding exactly the set is not written.
 * - **The grant may not read or update an old token** (*unverified*, plan §5.2): a new token is
 *   created and returned with the old IDs. The old ones are deleted only after the person confirms
 *   they saved the new value (`deleteOldEverydayTokens`, a second grant).
 */
import { describeFailure, succeeded, type CloudflareApi } from "./api.js";
import { EVERYDAY_V1, EVERYDAY_V2, TOKEN_NAMES, type TokenDetails, type TokenPolicy } from "./permissions.js";

/** The set the token gets: plan §5.2 page 2's four groups. */
const SET = EVERYDAY_V2;

const NAME = TOKEN_NAMES.everyday;
const PAGE = 50;
const MAX_PAGES = 20;

/** A token ID as Cloudflare makes them (32 hex); anything else is never sent in a path. */
const TOKEN_ID = /^[0-9a-f]{32}$/;

export type EverydayOutcome =
  | { readonly kind: "created"; readonly tokenId: string; readonly value: string }
  | { readonly kind: "updated"; readonly tokenIds: readonly string[]; readonly added: readonly string[]; readonly removed: readonly string[] }
  | { readonly kind: "current"; readonly tokenIds: readonly string[] }
  | { readonly kind: "replaced"; readonly tokenId: string; readonly value: string; readonly oldIds: readonly string[] };

/** The everyday token's policies: one `allow` on this account with exactly the `EVERYDAY_V2` groups. */
export function everydayPolicies(accountId: string): TokenPolicy[] {
  return [{ effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: "*" }, permission_groups: SET.map((g) => ({ id: g.id })) }];
}

/** The IDs of the account's tokens named `name`, across pages; throws rather than read a partial list. */
async function tokensNamed(api: CloudflareApi, accountId: string, name: string): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const r = await api("GET", `/accounts/${accountId}/tokens?per_page=${String(PAGE)}&page=${String(page)}`);
    const body = r.body as { result?: { id?: unknown; name?: unknown }[]; result_info?: { total_pages?: unknown } } | null;
    if (!succeeded(r) || !Array.isArray(body?.result)) throw new Error(`listing the account's API tokens failed: ${describeFailure(r)}`);
    const total = typeof body.result_info?.total_pages === "number" ? body.result_info.total_pages : 1;
    if (total > MAX_PAGES) throw new Error(`the account has more than ${String(MAX_PAGES)} pages of API tokens; delete unused tokens in the dashboard first`);
    for (const t of body.result) if (t.name === name && typeof t.id === "string") ids.push(t.id);
    if (page >= total) return ids;
  }
}

/** A refusal of the grant (403): the case the fallback is for. Anything else is an error. */
const refused = (r: { status: number }): boolean => r.status === 403;

const groupsOf = (policies: readonly TokenPolicy[]): Set<string> => new Set(policies.filter((p) => p.effect === "allow").flatMap((p) => p.permission_groups.map((g) => g.id)));

/** Exactly the everyday set: one account-wide allow policy with the four groups and nothing else. */
function isExact(policies: readonly TokenPolicy[], accountId: string): boolean {
  if (policies.length !== 1) return false;
  const [p] = policies;
  const want = everydayPolicies(accountId)[0]!;
  return p!.effect === "allow" && JSON.stringify(p!.resources) === JSON.stringify(want.resources) && groupsOf(policies).size === SET.length && SET.every((g) => groupsOf(policies).has(g.id));
}

async function create(api: CloudflareApi, accountId: string): Promise<{ tokenId: string; value: string }> {
  const r = await api("POST", `/accounts/${accountId}/tokens`, { name: NAME, policies: everydayPolicies(accountId) });
  const result = (r.body as { result?: { id?: unknown; value?: unknown } } | null)?.result;
  if (!succeeded(r)) throw new Error(`creating the everyday token ${NAME} failed: ${describeFailure(r)}`);
  if (typeof result?.id !== "string" || typeof result.value !== "string" || result.value === "") throw new Error(`creating the everyday token ${NAME}: Cloudflare's answer held no token value`);
  return { tokenId: result.id, value: result.value };
}

/** Group names by ID, for the page's "added" and "removed" lists; unknown IDs as themselves. */
const KNOWN_NAMES: Readonly<Record<string, string>> = Object.fromEntries([...EVERYDAY_V1, ...EVERYDAY_V2].map((g) => [g.id, g.name]));
const nameOf = (id: string, given?: string): string => KNOWN_NAMES[id] ?? given ?? id;

export async function ensureEverydayToken(api: CloudflareApi, accountId: string): Promise<EverydayOutcome> {
  const ids = await tokensNamed(api, accountId, NAME);
  if (ids.length === 0) return { kind: "created", ...(await create(api, accountId)) };
  const path = (id: string) => `/accounts/${accountId}/tokens/${encodeURIComponent(id)}`;
  // Every token is read before any is written, so a refusal changes none of them.
  const tokens: { id: string; token: TokenDetails }[] = [];
  for (const id of ids) {
    const got = await api("GET", path(id));
    const token = (got.body as { result?: TokenDetails } | null)?.result;
    if (refused(got)) return { kind: "replaced", ...(await create(api, accountId)), oldIds: ids };
    if (!succeeded(got) || token === undefined || !Array.isArray(token.policies)) throw new Error(`reading the everyday token ${id} failed: ${describeFailure(got)}`);
    tokens.push({ id, token });
  }
  const updated: string[] = [];
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const { id, token } of tokens) {
    if (isExact(token.policies, accountId)) continue;
    const body: Record<string, unknown> = { name: token.name };
    for (const key of ["status", "expires_on", "not_before", "condition"] as const) if (token[key] !== undefined && token[key] !== null) body[key] = token[key];
    body.policies = everydayPolicies(accountId);
    const put = await api("PUT", path(id), body);
    // Refused: a new token replaces the ones not yet updated; those already updated stay valid.
    if (refused(put)) return { kind: "replaced", ...(await create(api, accountId)), oldIds: ids.filter((x) => !updated.includes(x)) };
    if (!succeeded(put)) throw new Error(`updating the everyday token ${id} failed: ${describeFailure(put)}`);
    updated.push(id);
    const have = groupsOf(token.policies);
    for (const g of SET) if (!have.has(g.id)) added.add(g.name);
    for (const p of token.policies) for (const g of p.permission_groups) if (!SET.some((e) => e.id === g.id)) removed.add(nameOf(g.id, g.name));
  }
  if (updated.length === 0) return { kind: "current", tokenIds: ids };
  return { kind: "updated", tokenIds: updated, added: [...added], removed: [...removed] };
}

/**
 * Deletes those of `ids` that are listed as everyday tokens (`prototype-framework`), never the last
 * one; any other ID, or one not shaped like a token ID, is skipped and never sent.
 */
export async function deleteOldEverydayTokens(api: CloudflareApi, accountId: string, ids: readonly string[]): Promise<{ deleted: string[]; skipped: string[] }> {
  const everyday = new Set(await tokensNamed(api, accountId, NAME));
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    // Never the last everyday token: the one the person just saved must survive.
    if (!TOKEN_ID.test(id) || !everyday.has(id) || everyday.size - deleted.length <= 1) {
      skipped.push(id);
      continue;
    }
    const r = await api("DELETE", `/accounts/${accountId}/tokens/${id}`);
    if (!succeeded(r)) throw new Error(`deleting the old everyday token failed: ${describeFailure(r)}`);
    deleted.push(id);
  }
  return { deleted, skipped };
}
