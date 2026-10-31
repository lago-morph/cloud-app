/**
 * The admin app's routes (v0.2.0 plan §3, §5.2; D8, D10; DEC-0710). Admin-only: anyone not signed
 * in sees only the sign-in button, and only an administrator of the account gets a session.
 *
 * - `GET /`: signed out, the sign-in button; signed in, the pages.
 * - `POST /signin`: starts the sign-in grant (identity and membership only).
 * - `GET /<page>`: the page and its button (signed in only; otherwise back to `/`).
 * - `POST /<page>`: starts that page's grant, asking for its own optional scopes (scopes.ts).
 * - `GET /callback`: the one redirect URI of the admin client. It finishes the grant named by the
 *   grant cookie: sign-in sets the session; a page's grant runs the page's action with the person's
 *   token, which is revoked at once (grant.ts). A page's grant must be by the session's person, who
 *   must still be an administrator, and every scope the page asked for must have been granted;
 *   otherwise the page says which scopes are missing and runs nothing.
 * - `POST /signout`: ends the session.
 *
 * POSTs must come from the admin app's own pages (`Origin` equal to its origin), and the session
 * cookie is `SameSite=Lax`, so another site can start nothing. The session is short (PAR-445) and
 * never renewed. Log lines name a fixed reason only, never a code, state or token.
 */
import type { CloudflareApi } from "../provision/cloudflare/api.js";
import { readCookie } from "../auth/cookies.js";
import { GrantError, logLine, openGrant, startGrant, useGrant, type AdminConfig, type Grant } from "./grant.js";
import { button, esc, page, SECURITY_HEADERS } from "./html.js";
import { ADMIN_GRANT_MS, ADMIN_SESSION_MS, GRANT_COOKIE, SESSION_COOKIE } from "./params.js";
import { open, seal } from "./seal.js";
import { type AdminPageId } from "./scopes.js";

export interface Admin {
  readonly sub: string;
  readonly email: string;
}

/** What a page's action gets: the person's grant, for this request only. */
export interface GrantContext {
  readonly admin: Admin;
  readonly accountId: string;
  /** The Cloudflare API with the person's token. */
  readonly api: CloudflareApi;
  readonly granted: readonly string[];
  readonly log: (line: string) => void;
  readonly now: () => number;
}

export interface AdminPage {
  readonly id: Exclude<AdminPageId, "signin">;
  readonly title: string;
  /** The page before its action: what it will do (trusted HTML). */
  view(admin: Admin): string | Promise<string>;
  /** The action, with the person's grant; its result as trusted HTML. */
  run(ctx: GrantContext): Promise<string>;
}

export interface AdminDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly config: AdminConfig;
  readonly pages: readonly AdminPage[];
}

const cookie = (name: string, value: string, maxAgeMs: number): string => `${name}=${value}; Path=/; Max-Age=${String(Math.floor(maxAgeMs / 1000))}; HttpOnly; Secure; SameSite=Lax`;
const clear = (name: string): string => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

const redirect = (location: string, status: number, cookies: string[] = []): Response => {
  const headers = new Headers({ ...SECURITY_HEADERS, location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status, headers });
};

const withCookies = (res: Response, cookies: string[]): Response => {
  for (const c of cookies) res.headers.append("set-cookie", c);
  return res;
};

/** A Cloudflare API client carrying the person's token. */
export function grantApi(f: typeof fetch, apiBase: string, token: string): CloudflareApi {
  return async (method, path, body) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers["content-type"] = "application/json";
    const res = await f(`${apiBase}${path}`, { method, headers, redirect: "manual", ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      // not JSON: keep the text
    }
    return { status: res.status, body: parsed };
  };
}

async function sessionOf(request: Request, deps: AdminDeps): Promise<Admin | null> {
  const value = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (value === undefined) return null;
  const s = (await open(deps.config.clientSecret, "session", value, deps.now())) as Partial<Admin> | null;
  return s !== null && typeof s.sub === "string" && typeof s.email === "string" ? { sub: s.sub, email: s.email } : null;
}

