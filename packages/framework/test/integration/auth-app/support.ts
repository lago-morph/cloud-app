/**
 * Support for the auth app's integration suite (plan-v0.2.0 §7 "Integration"; §7a.1.4).
 *
 * Real pieces: the auth app's Worker bundle under local workerd (Miniflare) with a local D1, an
 * app Worker calling it over a real service binding, and mock-oauth2-server as the OAuth issuer
 * (tests/support/mock-oauth2/launcher.ts).
 *
 * One local HTTP server stands in for what has no local stand-in:
 * - Cloudflare's `/client/v4/user` and `/client/v4/memberships` (a fake, §7a.1.4 "Fakes"). It
 *   accepts a bearer token only if the issuer's userinfo accepts it, so the auth app must use the
 *   real access token it was issued;
 * - a recording pass-through for the issuer's token and revocation endpoints (the discovery
 *   document is served with those two endpoints pointed here), so tests can see that both tokens
 *   were revoked. Everything else (authorize, JWKS, issuer) is the issuer's own.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const ISSUER_ID = "cf";
export const ACCOUNT_ID = "acct-integration";

export interface FakeMember {
  /** `/user`'s email; omitted means none. */
  email?: string;
  memberships: { account: { id: string }; status: string; roles: string[] }[];
}

export interface Recorded {
  readonly path: string;
  readonly form: Record<string, string>;
  readonly status: number;
}

export interface Edge {
  readonly url: string;
  readonly discoveryUrl: string;
  readonly apiBase: string;
  readonly members: Map<string, FakeMember>;
  readonly recorded: Recorded[];
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

/** Starts the fake Cloudflare API and recording pass-through in front of `issuerBase`. */
export async function startEdge(issuerBase: string): Promise<Edge> {
  const issuer = `${issuerBase}/${ISSUER_ID}`;
  const members = new Map<string, FakeMember>();
  const recorded: Recorded[] = [];
  let self = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", self);
      if (req.method === "GET" && url.pathname === `/${ISSUER_ID}/.well-known/openid-configuration`) {
        const doc = (await (await fetch(`${issuer}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
        return send(res, 200, { ...doc, token_endpoint: `${self}/pass/token`, revocation_endpoint: `${self}/pass/revoke` });
      }
      if (req.method === "POST" && (url.pathname === "/pass/token" || url.pathname === "/pass/revoke")) {
        const raw = await body(req);
        const upstream = await fetch(`${issuer}/${url.pathname.slice("/pass/".length)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: raw });
        const text = await upstream.text();
        recorded.push({ path: url.pathname, form: Object.fromEntries(new URLSearchParams(raw)), status: upstream.status });
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        return res.end(text);
      }
      if (req.method === "GET" && (url.pathname === "/client/v4/user" || url.pathname === "/client/v4/memberships")) {
        const auth = req.headers.authorization ?? "";
        const info = await fetch(`${issuer}/userinfo`, { headers: { authorization: auth } });
        if (!auth.startsWith("Bearer ") || !info.ok) return send(res, 401, { success: false, errors: [{ code: 10000 }] });
        const sub = String(((await info.json()) as { sub?: unknown }).sub ?? "");
        const member = members.get(sub) ?? { memberships: [] };
        recorded.push({ path: url.pathname, form: {}, status: 200 });
        if (url.pathname === "/client/v4/user") return send(res, 200, { success: true, result: { id: sub, ...(member.email === undefined ? {} : { email: member.email }) } });
        return send(res, 200, { success: true, result: member.memberships, result_info: { page: 1, total_pages: 1 } });
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
    recorded,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The `Set-Cookie` name=value of a response, for a client that keeps cookies by hand. */
export function cookieOf(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}
