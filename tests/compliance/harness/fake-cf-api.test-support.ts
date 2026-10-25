/**
 * An in-memory Cloudflare API for the harness unit tests (DEC-0530, DEC-0531): the account's
 * subscriptions, the token permission groups, and account-owned tokens (create, list with
 * pages, delete). Shapes as the live API answered on 2026-10-25. No network.
 */
import type { CfCall } from "./d1-budget.js";

export const FAKE_ACCOUNT = "0123456789abcdef0123456789abcdef";

const GROUP_NAMES = [
  "Account API Tokens Read",
  "Account API Tokens Write",
  "Analytics Read",
  "D1 Write",
  "DNS Write",
  "Email Routing Addresses Write",
  "Email Routing Rules Write",
  "Email Sending Read",
  "Email Sending Write",
  "Workers R2 Storage Read",
  "Workers R2 Storage Write",
  "Workers Scripts Write",
  "Zone Read",
  "Zone Settings Write",
];

export interface FakeToken {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly policies: unknown;
  readonly expires_on?: string;
  readonly issued_on?: string;
}

export interface FakeCfApi {
  readonly call: CfCall;
  readonly tokens: Map<string, FakeToken>;
  readonly requests: { method: string; path: string; body?: unknown }[];
  /** The subscriptions answer: a listing, or an HTTP error status. */
  subscriptions: unknown[] | number;
  /** Paths (method + path prefix) that answer HTTP 500 instead. */
  readonly failing: Set<string>;
}

const ok = (result: unknown, extra: Record<string, unknown> = {}) => ({ status: 200, body: { success: true, errors: [], messages: [], result, ...extra } });
const err = (status: number, code: number, message: string) => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

export const WORKERS_PAID = { rate_plan: { id: "workers_paid", public_name: "Workers Paid", scope: "account" }, state: "Paid", frequency: "monthly", price: 5 };
export const R2_PAID = { rate_plan: { id: "r2_paid", public_name: "R2 Paid", scope: "account" }, state: "Paid", frequency: "monthly", price: 0 };
export const ZONE_FREE = { rate_plan: { id: "free", public_name: "Cloudflare Free Plan", scope: "zone" }, state: "Paid", frequency: "not-applicable", price: 0 };

export function fakeCfApi(options: { subscriptions?: unknown[] | number; perPage?: number } = {}): FakeCfApi {
  const A = `/accounts/${FAKE_ACCOUNT}`;
  let next = 0;
  const api: FakeCfApi = {
    tokens: new Map(),
    requests: [],
    subscriptions: options.subscriptions ?? [WORKERS_PAID, ZONE_FREE],
    failing: new Set(),
    call: (method, path, body) => {
      api.requests.push({ method, path, ...(body === undefined ? {} : { body }) });
      const [p, query = ""] = path.split("?") as [string, string?];
      if ([...api.failing].some((f) => `${method} ${path}`.startsWith(f))) return Promise.resolve(err(500, 10000, "internal error"));
      if (method === "GET" && p === `${A}/subscriptions`) {
        const s = api.subscriptions;
        return Promise.resolve(typeof s === "number" ? err(s, 9109, "Unauthorized to access requested resource") : ok(s));
      }
      if (method === "GET" && p === `${A}/tokens/permission_groups`) return Promise.resolve(ok(GROUP_NAMES.map((name, i) => ({ id: `group${String(i)}`, name, scopes: ["com.cloudflare.api.account"] }))));
      if (method === "GET" && p === `${A}/tokens`) {
        const params = new URLSearchParams(query);
        const perPage = Math.min(Number(params.get("per_page") ?? "20"), options.perPage ?? 50);
        const page = Number(params.get("page") ?? "1");
        const all = [...api.tokens.values()].map((t) => ({ id: t.id, name: t.name, status: "active", ...(t.expires_on === undefined ? {} : { expires_on: t.expires_on }), ...(t.issued_on === undefined ? {} : { issued_on: t.issued_on }) }));
        const total = Math.max(1, Math.ceil(all.length / perPage));
        return Promise.resolve(ok(all.slice((page - 1) * perPage, page * perPage), { result_info: { page, per_page: perPage, total_pages: total, total_count: all.length } }));
      }
      if (method === "POST" && p === `${A}/tokens`) {
        const b = body as { name?: unknown; policies?: unknown; expires_on?: unknown };
        if (typeof b.name !== "string" || !Array.isArray(b.policies) || b.policies.length === 0) return Promise.resolve(err(400, 1001, "bad request"));
        const id = `tok${String(++next)}`;
        const token: FakeToken = { id, name: b.name, value: `fake-value-${id}-not-a-credential`, policies: b.policies, ...(typeof b.expires_on === "string" ? { expires_on: b.expires_on } : {}) };
        api.tokens.set(id, token);
        return Promise.resolve(ok({ id, name: token.name, status: "active", value: token.value }));
      }
      const m = new RegExp(`^${A}/tokens/([^/]+)$`).exec(p);
      if (m !== null && method === "DELETE") return Promise.resolve(api.tokens.delete(m[1] ?? "") ? ok({ id: m[1] }) : err(404, 1003, "not found"));
      if (m !== null && method === "GET") {
        const t = api.tokens.get(m[1] ?? "");
        return Promise.resolve(t === undefined ? err(404, 1003, "not found") : ok({ id: t.id, name: t.name, policies: t.policies }));
      }
      return Promise.resolve(err(404, 7003, `no route for ${method} ${path}`));
    },
  };
  return api;
}

/** A token another tool or person made, which the harness must leave alone. */
export function addForeignToken(api: FakeCfApi, name: string, times: { readonly expires_on?: string; readonly issued_on?: string } = {}): void {
  api.tokens.set(`foreign-${name}`, { id: `foreign-${name}`, name, value: "x", policies: [], ...times });
}
