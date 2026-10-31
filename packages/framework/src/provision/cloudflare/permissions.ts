/**
 * The one versioned Cloudflare permission list (DEC-0563; plan-setup-wizard §4.1): the everyday
 * token's and the bootstrap token's permission groups, by ID, name and scope. The dashboard deep
 * links, the token checks, the in-place upgrade of the everyday token and the docs' permission
 * tables are all generated from it.
 *
 * - `EVERYDAY` (`prototype-framework`): DEC-0551's minimal set for every command but the account
 *   setup, plus "Email Routing Rules Read" (owner, 2026-10-26), so the everyday token can check the
 *   whole account setup on its own. It cannot create tokens and has no zone write permission.
 * - `BOOTSTRAP` (`prototype-framework-bootstrap`): v0.2.0 plan §5.1's four groups (DEC-0680),
 *   what `cloudflare-setup` needs to create the OAuth clients, store their secrets and deploy the
 *   admin app. The account setup itself moved to the admin app. The API cannot create a token that
 *   itself holds "Account API Tokens Write" (400, code 1001, verified 2026-10-26), so the owner makes
 *   it from the dashboard link with an expiry of 1 day at most; it deletes itself when setup is done.
 *
 * A release that needs more raises `PERMISSIONS_VERSION` (PAR-331) or `ACCOUNT_SETUP_VERSION`
 * (PAR-332) with the list.
 *
 * The IDs are Cloudflare's public permission group IDs, read from
 * `GET /accounts/<a>/tokens/permission_groups` on 2026-10-26. A group is matched by ID, or by name
 * when a policy lists one (the names are those the API lists; the dashboard shows "Write" as
 * "Edit").
 */
import type { CloudflareApi } from "./api.js";
import { policyCovers } from "./token-policies.js";

export type PermissionScope = "account" | "zone";

export interface PermissionGroup {
  /** Cloudflare's permission group ID. */
  readonly id: string;
  /** The group's name as `permission_groups` lists it. */
  readonly name: string;
  readonly scope: PermissionScope;
}

/** PAR-331: the version of `EVERYDAY` and `BOOTSTRAP`; raised whenever a release changes them (2: v0.2.0, DEC-0680). */
export const PERMISSIONS_VERSION = 2;
/** PAR-332: the version of the account setup this release expects (the setup record's `setupVersion`). */
export const ACCOUNT_SETUP_VERSION = 1;

const group = (id: string, name: string, scope: PermissionScope): PermissionGroup => Object.freeze({ id, name, scope });

/** Every group either token holds, by name. */
const GROUPS = {
  workersScriptsWrite: group("e086da7e2179491d91ee5f35b3ca210a", "Workers Scripts Write", "account"),
  r2StorageWrite: group("bf7481a1826f439697cb59a20b22293e", "Workers R2 Storage Write", "account"),
  d1Write: group("09b2857d1c31407795e75e3fed8617a1", "D1 Write", "account"),
  emailSendingRead: group("2d5b4b1f6c89487bb7184c2c1dcd3bf1", "Email Sending Read", "account"),
  emailSendingWrite: group("5df633d6b41c42bcaf5b4a62b9d14b64", "Email Sending Write", "account"),
  apiTokensWrite: group("5bc3f8b21c554832afc660159ab75fa4", "Account API Tokens Write", "account"),
  oauthClientWrite: group("50fc2f43318f40e4855a35d8de5bf643", "OAuth Client Write", "account"),
  secretsStoreWrite: group("adc8fa2bc6124928a8b3314dc63a1235", "Secrets Store Write", "account"),
  secretsStoreRead: group("5e33b7d77788455c9fdf18cbd38ee5a0", "Secrets Store Read", "account"),
  zoneRead: group("c8fed203ed3043cba015a93ad1616f1f", "Zone Read", "zone"),
  analyticsRead: group("9c88f9c5bce24ce7af9a958ba9c504db", "Analytics Read", "zone"),
  emailRoutingRulesRead: group("1b600d9d8062443e986a973f097e728a", "Email Routing Rules Read", "zone"),
  emailRoutingRulesWrite: group("79b3ec0d10ce4148a8f8bdc0cc5f97f2", "Email Routing Rules Write", "zone"),
} as const;

/** The everyday token's 7 groups (account first, then zone). */
export const EVERYDAY: readonly PermissionGroup[] = Object.freeze([
  GROUPS.workersScriptsWrite,
  GROUPS.r2StorageWrite,
  GROUPS.d1Write,
  GROUPS.emailSendingRead,
  GROUPS.zoneRead,
  GROUPS.analyticsRead,
  GROUPS.emailRoutingRulesRead,
]);

