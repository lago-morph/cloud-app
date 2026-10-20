/**
 * AUTH-AC-007 (docs/components/auth.md AUTH-REQ-007): "A POST with a session is rejected when
 * `Origin` is missing or wrong and accepted when it equals the public origin, both directly and
 * through the deployed router."
 *
 * Through the deployed router: raw HTTP to the run's target (`dev` locally, the test stage on a
 * cloud), which can omit `Origin` (DEC-0230). The public origin is the origin of the base URL
 * the driver gives the tests. Directly: the reference app in-process (`createTestApp`), whose
 * requests always carry an `Origin` (testing.d.ts), so only wrong and correct origins are sent
 * there; local target only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { client, tag, target } from "../../harness/index.js";
import { disposeReference, openReference } from "../files/in-process.js";

function wrongOrigins(publicOrigin: string): string[] {
  const u = new URL(publicOrigin);
  const otherScheme = u.protocol === "https:" ? "http:" : "https:";
  return [
    "https://evil.example",
    "null",
    `${u.protocol}//${u.host}.evil.example`, // look-alike host
    `${otherScheme}//${u.host}`, // same host, other scheme
    `${u.protocol}//${u.hostname}:${u.port === "1" ? "2" : "1"}`, // same host, other port
    `${publicOrigin}/`, // not an origin: trailing slash
    publicOrigin.toUpperCase(),
  ].filter((o) => o !== publicOrigin);
}

describe("AUTH-AC-007 through the deployed router", () => {
  it(tag("AUTH-AC-007", "through the deployed router: a POST with a session and no Origin is rejected with AUTH.REQUEST_FORGERY"), async () => {
    const user = await client().as("user", { id: "c-t3-ac007-missing" });
    user.expectError(await user.post("/api/levels/user", {}, { origin: false }), 403, "AUTH.REQUEST_FORGERY");
    user.expectError(await user.post("/api/auth/logout", undefined, { origin: false }), 403, "AUTH.REQUEST_FORGERY");
    // The rejected logout did not end the session.
    expect(user.expectStatus(await user.get("/api/auth/me"), 200).json()).toMatchObject({ level: "user", id: "c-t3-ac007-missing" });
  });

  it(tag("AUTH-AC-007", "through the deployed router: a POST with a session and a wrong Origin is rejected with AUTH.REQUEST_FORGERY"), async () => {
    const user = await client().as("user", { id: "c-t3-ac007-wrong" });
    for (const origin of wrongOrigins(user.baseUrl)) {
      user.expectError(await user.post("/api/levels/user", {}, { origin }), 403, "AUTH.REQUEST_FORGERY");
    }
  });

  it(tag("AUTH-AC-007", "through the deployed router: a POST with a session and Origin equal to the public origin is accepted"), async () => {
    const user = await client().as("user", { id: "c-t3-ac007-ok" });
    expect(user.expectStatus(await user.post("/api/levels/user", {}, { origin: user.baseUrl }), 200).json()).toStrictEqual({ level: "user", id: "c-t3-ac007-ok" });
    user.expectStatus(await user.post("/api/auth/logout", undefined, { origin: user.baseUrl }), 204);
  });
});

if (target().target === "local") {
  describe("AUTH-AC-007 directly (in-process)", () => {
    afterEach(disposeReference);

    it(tag("AUTH-AC-007", "directly (in-process): a POST with a session is rejected for a wrong Origin and accepted for the public origin"), async () => {
      const app = await openReference();
      const login = await app.request("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "user", id: "c-t3-ac007-direct" }) });
      expect(login.status).toBe(204);
      const cookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      expect(cookie).not.toBe("");
      // The public origin as the app sees it: the origin the in-process app itself sends.
      const accepted = await app.request("/api/levels/user", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
      expect(accepted.status).toBe(200);
      for (const origin of ["https://evil.example", "null", "http://localhost.evil.example"]) {
        const res = await app.request("/api/levels/user", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" });
        expect(res.status, origin).toBe(403);
        expect(((await res.json()) as { error?: { code?: string } }).error?.code, origin).toBe("AUTH.REQUEST_FORGERY");
      }
    });
  });
}
