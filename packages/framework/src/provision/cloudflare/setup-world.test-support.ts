/**
 * A fake Cloudflare with several accounts and API tokens, for `cloudflare-setup`'s unit tests
 * (plan-setup-wizard §6): each token has a value, an ID, an owner (an account, or a user token that
 * sees several accounts), an expiry and policies. `apiFor(value)` answers as that token would:
 * `GET /accounts`, both `tokens/verify` endpoints, token details, the in-place `PUT` and `DELETE`
 * (only with "Account API Tokens Write"), the plan (`subscriptions`, only with "Billing Read"), and
 * the everyday quick check's reads, each refused (403) when the token's policies lack the group.
 * Every other request goes to the account's `FakeCloud` (its `everydayApi` for a token without token
 * permissions), with the account ID in the path mapped to the fake's own. No network.
 */
import type { ApiReply, CloudflareApi } from "./api.js";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";
import { BOOTSTRAP, comparePolicies, EVERYDAY, TOKEN_NAMES, type PermissionGroup, type TokenPolicy } from "./permissions.js";

export const OTHER_ACCOUNT = "fedcba9876543210fedcba9876543210";

const ok = (result: unknown): ApiReply => ({ status: 200, body: { success: true, errors: [], messages: [], result } });
const err = (status: number, code: number, message: string): ApiReply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });
const INVALID = err(401, 1000, "Invalid API Token");
const UNAUTHORIZED = err(403, 9109, "Unauthorized to access requested resource");

/** A group of either list, by name. */
export function groupNamed(name: string): PermissionGroup {
  const found = [...EVERYDAY, ...BOOTSTRAP].find((x) => x.name === name);
  if (found === undefined) throw new Error(`no permission group ${name}`);
  return found;
}
const g = groupNamed;

