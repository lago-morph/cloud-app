/**
 * Support for the admin app's integration suite (plan-v0.2.0 §7 "Integration"; §7a.1.4).
 *
 * Real pieces: the admin app's Worker bundle (as the bootstrap uploads it) under local workerd
 * (Miniflare, `nodejs_compat`), and mock-oauth2-server as the OAuth issuer
 * (tests/support/mock-oauth2/launcher.ts): its authorize form, PKCE, and RS256 ID tokens.
 *
 * One local HTTP server ("the edge") stands in for what has no local stand-in:
 * - a pass-through for the issuer's token and revocation endpoints (the discovery document is
 *   served with those two pointed here). The token answer's `scope` is set to what the person
 *   granted: the scopes of the authorization request (`noteAuthorize`) minus `untick`, as
 *   Cloudflare's consent screen lets the person untick optional scopes (plan §2.1). Revoked tokens
 *   are recorded and refused afterwards;
 * - the Cloudflare API, **enforcing the granted scopes** (the unit fake's `scopeFor` and
 *   `GROUP_SCOPE`: 403 code 9109, and 400 code 1001 for a token holding a group no granted scope
 *   covers), with `/user` and `/memberships` from `members` keyed by the issuer's `sub`, and the
 *   account's API tokens from the unit tests' fake token store.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { covers, GROUP_SCOPE, scopeFor } from "../../../src/admin-app/fake-cloudflare.test-support.js";
import { fakeTokens, type FakeTokens } from "../../../src/admin-app/fake-tokens.test-support.js";

export const ISSUER_ID = "cf";
export const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

export interface Edge {
  readonly url: string;
  readonly discoveryUrl: string;
  readonly apiBase: string;
  /** Membership roles by `sub`; no entry: no membership of the account. */
  readonly members: Map<string, { email?: string; roles?: string[] }>;
  /** Optional scopes the person unticks at the consent screen. */
  readonly untick: Set<string>;
  readonly tokens: FakeTokens;
  /** Every access and refresh token issued, and whether it was revoked. */
  readonly issued: { access: string; refresh: string; scope: string[]; revoked: Set<string> }[];
  /**
   * Records the scopes an authorization request asked for; the next token answer grants them
   * (minus `untick`). One grant at a time: tests run their grants in sequence.
   */
  noteAuthorize(authorizeUrl: string): void;
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const send = (res: ServerResponse, status: number, value: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

const apiErr = (code: number, message: string) => ({ success: false, errors: [{ code, message }], messages: [], result: null });

export async function startEdge(issuerBase: string): Promise<Edge> {
  const issuer = `${issuerBase}/${ISSUER_ID}`;
  const members: Edge["members"] = new Map();
  const untick = new Set<string>();
  const tokens = fakeTokens(ACCOUNT_ID);
  const issued: Edge["issued"] = [];
  const revoked = new Set<string>();
  let asked: string[] = [];
  let self = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", self);
      if (req.method === "GET" && url.pathname === `/${ISSUER_ID}/.well-known/openid-configuration`) {
        const doc = (await (await fetch(`${issuer}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
        return send(res, 200, { ...doc, token_endpoint: `${self}/pass/token`, revocation_endpoint: `${self}/pass/revoke` });
      }
      if (req.method === "POST" && url.pathname === "/pass/token") {
        const upstream = await fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: await body(req) });
        const answer = (await upstream.json()) as Record<string, unknown>;
        if (upstream.ok && typeof answer.access_token === "string") {
          const scope = asked.filter((s) => !untick.has(s));
          issued.push({ access: answer.access_token, refresh: String(answer.refresh_token ?? ""), scope, revoked });
          answer.scope = scope.join(" ");
        }
        return send(res, upstream.status, answer);
      }
      if (req.method === "POST" && url.pathname === "/pass/revoke") {
        const raw = await body(req);
        const token = new URLSearchParams(raw).get("token") ?? "";
        const upstream = await fetch(`${issuer}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: raw });
        if (upstream.ok) revoked.add(token);
        res.writeHead(upstream.status);
        return res.end(await upstream.text());
      }
      if (url.pathname.startsWith("/client/v4/")) {
        const path = url.pathname.slice("/client/v4".length) + url.search;
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        const grant = issued.find((t) => t.access === bearer);
        if (grant === undefined || revoked.has(bearer)) return send(res, 403, apiErr(10000, "Authentication error"));
        const info = await fetch(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${bearer}` } });
        const sub = info.ok ? String(((await info.json()) as { sub?: unknown }).sub ?? "") : "";
        const member = members.get(sub);
        const p = url.pathname.slice("/client/v4".length);
        if (p === "/user") return send(res, 200, { success: true, result: { id: sub, ...(member?.email === undefined ? {} : { email: member.email }) } });
        if (p === "/memberships") {
          const result = member?.roles === undefined ? [] : [{ id: "m1", account: { id: ACCOUNT_ID, name: "Acct" }, status: "accepted", roles: member.roles }];
          return send(res, 200, { success: true, result, result_info: { page: 1, total_pages: 1 } });
        }
        const method = (req.method ?? "GET") as "GET" | "POST" | "PUT" | "DELETE";
        const text = method === "GET" || method === "DELETE" ? "" : await body(req);
        const json: unknown = text === "" ? undefined : JSON.parse(text);
        const needs = scopeFor(method, path)!;
        if (!covers(needs, grant.scope)) return send(res, 403, apiErr(9109, "Unauthorized to access requested resource"));
        if ((method === "POST" || method === "PUT") && /^\/accounts\/[^/]+\/tokens(\/[^/]+)?$/.test(p)) {
          const groups = ((json as { policies?: { permission_groups?: { id?: string }[] }[] } | undefined)?.policies ?? []).flatMap((x) => x.permission_groups ?? []);
          if (groups.some((g) => !grant.scope.includes(GROUP_SCOPE[g.id ?? ""] ?? "-"))) return send(res, 400, apiErr(1001, "The OAuth session does not include the scopes required for the requested permission groups"));
        }
        if (/^\/accounts\/[^/]+\/tokens(\/|$)/.test(p)) {
          const r = await tokens.api(method, path, json);
          return send(res, r.status, r.body);
        }
        return send(res, 404, apiErr(7003, "No route for that URI"));
      }
      send(res, 404, { error: "not found" });
    })().catch((e: unknown) => send(res, 500, { error: String(e) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  self = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: self,
    discoveryUrl: `${self}/${ISSUER_ID}/.well-known/openid-configuration`,
    apiBase: `${self}/client/v4`,
    members,
    untick,
    tokens,
    issued,
    noteAuthorize: (authorizeUrl) => {
      asked = (new URL(authorizeUrl).searchParams.get("scope") ?? "").split(" ").filter((s) => s !== "");
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
