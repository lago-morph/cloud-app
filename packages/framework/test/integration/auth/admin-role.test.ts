/**
 * Admins by role, anyone who signs in is a user, with the stub login provider, locally: AUTH-AC-003's
 * stub clause (docs/components/auth.md: "The same holds with `stubLoginProvider`, `loginWithStub`,
 * `grantRole` and `revokeRole`"). A grant or revoke through `TestApp.grantRole`/`revokeRole` changes
 * the level at the first request after the role refresh (PAR-425) of the same session, with no new
 * login and no rebuild. Configuration holds no admins or users list.
 *
 * E2E-007 (a role from account membership; a change shows at the next sign-in, DEC-0703, DEC-0791) is
 * tested in tests/compliance/e2e/E2E-007-E2E-018-signin.spec.ts. The stub's `grantRole` is no
 * membership change, so the last test here is tagged AUTH-AC-003, not E2E-007 (DEC-0759 superseded).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createTestApp } from "../../../src/testing/index.js";
import { authApp, disposeAll, expectError, me, newApp } from "./support.js";
import { ROLE_REFRESH_INTERVAL_SECONDS } from "../../../src/auth/role-refresh.js";

/** Just past PAR-425: a role change shows at the next role refresh (plan-v0.2.0 §4.1 step 5, DEC-0672). */
const REFRESH_DUE_MS = (ROLE_REFRESH_INTERVAL_SECONDS + 1) * 1000;

afterEach(disposeAll);

describe("the admin role", () => {
  it(tag("AUTH-AC-003", "every stub login is user; grantRole makes the first request after the role refresh admin and revokeRole makes it user again, with the same session"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    await app.loginWithStub("ac003-person");
    const before = await me(app);
    expect(before["level"]).toBe("user");
    const id = before["id"] as string;
    await expectError(await app.request("/api/admin-only"), "AUTH.FORBIDDEN");

    await app.grantRole(id, "admin");
    expect((await me(app))["level"], "within PAR-425 the session keeps its level").toBe("user");
    app.clock.advance(REFRESH_DUE_MS);
    expect(await me(app)).toStrictEqual({ level: "admin", id, displayName: expect.toSatisfy((v: unknown) => v === null || typeof v === "string") });
    const adminRoute = await app.request("/api/admin-only");
    expect(adminRoute.status).toBe(200);
    expect(await adminRoute.json()).toStrictEqual({ id, level: "admin" });

    await app.revokeRole(id, "admin");
    app.clock.advance(REFRESH_DUE_MS);
    expect((await me(app))["level"]).toBe("user");
    await expectError(await app.request("/api/admin-only"), "AUTH.FORBIDDEN");

    // Another person is unaffected by someone else's role.
    await app.grantRole(id, "admin");
    await app.loginWithStub("ac003-someone-else");
    expect((await me(app))["level"]).toBe("user");
    expect((await app.request("/api/user-only")).status).toBe(200);
  });

  it("an admins or users list in the framework configuration is refused, as the build refuses it", async () => {
    await expect(createTestApp(authApp(), { stubLoginProvider: true, config: { framework: { admins: [] } } })).rejects.toThrow(/unknown field "framework\.admins"/);
    await expect(createTestApp(authApp(), { stubLoginProvider: true, config: { framework: { users: [] } } })).rejects.toThrow(/unknown field "framework\.users"/);
  });
});

describe("becoming an admin through the stub (local, in-process)", () => {
  it(tag("AUTH-AC-003", "stub: log in, copy the ID from /api/auth/me, grantRole: admin after the next role refresh, with no new login"), async () => {
    // 1. Log in to a stage.
    const stage = await newApp({ stubLoginProvider: true });
    await stage.loginWithStub("e2e007-person", { displayName: "Person" });
    // 2. Copy the user ID from the account page.
    const account = await me(stage);
    expect(account["level"]).toBe("user");
    const copied = account["id"];
    expect(typeof copied).toBe("string");
    // Not admin before.
    await expectError(await stage.request("/api/admin-only"), "AUTH.FORBIDDEN");
    // 3. Grant the role through the stub; no redeploy, no new login.
    await stage.grantRole(copied as string, "admin");
    stage.clock.advance(REFRESH_DUE_MS);
    expect(await me(stage)).toStrictEqual({ level: "admin", id: copied, displayName: "Person" });
    expect((await stage.request("/api/admin-only")).status).toBe(200);
  });
});
