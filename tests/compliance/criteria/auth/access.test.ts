/**
 * AUTH-AC-004 on the run's target (docs/components/auth.md AUTH-REQ-004): the reference app's
 * protected routes (ROUTES.md "Access levels") answer 401 and 403 as specified for each level,
 * and `requireCurrentUser(c)` (`GET /levels/current`) returns the user when logged in and
 * throws `AUTH.UNAUTHENTICATED` when anonymous.
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";

describe("AUTH-AC-004 route protection", () => {
  it(tag("AUTH-AC-004", "anonymous: requireUser and requireAdmin routes answer 401 AUTH.UNAUTHENTICATED; an open route answers 200"), async () => {
    const anon = client();
    anon.expectStatus(await anon.get("/api/levels/anyone"), 200);
    for (const path of ["/api/levels/user", "/api/levels/admin"]) {
      anon.expectError(await anon.get(path), 401, "AUTH.UNAUTHENTICATED");
      anon.expectError(await anon.post(path, {}), 401, "AUTH.UNAUTHENTICATED");
    }
  });

  it(tag("AUTH-AC-004", "user: requireUser routes answer 200 with the user; requireAdmin routes answer 403 AUTH.FORBIDDEN"), async () => {
    const user = await client().as("user", { id: "c-t3-ac004-user" });
    for (const res of [await user.get("/api/levels/user"), await user.post("/api/levels/user", {})]) {
      expect(user.expectStatus(res, 200).json()).toStrictEqual({ level: "user", id: "c-t3-ac004-user" });
    }
    user.expectError(await user.get("/api/levels/admin"), 403, "AUTH.FORBIDDEN");
    user.expectError(await user.post("/api/levels/admin", {}), 403, "AUTH.FORBIDDEN");
    user.expectStatus(await user.get("/api/levels/anyone"), 200);
  });

  it(tag("AUTH-AC-004", "admin: requireUser and requireAdmin routes answer 200 with the admin"), async () => {
    const admin = await client().as("admin", { id: "c-t3-ac004-admin" });
    for (const path of ["/api/levels/user", "/api/levels/admin"]) {
      expect(admin.expectStatus(await admin.get(path), 200).json()).toStrictEqual({ level: "admin", id: "c-t3-ac004-admin" });
      expect(admin.expectStatus(await admin.post(path, {}), 200).json()).toStrictEqual({ level: "admin", id: "c-t3-ac004-admin" });
    }
  });

  it(tag("AUTH-AC-004", "requireCurrentUser returns the logged-in user and throws AUTH.UNAUTHENTICATED when anonymous"), async () => {
    const anon = client();
    anon.expectError(await anon.get("/api/levels/current"), 401, "AUTH.UNAUTHENTICATED");
    const user = await client().as("user", { id: "c-t3-ac004-current" });
    expect(user.expectStatus(await user.get("/api/levels/current"), 200).json()).toStrictEqual({ level: "user", id: "c-t3-ac004-current" });
    const admin = await client().as("admin", { id: "c-t3-ac004-current-admin" });
    expect(admin.expectStatus(await admin.get("/api/levels/current"), 200).json()).toStrictEqual({ level: "admin", id: "c-t3-ac004-current-admin" });
  });
});
