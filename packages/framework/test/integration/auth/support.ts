/**
 * Shared support for the AUTH integration suite (B-T3). Written from docs/components/auth.md,
 * docs/contracts/ts/{auth,testing,core}.d.ts and docs/contracts/http/framework.openapi.yaml,
 * not from any implementation. Uses only public, contracted names: `defineApp`,
 * `requireUser`/`requireAdmin`/`requireCurrentUser` (`<package>`), and `createTestApp`/`mockUsers`
 * (`<package>/testing`). Assumptions are recorded as DEC-0226…DEC-0234 (docs/decisions/decision-log.md, Item: B-T3).
 */
import { createHash } from "node:crypto";
import { expect } from "vitest";
import {
  ERROR_CATALOGUE,
  defineApp,
  requireAdmin,
  requireCurrentUser,
  requireUser,
  type DefinedApp,
  type ErrorCode,
} from "../../../src/index.js";
import { createTestApp, type TestApp, type TestAppOptions } from "../../../src/testing/index.js";
import { isCurrentUserResponse, isErrorResponse } from "../../../../../tests/support/http-schemas.js";

// The pure contract schema checks live in tests/support/http-schemas.ts, shared with the
// compliance criteria that run over HTTP (fix-auth005).
export { isCurrentUserResponse, isErrorResponse };

/** Local session cookie name (auth.md §2 "Session cookie"). */
export const SESSION_COOKIE = "session_local";

/** The fixed failed-login reasons of auth.md §2 "Failed login". */
export const FIXED_REASONS: readonly RegExp[] = [
  /transaction missing or expired/i,
  /state mismatch/i,
  /provider refused/i,
  /token exchange rejected/i,
  /token check failed/i,
];

/**
 * Reference app: one route per access check, plus a state-changing route for the request
 * forgery check. Defined lazily so a missing implementation fails each test, not the import.
 */
export function authApp(): DefinedApp<{}, never> {
  return defineApp({
    name: "authsuite",
    config: {},
    secrets: [],
    tables: {},
    routes: (api) => {
      // Dumps exactly what app code sees (AUTH-AC-001).
      api.get("/whoami", (c) => c.json(c.var.user));
      // Reads the ID behind requireUser() without a type assertion (AUTH-AC-001, AUTH-AC-004).
      api.get("/user-only", requireUser(), (c) => {
        const id: string = c.var.user.id;
        return c.json({ id, level: c.var.user.level });
      });
      api.get("/admin-only", requireAdmin(), (c) => {
        const id: string = c.var.user.id;
        return c.json({ id, level: c.var.user.level });
      });
      // requireCurrentUser(c) for handlers whose protection is not typed by middleware.
      api.get("/current", (c) => {
        const user = requireCurrentUser(c);
        const id: string = user.id;
        return c.json({ id, level: user.level, displayName: user.displayName });
      });
      for (const method of ["post", "put", "patch", "delete"] as const) {
        api[method]("/change", (c) => c.json({ changed: true }));
      }
    },
  });
}

/** Every test app created through `newApp` is disposed by `disposeAll` (call in afterEach). */
const created: TestApp[] = [];

export async function newApp(options?: TestAppOptions): Promise<TestApp> {
  const app = await createTestApp(authApp(), options);
  created.push(app);
  return app;
}

export async function disposeAll(): Promise<void> {
  const apps = created.splice(0, created.length);
  await Promise.all(apps.map((a) => a.dispose()));
}

/** User ID derivation of auth.md §2 (DEC-0067): `u_` + first 26 base32 chars of SHA-256. */
export function deriveUserId(providerId: string, subject: string): string {
  const digest = createHash("sha256").update(`${providerId}:${subject}`, "utf8").digest();
  return `u_${base32(digest).slice(0, 26)}`;
}

/** RFC 4648 base32, no padding, upper case. */
function base32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

/** One parsed Set-Cookie header. */
export interface SetCookie {
  readonly name: string;
  readonly value: string;
  /** Lower-cased attribute names mapped to their values ("" for flags). */
  readonly attributes: ReadonlyMap<string, string>;
}