/** The policies the dashboard link makes: the account groups on the account, the zone groups on all its zones (plan §2). */
export function dashboardPolicies(groups: readonly PermissionGroup[], accountId: string, zoneResources?: Record<string, unknown>): TokenPolicy[] {
  const pick = (s: "account" | "zone") => groups.filter((x) => x.scope === s).map((x) => ({ id: x.id, name: x.name }));
  return [
    { id: "pol-a", effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: "*" }, permission_groups: pick("account") },
    { id: "pol-z", effect: "allow", resources: zoneResources ?? { [`com.cloudflare.api.account.${accountId}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: pick("zone") },
  ];
}

export interface WorldToken {
  readonly id: string;
  readonly value: string;
  /** The owning account; a user token has none and sees `sees`. */
  readonly account?: string;
  readonly sees?: readonly string[];
  name: string;
  status: string;
  expires_on?: string;
  policies: TokenPolicy[];
  deleted: boolean;
}

export interface WorldAccount {
  readonly name: string;
  readonly cloud: FakeCloud;
  plan: "paid" | "free";
}

export class SetupWorld {
  readonly accounts = new Map<string, WorldAccount>();
  readonly tokens: WorldToken[] = [];
  /** `<token id or ?> <METHOD> <path>`, every request in order. */
  readonly requests: string[] = [];

  constructor() {
    this.addAccount(ACCOUNT, "Main account");
  }

  addAccount(id: string, name: string, cloud = new FakeCloud()): WorldAccount {
    const a: WorldAccount = { name, cloud, plan: "paid" };
    this.accounts.set(id, a);
    return a;
  }

  cloud(id = ACCOUNT): FakeCloud {
    return this.accounts.get(id)!.cloud;
  }

  /** An account token made from a deep link (its list's groups, the dashboard's policies). */
  addToken(kind: "everyday" | "bootstrap", value: string, id: string, options: { account?: string; groups?: readonly PermissionGroup[]; expires_on?: string; policies?: TokenPolicy[] } = {}): WorldToken {
    const account = options.account ?? ACCOUNT;
    const t: WorldToken = {
      id,
      value,
      account,
      name: TOKEN_NAMES[kind],
      status: "active",
      ...(options.expires_on === undefined ? {} : { expires_on: options.expires_on }),
      policies: options.policies ?? dashboardPolicies(options.groups ?? (kind === "everyday" ? EVERYDAY : BOOTSTRAP), account),
      deleted: false,
    };
    this.tokens.push(t);
    return t;
  }

  /** A user token (My Profile) that sees several accounts with every permission. */
  addUserToken(value: string, id: string, sees: readonly string[]): WorldToken {
    const t: WorldToken = {
      id,
      value,
      sees,
      name: "owner",
      status: "active",
      policies: [{ id: "pol-u", effect: "allow", resources: { "com.cloudflare.api.account.*": "*" }, permission_groups: [...BOOTSTRAP, ...EVERYDAY].map((x) => ({ id: x.id, name: x.name })) }],
      deleted: false,
    };
    this.tokens.push(t);
    return t;
  }

  token(id: string): WorldToken {
    return this.tokens.find((t) => t.id === id)!;
  }

  /** Requests that change something (not GET), by token. */
  writes(): string[] {
    return this.requests.filter((r) => !/ GET /.test(r) && !r.endsWith("POST /graphql"));
  }

  private visible(t: WorldToken): string[] {
    return t.account !== undefined ? [t.account] : [...(t.sees ?? [])];
  }

  private has(t: WorldToken, name: string, accountId: string, zoneId = "*"): boolean {
    return comparePolicies(t.policies, [g(name)], { accountId, zoneId }).missing.length === 0;
  }

  readonly apiFor = (value: string): CloudflareApi => async (method, path, body) => {
    const t = this.tokens.find((x) => x.value === value && !x.deleted);
    this.requests.push(`${t?.id ?? "?"} ${method} ${path}`);
    if (t === undefined) return INVALID;
    const url = new URL(`https://api${path}`);
    const p = url.pathname;
    const verified = () => ok({ id: t.id, status: t.status, ...(t.expires_on === undefined ? {} : { expires_on: t.expires_on }) });
    if (p === "/accounts" && method === "GET") return ok(this.visible(t).map((id) => ({ id, name: this.accounts.get(id)!.name })));
    if (p === "/user/tokens/verify") return t.account === undefined ? verified() : INVALID;
    const m = /^\/accounts\/([^/]+)(\/.*)?$/.exec(p);
    if (m) {
      const a = m[1]!;
      const rest = m[2] ?? "";
      const acct = this.accounts.get(a);
      if (acct === undefined || !this.visible(t).includes(a)) return UNAUTHORIZED;
      if (rest === "/tokens/verify") return t.account === a ? verified() : INVALID;
      const tok = /^\/tokens\/([^/]+)$/.exec(rest);
      const target = tok ? this.tokens.find((x) => x.id === tok[1]) : undefined;
      if (tok && target !== undefined) {
        if (!this.has(t, "Account API Tokens Write", a)) return UNAUTHORIZED;
        if (target.account !== a || target.deleted) return err(404, 1003, "token not found");
        if (method === "GET") return ok({ id: target.id, name: target.name, status: target.status, ...(target.expires_on === undefined ? {} : { expires_on: target.expires_on }), policies: target.policies });
        if (method === "PUT") {
          const b = body as { name?: string; status?: string; policies?: TokenPolicy[] };
          target.policies = JSON.parse(JSON.stringify(b.policies ?? [])) as TokenPolicy[];
          if (b.name !== undefined) target.name = b.name;
          return ok({ id: target.id, name: target.name, status: target.status, policies: target.policies });
        }
        if (method === "DELETE") {
          target.deleted = true;
          return ok({ id: target.id });
        }
      }
      if (rest === "/subscriptions") {
        if (!this.has(t, "Billing Read", a)) return UNAUTHORIZED;
        return ok([{ id: "sub", rate_plan: { id: acct.plan === "paid" ? "workers_paid" : "workers_free", scope: "account" }, state: "Paid" }]);
      }
      const reads: Record<string, string> = { "/workers/scripts": "Workers Scripts Write", "/r2/buckets": "Workers R2 Storage Write", "/d1/database": "D1 Write" };
      // The bootstrap's own resources (v0.2.0 plan §2.1b): any request needs its group.
      const bootstrapNeeds = rest.startsWith("/oauth_clients") ? "OAuth Client Write" : rest.startsWith("/secrets_store") ? "Secrets Store Write" : undefined;
      if (bootstrapNeeds !== undefined && !this.has(t, bootstrapNeeds, a)) return UNAUTHORIZED;
      const needs = method === "GET" ? reads[rest] : undefined;
      if (needs !== undefined && !this.has(t, needs, a)) return UNAUTHORIZED;
      return this.route(t, acct.cloud, method, path.replace(`/accounts/${a}`, `/accounts/${ACCOUNT}`), body);
    }
    const acct = this.accounts.get(this.visible(t)[0]!)!;
    const accountId = this.visible(t)[0]!;
    const zm = /^\/zones\/([^/]+)(\/.*)?$/.exec(p);
    if (p === "/zones" && !this.has(t, "Zone Read", accountId)) return UNAUTHORIZED;
    if (zm) {
      const z = zm[1]!;
      const rest = zm[2] ?? "";
      const needs = rest === "" ? "Zone Read" : rest === "/email/sending/subdomains" ? "Email Sending Read" : rest === "/email/routing/rules" ? "Email Routing Rules Read" : undefined;
      if (method === "GET" && needs !== undefined && !this.has(t, needs, accountId, z)) return UNAUTHORIZED;
    }
    if (p === "/graphql") {
      const zoneTag = (body as { variables?: { zoneTag?: string } } | undefined)?.variables?.zoneTag ?? "*";
      if (!this.has(t, "Analytics Read", accountId, zoneTag)) return { status: 200, body: { data: null, errors: [{ message: "not authorized for that zone" }] } };
    }
    return this.route(t, acct.cloud, method, path, body);
  };

  private route(t: WorldToken, cloud: FakeCloud, method: Parameters<CloudflareApi>[0], path: string, body: unknown): ReturnType<CloudflareApi> {
    const full = t.account === undefined || this.has(t, "Account API Tokens Write", t.account);
    return (full ? cloud.api : cloud.everydayApi)(method, path, body);
  }
}