/**
 * v0.2.0 plan §5.2 page 2's everyday set (DEC-0715): 4 account groups and no zone group, because
 * v0.2.0 has no email domain. Each is covered by one admin-client scope (`workers-scripts.write`,
 * `workers-r2.write`, `d1.write`, `secrets-store.read`; PAR-447). The admin app's everyday-token
 * page creates or updates the token with exactly these (`everyday-token.ts`). It becomes `EVERYDAY`
 * (with the tables and the quick check) once `cloudflare-setup`'s check no longer looks up the
 * email domain's zone with the everyday token (DEC-0716).
 */
export const EVERYDAY_V2: readonly PermissionGroup[] = Object.freeze([GROUPS.workersScriptsWrite, GROUPS.r2StorageWrite, GROUPS.d1Write, GROUPS.secretsStoreRead]);

/**
 * The bootstrap token's 4 groups (v0.2.0 plan §5.1, IDs from §2.1b; DEC-0680), all account-scoped:
 * deploying the admin (and later auth) Worker and registering the `workers.dev` subdomain, creating
 * both OAuth clients, putting their secrets in Secrets Store, and "Account API Tokens Write", which
 * only lets the token delete itself (and is why the dashboard must make it).
 */
export const BOOTSTRAP: readonly PermissionGroup[] = Object.freeze([GROUPS.workersScriptsWrite, GROUPS.oauthClientWrite, GROUPS.secretsStoreWrite, GROUPS.apiTokensWrite]);

/**
 * Stronger groups that also grant a read group: a token made by hand with the write group passes
 * the check, as `token-policies.ts`'s `alsoSatisfiedBy` ("Zone Write" for "Zone Read").
 */
const SATISFIED_BY: Readonly<Record<string, readonly { readonly id: string; readonly name: string }[]>> = Object.freeze({
  [GROUPS.zoneRead.id]: [{ id: "e6d2666161e84845a636613608cee8d5", name: "Zone Write" }],
  [GROUPS.emailSendingRead.id]: [GROUPS.emailSendingWrite],
  [GROUPS.emailRoutingRulesRead.id]: [GROUPS.emailRoutingRulesWrite],
  [GROUPS.secretsStoreRead.id]: [GROUPS.secretsStoreWrite],
});

export type TokenKind = "everyday" | "bootstrap";

/** The names the deep links pre-fill. */
export const TOKEN_NAMES: Readonly<Record<TokenKind, string>> = Object.freeze({ everyday: "prototype-framework", bootstrap: "prototype-framework-bootstrap" });

const LISTS: Readonly<Record<TokenKind, readonly PermissionGroup[]>> = Object.freeze({ everyday: EVERYDAY, bootstrap: BOOTSTRAP });

/** The dashboard's name of a group: "Write" shows as "Edit". */
export const dashboardName = (g: PermissionGroup): string => g.name.replace(/ Write$/, " Edit");

/** The dashboard's account-owned token page (`:account` makes the dashboard ask when the user has several). */
export const DEEP_LINK_BASE = "https://dash.cloudflare.com/?to=/:account/api-tokens";

/**
 * The dashboard link that opens "Create Custom Token" with every group of `kind` ticked and the
 * name filled in (developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/:
 * `permissionGroupKeys` is a URL-encoded JSON array of `{ key, type }`, where `key` may be a
 * permission group ID, and `type` is then ignored; `name` is optional). The link cannot set the
 * expiry, the account or the zone; the user picks them on the page.
 */
export function deepLink(kind: TokenKind): string {
  const keys = LISTS[kind].map((g) => ({ key: g.id, type: g.name.endsWith(" Read") ? "read" : "edit" }));
  return `${DEEP_LINK_BASE}&permissionGroupKeys=${encodeURIComponent(JSON.stringify(keys))}&name=${encodeURIComponent(TOKEN_NAMES[kind])}`;
}

/** One policy of a token, as `GET /accounts/<a>/tokens/<id>` returns it (`result.policies`). */
export interface TokenPolicy {
  readonly id?: string;
  readonly effect: "allow" | "deny";
  readonly resources: Readonly<Record<string, unknown>>;
  readonly permission_groups: readonly { readonly id: string; readonly name?: string; readonly meta?: unknown }[];
}

