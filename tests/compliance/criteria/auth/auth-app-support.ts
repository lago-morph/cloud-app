/**
 * Helpers for the in-process AUTH criteria that use a real provider (AUTH-AC-003, -005, -012,
 * -013, -015): the reference app through `createTestApp` with the auth-app provider over the fake
 * binding, or the stub provider (docs/contracts/ts/testing.d.ts). The sign-in is driven by hand
 * (login, the fake auth app's code, the callback) rather than with `loginWithAuthApp`, so that a
 * test sees every response and every `Set-Cookie` the criteria talk about.
 *
 * Values from the specification, not from the code: the user ID derivation (auth.md §2 "User
 * ID", DEC-0067), the role-refresh interval, retry count and delay (PAR-425 300 s, PAR-426 2,
 * PAR-427 200 ms; v020-B.md), the code lifetime (PAR-414 60 s; v020-A.md).
 */
import { createHash } from "node:crypto";
import { expect } from "vitest";
import type { TestApp } from "@lago-morph/prototype-framework/testing";
import { TEST_APP_ORIGIN } from "../../../../packages/framework/src/testing/test-app.js";
import { clears, loginCookieName, sessionCookieName, setCookies, type SetCookie } from "./support.js";

export const PUBLIC_ORIGIN = TEST_APP_ORIGIN;
export const CALLBACK_URL = `${PUBLIC_ORIGIN}/api/auth/callback`;
/** The fake auth app's origin and the app ID `createTestApp` gives the reference app (`<app>-<stage>`; v020-B.md DEC-0673). */
export const FAKE_AUTH_APP_ORIGIN = "https://auth-app.test";
export const APP_ID = "reference-local";
export const REFRESH_MS = 300_000;
export const RETRIES = 2;
export const RETRY_DELAY_MS = 200;
export const CODE_LIFETIME_MS = 60_000;
export const SESSION = sessionCookieName(false);
export const LOGIN = loginCookieName(false);

export type Identity = { readonly sub: string; readonly email: string; readonly role: "admin" | "user" };

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** auth.md §2: `u_` + the first 26 base32 characters of SHA-256(`<provider id>:<subject>`). Letter case is not specified. */
export function derivedUserId(providerId: string, subject: string): string {
  const bytes = createHash("sha256").update(`${providerId}:${subject}`, "utf8").digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  return `u_${out.slice(0, 26)}`;
}

export function expectUserId(actual: unknown, providerId: string, subject: string): void {
  expect(typeof actual === "string" ? actual.toUpperCase() : actual, `user ID of ${providerId}:${subject}`).toBe(derivedUserId(providerId, subject).toUpperCase());
  expect(String(actual).startsWith("u_")).toBe(true);
}

/** A browser for one person: keeps the session cookie as the responses set, re-issue or clear it. */
export class Browser {
  session: string | undefined;
  readonly seen: Response[] = [];
  constructor(readonly app: TestApp) {}

  async get(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.session !== undefined && !headers.has("cookie")) headers.set("cookie", this.session);
    const res = await this.app.request(path, { ...init, headers, redirect: "manual" });
    this.seen.push(res.clone());
    for (const k of this.sessionCookies(res)) this.session = clears(k, this.app.clock.now()) ? undefined : `${k.name}=${k.value}`;
    return res;
  }

  async json(path: string): Promise<Record<string, unknown>> {
    const res = await this.get(path);
    expect(res.status, `GET ${path}`).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  sessionCookies(res: Response): SetCookie[] {
    return setCookies(res.headers).filter((k) => k.name === SESSION);
  }
}

/** The absolute expiry (ms) a session `Set-Cookie` states, from Expires or Max-Age at `now`. */
export function expiryOf(cookie: SetCookie, now: number): number {
  const expires = cookie.attributes.get("expires");
  if (expires !== undefined) return Math.floor(Date.parse(expires) / 1000) * 1000;
  const maxAge = cookie.attributes.get("max-age");
  if (maxAge === undefined) throw new Error(`session cookie without an expiry: ${cookie.raw}`);
  return Math.floor((now + Number(maxAge) * 1000) / 1000) * 1000;
}

export interface Begun {
  readonly start: URL;
  readonly login: string;
  readonly response: Response;
}

/** `GET /api/auth/login`: the provider redirect and the transaction cookie. */
export async function beginLogin(browser: Browser, init: RequestInit = {}): Promise<Begun> {
  const response = await browser.get("/api/auth/login?returnTo=%2Fapi%2Fref%2Fme", init);
  expect(response.status, "login redirects").toBe(302);
  const location = response.headers.get("location");
  if (location === null) throw new Error("login: no Location");
  const tx = setCookies(response.headers).find((k) => k.name === LOGIN && !clears(k));
  if (tx === undefined) throw new Error(`login set no transaction cookie: ${response.headers.getSetCookie().join(" | ")}`);
  return { start: new URL(location, PUBLIC_ORIGIN), login: `${tx.name}=${tx.value}`, response };
}

/** `GET /api/auth/callback` with the transaction cookie and the given query. */
export async function callback(browser: Browser, begun: Begun, query: Record<string, string>): Promise<Response> {
  const url = new URL("/api/auth/callback", PUBLIC_ORIGIN);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return browser.get(`${url.pathname}${url.search}`, { headers: { cookie: [begun.login, browser.session].filter((s) => s !== undefined).join("; ") } });
}

export interface SignedIn {
  readonly browser: Browser;
  readonly session: SetCookie;
  readonly callback: Response;
}

function signedIn(browser: Browser, res: Response): SignedIn {
  expect(res.status, "callback redirects").toBe(302);
  const session = browser.sessionCookies(res).find((k) => !clears(k, browser.app.clock.now()));
  if (session === undefined) throw new Error(`sign-in set no session: ${res.headers.get("location") ?? ""}`);
  return { browser, session, callback: res };
}

/** Signs in through the auth-app provider: login, the fake auth app's code for the `/start` request, the callback. */
export async function signInWithAuthApp(app: TestApp, identity: Identity, browser = new Browser(app)): Promise<SignedIn> {
  const begun = await beginLogin(browser);
  const code = app.authApp.issueCode(identity, { app: begun.start.searchParams.get("app") ?? "", returnUrl: begun.start.searchParams.get("return") ?? "" });
  return signedIn(browser, await callback(browser, begun, { code, state: begun.start.searchParams.get("state") ?? "" }));
}

/** Signs in through the stub provider as `subject` (auth.md §2 "Stub provider": the callback URL with `state`, `code` and the subject). */
export async function signInWithStub(app: TestApp, subject: string): Promise<SignedIn> {
  const browser = new Browser(app);
  const begun = await beginLogin(browser);
  const query = Object.fromEntries(begun.start.searchParams);
  return signedIn(browser, await callback(browser, begun, { ...query, subject }));
}

/** The AUTH `warn` entries written since `from` (an index into `app.logs()`). */
export function authWarnings(app: TestApp, from: number): { message: string; requestId?: string }[] {
  return app.logs().slice(from).filter((e) => e.component === "AUTH" && e.severity === "warn");
}

/** The error code of a contract ErrorResponse. */
export async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.clone().json()) as { error?: { code?: string } };
  return body.error?.code;
}