export function setCookies(res: Response): SetCookie[] {
  return res.headers.getSetCookie().map((line) => {
    const [pair = "", ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    const attributes = new Map<string, string>();
    for (const attr of attrs) {
      const i = attr.indexOf("=");
      const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
      attributes.set(key, i < 0 ? "" : attr.slice(i + 1).trim());
    }
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attributes };
  });
}

/** True when the Set-Cookie line removes the cookie (empty value, Max-Age ≤ 0, or a past Expires). */
export function clearsCookie(cookie: SetCookie, now = Date.now()): boolean {
  const maxAge = cookie.attributes.get("max-age");
  if (maxAge !== undefined && Number(maxAge) <= 0) return true;
  const expires = cookie.attributes.get("expires");
  if (expires !== undefined && Date.parse(expires) <= now) return true;
  return false;
}

/** The session cookie a response sets (not a clearing one), or undefined. */
export function sessionCookieSet(res: Response): SetCookie | undefined {
  return setCookies(res).find((c) => c.name === SESSION_COOKIE && c.value !== "" && !clearsCookie(c));
}

export function cookieHeader(cookie: SetCookie): string {
  return `${cookie.name}=${cookie.value}`;
}

/** Logs in through the authentication mock's route and returns the session cookie it set. */
export async function mockLogin(
  app: TestApp,
  body: { level: "anonymous" | "user" | "admin"; id?: string; displayName?: string | null },
): Promise<SetCookie> {
  const res = await app.request("/api/auth/mock-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(204);
  const cookie = sessionCookieSet(res);
  if (cookie === undefined) throw new Error("mock-login set no session cookie");
  return cookie;
}

/** GET /api/auth/me, optionally with an explicit Cookie header. */
export async function me(app: TestApp, cookie?: string): Promise<Record<string, unknown>> {
  const res = await app.request("/api/auth/me", cookie === undefined ? undefined : { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** Asserts an ErrorResponse with the code's catalogue status and a non-empty requestId. */
export async function expectError(res: Response, code: ErrorCode): Promise<{ requestId: string }> {
  expect(res.status).toBe(ERROR_CATALOGUE[code].status);
  const body = (await res.json()) as unknown;
  expect(isErrorResponse(body)).toBe(true);
  const error = (body as { error: { code: string; requestId: string } }).error;
  expect(error.code).toBe(code);
  return { requestId: error.requestId };
}

/** The path and query of a Location header, resolved against any base. */
export function locationOf(res: Response): URL {
  const location = res.headers.get("location");
  if (location === null) throw new Error(`expected a Location header (status ${res.status})`);
  return new URL(location, "http://placeholder.invalid");
}

/**
 * Starts a login with the stub provider. B-T3 decision 3: the stub "speaks no protocol", so
 * its redirect goes straight to the callback URL it was given, with stub-specific query
 * parameters; following it in-process completes the login.
 */
export async function startStubLogin(
  app: TestApp,
  returnTo?: string,
  headers?: Record<string, string>,
): Promise<{ callback: URL; transactionCookie: SetCookie; response: Response }> {
  const query = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await app.request(`/api/auth/login${query}`, headers === undefined ? undefined : { headers });
  expect(response.status).toBe(302);
  const callback = locationOf(response);
  expect(callback.pathname).toBe("/api/auth/callback");
  const transactionCookie = setCookies(response).find((c) => c.name !== SESSION_COOKIE && c.value !== "" && !clearsCookie(c));
  if (transactionCookie === undefined) throw new Error("login set no transaction cookie");
  return { callback, transactionCookie, response };
}

/** Requests the callback URL in-process, with the given Cookie header (or none). */
export function followCallback(app: TestApp, callback: URL, cookie?: string): Promise<Response> {
  return app.request(`${callback.pathname}${callback.search}`, cookie === undefined ? undefined : { headers: { cookie } });
}

/** Completes a stub login with an explicit returnTo and returns the final redirect and session. */
export async function stubLoginVia(app: TestApp, returnTo?: string): Promise<{ redirect: Response; session: SetCookie | undefined }> {
  const { callback, transactionCookie } = await startStubLogin(app, returnTo);
  const redirect = await followCallback(app, callback, cookieHeader(transactionCookie));
  expect(redirect.status).toBe(302);
  return { redirect, session: sessionCookieSet(redirect) };
}
