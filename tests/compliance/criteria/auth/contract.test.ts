/**
 * AUTH-AC-005 contract part (docs/components/auth.md AUTH-REQ-005): "`/api/auth/*` responses
 * validate against the HTTP contract" (docs/contracts/http/framework.openapi.yaml). Where:
 * Local, cloud; the admin-list part is a cloud milestone item (not-run in this phase).
 *
 * Over HTTP against the run's target (`dev`, or the test stage), target-neutral through
 * `client()`. A test stage has the mock and no real login provider (DEC-0171), so the
 * successful-callback response (302 to `returnTo` with a session cookie) does not exist there:
 * on cloud it is a not-run part (tests/compliance/harness/expected.ts, Google login mocked for
 * this phase), and locally it is covered in-process by the framework's AUTH suite
 * (packages/framework/test/integration/auth/routes-contract.test.ts, stub provider).
 * Root cause 2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test; decision draft fix-auth005.
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
  it(tag("AUTH-AC-005", "contract part: GET /api/auth/me is 200, Cache-Control no-store, CurrentUser schema at every level"), async () => {
    const anon = client();
    expect(expectCurrentUser(anon.expectStatus(await anon.get("/api/auth/me"), 200))).toStrictEqual({ level: "anonymous" });
    for (const level of ["user", "admin"] as const) {
      const id = `fix-auth005-me-${level}`;
      const c = await client().as(level, { id, displayName: null });
      expect(expectCurrentUser(c.expectStatus(await c.get("/api/auth/me"), 200))).toStrictEqual({ level, id, displayName: null });
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

  it(tag("AUTH-AC-005", "contract part: GET /api/auth/login redirects (302) to the sanitised returnTo on a stage without a real provider"), async () => {
    const c = client();
    const res = c.expectStatus(await c.get("/api/auth/login?returnTo=%2Fafter"), [302, 303]);
    // A test stage and local `dev` have the mock and no real provider: login sets the mock's
    // default session and redirects to the sanitised returnTo (DEC-0171).
    const location = locationOf(c, res);
    expect(location.origin).toBe(c.baseUrl);
    expect(`${location.pathname}${location.search}`).toBe("/after");
    expect(res.headers.get("cache-control")).toBe("no-store");
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
