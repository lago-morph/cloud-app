/**
 * AUTH-AC-005 contract part (docs/components/auth.md AUTH-REQ-005 as amended): "`/api/auth/*`
 * responses validate against the HTTP contract, and no `/api/auth/me` response has an
 * `unlistedId`" (docs/contracts/http/framework.openapi.yaml). Where: Local, cloud. The admin-role
 * part runs on `prodcheck` (admin-role.test.ts).
 *
 * Over HTTP against the run's target (`dev`, or the test stage), target-neutral through
 * `client()`. Every stage installs the password provider, so `GET /api/auth/login` always
 * redirects to the framework's sign-in page (auth.md §2 "Credential login", DEC-0516, superseding
 * DEC-0171's default-user login); the authentication mock works only through
 * `/api/auth/mock-login`. The successful-callback response (302 to `returnTo` with a session
 * cookie) needs a redirect provider, which only the in-process stub is: on cloud it is a not-run
 * part (tests/compliance/harness/expected.ts, DEC-0513), and locally it is covered in-process by
 * the framework's AUTH suite (stub provider).
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";
import type { ComplianceClient, HttpResponse } from "../../harness/http.js";
import { ERROR_CATALOGUE, isCurrentUserResponse, isErrorResponse, type ErrorCode } from "../../../support/http-schemas.js";
import { clears, sessionCookieName, setCookies } from "./support.js";

/** The response is a contract ErrorResponse with `code`, at the code's catalogue status. */
function expectContractError(c: ComplianceClient, res: HttpResponse, code: ErrorCode): void {
  const status = ERROR_CATALOGUE[code].status;
  if (status === null) throw new Error(`${code} never crosses HTTP`);
  c.expectError(res, status, code);
  expect(res.headers.get("content-type") ?? "", `${res.method} ${res.path}`).toMatch(/^application\/json/);
  expect(isErrorResponse(res.json()), `${res.method} ${res.path}: ${res.text}`).toBe(true);
}

/** The Location header resolved against the target's origin. */
function locationOf(c: ComplianceClient, res: HttpResponse): URL {
  const location = res.headers.get("location");
  if (location === null) throw new Error(`${res.method} ${res.path}: no Location header (status ${String(res.status)})`);
  return new URL(location, c.baseUrl);
}

function expectCurrentUser(res: HttpResponse): unknown {
  expect(res.headers.get("cache-control"), `${res.method} ${res.path}`).toBe("no-store");
  expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
  const body = res.json();
  expect(isCurrentUserResponse(body), res.text).toBe(true);
  return body;
}

describe("AUTH-AC-005 /api/auth/* against the HTTP contract, on the target", () => {
  it(tag("AUTH-AC-005", "contract part: GET /api/auth/me is 200, Cache-Control no-store, CurrentUser schema at every level, and never has an unlistedId"), async () => {
    const anon = client();
    expect(expectCurrentUser(anon.expectStatus(await anon.get("/api/auth/me"), 200))).toStrictEqual({ level: "anonymous" });
    for (const level of ["user", "admin"] as const) {
      const id = `fix-auth005-me-${level}`;
      const c = await client().as(level, { id, displayName: null });
      const body = expectCurrentUser(c.expectStatus(await c.get("/api/auth/me"), 200));
      expect(body).toStrictEqual({ level, id, displayName: null });
      expect(body, "no unlistedId (DEC-0522)").not.toHaveProperty("unlistedId");
    }
  });

  it(tag("AUTH-AC-005", "contract part: POST /api/auth/mock-login is 204 with an empty body; invalid bodies are 400 HTTP.INVALID_INPUT"), async () => {
    const c = client();
    const ok = c.expectStatus(await c.post("/api/auth/mock-login", { level: "user", id: "fix-auth005-mock", displayName: "M" }), 204);
    expect(ok.text).toBe("");
    expect(expectCurrentUser(c.expectStatus(await c.get("/api/auth/me"), 200))).toStrictEqual({ level: "user", id: "fix-auth005-mock", displayName: "M" });

    for (const body of [{ level: "boss" }, {}, { level: "user", extra: true }, { level: "user", id: 5 }]) {
      const anon = client();
      expectContractError(anon, await anon.post("/api/auth/mock-login", body), "HTTP.INVALID_INPUT");
    }
  });

  it(tag("AUTH-AC-005", "contract part: GET /api/auth/login redirects (302) to the framework's sign-in page on the public origin with the sanitised returnTo, and logs nobody in"), async () => {
    for (const [returnTo, expected] of [
      ["/after", "/after"],
      ["//evil.example", "/"],
      ["https://evil.example/x", "/"],
    ] as const) {
      const c = client();
      const res = c.expectStatus(await c.get(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`), 302);
      const location = locationOf(c, res);
      expect(location.origin, `returnTo ${returnTo}: the redirect stays on the public origin`).toBe(c.baseUrl);
      expect(location.pathname, `returnTo ${returnTo}: the framework's sign-in page`).toBe("/api/auth/sign-in");
      expect(location.searchParams.get("returnTo") ?? "/", `returnTo ${returnTo}: carried sanitised`).toBe(expected);
      // The mock is reached only through mock-login (DEC-0516): login sets no session.
      expect(setCookies(res.headers).filter((k) => k.name === sessionCookieName() && !clears(k)), "no session cookie").toEqual([]);
      expect(c.expectStatus(await c.get("/api/auth/me"), 200).json()).toStrictEqual({ level: "anonymous" });
      const page = c.expectStatus(await c.get(`${location.pathname}${location.search}`), 200);
      expect(page.headers.get("content-type") ?? "", "the sign-in page is HTML").toMatch(/^text\/html/);
    }
  });

  it(tag("AUTH-AC-005", "contract part: GET /api/auth/callback without a transaction is 302 to / with authError=login_failed and creates no session"), async () => {
    const c = client();
    const res = c.expectStatus(await c.get("/api/auth/callback?code=fix-auth005&state=fix-auth005"), 302);
    const location = locationOf(c, res);
    expect(location.origin).toBe(c.baseUrl);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("authError")).toBe("login_failed");
    expect(location.searchParams.get("requestId") ?? "").not.toBe("");
    expect(setCookies(res.headers).filter((k) => k.name === sessionCookieName() && !clears(k))).toEqual([]);
    expect(c.expectStatus(await c.get("/api/auth/me"), 200).json()).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-005", "contract part: POST /api/auth/logout is 204 with an empty body, with and without a session"), async () => {
    const anon = client();
    expect(anon.expectStatus(await anon.post("/api/auth/logout"), 204).text).toBe("");
    const user = await client().as("user", { id: "fix-auth005-logout" });
    expect(user.expectStatus(await user.post("/api/auth/logout"), 204).text).toBe("");
    expect(user.expectStatus(await user.get("/api/auth/me"), 200).json()).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-005", "contract part: methods the contract does not define for an auth route are 405 HTTP.METHOD_NOT_ALLOWED"), async () => {
    const c = client();
    for (const [method, path] of [
      ["GET", "/api/auth/logout"],
      ["DELETE", "/api/auth/me"],
      ["POST", "/api/auth/login"],
      ["GET", "/api/auth/mock-login"],
    ] as const) {
      const res = await c.request(method, path);
      expectContractError(c, res, "HTTP.METHOD_NOT_ALLOWED");
      expect(res.headers.get("allow") ?? "", `${method} ${path}`).not.toBe("");
    }
  });
});
