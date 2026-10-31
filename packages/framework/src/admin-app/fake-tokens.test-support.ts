/**
 * Test support: an account's API tokens behind a `CloudflareApi` (list with pages, read, create,
 * update, delete), in the live API's shapes (plan §2.3: `PUT …/tokens/<id>` keeps the value). Used
 * behind the admin app's scope-enforcing fake (fake-cloudflare.test-support.ts). `refuseUpdate`
 * plays the unverified case of plan §5.2 page 2: a grant that cannot update a token it did not
 * create. Values are fake. No network.
 */
import type { ApiReply, CloudflareApi } from "../provision/cloudflare/api.js";
import type { TokenPolicy } from "../provision/cloudflare/permissions.js";

export interface FakeToken {
  readonly id: string;
  name: string;
  readonly value: string;
  status: string;
  expires_on?: string;
  condition?: unknown;
  policies: TokenPolicy[];
}

export interface FakeTokens {
  readonly api: CloudflareApi;
  readonly tokens: Map<string, FakeToken>;
  /** Token IDs whose read and update the grant is refused (403 code 9109). */
  readonly refuseUpdate: Set<string>;
  /** Every write: `<METHOD> <path>`. */
  readonly writes: string[];
  add(token: Omit<FakeToken, "status"> & { status?: string }): FakeToken;
}

const ok = (result: unknown, extra: Record<string, unknown> = {}): ApiReply => ({ status: 200, body: { success: true, errors: [], messages: [], result, ...extra } });
const err = (status: number, code: number, message: string): ApiReply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

export function fakeTokens(accountId: string, options: { perPage?: number } = {}): FakeTokens {
  const tokens = new Map<string, FakeToken>();
  const refuseUpdate = new Set<string>();
  const writes: string[] = [];
  let next = 1;
  const A = `/accounts/${accountId}/tokens`;
  const listed = (t: FakeToken) => ({ id: t.id, name: t.name, status: t.status, ...(t.expires_on === undefined ? {} : { expires_on: t.expires_on }) });
  const api: CloudflareApi = (method, path, body) => {
    const [p = "", query = ""] = path.split("?");
    if (method !== "GET") writes.push(`${method} ${p}`);
    if (p === A && method === "GET") {
      const q = new URLSearchParams(query);
      const per = Math.min(Number(q.get("per_page") ?? "20"), options.perPage ?? 50);
      const page = Number(q.get("page") ?? "1");
      const all = [...tokens.values()].map(listed);
      return Promise.resolve(ok(all.slice((page - 1) * per, page * per), { result_info: { page, per_page: per, total_pages: Math.max(1, Math.ceil(all.length / per)), total_count: all.length } }));
    }
    if (p === A && method === "POST") {
      const b = body as { name: string; policies: TokenPolicy[]; expires_on?: string };
      const t: FakeToken = { id: `${String(next++).padStart(32, "0")}`, name: b.name, value: `fake-token-value-${String(next)}-${crypto.randomUUID()}`, status: "active", policies: b.policies, ...(b.expires_on === undefined ? {} : { expires_on: b.expires_on }) };
      tokens.set(t.id, t);
      return Promise.resolve(ok({ ...listed(t), value: t.value, policies: t.policies }));
    }
    const m = new RegExp(`^${A}/([^/]+)$`).exec(p);
    if (m === null) return Promise.resolve(err(404, 7003, "No route for that URI"));
    const t = tokens.get(m[1]!);
    if (t === undefined) return Promise.resolve(err(404, 1003, "Token not found"));
    if (refuseUpdate.has(t.id) && method !== "DELETE") return Promise.resolve(err(403, 9109, "Unauthorized to access requested resource"));
    if (method === "GET") return Promise.resolve(ok({ ...listed(t), policies: t.policies, ...(t.condition === undefined ? {} : { condition: t.condition }) }));
    if (method === "PUT") {
      const b = body as { name: string; status?: string; expires_on?: string; condition?: unknown; policies: TokenPolicy[] };
      t.name = b.name;
      t.policies = b.policies;
      if (b.status !== undefined) t.status = b.status;
      t.expires_on = b.expires_on;
      t.condition = b.condition;
      return Promise.resolve(ok({ ...listed(t), policies: t.policies }));
    }
    if (method === "DELETE") {
      tokens.delete(t.id);
      return Promise.resolve(ok({ id: t.id }));
    }
    return Promise.resolve(err(405, 10000, "method not allowed"));
  };
  return {
    api,
    tokens,
    refuseUpdate,
    writes,
    add(token) {
      const t: FakeToken = { status: "active", ...token };
      tokens.set(t.id, t);
      return t;
    },
  };
}