const sameOrigin = (request: Request, deps: AdminDeps): boolean => request.headers.get("origin") === deps.config.origin;

const signInPage = (status = 200, note = ""): Response =>
  page("Prototype admin", `${note}<p>Sign in with your Cloudflare account. Only an administrator of this account can use the admin app.</p>${button("/signin", "Sign in with Cloudflare")}`, { status });

function homePage(admin: Admin, deps: AdminDeps): Response {
  const links = deps.pages.map((p) => `<li><a href="/${p.id}">${esc(p.title)}</a></li>`).join("");
  return page("Prototype admin", `<p>Signed in as ${esc(admin.email)}.</p><ul>${links}</ul><nav>${button("/signout", "Sign out")}</nav>`);
}

/** A refusal page; `text` is trusted HTML. */
const refusedPage = (status: number, text: string, cookies: string[] = []): Response => withCookies(page("Prototype admin", `<p>${text}</p><p><a href="/">Back to the admin app</a></p>`, { status }), cookies);

const NOT_ADMIN = "Only an administrator of this Cloudflare account can use the admin app. Ask the account's owner if you need it.";

async function callback(request: Request, url: URL, deps: AdminDeps): Promise<Response> {
  const warn = (reason: string): void => deps.log(logLine("warn", `grant refused: ${reason}`));
  const g = await openGrant(deps, readCookie(request.headers.get("cookie"), GRANT_COOKIE), url.searchParams.get("state") ?? "");
  // A mismatched callback leaves the grant cookie alone: any site can send a browser here.
  if (g === null) {
    warn("state mismatch or expired grant");
    return refusedPage(400, "This sign-in has expired or did not start here. Go back to the admin app and start again.");
  }
  const done = [clear(GRANT_COOKIE)];
  if (url.searchParams.get("error") !== null) {
    warn("declined at Cloudflare");
    return refusedPage(400, "The request was not approved at Cloudflare, so nothing was done.", done);
  }
  const code = url.searchParams.get("code") ?? "";
  if (code === "") {
    warn("no code");
    return refusedPage(400, "Cloudflare sent no authorization. Start again.", done);
  }
  const session = g.page === "signin" ? null : await sessionOf(request, deps);
  const target = g.page === "signin" ? undefined : deps.pages.find((p) => p.id === g.page);
  // A page's grant needs a live session: refused before the code is exchanged, so no token is issued for nothing.
  if (g.page !== "signin" && (session === null || target === undefined)) {
    warn("no session");
    return refusedPage(401, "Your admin session ended. Sign in again, then repeat the step.", done);
  }
  try {
    return await useGrant(deps, g, code, async (grant: Grant) => {
      if (g.page === "signin") {
        const value = await seal(deps.config.clientSecret, "session", grant.admin, deps.now() + ADMIN_SESSION_MS);
        deps.log(logLine("info", "admin signed in"));
        return redirect("/", 303, [...done, cookie(SESSION_COOKIE, value, ADMIN_SESSION_MS)]);
      }
      // Checked before the exchange; repeated for the type checker.
      if (session === null || target === undefined) return refusedPage(401, "Your admin session ended. Sign in again, then repeat the step.", done);
      if (grant.admin.sub !== session.sub) {
        warn("grant by another person than the session's");
        return refusedPage(403, "You approved this at Cloudflare as a different person than the one signed in here. Sign in again.", [...done, clear(SESSION_COOKIE)]);
      }
      if (grant.missing.length > 0) {
        warn(`optional scopes not granted (${grant.missing.join(", ")})`);
        const list = grant.missing.map((s) => `<li><code>${esc(s)}</code></li>`).join("");
        return withCookies(
          page(target.title, `<p class="warn">Nothing was done: at Cloudflare these permissions were not granted, and this step needs them:</p><ul>${list}</ul><p>Start again and keep every permission on the Cloudflare page ticked.</p>${button(`/${target.id}`, "Start again")}`, { status: 403 }),
          done,
        );
      }
      const api = grantApi(deps.fetch, deps.config.apiBase, grant.accessToken);
      let html: string;
      try {
        html = await target.run({ admin: grant.admin, accountId: deps.config.accountId, api, granted: grant.granted, log: deps.log, now: deps.now });
      } catch (e) {
        // Step errors name the step and Cloudflare's answer, never a token or a value (each step's own rule).
        const message = e instanceof Error ? e.message : "unknown error";
        deps.log(logLine("warn", `${target.id} step failed`));
        const advice = /code 9109\b/.test(message) ? "<p>Cloudflare refused a permission: start again and keep every permission on the Cloudflare page ticked.</p>" : "";
        return withCookies(page(target.title, `<p class="warn">That step failed: ${esc(message)}</p>${advice}${button(`/${target.id}`, "Start again")}<p><a href="/">Back to the admin app</a></p>`, { status: 502 }), done);
      }
      return withCookies(page(target.title, `${html}<p><a href="/">Back to the admin app</a></p>`), done);
    });
  } catch (e) {
    if (e instanceof GrantError) {
      warn(e.reason);
      if (e.kind === "not-admin") return refusedPage(403, NOT_ADMIN, [...done, clear(SESSION_COOKIE)]);
      return refusedPage(400, "Signing in with Cloudflare failed. Start again.", done);
    }
    deps.log(logLine("error", "grant failed: internal error"));
    return refusedPage(503, "Something went wrong talking to Cloudflare. Nothing secret was shown; try again shortly.", done);
  }
}