export interface PolicyComparison {
  /** The required groups no `allow` policy grants on their scope, or that a `deny` policy takes away. */
  readonly missing: readonly PermissionGroup[];
  /**
   * The part of `missing` that a `deny` policy takes away. An added `allow` cannot beat a deny, so
   * the in-place update cannot fix these: the token must be made again (DEC-0586).
   */
  readonly denied: readonly PermissionGroup[];
  /** The policies name accounts, and none of them is this one (nor `*`). */
  readonly wrongAccount: boolean;
  /**
   * Some `allow` policy that grants a required zone group covers the zone: the zone itself, all
   * zones, or the whole account (true when no zone group is required). False for a token scoped to
   * another zone, and for one with none of the zone groups at all (`missing` lists them).
   */
  readonly zoneCovered: boolean;
}

const ACCOUNT_PREFIX = "com.cloudflare.api.account.";
const ZONE_PREFIX = "com.cloudflare.api.account.zone.";

const listsGroup = (p: TokenPolicy, g: { readonly id: string; readonly name: string }): boolean => p.permission_groups.some((have) => have.id === g.id || have.name === g.name);
/** The group, or a stronger group that includes it ("Zone Write" for "Zone Read"). */
const grantsGroup = (p: TokenPolicy, want: PermissionGroup): boolean => [want, ...(SATISFIED_BY[want.id] ?? [])].some((g) => listsGroup(p, g));

/** The account IDs (or `*`) a policy's resources name. */
const accountsNamed = (p: TokenPolicy): string[] => Object.keys(p.resources).filter((k) => k.startsWith(ACCOUNT_PREFIX) && !k.startsWith(ZONE_PREFIX)).map((k) => k.slice(ACCOUNT_PREFIX.length));

/**
 * Compares a token's policies with a required list (the plan's step 7 check of the everyday token,
 * read with the bootstrap token). Scopes are read as `token-policies.ts`'s `policyCovers` reads
 * them: an account group needs the account (or `*`), a zone group the zone, all zones, or the whole
 * account.
 */
export function comparePolicies(policies: readonly TokenPolicy[], required: readonly PermissionGroup[], scope: { readonly accountId: string; readonly zoneId: string }): PolicyComparison {
  const covers = (p: TokenPolicy, s: PermissionScope) => policyCovers(p.resources, s, scope.accountId, scope.zoneId);
  // A deny takes away the group it names, not a weaker one: denying "Zone Write" leaves "Zone Read".
  const isDenied = (want: PermissionGroup) => policies.some((p) => p.effect === "deny" && listsGroup(p, want) && covers(p, want.scope));
  const denied = required.filter(isDenied);
  const missing = required.filter((want) => isDenied(want) || !policies.some((p) => p.effect === "allow" && grantsGroup(p, want) && covers(p, want.scope)));
  const named = policies.filter((p) => p.effect === "allow").flatMap(accountsNamed);
  const wrongAccount = named.length > 0 && !named.some((a) => a === scope.accountId || a === "*");
  const zoneGroups = required.filter((g) => g.scope === "zone");
  const zoneCovered = zoneGroups.length === 0 || policies.some((p) => p.effect === "allow" && zoneGroups.some((g) => grantsGroup(p, g)) && covers(p, "zone"));
  return { missing, denied, wrongAccount, zoneCovered };
}

/**
 * The `policies` of the in-place update (`PUT /accounts/<a>/tokens/<id>`, which keeps the token's
 * value, verified 2026-10-26): every existing policy unchanged (its `id`, effect and resources;
 * its groups by ID, with their `meta` when they have one), then one `allow` policy for the missing
 * account groups on the account, and one for the missing zone groups on the zone, in Cloudflare's
 * documented top-level form `{ "com.cloudflare.api.account.zone.<zone>": "*" }`, or on all the
 * account's zones (nested under the account, as the dashboard writes it) without one (DEC-0586).
 */
export function withMissingPermissions(policies: readonly TokenPolicy[], missing: readonly PermissionGroup[], scope: { readonly accountId: string; readonly zoneId?: string }): TokenPolicy[] {
  const account = `${ACCOUNT_PREFIX}${scope.accountId}`;
  const kept: TokenPolicy[] = policies.map((p) => ({
    ...(p.id === undefined ? {} : { id: p.id }),
    effect: p.effect,
    resources: p.resources,
    permission_groups: p.permission_groups.map((g) => (g.meta === undefined || g.meta === null ? { id: g.id } : { id: g.id, meta: g.meta })),
  }));
  const ids = (s: PermissionScope) => missing.filter((g) => g.scope === s).map((g) => ({ id: g.id }));
  const accountGroups = ids("account");
  const zoneGroups = ids("zone");
  if (accountGroups.length > 0) kept.push({ effect: "allow", resources: { [account]: "*" }, permission_groups: accountGroups });
  if (zoneGroups.length > 0) {
    const resources = scope.zoneId === undefined ? { [account]: { [`${ZONE_PREFIX}*`]: "*" } } : { [`${ZONE_PREFIX}${scope.zoneId}`]: "*" };
    kept.push({ effect: "allow", resources, permission_groups: zoneGroups });
  }
  return kept;
}

