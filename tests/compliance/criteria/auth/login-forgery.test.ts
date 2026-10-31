/**
 * AUTH-AC-014 (docs/components/auth.md, AUTH-REQ-007 as amended by DEC-0516): a POST without any
 * session to each POST route under `/api/auth/`, with `Origin` missing or naming another origin,
 * gets 403 `AUTH.REQUEST_FORGERY` and has no effect; with `Origin` equal to the public origin it
 * is accepted.
 *
 * The POST routes left once the password provider's went (plan-v0.2.0 §6): `logout`, and
 * `mock-login` where the mock is installed (`dev` locally, the test stage on a cloud). Through the
 * deployed router, which can omit `Origin`. "No effect": no session cookie is set or cleared, and
 * `/api/auth/me` stays anonymous.
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";
import { sessionCookieName, setCookies } from "./support.js";

function wrongOrigins(publicOrigin: string): (string | false)[] {
  const u = new URL(publicOrigin);
  return [false, "https://evil.example", "null", `${u.protocol}//${u.host}.evil.example`, `${u.protocol === "https:" ? "http:" : "https:"}//${u.host}`, `${publicOrigin}/`];
}

describe("AUTH-AC-014 through the deployed router", () => {
  it(tag("AUTH-AC-014", "through the deployed router: logout and mock-login without a session and with Origin missing or wrong are 403 AUTH.REQUEST_FORGERY with no effect; with the public origin they are accepted"), async () => {
    const c = client();
    const routes: [string, unknown, number][] = [
      ["/api/auth/logout", undefined, 204],
      ["/api/auth/mock-login", { level: "user", id: "c-b-ac014" }, 204],
    ];
    for (const [path, body] of routes) {
      for (const origin of wrongOrigins(c.baseUrl)) {
        const res = await c.post(path, body, { origin });
        c.expectError(res, 403, "AUTH.REQUEST_FORGERY");
        expect(setCookies(res.headers).filter((k) => k.name === sessionCookieName()), `${path} with Origin ${String(origin)}: no session cookie set or cleared`).toEqual([]);
        expect(c.expectStatus(await c.get("/api/auth/me"), 200).json()).toStrictEqual({ level: "anonymous" });
      }
    }
    for (const [path, body, status] of routes) c.expectStatus(await client().post(path, body, { origin: c.baseUrl }), status);
  });
});