export async function handleAdminRequest(request: Request, deps: AdminDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const pageFor = deps.pages.find((p) => `/${p.id}` === path);
  const known = path === "/" || path === "/signin" || path === "/signout" || path === "/callback" || pageFor !== undefined;
  if (!known) return page("Not found", "<p>Not found.</p>", { status: 404 });
  const methods = path === "/" || path === "/callback" ? ["GET"] : path === "/signin" || path === "/signout" ? ["POST"] : ["GET", "POST"];
  if (!methods.includes(request.method)) return page("Method not allowed", "<p>Method not allowed.</p>", { status: 405, headers: { allow: methods.join(", ") } });
  try {
    if (path === "/callback") return await callback(request, url, deps);
    if (request.method === "POST" && !sameOrigin(request, deps)) {
      deps.log(logLine("warn", "cross-site request refused"));
      return page("Prototype admin", "<p>This request did not come from the admin app's own page.</p>", { status: 403 });
    }
    const admin = await sessionOf(request, deps);
    if (path === "/signout") return redirect("/", 303, [clear(SESSION_COOKIE)]);
    if (path === "/signin") {
      const g = await startGrant(deps, "signin");
      return redirect(g.location, 302, [cookie(GRANT_COOKIE, g.cookie, ADMIN_GRANT_MS)]);
    }
    if (path === "/") return admin === null ? signInPage() : homePage(admin, deps);
    // A page: signed-in administrators only.
    const target = pageFor!;
    if (admin === null) return request.method === "GET" ? redirect("/", 303) : signInPage(401, "<p class=\"warn\">Your admin session ended. Sign in again.</p>");
    if (request.method === "GET") return page(target.title, `${await target.view(admin)}${button(`/${target.id}`, `Continue at Cloudflare`)}<p><a href="/">Back</a></p>`);
    const g = await startGrant(deps, target.id);
    return redirect(g.location, 302, [cookie(GRANT_COOKIE, g.cookie, ADMIN_GRANT_MS)]);
  } catch {
    deps.log(logLine("error", "request failed: internal error"));
    return page("Prototype admin", "<p>The admin app could not reach Cloudflare. Try again shortly.</p>", { status: 503 });
  }
}
