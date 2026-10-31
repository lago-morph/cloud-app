/**
 * E2E-017's local stand-ins for Cloudflare (plan-v0.2.0 §7.1 "Add" item 1, §7a.1.4 "Fakes"): one
 * fake account (`SetupWorld`, the fake the setup unit tests use) seen two ways.
 *
 * - **By API token**, in-process: `world.apiFor(value)` is what `cloudflare-setup` gets as its API.
 *   The framework's Cloudflare API client has a fixed base URL, so the command runs in-process with
 *   that API injected, as its own unit tests do (DEC-0761).
 * - **By OAuth grant**, over HTTP: `startSetupEdge` serves the issuer's discovery document with its
 *   token and revocation endpoints pointed at itself (a pass-through to mock-oauth2-server). As
 *   Cloudflare does, a grant is only for a client the account registered (the bootstrap's OAuth
 *   client: its ID, secret and redirect URI), and grants the asked scopes that client allows
 *   (required plus optional, and `openid`), minus those the person unticks. The Cloudflare API
 *   accepts only a live access token mock-oauth2-server issued and **enforces its granted scopes**
 *   with the admin app's scope table (`scopeFor`, `covers`, `GROUP_SCOPE`), then answers from the
 *   same fake account. `/user` and `/memberships` come from `members`, keyed by the issuer's `sub`;
 *   they need only a live token (their required scopes are every grant's, so not checked).
 *   Every write the edge serves itself (D1 databases, the everyday token) is recorded in `writes`.
 *   An everyday token the grant creates becomes a real token of the world, so `cloudflare-setup` can
 *   then use it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { covers, GROUP_SCOPE, scopeFor } from "../../../../packages/framework/src/admin-app/fake-cloudflare.test-support.js";
import { ACCOUNT } from "../../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { TOKEN_NAMES, type TokenPolicy } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import type { SetupWorld } from "../../../../packages/framework/src/provision/cloudflare/setup-world.test-support.js";

export const ISSUER_ID = "cf";

export interface SetupEdge {
  readonly discoveryUrl: string;
  readonly apiBase: string;
  /** Membership roles by `sub`; no entry: no membership of the account. */
  readonly members: Map<string, { roles: string[] }>;
  /** Optional scopes the person unticks at the consent screen, for the next grants. */
  readonly untick: Set<string>;
  /** The account's D1 databases (the auth app's registry among them). */
  readonly databases: readonly { uuid: string; name: string }[];
  /** Writes the edge answered itself (`<METHOD> <path>`); the rest are in the fake account's `requests`. */
  readonly writes: readonly string[];
  /** Every access token issued: its granted scopes and whether it was revoked. */
  readonly grants: { access: string; refresh: string; scope: string[]; revoked: boolean }[];
  /** Records the scopes an authorization request asked for; the next token answer grants them. */
  noteAuthorize(authorizeUrl: string): void;
  close(): Promise<void>;
}

const send = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
const apiErr = (code: number, message: string) => ({ success: false, errors: [{ code, message }], messages: [], result: null });

