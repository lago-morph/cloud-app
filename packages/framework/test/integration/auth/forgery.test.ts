/**
 * AUTH-AC-007, local in-process ("directly") part: Origin-based request forgery check for
 * state-changing requests that carry a session. docs/components/auth.md AUTH-REQ-007, DEC-0072.
 * The "through the deployed router" part and the missing-Origin clause are not reachable
 * through `TestApp.request`, which always supplies an Origin (B-T3 decision 5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { cookieHeader, disposeAll, expectError, mockLogin, newApp } from "./support.js";

afterEach(disposeAll);

const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

describe("AUTH request forgery check (in-process)", () => {
  it(tag("AUTH-AC-007", "in-process: a state-changing request with a session and a wrong Origin is rejected with AUTH.REQUEST_FORGERY"), async () => {
    const app = await newApp();
    const cookie = cookieHeader(await mockLogin(app, { level: "user", id: "ac007-user" }));
    for (const method of METHODS) {
      for (const origin of ["https://evil.example", "null", "http://localhost.evil.example"]) {
        const res = await app.request("/api/change", { method, headers: { cookie, origin } });
        await expectError(res, "AUTH.REQUEST_FORGERY");
      }
    }
  });

  it(tag("AUTH-AC-007", "in-process: the same requests are accepted when Origin equals the deployment's public origin"), async () => {
    const app = await newApp();
    const cookie = cookieHeader(await mockLogin(app, { level: "user", id: "ac007-user" }));
    for (const method of METHODS) {
      // No Origin in init: TestApp sends the deployment's public origin (testing.d.ts).
      const res = await app.request("/api/change", { method, headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ changed: true });
    }
    // Logout is also state-changing and passes with the public origin.
    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(204);
  });

  it(tag("AUTH-AC-007", "in-process: logout with a session and a wrong Origin is rejected"), async () => {
    const app = await newApp();
    const cookie = cookieHeader(await mockLogin(app, { level: "admin", id: "ac007-admin" }));
    const res = await app.request("/api/auth/logout", { method: "POST", headers: { cookie, origin: "https://evil.example" } });
    await expectError(res, "AUTH.REQUEST_FORGERY");
  });
});
