/**
 * The auth app's HTTP routes (plan §4.1 steps 2–3; DEC-0660).
 *
 * `GET /start?app=<id>&return=<url>&state=<s>`: `return` must be registered for `app`, by exact
 * string match (DEC-0657); otherwise 400 and no redirect, so the auth app never sends anyone to an
 * unapproved URL. It then saves the sign-in (PKCE verifier, nonce, app, return, the app's state)
 * under a fresh state, sets that state in the `__Host-auth-signin` cookie, and redirects to the
 * issuer's authorize endpoint.
 *
 * `GET /callback`: the query `state` must equal the cookie's (bound to this browser) and name a
 * saved, unexpired sign-in, used up here; otherwise 400. Then it signs in (sign-in.ts), upserts
 * `users`, issues the one-time code and redirects to `return?code=…&state=<app state>`. A
 * declined consent or a refused sign-in goes back to `return?error=login_failed&state=…`, so the
 * app shows its own failed-login result. One `warn` line names the fixed reason; never a code,
 * state or token.
 */
import { SignInError } from "./errors.js";
import { SIGN_IN_TRANSACTION_MS } from "./params.js";
import { createPkce, randomToken } from "./pkce.js";
import { completeSignIn, logLine, type AuthAppConfig } from "./sign-in.js";
import { createCode, isRegistered, saveSignIn, takeSignIn, upsertUser, type D1Like, type SignInState } from "./store.js";
import { authorizeUrl, loadDiscovery } from "./upstream.js";

export const SIGN_IN_COOKIE = "__Host-auth-signin";

/** Longest `state` an app may pass to `/start`. */
const MAX_APP_STATE = 512;

export interface AuthAppDeps {
  readonly db: D1Like;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly config: AuthAppConfig;
}

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const cookie = (value: string, maxAge: number): string => `${SIGN_IN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

const page = (status: number, text: string, headers: Record<string, string> = {}): Response =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in</title><p>${text}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE, ...headers } });

const redirect = (location: string, headers: Record<string, string> = {}): Response => new Response(null, { status: 302, headers: { location, ...NO_STORE, ...headers } });

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function readCookie(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SIGN_IN_COOKIE) return rest.join("=");
  }
  return null;
}

async function start(url: URL, deps: AuthAppDeps): Promise<Response> {
  const app = url.searchParams.get("app") ?? "";
  const returnUrl = url.searchParams.get("return") ?? "";
  const appState = url.searchParams.get("state") ?? "";
  if (app === "" || returnUrl === "" || appState === "" || appState.length > MAX_APP_STATE) return page(400, "This sign-in link is incomplete.");
  if (!(await isRegistered(deps.db, app, returnUrl))) {
    deps.log(logLine("warn", "sign-in refused: return URL not registered"));
    return page(400, "This sign-in link is not approved for this app.");
  }
  const discovery = await loadDiscovery(deps.fetch, deps.config.discoveryUrl);
  const pkce = await createPkce();
  const state = randomToken(32);
  const nonce = randomToken(32);
  const signIn: SignInState = { verifier: pkce.verifier, nonce, app, returnUrl, appState };
  await saveSignIn(deps.db, state, signIn, deps.now());
  const location = authorizeUrl(discovery, { clientId: deps.config.clientId, redirectUri: deps.config.callbackUrl, state, nonce, challenge: pkce.challenge });
  return redirect(location, { "set-cookie": cookie(state, SIGN_IN_TRANSACTION_MS / 1000) });
}

const PROVIDER_ERROR = /^[a-z_]{1,40}$/;

async function callback(request: Request, url: URL, deps: AuthAppDeps): Promise<Response> {
  const clear = { "set-cookie": cookie("", 0) };
  const refuse = (reason: string): void => deps.log(logLine("warn", `sign-in refused: ${reason}`));
  const state = url.searchParams.get("state") ?? "";
  if (state === "" || readCookie(request) !== state) {
    refuse("state mismatch");
    return page(400, "Sign-in failed. Return to the app and try again.", clear);
  }
  const signIn = await takeSignIn(deps.db, state, deps.now());
  if (signIn === null) {
    refuse("unknown or expired sign-in");
    return page(400, "Sign-in failed. Return to the app and try again.", clear);
  }
  const failed = (): Response => redirect(withParams(signIn.returnUrl, { error: "login_failed", state: signIn.appState }), clear);

  const error = url.searchParams.get("error");
  if (error !== null) {
    refuse(`provider refused (${PROVIDER_ERROR.test(error) ? error : "other"})`);
    return failed();
  }
  const code = url.searchParams.get("code");
  if (code === null || code === "") {
    refuse("no code");
    return failed();
  }
  try {
    const identity = await completeSignIn(deps, { code, verifier: signIn.verifier, nonce: signIn.nonce });
    await upsertUser(deps.db, identity, deps.now());
    const oneTime = await createCode(deps.db, { sub: identity.sub, app: signIn.app, returnUrl: signIn.returnUrl }, deps.now());
    return redirect(withParams(signIn.returnUrl, { code: oneTime, state: signIn.appState }), clear);
  } catch (e) {
    if (e instanceof SignInError) refuse(e.reason);
    else deps.log(logLine("error", "sign-in failed: internal error"));
    return failed();
  }
}

export async function handleAuthAppRequest(request: Request, deps: AuthAppDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/start" && url.pathname !== "/callback") return page(404, "Not found.");
  if (request.method !== "GET") return page(405, "Method not allowed.", { allow: "GET" });
  try {
    return url.pathname === "/start" ? await start(url, deps) : await callback(request, url, deps);
  } catch (e) {
    deps.log(logLine("error", e instanceof SignInError ? `sign-in failed: ${e.reason}` : "sign-in failed: internal error"));
    return page(503, "Sign-in is unavailable. Try again shortly.");
  }
}