async function rawBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export async function startSetupEdge(world: SetupWorld, issuerBase: string): Promise<SetupEdge> {
  const issuer = `${issuerBase}/${ISSUER_ID}`;
  const members: SetupEdge["members"] = new Map();
  const untick = new Set<string>();
  const grants: SetupEdge["grants"] = [];
  let asked: { scopes: string[]; clientId: string; redirectUri: string } = { scopes: [], clientId: "", redirectUri: "" };
  const writes: string[] = [];
  let self = "";
  let nextToken = 1;
  const databases: { uuid: string; name: string }[] = [];

  async function cloudflareApi(req: IncomingMessage, url: URL): Promise<{ status: number; body: unknown }> {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const grant = grants.find((g) => g.access === bearer);
    if (grant === undefined || grant.revoked) return { status: 403, body: apiErr(10000, "Authentication error") };
    const info = await fetch(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${bearer}` } });
    const sub = info.ok ? String(((await info.json()) as { sub?: unknown }).sub ?? "") : "";
    const p = url.pathname.slice("/client/v4".length);
    const path = p + url.search;
    if (p === "/user") return { status: 200, body: { success: true, result: { id: sub } } };
    if (p === "/memberships") {
      const roles = members.get(sub)?.roles;
      const result = roles === undefined ? [] : [{ id: "m1", account: { id: ACCOUNT, name: "Main account" }, status: "accepted", roles }];
      return { status: 200, body: { success: true, result, result_info: { page: 1, total_pages: 1 } } };
    }
    const method = (req.method ?? "GET") as "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    const needs = scopeFor(method, path);
    if (needs !== undefined && !covers(needs, grant.scope)) return { status: 403, body: apiErr(9109, "Unauthorized to access requested resource") };
    const raw = await rawBody(req);
    const type = req.headers["content-type"] ?? "";
    let body: unknown;
    if (raw.length > 0) body = type.startsWith("multipart/form-data") ? await new Request(url, { method, headers: { "content-type": type }, body: raw }).formData() : JSON.parse(Buffer.from(raw).toString("utf8"));
    const tokens = /^\/accounts\/[^/]+\/tokens$/.test(p);
    if (tokens && method === "POST") {
      const b = body as { name?: string; policies?: TokenPolicy[] };
      const groups = (b.policies ?? []).flatMap((x) => x.permission_groups ?? []);
      if (groups.some((g) => !grant.scope.includes(GROUP_SCOPE[g.id ?? ""] ?? GROUP_SCOPE[g.name ?? ""] ?? "-"))) {
        return { status: 400, body: apiErr(1001, "The OAuth session does not include the scopes required for the requested permission groups") };
      }
      writes.push(`POST ${p} ${String(b.name)}`);
      if (b.name === TOKEN_NAMES.everyday) {
        // The everyday token the grant makes is a real token of the account from now on.
        const id = `everyday${String(nextToken++).padStart(24, "0")}`;
        const value = `e2e017-everyday-${crypto.randomUUID()}`;
        world.addToken("everyday", value, id, { policies: b.policies ?? [] });
        return { status: 200, body: { success: true, errors: [], messages: [], result: { id, name: b.name, status: "active", value, policies: b.policies } } };
      }
    }
    if (tokens && method === "GET") {
      // The account's tokens: the world's (the everyday token, once made) and the account's own (the signing token).
      const own = (await world.cloud().api("GET", path)).body as { result?: { id: string; name: string }[] };
      const listed = world.tokens.filter((t) => !t.deleted && t.account === ACCOUNT).map((t) => ({ id: t.id, name: t.name, status: t.status }));
      return { status: 200, body: { success: true, errors: [], messages: [], result: [...listed, ...(own.result ?? [])], result_info: { page: 1, total_pages: 1 } } };
    }
    if (p === `/accounts/${ACCOUNT}/d1/database` && (method === "GET" || method === "POST")) {
      // The account's D1 databases by name (the fake account's own D1 stands in for stage databases only).
      if (method === "POST") writes.push(`POST ${p}`);
      if (method === "POST") databases.push({ uuid: crypto.randomUUID(), name: (body as { name: string }).name });
      const result = method === "POST" ? databases.at(-1) : databases;
      return { status: 200, body: { success: true, errors: [], messages: [], result, result_info: { page: 1, per_page: 100, count: databases.length, total_count: databases.length } } };
    }
    const reply = await world.cloud().api(method as never, path, body);
    return { status: reply.status, body: reply.body };
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", self);
      if (req.method === "GET" && url.pathname === `/${ISSUER_ID}/.well-known/openid-configuration`) {
        const doc = (await (await fetch(`${issuer}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
        return send(res, 200, { ...doc, token_endpoint: `${self}/pass/token`, revocation_endpoint: `${self}/pass/revoke` });
      }
      if (req.method === "POST" && url.pathname === "/pass/token") {
        const raw = await rawBody(req);
        const form = new URLSearchParams(Buffer.from(raw).toString("utf8"));
        // Only a client the account registered, with its secret, for its own redirect URI and the one the authorization named.
        const client = world.cloud().oauthClients.get(form.get("client_id") ?? "");
        const redirects = (client?.body.redirect_uris as string[] | undefined) ?? [];
        if (client === undefined || client.secret !== form.get("client_secret") || form.get("client_id") !== asked.clientId || !redirects.includes(form.get("redirect_uri") ?? "") || !redirects.includes(asked.redirectUri)) {
          return send(res, 401, { error: "invalid_client" });
        }
        const allowed = new Set(["openid", ...((client.body.scopes as string[] | undefined) ?? []), ...((client.body.optional_scopes as string[] | undefined) ?? [])]);
        const upstream = await fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: raw });
        const answer = (await upstream.json()) as Record<string, unknown>;
        if (upstream.ok && typeof answer.access_token === "string") {
          const scope = asked.scopes.filter((s) => allowed.has(s) && !untick.has(s));
          grants.push({ access: answer.access_token, refresh: String(answer.refresh_token ?? ""), scope, revoked: false });
          answer.scope = scope.join(" ");
        }
        return send(res, upstream.status, answer);
      }
      if (req.method === "POST" && url.pathname === "/pass/revoke") {
        const raw = await rawBody(req);
        const token = new URLSearchParams(Buffer.from(raw).toString("utf8")).get("token") ?? "";
        const upstream = await fetch(`${issuer}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: raw });
        for (const g of grants) if (upstream.ok && (g.access === token || g.refresh === token)) g.revoked = true;
        res.writeHead(upstream.status);
        return res.end(await upstream.text());
      }
      if (url.pathname.startsWith("/client/v4/")) {
        const r = await cloudflareApi(req, url);
        return send(res, r.status, r.body);
      }
      send(res, 404, { error: "not found" });
    })().catch((e: unknown) => send(res, 500, { error: String(e) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  self = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    discoveryUrl: `${self}/${ISSUER_ID}/.well-known/openid-configuration`,
    apiBase: `${self}/client/v4`,
    members,
    untick,
    databases,
    writes,
    grants,
    noteAuthorize: (authorizeUrl) => {
      const q = new URL(authorizeUrl).searchParams;
      asked = { scopes: (q.get("scope") ?? "").split(" ").filter((s) => s !== ""), clientId: q.get("client_id") ?? "", redirectUri: q.get("redirect_uri") ?? "" };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
