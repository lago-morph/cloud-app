/**
 * HTTP-AC-005 (Cloud): two different mock users requesting the same personal route through the
 * deployed router each receive their own response; API responses carry `no-store`
 * (docs/components/http.md §4). Personal route: `GET /api/ref/me` (ROUTES.md) and the framework's
 * `GET /api/auth/me`.
 */
import { describe, expect, it } from "vitest";
import { client, tag, type HttpResponse } from "../../harness/index.js";
import { uniqueValue } from "../core/support/repo.js";

function expectNoStore(r: HttpResponse): void {
  const cc = r.headers.get("cache-control") ?? "";
  expect(cc.split(",").map((d) => d.trim().toLowerCase()), `${r.method} ${r.path} Cache-Control: ${cc}`).toContain("no-store");
}

describe("HTTP: API responses are not cached", () => {
  it(tag("HTTP-AC-005", "two mock users and an anonymous client alternately request the same personal routes and each gets its own response, every one marked no-store"), async () => {
    const idA = uniqueValue("c-t1-user-a-");
    const idB = uniqueValue("c-t1-user-b-");
    const c = client();
    const a = await c.as("user", { id: idA, displayName: "User A" });
    const b = await c.as("user", { id: idB, displayName: "User B" });
    const anonymous = client();

    for (let round = 0; round < 2; round += 1) {
      for (const [who, cl, expected] of [
        ["A", a, { level: "user", id: idA, displayName: "User A" }],
        ["B", b, { level: "user", id: idB, displayName: "User B" }],
        ["anonymous", anonymous, { level: "anonymous" }],
      ] as const) {
        const ref = cl.expectStatus(await cl.get("/api/ref/me"), 200);
        expectNoStore(ref);
        expect(ref.json<{ user: unknown }>().user, `round ${String(round)}: /api/ref/me for ${who}`).toEqual(expected);
        const me = cl.expectStatus(await cl.get("/api/auth/me"), 200);
        expectNoStore(me);
        const expectedMe = "id" in expected ? { level: "user", id: expected.id } : { level: "anonymous" };
        expect(me.json<{ level: string; id?: string }>(), `round ${String(round)}: /api/auth/me for ${who}`).toMatchObject(expectedMe);
      }
    }

    // Other API responses (another personal route, an error response) carry no-store too.
    expectNoStore(a.expectStatus(await a.get("/api/levels/user"), 200));
    expectNoStore(anonymous.expectError(await anonymous.get("/api/levels/user"), 401, "AUTH.UNAUTHENTICATED"));
    expectNoStore(anonymous.expectError(await anonymous.get("/api/does-not-exist"), 404, "HTTP.NOT_FOUND"));
  });
});