/** A token as `GET /accounts/<a>/tokens/<id>` returns it: the fields the in-place update sends back. */
export interface TokenDetails {
  readonly name: string;
  readonly status?: string;
  readonly expires_on?: string;
  readonly not_before?: string;
  readonly condition?: unknown;
  readonly policies: readonly TokenPolicy[];
}

/**
 * The whole body of the in-place update: the token's name, status, expiry, start and IP conditions
 * as they are, and `withMissingPermissions`' policies. It never asks for a new value.
 */
export function inPlaceUpdateBody(token: TokenDetails, missing: readonly PermissionGroup[], scope: { readonly accountId: string; readonly zoneId?: string }): Record<string, unknown> {
  const body: Record<string, unknown> = { name: token.name };
  for (const key of ["status", "expires_on", "not_before", "condition"] as const) if (token[key] !== undefined && token[key] !== null) body[key] = token[key];
  body.policies = withMissingPermissions(token.policies, missing, scope);
  return body;
}

export interface ProbeResult {
  readonly group: PermissionGroup;
  readonly ok: boolean;
  /** The HTTP status; never a value. */
  readonly status: number;
}

/** A GraphQL Analytics read on the zone: the dataset `check-login` reads (email-delivery.ts), one row at most. */
const ANALYTICS_PROBE = `query AnalyticsProbe($zoneTag: string, $since: Time) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      emailSendingAdaptive(limit: 1, filter: { datetime_geq: $since }) {
        datetime
      }
    }
  }
}`;

/**
 * The quick check of the everyday token (plan §4.3 step 2): one cheap read for each `EVERYDAY`
 * group, with the token the `api` carries. A read passes when it answers 2xx (and, for GraphQL,
 * without errors), so a read-or-write group shows only that it can read. The zone groups, and
 * "Email Sending Read" (read on the zone's sending listing, as a production deploy reads it), need
 * the zone and are read only when `zoneId` is given; without it the result lists only the other
 * account groups. Reads only; the replies' bodies are never returned.
 */
export async function probeEveryday(api: CloudflareApi, scope: { readonly accountId: string; readonly zoneId?: string }): Promise<ProbeResult[]> {
  const a = `/accounts/${scope.accountId}`;
  const z = scope.zoneId;
  const reads: Record<string, (() => ReturnType<CloudflareApi>) | undefined> = {
    [GROUPS.workersScriptsWrite.id]: () => api("GET", `${a}/workers/scripts`),
    [GROUPS.r2StorageWrite.id]: () => api("GET", `${a}/r2/buckets?per_page=1`),
    [GROUPS.d1Write.id]: () => api("GET", `${a}/d1/database?per_page=1`),
    [GROUPS.emailSendingRead.id]: z === undefined ? undefined : () => api("GET", `/zones/${z}/email/sending/subdomains`),
    [GROUPS.zoneRead.id]: z === undefined ? undefined : () => api("GET", `/zones/${z}`),
    [GROUPS.analyticsRead.id]: z === undefined ? undefined : () => api("POST", "/graphql", { query: ANALYTICS_PROBE, variables: { zoneTag: z, since: new Date(Date.now() - 3_600_000).toISOString() } }),
    [GROUPS.emailRoutingRulesRead.id]: z === undefined ? undefined : () => api("GET", `/zones/${z}/email/routing/rules?per_page=1`),
  };
  const results: ProbeResult[] = [];
  for (const g of EVERYDAY) {
    const read = reads[g.id];
    if (read === undefined) continue;
    const r = await read();
    const errors = (r.body as { errors?: unknown } | null | undefined)?.errors;
    const graphqlFailed = g.id === GROUPS.analyticsRead.id && Array.isArray(errors) && errors.length > 0;
    results.push({ group: g, ok: r.status >= 200 && r.status < 300 && !graphqlFailed, status: r.status });
  }
  return results;
}

const SCOPE_TEXT: Readonly<Record<PermissionScope, string>> = Object.freeze({ account: "Account", zone: "Zone" });

/** The docs' permission table of a token (README, owner-tasks, QUICKSTART), generated from the list. */
export function permissionTableMarkdown(kind: TokenKind): string {
  const rows = LISTS[kind].map((g) => `| ${SCOPE_TEXT[g.scope]} | ${dashboardName(g)} | ${g.name} | \`${g.id}\` |`);
  return ["| Scope | On the dashboard | API name | Permission group ID |", "| --- | --- | --- | --- |", ...rows].join("\n") + "\n";
}
