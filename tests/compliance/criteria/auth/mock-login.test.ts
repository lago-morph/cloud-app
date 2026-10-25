/**
 * AUTH-AC-009, test-stage part (docs/components/auth.md AUTH-REQ-009; framework.openapi.yaml
 * `/api/auth/mock-login`): on the run's target — local `dev` or a `test-` stage — the
 * authentication mock lets a test choose any identity: access level, user ID used as given (not
 * derived), and display name. The mock is reached only through mock-login: `/api/auth/login`
 * goes to the sign-in page (DEC-0516; contract.test.ts). The "404 on a production deployment"
 * part needs the redeployed `prodcheck` stage (not-run until the password provider runs on a
 * cloud stage: tests/compliance/harness/expected.ts, DEC-0509); "production bundles contain no
 * mock module" is a build inspection, not checked here.
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";

describe("AUTH-AC-009 mock-login on the test stage", () => {
  it(tag("AUTH-AC-009", "test-stage part: mock-login sets the chosen level, user ID (as given) and display name"), async () => {
    const cases = [
      { level: "user", id: "c-t3-ac009 user/ID:not-derived", displayName: "C-T3 Üser" },
      { level: "admin", id: "c-t3-ac009-admin", displayName: null },
    ] as const;
    for (const chosen of cases) {
      const c = client();
      c.expectStatus(await c.post("/api/auth/mock-login", chosen), 204);
      expect(c.expectStatus(await c.get("/api/auth/me"), 200).json()).toStrictEqual(chosen);
      expect(c.expectStatus(await c.get("/api/ref/me"), 200).json()).toStrictEqual({ user: chosen });
      expect(c.expectStatus(await c.get("/api/levels/user"), 200).json()).toStrictEqual({ level: chosen.level, id: chosen.id });
      const admin = await c.get("/api/levels/admin");
      if (chosen.level === "admin") expect(c.expectStatus(admin, 200).json()).toStrictEqual({ level: "admin", id: chosen.id });
      else c.expectError(admin, 403, "AUTH.FORBIDDEN");
    }
  });

  it(tag("AUTH-AC-009", "test-stage part: without an ID each level gets a fixed default ID; level anonymous logs out"), async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const c = client();
      c.expectStatus(await c.post("/api/auth/mock-login", { level: "user" }), 204);
      const me = c.expectStatus(await c.get("/api/auth/me"), 200).json<{ level: string; id: string; displayName: string | null }>();
      expect(me.level).toBe("user");
      expect(typeof me.id === "string" && me.id !== "").toBe(true);
      ids.push(me.id);
      c.expectStatus(await c.post("/api/auth/mock-login", { level: "anonymous" }), 204);
      expect(c.expectStatus(await c.get("/api/auth/me"), 200).json()).toStrictEqual({ level: "anonymous" });
      c.expectError(await c.get("/api/levels/user"), 401, "AUTH.UNAUTHENTICATED");
    }
    expect(ids[0]).toBe(ids[1]);
  });
});
