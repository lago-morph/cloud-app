/**
 * AUTH-AC-005 contract part: `/api/auth/*` responses validate against
 * docs/contracts/http/framework.openapi.yaml (status codes, headers, CurrentUser and
 * ErrorResponse schemas). The admin-list part is a cloud milestone item, not-run in this phase.
 * AUTH-AC-009 local part: `/api/auth/mock-login` works locally (a test stage) with the
 * identity used as given. The production-404 and bundle parts need a production build and are
 * covered by bundle inspection (CORE-AC-006, B-T4) and the cloud not-run list.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CATALOGUE } from "../../../src/index.js";
import { tag } from "../../../../../tests/support/tags.js";
import {
  SESSION_COOKIE,
  clearsCookie,
  cookieHeader,
  disposeAll,
  frameworkConfig,
  isCurrentUserResponse,
  isErrorResponse,
  locationOf,
  me,
  mockLogin,
  newApp,
  sessionCookieSet,
  setCookies,
  startStubLogin,
} from "./support.js";

afterEach(disposeAll);

async function expectContractError(res: Response): Promise<void> {
  expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
  const body = (await res.json()) as { error: { code: keyof typeof ERROR_CATALOGUE } };
  expect(isErrorResponse(body)).toBe(true);
  expect(res.status).toBe(ERROR_CATALOGUE[body.error.code].status);
}

describe("AUTH routes against the HTTP contract", () => {
  it(tag("AUTH-AC-005", "contract part: GET /api/auth/me is 200, Cache-Control no-store, CurrentUser schema at every level"), async () => {
    const app = await newApp();
    const anon = await app.request("/api/auth/me");
    expect(anon.status).toBe(200);
    expect(anon.headers.get("cache-control")).toBe("no-store");
    expect(anon.headers.get("content-type") ?? "").toMatch(/^application\/json/);
    expect(isCurrentUserResponse(await anon.json())).toBe(true);

    for (const level of ["user", "admin"] as const) {
      const cookie = cookieHeader(await mockLogin(app, { level, id: `ac005-${level}`, displayName: null }));
      const res = await app.request("/api/auth/me", { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(isCurrentUserResponse(body)).toBe(true);
      expect(body).toStrictEqual({ level, id: `ac005-${level}`, displayName: null });
    }

    // The unlistedId form (stub provider, users list without this login's ID).
    const listed = await newApp({ stubLoginProvider: true, config: frameworkConfig({ users: ["u_SOMEONEELSE"] }) });
    await listed.loginWithStub("ac005-unlisted");
    const unlisted = await listed.request("/api/auth/me");
    expect(unlisted.status).toBe(200);
    expect(unlisted.headers.get("cache-control")).toBe("no-store");
    const body = (await unlisted.json()) as Record<string, unknown>;
    expect(isCurrentUserResponse(body)).toBe(true);
    expect(body["level"]).toBe("anonymous");
    expect(typeof body["unlistedId"]).toBe("string");
  });

  it(tag("AUTH-AC-005", "contract part: login 302, callback 302 (success and failure), logout 204"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { response: login, callback, transactionCookie } = await startStubLogin(app, "/after");
    expect(login.status).toBe(302);

    const ok = await app.request(`${callback.pathname}${callback.search}`, { headers: { cookie: cookieHeader(transactionCookie) } });
    expect(ok.status).toBe(302);
    const okLocation = locationOf(ok);
    expect(`${okLocation.pathname}${okLocation.search}`).toBe("/after");
    const session = sessionCookieSet(ok);
    expect(session).toBeDefined();

    const failed = await app.request(`${callback.pathname}${callback.search}`);
    expect(failed.status).toBe(302);
    const failedLocation = locationOf(failed);
    expect(failedLocation.pathname).toBe("/");
    expect(failedLocation.searchParams.get("authError")).toBe("login_failed");

    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie: session === undefined ? "" : cookieHeader(session) } });
    expect(logout.status).toBe(204);
    expect(await logout.text()).toBe("");
  });

  it(tag("AUTH-AC-005", "contract part: POST /api/auth/mock-login 204; invalid bodies and wrong methods give a contract ErrorResponse"), async () => {
    const app = await newApp();
    const ok = await app.request("/api/auth/mock-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "user", id: "ac005-mock", displayName: "M" }),
    });
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");

    const invalidBodies = [{ level: "boss" }, {}, { level: "user", extra: true }, { level: "user", id: 5 }];
    for (const body of invalidBodies) {
      const res = await app.request("/api/auth/mock-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      await expectContractError(res);
    }

    // Methods the contract does not define for a route answer with an ErrorResponse.
    await expectContractError(await app.request("/api/auth/logout"));
    await expectContractError(await app.request("/api/auth/me", { method: "DELETE" }));
  });
});

describe("authentication mock route (local)", () => {
  it(tag("AUTH-AC-009", "local part: /api/auth/mock-login sets any chosen identity, with the user ID used as given"), async () => {
    const app = await newApp();
    const cases = [
      { level: "user", id: "chosen-user-id", displayName: "Ada" },
      { level: "admin", id: "chosen-admin-id", displayName: null },
    ] as const;
    for (const identity of cases) {
      const cookie = await mockLogin(app, identity);
      expect(await me(app, cookieHeader(cookie))).toStrictEqual(identity);
    }
    // Anonymous clears the session.
    const res = await app.request("/api/auth/mock-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "anonymous" }),
    });
    expect(res.status).toBe(204);
    expect(sessionCookieSet(res)).toBeUndefined();
    const cleared = setCookies(res).find((c) => c.name === SESSION_COOKIE);
    if (cleared !== undefined) expect(cleared.value === "" || clearsCookie(cleared)).toBe(true);
    // Default IDs: a fixed ID per level when none is given.
    const first = await mockLogin(app, { level: "user" });
    const second = await mockLogin(app, { level: "user" });
    const a = await me(app, cookieHeader(first));
    const b = await me(app, cookieHeader(second));
    expect(a["level"]).toBe("user");
    expect(typeof a["id"]).toBe("string");
    expect(b["id"]).toBe(a["id"]);
  });
});
